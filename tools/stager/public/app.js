import { LIBRARY, CATEGORIES, SHAPES, STYLES, ROOM_TYPES, PALETTE } from "./library.js";
import { drawShape } from "./shapes.js";
import { buildPrompt } from "./prompt.js";
import * as S3 from "./scene3d.js";
import { emptyWarp, isWarped, localCorners, quadFor, pointInQuad, centroid, warpToCanvas } from "./warp.js";

const $ = (id) => document.getElementById(id);
const canvas = $("canvas");
const ctx = canvas.getContext("2d");
const stage = $("stage");

const MY_CATEGORY = "My library";
const RATIOS = ["1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"];
const HANDLE = 7;
const ROT_OFFSET = 26;

const state = {
  photo: null, // { src, img, W, H }
  items: [],
  selected: null,
  scene: {
    room: ROOM_TYPES[0],
    style: STYLES[0],
    palette: "",
    clear: false,
    accessories: true,
    extra: "",
  },
  results: [], // { id, src, status: "loading" | "done" | "error", error }
  room: { ...S3.DEFAULT_ROOM }, // camera match for 3D placement
  myLibrary: [],
  config: { hasKey: false, model: "" },
};

let history = [];
let view = { s: 1, ox: 0, oy: 0 };
let drag = null;
let uidCounter = 1;
// "transform" shows move, resize and rotate handles. "corners" lets each
// corner be dragged on its own for perspective.
let editMode = "transform";
const warpCache = new Map();

const is3D = (item) => item.kind === "3d";
const aspect = () => (state.photo ? state.photo.W / state.photo.H : 1.5);
const canUse3D = (shape) => S3.has3D() && S3.supports3D(shape);

// Screen position of an image fraction.
const toScreen = (q) => ({ x: view.ox + q.u * state.photo.W * view.s, y: view.oy + q.v * state.photo.H * view.s });

function make3D(item, lib, u, v) {
  const dims = lib?.dims || [1, 0.6, 0.8];
  const p = S3.dropPoint(state.room, aspect(), u, v);
  Object.assign(item, {
    kind: "3d",
    x: p.x,
    z: p.z,
    yaw: 0,
    dims: { w: dims[0], d: dims[1], h: dims[2] },
    lift: lib?.lift || 0,
  });
}

function makeFlat(item) {
  const c = S3.itemCorners(state.room, aspect(), item);
  const pts = [...c.bottom, ...c.top];
  const us = pts.map((q) => q.u);
  const vs = pts.map((q) => q.v);
  Object.assign(item, {
    kind: "flat",
    cx: (Math.min(...us) + Math.max(...us)) / 2,
    cy: (Math.min(...vs) + Math.max(...vs)) / 2,
    w: Math.max(...us) - Math.min(...us),
    h: Math.max(...vs) - Math.min(...vs),
    rotation: 0,
    warp: emptyWarp(),
  });
}

// ---------- storage (per-browser conveniences only) ----------

function load(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v ? JSON.parse(v) : fallback;
  } catch {
    return fallback;
  }
}

function save(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

// ---------- helpers ----------

const defaultMount = (shape) =>
  ({ art: "wall", mirror: "wall", curtain: "wall", pendant: "ceiling", tableLamp: "surface", decor: "surface" })[shape] ||
  "floor";

function setStatus(msg) {
  $("status").textContent = msg || "";
}

function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not read that image"));
    img.src = src;
  });
}

// Re-encode an image so the longest side is at most maxSide.
async function downscale(src, maxSide, type = "image/jpeg", quality = 0.9) {
  const img = await loadImage(src);
  const k = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement("canvas");
  c.width = Math.round(img.naturalWidth * k);
  c.height = Math.round(img.naturalHeight * k);
  c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL(type, quality);
}

function nearestRatio(W, H) {
  const target = Math.log(W / H);
  let best = RATIOS[0];
  let bestDiff = Infinity;
  for (const r of RATIOS) {
    const [a, b] = r.split(":").map(Number);
    const d = Math.abs(Math.log(a / b) - target);
    if (d < bestDiff) {
      bestDiff = d;
      best = r;
    }
  }
  return best;
}

function dataUrlToBlob(dataUrl) {
  const [head, body] = dataUrl.split(",");
  const mime = /data:([^;]+)/.exec(head)?.[1] || "application/octet-stream";
  const bin = atob(body);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

// Saves a file. Inside a published claude.ai page, plain download links are
// blocked, so the platform's downloads capability is used when it is there.
let downloadsApi;
async function download(data, filename) {
  const blob = typeof data === "string" ? dataUrlToBlob(data) : data;
  if (downloadsApi === undefined) {
    downloadsApi = window.claude?.use ? await window.claude.use("downloads").catch(() => null) : null;
  }
  if (downloadsApi) {
    try {
      await downloadsApi.save({ filename, data: blob });
      return true;
    } catch (e) {
      if (e?.code !== "declined") setStatus(`Could not save ${filename}: ${e?.message || e}`);
      return false;
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  return true;
}

// In-page replacements for alert, confirm and prompt, which published pages
// cannot show.
function ask(message, { okLabel = "OK", cancelLabel = "Cancel", input = null } = {}) {
  return new Promise((resolve) => {
    const dlg = $("askDialog");
    $("askMessage").textContent = message;
    const field = $("askInput");
    field.hidden = input == null;
    field.value = input ?? "";
    $("askOk").textContent = okLabel;
    $("askCancel").hidden = cancelLabel == null;
    $("askCancel").textContent = cancelLabel || "";
    const done = (ok) => {
      dlg.close();
      $("askOk").onclick = $("askCancel").onclick = dlg.oncancel = null;
      resolve(input == null ? ok : ok ? field.value.trim() || null : null);
    };
    $("askOk").onclick = () => done(true);
    $("askCancel").onclick = () => done(false);
    dlg.oncancel = (ev) => {
      ev.preventDefault();
      done(false);
    };
    dlg.showModal();
    (input == null ? $("askOk") : field).focus();
  });
}

const notice = (message) => ask(message, { cancelLabel: null });

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  }
}

function snapshot() {
  history.push(JSON.stringify(state.items));
  if (history.length > 60) history.shift();
}

function undo() {
  const prev = history.pop();
  if (prev == null) return;
  state.items = JSON.parse(prev);
  if (!state.items.find((i) => i.uid === state.selected)) state.selected = null;
  refreshItemPanel();
  draw();
}

function selectedItem() {
  return state.items.find((i) => i.uid === state.selected) || null;
}

function nextColorIdx() {
  const used = new Set(state.items.map((i) => i.colorIdx));
  for (let i = 0; i < PALETTE.length; i++) if (!used.has(i)) return i;
  return state.items.length % PALETTE.length;
}

// ---------- library ----------

function allLibrary() {
  return [...state.myLibrary, ...LIBRARY];
}

function findLib(id) {
  return allLibrary().find((l) => l.id === id);
}

function thumb(entry) {
  const c = document.createElement("canvas");
  const dpr = window.devicePixelRatio || 1;
  c.width = 44 * dpr;
  c.height = 30 * dpr;
  const g = c.getContext("2d");
  g.scale(dpr, dpr);
  const aspect = entry.aspect || 1;
  let w = 40;
  let h = w / aspect;
  if (h > 26) {
    h = 26;
    w = h * aspect;
  }
  g.translate((44 - w) / 2, (30 - h) / 2);
  drawShape(g, entry.shape, w, h, "#6b7280", { alpha: 0.45, lineWidth: 1.2 });
  return c;
}

function renderLibrary() {
  const q = $("librarySearch").value.trim().toLowerCase();
  const list = $("libraryList");
  list.innerHTML = "";
  const cats = [MY_CATEGORY, ...CATEGORIES];
  for (const cat of cats) {
    const entries = allLibrary().filter(
      (e) => e.category === cat && (!q || `${e.name} ${e.prompt}`.toLowerCase().includes(q))
    );
    if (!entries.length) continue;
    const sec = document.createElement("div");
    sec.className = "lib-cat";
    const h = document.createElement("h4");
    h.textContent = cat;
    sec.appendChild(h);
    for (const e of entries) {
      const row = document.createElement("div");
      row.className = "lib-item";
      row.draggable = true;
      row.title = "Drag onto the photo, or click to add in the centre";
      row.appendChild(thumb(e));
      const name = document.createElement("span");
      name.textContent = e.name;
      row.appendChild(name);
      if (cat === MY_CATEGORY) {
        const del = document.createElement("button");
        del.className = "del";
        del.textContent = "x";
        del.title = "Remove from my library";
        del.onclick = async (ev) => {
          ev.stopPropagation();
          if (!(await ask(`Remove "${e.name}" from your library?`, { okLabel: "Remove" }))) return;
          state.myLibrary = state.myLibrary.filter((m) => m.id !== e.id);
          save("stager.library", state.myLibrary);
          renderLibrary();
        };
        row.appendChild(del);
      }
      row.addEventListener("dragstart", (ev) => {
        ev.dataTransfer.setData("text/stager-item", e.id);
        ev.dataTransfer.effectAllowed = "copy";
      });
      row.addEventListener("click", () => {
        if (!state.photo) return setStatus("Upload a photo first.");
        // Stagger click-added items so they do not stack on one spot.
        const n = state.items.length % 5;
        addItem(e.id, 0.3 + n * 0.1, state.room.enabled && e.dims ? 0.72 : 0.6);
      });
      sec.appendChild(row);
    }
    list.appendChild(sec);
  }
}

function addItem(libId, cx, cy) {
  const lib = findLib(libId);
  if (!lib || !state.photo) return;
  snapshot();
  const { W, H } = state.photo;
  const w = Math.min(0.95, lib.w);
  let h = (w * W) / lib.aspect / H;
  let wFinal = w;
  if (h > 0.9) {
    wFinal = (w * 0.9) / h;
    h = 0.9;
  }
  const colorIdx = nextColorIdx();
  const item = {
    uid: `i${Date.now().toString(36)}${uidCounter++}`,
    libId: lib.id,
    name: lib.name,
    shape: lib.shape,
    prompt: lib.prompt || "",
    notes: lib.notes || "",
    facing: lib.facing || "",
    mount: lib.mount || defaultMount(lib.shape),
    colorIdx,
    colorName: PALETTE[colorIdx].name,
    color: PALETTE[colorIdx].hex,
    cx,
    cy,
    w: wFinal,
    h,
    rotation: 0,
    flip: false,
    skewX: 0,
    skewY: 0,
    perspX: 0,
    perspY: 0,
    warp: emptyWarp(),
    ref: lib.ref || null,
  };
  if (state.room.enabled && lib.dims && canUse3D(lib.shape)) make3D(item, lib, cx, cy);
  // Rugs go underneath everything else.
  if (lib.shape === "rug") state.items.unshift(item);
  else state.items.push(item);
  state.selected = item.uid;
  refreshItemPanel();
  draw();
  if (lib.shape === "box" && !item.prompt) $("itemPrompt").focus();
}

// ---------- canvas view ----------

function resizeCanvas() {
  const rect = stage.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.round(rect.width * dpr));
  canvas.height = Math.max(1, Math.round(rect.height * dpr));
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  computeView();
  draw();
}

function computeView() {
  if (!state.photo) return;
  const rect = stage.getBoundingClientRect();
  const { W, H } = state.photo;
  const s = Math.min(rect.width / W, rect.height / H) * 0.97;
  view = { s, ox: (rect.width - W * s) / 2, oy: (rect.height - H * s) / 2 };
}

function screenBox(item) {
  const { W, H } = state.photo;
  return {
    x: view.ox + item.cx * W * view.s,
    y: view.oy + item.cy * H * view.s,
    w: item.w * W * view.s,
    h: item.h * H * view.s,
    r: ((item.rotation || 0) * Math.PI) / 180,
  };
}

function rotatePt(x, y, r) {
  const c = Math.cos(r);
  const s = Math.sin(r);
  return { x: x * c - y * s, y: x * s + y * c };
}

function handlesFor(item) {
  if (is3D(item)) {
    const t = S3.turnHandle(state.room, aspect(), item);
    return t.behind ? {} : { turn: toScreen(t) };
  }
  const b = screenBox(item);
  const pts = {};
  if (editMode === "corners") {
    quadFor(item, b).forEach((p, i) => (pts[`c${i}`] = { x: p.x, y: p.y, i }));
    return pts;
  }
  for (const [name, sx, sy] of [
    ["nw", -1, -1],
    ["ne", 1, -1],
    ["se", 1, 1],
    ["sw", -1, 1],
  ]) {
    const p = rotatePt((sx * b.w) / 2, (sy * b.h) / 2, b.r);
    pts[name] = { x: b.x + p.x, y: b.y + p.y, sx, sy };
  }
  const rp = rotatePt(0, -b.h / 2 - ROT_OFFSET, b.r);
  pts.rot = { x: b.x + rp.x, y: b.y + rp.y };
  return pts;
}

// Flat rendering of an item's silhouette, used as the texture for warping.
function shapeTexture(item, w, h, alpha, lineWidth) {
  const k = Math.min(1, 1200 / Math.max(w, h, 1));
  const c = document.createElement("canvas");
  c.width = Math.max(2, Math.round(w * k));
  c.height = Math.max(2, Math.round(h * k));
  const g = c.getContext("2d");
  if (item.flip) {
    g.translate(c.width, 0);
    g.scale(-1, 1);
  }
  drawShape(g, item.shape, c.width, c.height, item.color, { alpha, lineWidth: Math.max(1, lineWidth * k) });
  return c;
}

function drawItem(g, item, box, { alpha, lineWidth, badgeR, showName, index, cache = false }) {
  if (badgeR === 0) showName = false;
  let center = { x: box.x, y: box.y };
  if (isWarped(item)) {
    const quad = quadFor(item, box);
    center = centroid(quad);
    const key = JSON.stringify([item.shape, item.color, item.flip, alpha, lineWidth, quad.map((p) => [p.x.toFixed(1), p.y.toFixed(1)])]);
    let warped = cache && warpCache.get(item.uid)?.key === key ? warpCache.get(item.uid).warped : null;
    if (!warped) {
      warped = warpToCanvas(shapeTexture(item, box.w, box.h, alpha, lineWidth), quad);
      if (cache) warpCache.set(item.uid, { key, warped });
    }
    if (warped) g.drawImage(warped.canvas, warped.x, warped.y);
  } else {
    g.save();
    g.translate(box.x, box.y);
    g.rotate(box.r);
    if (item.flip) g.scale(-1, 1);
    g.translate(-box.w / 2, -box.h / 2);
    drawShape(g, item.shape, box.w, box.h, item.color, { alpha, lineWidth });
    g.restore();
  }
  if (badgeR) drawBadge(g, item, center.x, center.y, { badgeR, showName, index });
}

// Number badge, kept upright.
function drawBadge(g, item, x, y, { badgeR, showName, index }) {
  g.save();
  g.beginPath();
  g.arc(x, y, badgeR, 0, Math.PI * 2);
  g.fillStyle = item.color;
  g.fill();
  g.lineWidth = Math.max(1.5, badgeR / 7);
  g.strokeStyle = "#ffffff";
  g.stroke();
  g.fillStyle = "#ffffff";
  g.font = `700 ${Math.round(badgeR * 1.15)}px system-ui, sans-serif`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(String(index + 1), x, y + badgeR * 0.05);
  if (showName) {
    g.font = `600 12px system-ui, sans-serif`;
    const label = item.name;
    const tw = g.measureText(label).width + 10;
    g.fillStyle = "rgba(0,0,0,0.7)";
    g.fillRect(x - tw / 2, y + badgeR + 3, tw, 18);
    g.fillStyle = "#ffffff";
    g.fillText(label, x, y + badgeR + 12);
  }
  g.restore();
}

// Draws every placeholder onto g, where (ox, oy) and (pw, ph) place the photo.
// Flat pieces go first (they are mostly on walls), then the 3D layer, then
// all the number badges so none are hidden.
function drawAllItems(g, ox, oy, pw, ph, { alpha, lineWidth, badgeR, showName, cache, grid = false, pixelScale = 1 }) {
  const flat = [];
  state.items.forEach((item, index) => {
    if (is3D(item)) return;
    const box = {
      x: ox + item.cx * pw,
      y: oy + item.cy * ph,
      w: item.w * pw,
      h: item.h * ph,
      r: ((item.rotation || 0) * Math.PI) / 180,
    };
    drawItem(g, item, box, { alpha, lineWidth, badgeR: 0, showName: false, index, cache });
    const c = isWarped(item) ? centroid(quadFor(item, box)) : box;
    flat.push([item, index, c.x, c.y]);
  });
  const items3d = state.items.filter(is3D);
  if (S3.has3D() && (items3d.length || grid)) {
    const gl = S3.renderItems(state.room, items3d, pw * pixelScale, ph * pixelScale, { grid });
    g.drawImage(gl, ox, oy, pw, ph);
  }
  for (const [item, index, x, y] of flat) drawBadge(g, item, x, y, { badgeR, showName, index });
  state.items.forEach((item, index) => {
    if (!is3D(item)) return;
    const q = S3.project(state.room, aspect(), item.x, (item.lift || 0) + item.dims.h / 2, item.z);
    if (q.behind) return;
    drawBadge(g, item, ox + q.u * pw, oy + q.v * ph, { badgeR, showName, index });
  });
}

function draw() {
  const rect = stage.getBoundingClientRect();
  ctx.clearRect(0, 0, rect.width, rect.height);
  $("empty").classList.toggle("hidden", Boolean(state.photo));
  if (!state.photo) return;
  const { img, W, H } = state.photo;
  ctx.drawImage(img, view.ox, view.oy, W * view.s, H * view.s);

  if ($("showPlaceholders").checked) {
    drawAllItems(ctx, view.ox, view.oy, W * view.s, H * view.s, {
      alpha: 0.5,
      lineWidth: 2,
      badgeR: 11,
      showName: $("showNames").checked,
      cache: true,
      grid: state.room.grid || editMode === "camera",
      pixelScale: window.devicePixelRatio || 1,
    });
  }

  if (editMode === "camera") drawCameraOverlay();

  const sel = selectedItem();
  if (sel && is3D(sel) && $("showPlaceholders").checked) {
    drawSelection3D(sel);
  } else if (sel && $("showPlaceholders").checked) {
    const b = screenBox(sel);
    ctx.save();
    ctx.setLineDash([5, 4]);
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 1.5;
    if (editMode === "corners") {
      const q = quadFor(sel, b);
      ctx.beginPath();
      q.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.closePath();
      ctx.stroke();
    } else {
      ctx.translate(b.x, b.y);
      ctx.rotate(b.r);
      ctx.strokeRect(-b.w / 2, -b.h / 2, b.w, b.h);
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(0, -b.h / 2);
      ctx.lineTo(0, -b.h / 2 - ROT_OFFSET);
      ctx.stroke();
    }
    ctx.restore();
    const hs = handlesFor(sel);
    for (const [name, p] of Object.entries(hs)) {
      ctx.beginPath();
      if (name === "rot") ctx.arc(p.x, p.y, HANDLE, 0, Math.PI * 2);
      else if (name.startsWith("c")) ctx.arc(p.x, p.y, HANDLE + 1, 0, Math.PI * 2);
      else ctx.rect(p.x - HANDLE / 2 - 1, p.y - HANDLE / 2 - 1, HANDLE + 2, HANDLE + 2);
      ctx.fillStyle = name.startsWith("c") ? sel.color : "#ffffff";
      ctx.fill();
      ctx.strokeStyle = name.startsWith("c") ? "#ffffff" : sel.color;
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    if (editMode === "corners") {
      ctx.save();
      ctx.font = "600 12px system-ui, sans-serif";
      const msg = "Corner mode: drag any corner. Double-click or press Done to finish.";
      const tw = ctx.measureText(msg).width + 16;
      ctx.fillStyle = "rgba(0,0,0,0.72)";
      ctx.fillRect(10, 10, tw, 24);
      ctx.fillStyle = "#ffffff";
      ctx.fillText(msg, 18, 26);
      ctx.restore();
    }
  }
}

function drawSelection3D(item) {
  const c = S3.itemCorners(state.room, aspect(), item);
  const bot = c.bottom.map(toScreen);
  const top = c.top.map(toScreen);
  ctx.save();
  ctx.setLineDash([5, 4]);
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  for (const ring of [bot, top]) {
    ring.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.closePath();
  }
  for (let i = 0; i < 4; i++) {
    ctx.moveTo(bot[i].x, bot[i].y);
    ctx.lineTo(top[i].x, top[i].y);
  }
  ctx.stroke();
  // Front edge in solid colour so it is clear which way the piece faces.
  ctx.setLineDash([]);
  ctx.strokeStyle = item.color;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(bot[0].x, bot[0].y);
  ctx.lineTo(bot[1].x, bot[1].y);
  ctx.stroke();
  const h = handlesFor(item).turn;
  if (h) {
    const mid = { x: (bot[0].x + bot[1].x) / 2, y: (bot[0].y + bot[1].y) / 2 };
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(mid.x, mid.y);
    ctx.lineTo(h.x, h.y);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(h.x, h.y, HANDLE + 1, 0, Math.PI * 2);
    ctx.fillStyle = "#ffffff";
    ctx.fill();
    ctx.strokeStyle = item.color;
    ctx.lineWidth = 2;
    ctx.stroke();
  }
  ctx.restore();
}

function horizonY() {
  return view.oy + state.room.horizon * state.photo.H * view.s;
}

function drawCameraOverlay() {
  const y = horizonY();
  const x0 = view.ox;
  const x1 = view.ox + state.photo.W * view.s;
  ctx.save();
  ctx.strokeStyle = "#ffe066";
  ctx.lineWidth = 2;
  ctx.setLineDash([10, 6]);
  ctx.beginPath();
  ctx.moveTo(x0, y);
  ctx.lineTo(x1, y);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.font = "600 12px system-ui, sans-serif";
  const msg = "Eye level: drag this line to where the floor and ceiling lines meet";
  const tw = ctx.measureText(msg).width + 16;
  ctx.fillStyle = "rgba(0,0,0,0.72)";
  ctx.fillRect(x0 + 8, y - 30, tw, 22);
  ctx.fillStyle = "#ffe066";
  ctx.fillText(msg, x0 + 16, y - 15);
  ctx.restore();
}

// ---------- pointer interaction ----------

function pointerPos(ev) {
  const rect = canvas.getBoundingClientRect();
  return { x: ev.clientX - rect.left, y: ev.clientY - rect.top };
}

function hitTest(p) {
  const sel = selectedItem();
  if (sel) {
    for (const [name, h] of Object.entries(handlesFor(sel))) {
      if (Math.hypot(p.x - h.x, p.y - h.y) <= HANDLE + 4) return { item: sel, handle: name };
    }
  }
  if (S3.has3D()) {
    const items3d = state.items.filter(is3D);
    const u = (p.x - view.ox) / (state.photo.W * view.s);
    const v = (p.y - view.oy) / (state.photo.H * view.s);
    const uid = S3.pick(state.room, aspect(), items3d, u, v);
    if (uid) return { item: state.items.find((i) => i.uid === uid), handle: null };
  }
  for (let i = state.items.length - 1; i >= 0; i--) {
    const item = state.items[i];
    if (is3D(item)) continue;
    const b = screenBox(item);
    const l = rotatePt(p.x - b.x, p.y - b.y, -b.r);
    if (Math.abs(l.x) <= b.w / 2 + 3 && Math.abs(l.y) <= b.h / 2 + 3) return { item, handle: null };
    if (isWarped(item) && pointInQuad(p, quadFor(item, b))) return { item, handle: null };
  }
  return null;
}

canvas.addEventListener("pointerdown", (ev) => {
  if (!state.photo || !$("showPlaceholders").checked) return;
  const p = pointerPos(ev);
  if (editMode === "camera" && Math.abs(p.y - horizonY()) < 10) {
    canvas.setPointerCapture(ev.pointerId);
    drag = { mode: "horizon" };
    return;
  }
  const hit = hitTest(p);
  if (!hit) {
    state.selected = null;
    if (editMode !== "camera") editMode = "transform";
    refreshItemPanel();
    draw();
    return;
  }
  canvas.setPointerCapture(ev.pointerId);
  snapshot();
  const item = hit.item;
  if (item.uid !== state.selected && editMode !== "camera") editMode = "transform";
  state.selected = item.uid;
  refreshItemPanel();
  if (is3D(item)) {
    const fp = floorAt(p) || { x: item.x, z: item.z };
    drag = hit.handle === "turn" ? { mode: "turn3d", item } : { mode: "move3d", item, fp0: fp, x0: item.x, z0: item.z };
    draw();
    return;
  }
  const b = screenBox(item);
  if (hit.handle === "rot") {
    drag = { mode: "rotate", item };
  } else if (hit.handle?.startsWith("c")) {
    drag = { mode: "corner", item, i: Number(hit.handle.slice(1)) };
  } else if (hit.handle) {
    const hs = handlesFor(item);
    const opposite = { nw: "se", ne: "sw", se: "nw", sw: "ne" }[hit.handle];
    drag = {
      mode: "resize",
      item,
      sx: hs[hit.handle].sx,
      sy: hs[hit.handle].sy,
      anchor: { x: hs[opposite].x, y: hs[opposite].y },
      w0: b.w,
      h0: b.h,
    };
  } else {
    drag = { mode: "move", item, start: p, cx0: item.cx, cy0: item.cy };
  }
  draw();
});

canvas.addEventListener("pointermove", (ev) => {
  const p = pointerPos(ev);
  if (!drag && editMode === "camera" && state.photo && Math.abs(p.y - horizonY()) < 10) {
    canvas.style.cursor = "ns-resize";
    return;
  }
  if (!drag) {
    const hit = state.photo && $("showPlaceholders").checked ? hitTest(p) : null;
    canvas.style.cursor = !hit ? "default" : hit.handle === "rot" || hit.handle === "turn" ? "grab" : hit.handle?.startsWith("c") ? "crosshair" : hit.handle ? "nwse-resize" : "move";
    return;
  }
  const { W, H } = state.photo;
  const item = drag.item;
  if (drag.mode === "horizon") {
    state.room.horizon = Math.min(0.98, Math.max(0.02, (p.y - view.oy) / (H * view.s)));
    syncRoomFields();
  } else if (drag.mode === "move3d") {
    const fp = floorAt(p);
    if (fp && Math.hypot(fp.x, fp.z) < 60) {
      item.x = drag.x0 + fp.x - drag.fp0.x;
      item.z = Math.min(-0.3, drag.z0 + fp.z - drag.fp0.z);
    }
  } else if (drag.mode === "turn3d") {
    const fp = floorAt(p);
    if (fp) {
      let deg = (Math.atan2(fp.x - item.x, fp.z - item.z) * 180) / Math.PI;
      if (ev.shiftKey) deg = Math.round(deg / 15) * 15;
      else for (const snap of [-180, -90, 0, 90, 180]) if (Math.abs(deg - snap) < 4) deg = snap;
      item.yaw = deg;
      syncItem3DFields(item);
    }
  } else if (drag.mode === "move") {
    item.cx = drag.cx0 + (p.x - drag.start.x) / (W * view.s);
    item.cy = drag.cy0 + (p.y - drag.start.y) / (H * view.s);
  } else if (drag.mode === "rotate") {
    const b = screenBox(item);
    let deg = (Math.atan2(p.y - b.y, p.x - b.x) * 180) / Math.PI + 90;
    if (deg > 180) deg -= 360;
    if (ev.shiftKey) deg = Math.round(deg / 15) * 15;
    else if (Math.abs(deg) < 3) deg = 0;
    item.rotation = deg;
  } else if (drag.mode === "corner") {
    const b = screenBox(item);
    const l = rotatePt(p.x - b.x, p.y - b.y, -b.r);
    const base = localCorners(item, b.w, b.h, { withWarp: false })[drag.i];
    if (!item.warp) item.warp = emptyWarp();
    item.warp[drag.i] = { x: (l.x - base.x) / b.w, y: (l.y - base.y) / b.h };
  } else if (drag.mode === "resize") {
    const r = ((item.rotation || 0) * Math.PI) / 180;
    const v = rotatePt(p.x - drag.anchor.x, p.y - drag.anchor.y, -r);
    let w = Math.max(8, v.x * drag.sx);
    let h = Math.max(8, v.y * drag.sy);
    if (ev.shiftKey) {
      const k = Math.max(w / drag.w0, h / drag.h0);
      w = drag.w0 * k;
      h = drag.h0 * k;
    }
    const c = rotatePt((drag.sx * w) / 2, (drag.sy * h) / 2, r);
    item.cx = (drag.anchor.x + c.x - view.ox) / (W * view.s);
    item.cy = (drag.anchor.y + c.y - view.oy) / (H * view.s);
    item.w = w / (W * view.s);
    item.h = h / (H * view.s);
  }
  draw();
});

function floorAt(p) {
  const u = (p.x - view.ox) / (state.photo.W * view.s);
  const v = (p.y - view.oy) / (state.photo.H * view.s);
  return S3.floorPoint(state.room, aspect(), u, v);
}

function endDrag() {
  drag = null;
}
canvas.addEventListener("pointerup", endDrag);
canvas.addEventListener("pointercancel", endDrag);

// Drag from the library, or drop an image file to use as the photo.
stage.addEventListener("dragover", (ev) => {
  ev.preventDefault();
  stage.classList.add("drop");
});
stage.addEventListener("dragleave", () => stage.classList.remove("drop"));
stage.addEventListener("drop", async (ev) => {
  ev.preventDefault();
  stage.classList.remove("drop");
  const file = [...(ev.dataTransfer.files || [])].find((f) => f.type.startsWith("image/"));
  if (file) return setPhoto(await readFileAsDataURL(file));
  const id = ev.dataTransfer.getData("text/stager-item");
  if (!id) return;
  if (!state.photo) return setStatus("Upload a photo first.");
  const p = pointerPos(ev);
  const { W, H } = state.photo;
  addItem(id, (p.x - view.ox) / (W * view.s), (p.y - view.oy) / (H * view.s));
});

// ---------- photo ----------

async function setPhoto(src, { keepItems = false } = {}) {
  try {
    const img = await loadImage(src);
    if (state.photo && state.items.length && !keepItems) {
      if (!(await ask("Replace the photo? Your placeholders stay where they are, relative to the frame.", { okLabel: "Replace" }))) return;
    }
    state.photo = { src, img, W: img.naturalWidth, H: img.naturalHeight };
    computeView();
    draw();
    setStatus(`${img.naturalWidth} x ${img.naturalHeight}, output ratio ${nearestRatio(img.naturalWidth, img.naturalHeight)}`);
  } catch (e) {
    notice(e.message);
  }
}

$("photoInput").addEventListener("change", async (ev) => {
  const f = ev.target.files[0];
  if (f) await setPhoto(await readFileAsDataURL(f));
  ev.target.value = "";
});

window.addEventListener("paste", async (ev) => {
  if (isTyping(ev.target)) return;
  const file = [...(ev.clipboardData?.files || [])].find((f) => f.type.startsWith("image/"));
  if (file) setPhoto(await readFileAsDataURL(file));
});

// ---------- item panel ----------

function fillSelect(sel, values, labels = values) {
  sel.innerHTML = "";
  values.forEach((v, i) => {
    const o = document.createElement("option");
    o.value = v;
    o.textContent = labels[i];
    sel.appendChild(o);
  });
}

function refreshItemPanel() {
  const item = selectedItem();
  $("itemPanel").classList.toggle("hidden", !item);
  if (!item) return;
  const idx = state.items.indexOf(item);
  $("itemNumber").textContent = String(idx + 1);
  $("itemNumber").style.background = item.color;
  $("itemName").value = item.name;
  $("itemPrompt").value = item.prompt;
  $("itemNotes").value = item.notes;
  $("itemFacing").value = item.facing;
  $("itemMount").value = item.mount;
  $("itemShape").value = item.shape;
  $("itemColor").value = String(item.colorIdx);
  const three = is3D(item);
  document.querySelectorAll(".flat-only").forEach((el) => (el.hidden = three));
  document.querySelectorAll(".three-only").forEach((el) => (el.hidden = !three));
  $("itemMake3D").hidden = three || !canUse3D(item.shape);
  $("itemMakeFlat").hidden = !three;
  if (three) syncItem3DFields(item);
  for (const [id, key, scale] of PERSPECTIVE_FIELDS) {
    $(id).value = String(Math.round((item[key] || 0) * scale));
    $(`${id}Val`).textContent = $(id).value;
  }
  $("itemCorners").textContent = editMode === "corners" ? "Done" : "Drag corners";
  $("itemCorners").classList.toggle("primary", editMode === "corners");
  const prev = $("itemRefPreview");
  prev.classList.toggle("hidden", !item.ref);
  if (item.ref) prev.src = item.ref;
  else prev.removeAttribute("src");
}

function bindItemField(id, key, event = "input") {
  const el = $(id);
  el.addEventListener("focus", () => snapshot());
  el.addEventListener(event, () => {
    const item = selectedItem();
    if (!item) return;
    item[key] = el.value;
    draw();
  });
}
bindItemField("itemName", "name");
bindItemField("itemPrompt", "prompt");
bindItemField("itemNotes", "notes");
bindItemField("itemFacing", "facing", "change");
bindItemField("itemMount", "mount", "change");
bindItemField("itemShape", "shape", "change");

// Perspective sliders. Skew is stored in degrees, perspective as -1 to 1.
const PERSPECTIVE_FIELDS = [
  ["itemSkewX", "skewX", 1],
  ["itemSkewY", "skewY", 1],
  ["itemPerspX", "perspX", 100],
  ["itemPerspY", "perspY", 100],
];
for (const [id, key, scale] of PERSPECTIVE_FIELDS) {
  const el = $(id);
  el.addEventListener("pointerdown", () => snapshot());
  el.addEventListener("keydown", () => snapshot());
  el.addEventListener("input", () => {
    const item = selectedItem();
    if (!item) return;
    item[key] = Number(el.value) / scale;
    $(`${id}Val`).textContent = el.value;
    draw();
  });
  el.addEventListener("dblclick", () => {
    const item = selectedItem();
    if (!item) return;
    snapshot();
    item[key] = 0;
    refreshItemPanel();
    draw();
  });
}

function toggleCorners() {
  if (!selectedItem()) return;
  editMode = editMode === "corners" ? "transform" : "corners";
  refreshItemPanel();
  draw();
}
$("itemCorners").onclick = toggleCorners;
canvas.addEventListener("dblclick", (ev) => {
  const hit = state.photo && hitTest(pointerPos(ev));
  if (hit && hit.item.uid === state.selected) toggleCorners();
});
$("itemResetPersp").onclick = () => {
  const item = selectedItem();
  if (!item) return;
  snapshot();
  Object.assign(item, { skewX: 0, skewY: 0, perspX: 0, perspY: 0, warp: emptyWarp() });
  refreshItemPanel();
  draw();
};

// 3D size, turn and lift. Sizes show in centimetres.
const ITEM_3D_FIELDS = [
  ["itemDimW", (it) => it.dims.w * 100, (it, v) => (it.dims.w = Math.max(0.05, v / 100))],
  ["itemDimD", (it) => it.dims.d * 100, (it, v) => (it.dims.d = Math.max(0.01, v / 100))],
  ["itemDimH", (it) => it.dims.h * 100, (it, v) => (it.dims.h = Math.max(0.005, v / 100))],
  ["itemLift", (it) => (it.lift || 0) * 100, (it, v) => (it.lift = Math.max(0, v / 100))],
  ["itemYaw", (it) => it.yaw, (it, v) => (it.yaw = v)],
];

function syncItem3DFields(item) {
  for (const [id, get] of ITEM_3D_FIELDS) {
    if (document.activeElement !== $(id)) $(id).value = String(Math.round(get(item)));
  }
  $("itemYawVal").textContent = `${Math.round(item.yaw)}°`;
}

for (const [id, , set] of ITEM_3D_FIELDS) {
  const el = $(id);
  el.addEventListener("focus", () => snapshot());
  el.addEventListener("pointerdown", () => snapshot());
  el.addEventListener("input", () => {
    const item = selectedItem();
    const v = Number(el.value);
    if (!item || !is3D(item) || !Number.isFinite(v)) return;
    set(item, v);
    $("itemYawVal").textContent = `${Math.round(item.yaw)}°`;
    draw();
  });
}

$("itemMake3D").onclick = () => {
  const item = selectedItem();
  if (!item || !canUse3D(item.shape)) return;
  snapshot();
  make3D(item, findLib(item.libId), item.cx, item.cy + item.h / 2);
  refreshItemPanel();
  draw();
};
$("itemMakeFlat").onclick = () => {
  const item = selectedItem();
  if (!item || !is3D(item)) return;
  snapshot();
  makeFlat(item);
  refreshItemPanel();
  draw();
};

// Camera match for 3D placement. Eye level is stored as a fraction of the
// photo height, lens width in degrees, camera height in metres.
const ROOM_FIELDS = [
  ["roomHorizon", (r) => r.horizon * 100, (r, v) => (r.horizon = v / 100)],
  ["roomFov", (r) => r.fov, (r, v) => (r.fov = v)],
  ["roomHeight", (r) => r.camHeight * 100, (r, v) => (r.camHeight = v / 100)],
];

function syncRoomFields() {
  for (const [id, get] of ROOM_FIELDS) {
    $(id).value = String(Math.round(get(state.room)));
    $(`${id}Val`).textContent = $(id).value;
  }
  $("roomEnabled").checked = state.room.enabled;
  $("roomGrid").checked = state.room.grid;
  $("roomAdjust").textContent = editMode === "camera" ? "Done" : "Match camera";
  $("roomAdjust").classList.toggle("primary", editMode === "camera");
}

for (const [id, , set] of ROOM_FIELDS) {
  $(id).addEventListener("input", () => {
    set(state.room, Number($(id).value));
    $(`${id}Val`).textContent = $(id).value;
    draw();
  });
}
$("roomEnabled").addEventListener("change", () => (state.room.enabled = $("roomEnabled").checked));
$("roomGrid").addEventListener("change", () => {
  state.room.grid = $("roomGrid").checked;
  draw();
});
$("roomAdjust").onclick = () => {
  editMode = editMode === "camera" ? "transform" : "camera";
  syncRoomFields();
  draw();
};

$("itemColor").addEventListener("change", () => {
  const item = selectedItem();
  if (!item) return;
  snapshot();
  const idx = Number($("itemColor").value);
  item.colorIdx = idx;
  item.colorName = PALETTE[idx].name;
  item.color = PALETTE[idx].hex;
  refreshItemPanel();
  draw();
});

$("itemRefInput").addEventListener("change", async (ev) => {
  const item = selectedItem();
  const f = ev.target.files[0];
  ev.target.value = "";
  if (!item || !f) return;
  snapshot();
  item.ref = await downscale(await readFileAsDataURL(f), 1024, "image/jpeg", 0.88);
  refreshItemPanel();
});
$("itemRefClear").addEventListener("click", () => {
  const item = selectedItem();
  if (!item) return;
  snapshot();
  item.ref = null;
  refreshItemPanel();
});

function duplicateSelected() {
  const item = selectedItem();
  if (!item) return;
  snapshot();
  const colorIdx = nextColorIdx();
  const copy = {
    ...item,
    warp: (item.warp || emptyWarp()).map((c) => ({ ...c })),
    ...(is3D(item) ? { x: item.x + 0.4, dims: { ...item.dims } } : {}),
    uid: `i${Date.now().toString(36)}${uidCounter++}`,
    cx: item.cx + 0.03,
    cy: item.cy + 0.03,
    colorIdx,
    colorName: PALETTE[colorIdx].name,
    color: PALETTE[colorIdx].hex,
  };
  state.items.splice(state.items.indexOf(item) + 1, 0, copy);
  state.selected = copy.uid;
  refreshItemPanel();
  draw();
}

function deleteSelected() {
  const item = selectedItem();
  if (!item) return;
  snapshot();
  state.items = state.items.filter((i) => i !== item);
  S3.forget(item.uid);
  state.selected = null;
  refreshItemPanel();
  draw();
}

function moveLayer(delta) {
  const item = selectedItem();
  if (!item) return;
  const i = state.items.indexOf(item);
  const j = Math.max(0, Math.min(state.items.length - 1, i + delta));
  if (i === j) return;
  snapshot();
  state.items.splice(i, 1);
  state.items.splice(j, 0, item);
  refreshItemPanel();
  draw();
}

$("itemDuplicate").onclick = duplicateSelected;
$("itemDelete").onclick = deleteSelected;
$("itemForward").onclick = () => moveLayer(1);
$("itemBack").onclick = () => moveLayer(-1);
$("itemFlip").onclick = () => {
  const item = selectedItem();
  if (!item) return;
  snapshot();
  item.flip = !item.flip;
  draw();
};
$("itemResetRot").onclick = () => {
  const item = selectedItem();
  if (!item) return;
  snapshot();
  item.rotation = 0;
  draw();
};

$("itemSaveToLibrary").onclick = async () => {
  const item = selectedItem();
  if (!item || !state.photo) return;
  const name = await ask("Name for this library item", { okLabel: "Save", input: item.name });
  if (!name) return;
  const { W, H } = state.photo;
  const entry = {
    id: `my-${Date.now().toString(36)}`,
    name,
    category: MY_CATEGORY,
    shape: item.shape,
    w: item.w,
    aspect: (item.w * W) / (item.h * H),
    prompt: item.prompt,
    notes: item.notes,
    facing: item.facing,
    mount: item.mount,
    ref: item.ref,
  };
  state.myLibrary.unshift(entry);
  if (!save("stager.library", state.myLibrary)) {
    notice("Saved for this session, but the browser storage is full, so it will not survive a reload. Use Export my library to keep it.");
  }
  renderLibrary();
};

$("exportLibrary").onclick = () => {
  if (!state.myLibrary.length) return notice("Your library is empty. Select an item and use Save to my library first.");
  const blob = new Blob([JSON.stringify({ stagerLibrary: 1, items: state.myLibrary }, null, 2)], {
    type: "application/json",
  });
  download(blob, "stager-library.json");
};

$("libraryInput").addEventListener("change", async (ev) => {
  const f = ev.target.files[0];
  ev.target.value = "";
  if (!f) return;
  try {
    const data = JSON.parse(await f.text());
    const incoming = (data.items || []).filter((e) => e && e.name && e.shape);
    const known = new Set(state.myLibrary.map((e) => e.id));
    for (const e of incoming) {
      if (known.has(e.id)) continue;
      state.myLibrary.push({ ...e, category: MY_CATEGORY });
    }
    save("stager.library", state.myLibrary);
    renderLibrary();
    setStatus(`Imported ${incoming.length} library item(s).`);
  } catch {
    notice("That file is not a Stager library.");
  }
});

// ---------- scene ----------

const SCENE_FIELDS = [
  ["sceneRoom", "room", "value"],
  ["sceneStyle", "style", "value"],
  ["scenePalette", "palette", "value"],
  ["sceneClear", "clear", "checked"],
  ["sceneAccessories", "accessories", "checked"],
  ["sceneExtra", "extra", "value"],
];

function bindSceneFields() {
  for (const [id, key, prop] of SCENE_FIELDS) {
    const el = $(id);
    el.addEventListener(prop === "checked" ? "change" : "input", () => {
      state.scene[key] = el[prop];
      save("stager.scene", state.scene);
    });
  }
}

function syncSceneFields() {
  for (const [id, key, prop] of SCENE_FIELDS) $(id)[prop] = state.scene[key];
}

// ---------- guide, prompt, render ----------

function renderGuide(maxSide) {
  const { img, W, H } = state.photo;
  const k = Math.min(1, maxSide / Math.max(W, H));
  const c = document.createElement("canvas");
  c.width = Math.round(W * k);
  c.height = Math.round(H * k);
  const g = c.getContext("2d");
  g.drawImage(img, 0, 0, c.width, c.height);
  const long = Math.max(c.width, c.height);
  drawAllItems(g, 0, 0, c.width, c.height, {
    alpha: 0.62,
    lineWidth: Math.max(2, long / 500),
    badgeR: Math.max(12, long / 75),
    showName: false,
    cache: false,
  });
  return c;
}

function currentPrompt() {
  return buildPrompt(state.scene, state.items, state.photo?.W || 1, state.photo?.H || 1, state.room);
}

function openModal(title, node) {
  $("modalTitle").textContent = title;
  const body = $("modalBody");
  body.innerHTML = "";
  body.appendChild(node);
  $("modal").showModal();
}
$("modalClose").onclick = () => $("modal").close();

$("previewGuide").onclick = () => {
  if (!state.photo) return setStatus("Upload a photo first.");
  const img = new Image();
  img.src = renderGuide(1600).toDataURL("image/jpeg", 0.9);
  openModal("Layout guide (image 2)", img);
};

$("previewPrompt").onclick = () => {
  const pre = document.createElement("pre");
  pre.textContent = currentPrompt();
  openModal("Prompt", pre);
};

$("copyPrompt").onclick = async () => {
  setStatus((await copyText(currentPrompt())) ? "Prompt copied." : "Could not copy. Use Show prompt instead.");
};

$("exportPack").onclick = async () => {
  if (!state.photo) return setStatus("Upload a photo first.");
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
  const photo = document.createElement("canvas");
  photo.width = state.photo.W;
  photo.height = state.photo.H;
  photo.getContext("2d").drawImage(state.photo.img, 0, 0);
  const files = [
    [photo.toDataURL("image/jpeg", 0.95), `stager-${stamp}-1-photo.jpg`],
    [renderGuide(4096).toDataURL("image/png"), `stager-${stamp}-2-guide.png`],
    [new Blob([currentPrompt()], { type: "text/plain" }), `stager-${stamp}-prompt.txt`],
  ];
  state.items.forEach((it, i) => {
    if (it.ref) files.push([it.ref, `stager-${stamp}-ref-item-${i + 1}.jpg`]);
  });
  setStatus("Saving the photo, guide and prompt.");
  let saved = 0;
  for (const [data, name] of files) {
    if (await download(data, name)) saved++;
    await new Promise((r) => setTimeout(r, 350));
  }
  setStatus(`Saved ${saved} of ${files.length} files.`);
};

async function renderOnce(payload, entry) {
  try {
    const r = await fetch("/api/render", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const json = await r.json().catch(() => ({ error: `Server returned ${r.status}` }));
    if (!r.ok || !json.images?.length) throw new Error(json.error || "No image returned");
    entry.src = json.images[0];
    entry.status = "done";
  } catch (e) {
    entry.status = "error";
    entry.error = e.message;
  }
  renderResults();
}

$("render").onclick = async () => {
  if (!state.photo) return setStatus("Upload a photo first.");
  if (!state.config.hasKey) return notice("Rendering needs the local Stager server running with GEMINI_API_KEY set. You can still use Download pack with Higgsfield.");
  const count = Number($("renderCount").value);
  setStatus("Preparing images...");
  const photo = await downscale(state.photo.src, 2560, "image/jpeg", 0.92);
  const guide = renderGuide(2560).toDataURL("image/jpeg", 0.9);
  const payload = {
    prompt: currentPrompt(),
    photo,
    guide,
    references: state.items.filter((i) => i.ref).map((i) => i.ref),
    aspectRatio: nearestRatio(state.photo.W, state.photo.H),
    imageSize: $("renderSize").value,
  };
  const entries = [];
  for (let i = 0; i < count; i++) {
    const entry = { id: `r${Date.now()}${i}`, status: "loading", src: null, before: state.photo.src };
    state.results.unshift(entry);
    entries.push(entry);
  }
  renderResults();
  setStatus(`Rendering ${count} variation(s). This usually takes 20 to 60 seconds.`);
  await Promise.all(entries.map((e) => renderOnce(payload, e)));
  const failed = entries.filter((e) => e.status === "error").length;
  setStatus(failed ? `${failed} of ${count} render(s) failed.` : "Done.");
};

function renderResults() {
  const grid = $("results");
  grid.innerHTML = "";
  if (!state.results.length) {
    grid.innerHTML = '<p class="muted">Renders show up here.</p>';
    return;
  }
  for (const r of state.results) {
    const card = document.createElement("div");
    card.className = "result";
    if (r.status === "loading") {
      card.classList.add("loading");
      card.textContent = "Rendering...";
    } else if (r.status === "error") {
      card.classList.add("error");
      card.textContent = r.error;
      const x = document.createElement("button");
      x.className = "btn small";
      x.textContent = "Dismiss";
      x.style.marginTop = "8px";
      x.onclick = () => {
        state.results = state.results.filter((o) => o !== r);
        renderResults();
      };
      card.appendChild(document.createElement("br"));
      card.appendChild(x);
    } else {
      const img = document.createElement("img");
      img.src = r.src;
      img.onclick = () => openCompare(r);
      card.appendChild(img);
      const row = document.createElement("div");
      row.className = "row";
      const dl = document.createElement("button");
      dl.className = "btn small";
      dl.textContent = "Download";
      dl.onclick = () => download(r.src, `staged-${r.id}.${r.src.startsWith("data:image/jpeg") ? "jpg" : "png"}`);
      const base = document.createElement("button");
      base.className = "btn small";
      base.textContent = "Use as base";
      base.title = "Load this render as the photo and clear the placeholders, to add more items in a second pass";
      base.onclick = async () => {
        if (!(await ask("Use this render as the new photo? Current placeholders will be cleared (Undo brings them back).", { okLabel: "Use as base" }))) return;
        snapshot();
        state.items = [];
        state.selected = null;
        refreshItemPanel();
        await setPhoto(r.src, { keepItems: true });
      };
      row.append(dl, base);
      card.appendChild(row);
    }
    grid.appendChild(card);
  }
}

function openCompare(r) {
  const wrap = document.createElement("div");
  wrap.className = "compare";
  const before = document.createElement("img");
  before.src = r.before || state.photo.src;
  const afterWrap = document.createElement("div");
  afterWrap.className = "after";
  const after = document.createElement("img");
  after.src = r.src;
  after.style.width = "100%";
  after.style.height = "100%";
  after.style.objectFit = "fill";
  afterWrap.appendChild(after);
  const slider = document.createElement("input");
  slider.type = "range";
  slider.min = "0";
  slider.max = "100";
  slider.value = "50";
  const apply = () => (afterWrap.style.clipPath = `inset(0 ${100 - slider.value}% 0 0)`);
  slider.oninput = apply;
  apply();
  const holder = document.createElement("div");
  holder.style.position = "relative";
  holder.append(before, afterWrap);
  wrap.append(holder, slider);
  const note = document.createElement("p");
  note.className = "hint";
  note.textContent = "Slide to compare. Left of the line is the render, right is the original.";
  wrap.appendChild(note);
  openModal("Before and after", wrap);
}

// ---------- projects ----------

$("saveProject").onclick = () => {
  if (!state.photo) return setStatus("Nothing to save yet.");
  const data = {
    stagerProject: 1,
    scene: state.scene,
    room: state.room,
    items: state.items,
    photo: state.photo.src,
    results: state.results.filter((r) => r.status === "done").map(({ id, src, before }) => ({ id, src, before })),
  };
  const blob = new Blob([JSON.stringify(data)], { type: "application/json" });
  download(blob, `stager-project-${new Date().toISOString().slice(0, 10)}.json`);
};

$("projectInput").addEventListener("change", async (ev) => {
  const f = ev.target.files[0];
  ev.target.value = "";
  if (!f) return;
  try {
    const data = JSON.parse(await f.text());
    if (!data.stagerProject || !data.photo) throw new Error();
    snapshot();
    state.items = data.items || [];
    state.selected = null;
    state.scene = { ...state.scene, ...(data.scene || {}) };
    state.room = { ...S3.DEFAULT_ROOM, ...(data.room || {}) };
    syncRoomFields();
    state.results = (data.results || []).map((r) => ({ ...r, status: "done" }));
    syncSceneFields();
    refreshItemPanel();
    renderResults();
    await setPhoto(data.photo, { keepItems: true });
  } catch {
    notice("That file is not a Stager project.");
  }
});

// ---------- keyboard ----------

function isTyping(el) {
  return el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);
}

window.addEventListener("keydown", (ev) => {
  const mod = ev.ctrlKey || ev.metaKey;
  if (mod && ev.key.toLowerCase() === "z" && !isTyping(ev.target)) {
    ev.preventDefault();
    return undo();
  }
  if (isTyping(ev.target)) return;
  if (ev.key === "Escape" && editMode === "camera") return $("roomAdjust").click();
  const item = selectedItem();
  if (!item) return;
  if (ev.key === "Delete" || ev.key === "Backspace") {
    ev.preventDefault();
    deleteSelected();
  } else if (mod && ev.key.toLowerCase() === "d") {
    ev.preventDefault();
    duplicateSelected();
  } else if (ev.key === "Escape" && editMode === "corners") {
    toggleCorners();
  } else if (ev.key === "Escape") {
    state.selected = null;
    refreshItemPanel();
    draw();
  } else if (is3D(item) && (ev.key.startsWith("Arrow") || /^[qe]$/i.test(ev.key))) {
    ev.preventDefault();
    if (!ev.repeat) snapshot();
    const step = ev.shiftKey ? 0.25 : 0.05;
    if (ev.key === "ArrowLeft") item.x -= step;
    if (ev.key === "ArrowRight") item.x += step;
    if (ev.key === "ArrowUp") item.z = Math.min(-0.3, item.z - step);
    if (ev.key === "ArrowDown") item.z = Math.min(-0.3, item.z + step);
    if (/^q$/i.test(ev.key)) item.yaw -= ev.shiftKey ? 15 : 5;
    if (/^e$/i.test(ev.key)) item.yaw += ev.shiftKey ? 15 : 5;
    item.yaw = ((((item.yaw + 180) % 360) + 360) % 360) - 180;
    syncItem3DFields(item);
    draw();
  } else if (ev.key.startsWith("Arrow")) {
    ev.preventDefault();
    const step = (ev.shiftKey ? 10 : 1) / view.s;
    const { W, H } = state.photo;
    if (!ev.repeat) snapshot();
    if (ev.key === "ArrowLeft") item.cx -= step / W;
    if (ev.key === "ArrowRight") item.cx += step / W;
    if (ev.key === "ArrowUp") item.cy -= step / H;
    if (ev.key === "ArrowDown") item.cy += step / H;
    draw();
  }
});

$("undo").onclick = undo;
$("showNames").onchange = draw;
$("showPlaceholders").onchange = draw;
$("librarySearch").addEventListener("input", renderLibrary);

// ---------- init ----------

async function init() {
  state.myLibrary = load("stager.library", []);
  state.scene = { ...state.scene, ...load("stager.scene", {}) };
  fillSelect($("sceneRoom"), ROOM_TYPES);
  fillSelect($("sceneStyle"), STYLES);
  fillSelect($("itemShape"), SHAPES);
  fillSelect(
    $("itemColor"),
    PALETTE.map((_, i) => String(i)),
    PALETTE.map((p) => p.name)
  );
  syncSceneFields();
  bindSceneFields();
  syncRoomFields();
  if (!S3.has3D()) {
    state.room.enabled = false;
    $("roomCard").querySelector(".hint").textContent = "3D placement could not load in this browser, so every piece is placed flat.";
  }
  renderLibrary();
  renderResults();
  new ResizeObserver(resizeCanvas).observe(stage);
  resizeCanvas();

  try {
    const r = await fetch("/api/config");
    state.config = await r.json();
  } catch {
    state.config = { hasKey: false };
  }
  $("render").disabled = !state.config.hasKey;
  $("keyNote").textContent = state.config.hasKey
    ? `Renders go to ${state.config.model} through the local server.`
    : "Render needs the local Stager server with a Gemini key. Download pack works everywhere.";
}

init();
