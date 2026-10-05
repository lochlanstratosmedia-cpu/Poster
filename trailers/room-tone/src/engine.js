// Room Tone trailer engine: easing, tracks, typing and screenplay layout.
// Everything is a pure function of time so any frame renders the same way.
window.RT = window.RT || {};
(() => {
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const lerp = (a, b, p) => a + (b - a) * p;

  function bezier(x1, y1, x2, y2) {
    const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
    const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
    const fx = (t) => ((ax * t + bx) * t + cx) * t;
    const fy = (t) => ((ay * t + by) * t + cy) * t;
    return (x) => {
      if (x <= 0) return 0;
      if (x >= 1) return 1;
      let lo = 0, hi = 1, t = x;
      for (let i = 0; i < 30; i++) {
        const v = fx(t);
        if (Math.abs(v - x) < 1e-6) break;
        if (v < x) lo = t; else hi = t;
        t = (lo + hi) / 2;
      }
      return fy(t);
    };
  }

  const E = {
    std: bezier(0.4, 0, 0.2, 1),
    inOut: bezier(0.65, 0, 0.35, 1),
    soft: bezier(0.45, 0, 0.2, 1),
    out: bezier(0.16, 1, 0.3, 1),
    in: bezier(0.55, 0, 0.75, 0.2),
    linear: (x) => clamp(x, 0, 1),
  };

  const ramp = (t, a, b, e = E.std) => (b <= a ? (t >= a ? 1 : 0) : e(clamp((t - a) / (b - a), 0, 1)));
  // Fade in over `fi` from a, fade out over `fo` ending at b.
  const win = (t, a, b, fi = 0.5, fo = 0.4) => (t < a || t > b ? 0 : Math.min(ramp(t, a, a + fi, E.out), 1 - ramp(t, b - fo, b, E.std)));
  const blink = (t, since = 0) => ((t - since) % 1.06) < 0.6;

  // [[t, v], ...] eased with E.soft between points.
  function curve(points, t) {
    if (t <= points[0][0]) return points[0][1];
    for (let i = 1; i < points.length; i++) {
      const [t1, v1] = points[i];
      if (t < t1) {
        const [t0, v0] = points[i - 1];
        return lerp(v0, v1, E.soft((t - t0) / (t1 - t0)));
      }
    }
    return points[points.length - 1][1];
  }

  // Camera track: x, y eased together, zoom eased in log space.
  function camera(keys, t, resolveX = (x) => x) {
    const val = (k) => ({ x: resolveX(k.x), y: k.y, z: k.z });
    if (t <= keys[0].t) return val(keys[0]);
    for (let i = 1; i < keys.length; i++) {
      const k1 = keys[i];
      if (t < k1.t) {
        const a = val(keys[i - 1]);
        if (k1.cut) return a;
        const b = val(k1);
        const p = E.soft((t - keys[i - 1].t) / (k1.t - keys[i - 1].t));
        return { x: lerp(a.x, b.x, p), y: lerp(a.y, b.y, p), z: Math.exp(lerp(Math.log(a.z), Math.log(b.z), p)) };
      }
    }
    return val(keys[keys.length - 1]);
  }

  function clampCam(c, w = RT.W, h = RT.H) {
    const hw = w / 2 / c.z, hh = h / 2 / c.z;
    return { x: c.z >= 1 ? clamp(c.x, hw, w - hw) : c.x, y: c.z >= 1 ? clamp(c.y, hh, h - hh) : c.y, z: c.z };
  }

  // ------------------------------------------------------------- typing
  function rng(seed) {
    return () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Keystroke times: steady rhythm, a touch slower after spaces and a
  // proper beat after punctuation, so it reads as a person typing.
  function keystrokes(text, start, cps, seed) {
    const r = rng(seed);
    const times = [];
    let t = start;
    for (let i = 0; i < text.length; i++) {
      times.push(t);
      let d = (1 / cps) * (0.72 + 0.56 * r());
      if (text[i] === " ") d *= 1.15;
      if (/[.,!?:]/.test(text[i])) d *= 2.1;
      t += d;
    }
    return { times, end: times.length ? times[times.length - 1] : start };
  }
  const typed = (k, t) => {
    let n = 0;
    while (n < k.times.length && k.times[n] <= t) n++;
    return n;
  };

  for (const ev of RT.EDITS) if (ev.op === "type") ev.keys = keystrokes(ev.text, ev.t, ev.cps, ev.seed);
  const A = RT.AUTHOR_TYPING;
  A.keys = keystrokes(RT.SCRIPT.author, A.t, A.cps, A.seed);

  // ------------------------------------------------------------ document
  const NEXT = { action: "action", scene: "action", character: "dialogue", paren: "dialogue", dialogue: "action", transition: "scene" };

  // The document at time t: elements, caret and selection.
  function docAt(t) {
    const els = RT.SCRIPT.opening.map((e) => ({ type: e.type, text: e.text, ital: [] }));
    const caret = { el: els.length - 1, off: 0 };
    let sel = null;
    let lastKey = -1;
    for (const ev of RT.EDITS) {
      if (t < ev.t) break;
      const cur = els[caret.el];
      if (ev.op === "type") {
        const n = typed(ev.keys, t);
        cur.text += ev.text.slice(0, n);
        if (cur.type === "character" || cur.type === "scene") cur.text = cur.text.toUpperCase();
        caret.off = cur.text.length;
        if (n) lastKey = ev.keys.times[n - 1];
      } else if (ev.op === "enter") {
        els.splice(caret.el + 1, 0, { type: NEXT[cur.type], text: "", ital: [] });
        caret.el += 1;
        caret.off = 0;
        lastKey = ev.t;
      } else if (ev.op === "tab") {
        // Smart Tab: an empty Action line becomes a Character cue.
        if (cur.type === "action" && cur.text === "") cur.type = "character";
        lastKey = ev.t;
      } else if (ev.op === "select") {
        const p = E.std(clamp((t - ev.t) / ev.dur, 0, 1));
        const b = Math.round(lerp(ev.from, ev.to, p));
        sel = { el: caret.el, a: ev.from, b };
        caret.off = b;
      } else if (ev.op === "italic") {
        if (sel) cur.ital.push([sel.a, sel.b]);
      } else if (ev.op === "collapse") {
        sel = null;
        caret.off = cur.text.length;
        lastKey = ev.t;
      }
    }
    return { els, caret, sel, lastKey };
  }

  function finalDoc() {
    const d = docAt(1e9);
    const els = d.els.filter((e) => e.text !== "");
    return els.concat(RT.SCRIPT.rest.map((e) => ({ type: e.type, text: e.text, ital: [] })));
  }

  // ------------------------------------------------------------- layout
  // Industry layout on US Letter, inches from the left edge of the page.
  const GEO = {
    scene: { x: 1.5, w: 60 },
    action: { x: 1.5, w: 60 },
    character: { x: 3.7, w: 38 },
    paren: { x: 3.1, w: 25 },
    dialogue: { x: 2.5, w: 35 },
    transition: { x: 1.5, w: 60, right: 7.5 },
  };
  const LINES_PER_PAGE = 54; // 1 inch top and bottom margins at 6 lines per inch
  const tight = (prev, cur) => (cur === "dialogue" || cur === "paren") && (prev === "character" || prev === "paren" || prev === "dialogue");

  function wrap(text, w) {
    const out = [];
    let s = 0;
    while (text.length - s > w) {
      let cut = text.lastIndexOf(" ", s + w);
      if (cut <= s) {
        out.push({ s, e: s + w });
        s += w;
      } else {
        out.push({ s, e: cut });
        s = cut + 1;
      }
    }
    out.push({ s, e: text.length });
    return out;
  }

  function elementLines(el) {
    const g = GEO[el.type];
    return wrap(el.text, g.w).map((l) => ({
      el, type: el.type, s: l.s, e: l.e, text: el.text.slice(l.s, l.e),
      x: g.right ? g.right - (l.e - l.s) * 0.1 : g.x,
    }));
  }

  // Lays out elements top to bottom; returns lines with a row index.
  function layout(els) {
    const lines = [];
    let row = 0;
    els.forEach((el, i) => {
      if (i > 0) row += tight(els[i - 1].type, el.type) ? 1 : 2;
      const ls = elementLines(el);
      ls.forEach((l, j) => lines.push({ ...l, idx: i, row: row + j }));
      row += ls.length - 1;
    });
    return lines;
  }

  // Row and column for a caret at character `off` of element `idx`.
  function caretAt(lines, idx, off) {
    const mine = lines.filter((l) => l.idx === idx);
    let pick = mine[0];
    for (const l of mine) if (l.s <= off) pick = l;
    const col = Math.min(off - pick.s, GEO[pick.type].w);
    return { row: pick.row, x: pick.x + col * 0.1, line: pick };
  }

  // Splits elements into pages. Character cues stay with their dialogue and
  // scene headings never end a page.
  function paginate(els) {
    const blocks = [];
    for (let i = 0; i < els.length; i++) {
      const b = [els[i]];
      if (els[i].type === "character") while (i + 1 < els.length && (els[i + 1].type === "dialogue" || els[i + 1].type === "paren")) b.push(els[++i]);
      blocks.push(b);
    }
    const height = (b) => layout(b).reduce((m, l) => Math.max(m, l.row + 1), 0);
    const pages = [[]];
    let used = 0;
    for (let i = 0; i < blocks.length; i++) {
      let need = height(blocks[i]) + (used ? 1 : 0);
      if (blocks[i][0].type === "scene" && blocks[i + 1]) need += 1 + Math.min(2, height(blocks[i + 1]));
      if (used && used + need > LINES_PER_PAGE) {
        pages.push([]);
        used = 0;
      }
      pages[pages.length - 1].push(...blocks[i]);
      used += height(blocks[i]) + (used ? 1 : 0);
    }
    return pages;
  }

  // ---------------------------------------------------------- page HTML
  const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  function lineHTML(l) {
    let html = "";
    let pos = l.s;
    const spans = (l.el.ital || []).map(([a, b]) => [Math.max(a, l.s), Math.min(b, l.e)]).filter(([a, b]) => b > a).sort((p, q) => p[0] - q[0]);
    for (const [a, b] of spans) {
      html += esc(l.el.text.slice(pos, a)) + "<i>" + esc(l.el.text.slice(a, b)) + "</i>";
      pos = b;
    }
    html += esc(l.el.text.slice(pos, l.e));
    return `<div class="ln" style="top:${96 + l.row * 16}px;left:${l.x * 96}px">${html}</div>`;
  }
  const pageHTML = (lines, number) => (number ? `<div class="ln num" style="top:48px;right:96px">${number}.</div>` : "") + lines.map(lineHTML).join("");

  function titleHTML(title, author, placeholder) {
    const a = author ? esc(author) : `<span class="ph">${esc(placeholder)}</span>`;
    return `<div class="ln ctr" style="top:${96 + 24 * 16 - 96}px">${esc(title)}</div>` +
      `<div class="ln ctr" style="top:${96 + 27 * 16 - 96}px">Written by</div>` +
      `<div class="ln ctr" style="top:${96 + 29 * 16 - 96}px">${a}</div>`;
  }
  const TITLE_ROWS = { title: 24, written: 27, author: 29 }; // rows from the top edge, 1/6 inch each

  Object.assign(RT, { clamp, lerp, E, ramp, win, blink, curve, camera, clampCam, keystrokes, typed, docAt, finalDoc, GEO, layout, caretAt, paginate, pageHTML, titleHTML, TITLE_ROWS, LINES_PER_PAGE });
})();
