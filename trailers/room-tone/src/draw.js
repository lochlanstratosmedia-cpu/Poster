// Room Tone trailer: builds the scene once, then draw(t) sets every element
// for time t. No CSS transitions or animations, so frames are deterministic.
(() => {
  const { T, UI, PAGE, E, ramp, win, blink, curve, lerp, clamp } = RT;
  const $ = (id) => document.getElementById(id);
  const px = (v) => `${v}px`;
  const params = new URLSearchParams(location.search);
  const RENDER = params.has("render");
  if (RENDER) document.body.classList.add("render");

  const NAV_ITEMS = ["Home", "Script", "Desk", "Sound", "Import", "PDF"];
  const FINAL = RT.finalDoc();
  const PAGES = RT.paginate(FINAL);
  const TOTAL = PAGES.length + 1; // with the title page

  // ------------------------------------------------------------- build
  function build() {
    const k = RT.PLATE.k;
    for (const id of ["plateOn", "plateOff"]) {
      const img = $(id);
      img.style.width = px(RT.PLATE.w * k);
      img.style.height = px(RT.PLATE.h * k);
      img.style.left = px(RT.PLATE.x0);
    }
    const pt = $("pageText");
    pt.style.transform = `translate(${PAGE.left}px, ${PAGE.top}px) scale(${PAGE.scale})`;

    const nav = $("nav");
    nav.style.width = px(UI.nav.w);
    nav.style.height = px(UI.nav.h);
    nav.style.padding = `0 ${UI.nav.padX}px`;
    nav.style.fontSize = px(UI.nav.font);
    nav.innerHTML = NAV_ITEMS.map((n) => `<span data-name="${n}" style="padding:${UI.nav.h * 0.16}px ${UI.nav.font * 0.55}px;margin:0 -${UI.nav.font * 0.55}px">${n}</span>`).join("");

    const S = UI.switches;
    const sw = $("switches");
    sw.style.top = px(S.top);
    sw.style.right = px(S.right);
    sw.style.gap = px(S.gap);
    const knob = S.h * 0.34;
    sw.innerHTML = ["light", "sound"].map((n) => `<div class="sw dim-glass" id="sw-${n}" style="height:${S.h}px;padding:0 ${S.h * 0.31}px 0 ${S.h * 0.28}px;gap:${S.h * 0.2}px;font-size:${S.font}px">
        <span class="swl"></span><div class="track" style="width:${S.h * 0.64}px;height:${S.h * 0.39}px"><div class="knob" style="width:${knob}px;height:${knob}px"></div></div></div>`).join("");

    const P = UI.pageNav;
    const pn = $("pageNav");
    Object.assign(pn.style, { left: px(P.left), top: px(P.top), width: px(P.w), height: px(P.h), fontSize: px(P.font) });
    pn.innerHTML = [["first", "&lt;&lt;", 0.068], ["prev", "&lt;", 0.179], ["label", "", 0.447], ["next", "&gt;", 0.713], ["last", "&gt;&gt;", 0.823], ["add", "+", 0.93]]
      .map(([id, s, f]) => `<span id="pn-${id}" style="left:${f * 100}%;padding:${P.h * 0.12}px ${P.h * 0.18}px;border-radius:6px">${s}</span>`).join("");
    const Z = UI.zoom;
    Object.assign($("zoom").style, { left: px(Z.left), top: px(Z.top), width: px(Z.w), height: px(Z.h), fontSize: px(P.font), opacity: 0.45 });
    Object.assign($("saved").style, { left: px(UI.saved.left), top: px(UI.saved.top), fontSize: px(UI.saved.font) });

    $("sound").innerHTML = RT.TRACKS.map((name, i) => `<div class="row" id="row-${i}"><span>${name}</span><span class="lvl" id="lvl-${i}"></span></div>`).join("");

    // Pointer shapes: an arrow and a text I-beam, drawn here.
    $("pointer").innerHTML = `
      <svg id="arrow" width="22" height="30" viewBox="-1 -1 15 21"><path d="M0 0 L0 15.6 L3.9 12 L6.6 18.2 L9 17.2 L6.4 11.2 L11.6 11.2 Z" fill="#111" stroke="#fff" stroke-width="1.15" stroke-linejoin="round"/></svg>
      <svg id="ibeam" width="14" height="30" viewBox="-5 -10 10 20" style="left:-7px;top:-15px"><path d="M-3 -8.5 Q0 -8.5 0 -6.5 Q0 -8.5 3 -8.5 M0 -6.5 V6.5 M-3 8.5 Q0 8.5 0 6.5 Q0 8.5 3 8.5" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round"/><path d="M-3 -8.5 Q0 -8.5 0 -6.5 Q0 -8.5 3 -8.5 M0 -6.5 V6.5 M-3 8.5 Q0 8.5 0 6.5 Q0 8.5 3 8.5" fill="none" stroke="#111" stroke-width="1.2" stroke-linecap="round"/></svg>`;

    // PDF: title sheet plus the paginated script, laid out in a row.
    const D = RT.PDF;
    const n = TOTAL;
    const total = n * D.pageW + (n - 1) * D.gap;
    D.startX = (RT.W - total) / 2;
    D.pageH = (D.pageW * 11) / 8.5;
    D.scale = D.pageW / 816;
    const cam = $("pdfCam");
    let html = "";
    for (let i = 0; i < n; i++) {
      const content = i === 0 ? RT.titleHTML(RT.SCRIPT.title, RT.SCRIPT.author) : RT.pageHTML(RT.layout(PAGES[i - 1]), i >= 2 ? i : null);
      html += `<div class="pdfpage" id="pdf-${i}" style="left:${D.startX + i * (D.pageW + D.gap)}px;top:${D.top}px;width:${D.pageW}px;height:${D.pageH}px"><div class="sheet" style="transform:scale(${D.scale})">${content}</div></div>`;
    }
    cam.innerHTML = html;
    // Centre of the "2." and "3." numbers, for the PDF camera.
    D.pairX = D.startX + 2 * (D.pageW + D.gap) + D.pageW + D.gap / 2;
  }

  // --------------------------------------------------- live measurements
  const navLeft = () => UI.nav.cx - UI.nav.w / 2;
  const navCy = (t) => lerp(UI.nav.homeCy, UI.nav.topCy, ramp(t, T.glide, T.glide + T.glideDur, E.inOut));
  function navItem(name, t, home) {
    const el = $("nav").querySelector(`[data-name="${name}"]`);
    return [navLeft() + el.offsetLeft + el.offsetWidth / 2, home ? UI.nav.homeCy : navCy(t)];
  }
  function centerOf(el, dx = 0, dy = 0) {
    let x = el.offsetWidth / 2, y = el.offsetHeight / 2;
    for (let n = el; n && n.id !== "ui"; n = n.offsetParent) { x += n.offsetLeft; y += n.offsetTop; }
    return [x + dx, y + dy];
  }
  const pageToApp = (x, y) => [PAGE.left + x * PAGE.scale, PAGE.top + y * PAGE.scale];

  function caretPage(doc, off, elIdx = doc.caret.el) {
    const lines = RT.layout(doc.els);
    const c = RT.caretAt(lines, elIdx, off);
    return { x: c.x * 96, y: 96 + c.row * 16, lines };
  }

  // Where the slim format pill sits: centred on the selection.
  function pillBox() {
    const d = RT.docAt(T.clickItalic - 0.01);
    const a = caretPage(d, d.sel.a), b = caretPage(d, d.sel.b);
    const [x0, y0] = pageToApp(a.x, a.y);
    const [x1] = pageToApp(b.x, b.y);
    const w = 100, h = 28;
    // Below the selected line, where the page is blank, so no text is hidden.
    return { left: (x0 + x1) / 2 - w / 2, top: y0 + 16 * PAGE.scale + 7, w, h };
  }

  function soundBox() {
    const [x] = navItem("Sound", 99);
    return { left: x - 98, top: UI.nav.topCy + UI.nav.h / 2 + 9 };
  }
  function menuBox() {
    const [x] = navItem("PDF", 99);
    const w = $("menu").offsetWidth || 104;
    return { left: x - w / 2, top: UI.nav.topCy + UI.nav.h / 2 + 9 };
  }

  function resolve(at, t) {
    const [kind, a, dx = 0, dy = 0] = at;
    let p;
    if (kind === "xy") return [a, dx];
    if (kind === "nav") p = navItem(a, t);
    else if (kind === "nav-home") p = navItem(a, t, true);
    else if (kind === "switch") {
      const tr = $(`sw-${a}`).querySelector(".track");
      p = centerOf(tr);
    } else if (kind === "soundRow") p = centerOf($(`row-${a}`), -40, 0);
    else if (kind === "pill") {
      const b = pillBox();
      p = [b.left + 50, b.top + b.h / 2];
    } else if (kind === "pageNav") p = centerOf($(`pn-${a}`));
    else if (kind === "menu") p = centerOf($("exportBtn"));
    else if (kind === "title") {
      const n = RT.typed(RT.AUTHOR_TYPING.keys, t);
      p = pageToApp(432 + Math.max(n, 3) * 4.8, RT.TITLE_ROWS.author * 16 + 8);
    } else if (kind === "char") {
      const d = RT.docAt(t);
      const c = caretPage(d, a);
      p = pageToApp(c.x, c.y + 8);
    }
    return [p[0] + dx, p[1] + dy];
  }

  // ----------------------------------------------------------- drawing
  const cache = new Map();
  const setHTML = (el, html) => {
    if (cache.get(el) !== html) {
      el.innerHTML = html;
      cache.set(el, html);
    }
  };
  const show = (el, o) => (el.style.opacity = o.toFixed(4));
  const pressed = (target, t) => RT.POINTER.clicks.some((c) => c.target === target && t >= c.t && t < c.t + 0.18);

  function pageView(t) {
    const v = RT.PAGE_VIEW;
    let i = 0;
    while (i + 1 < v.length && t >= v[i + 1][0]) i++;
    const p = i === 0 ? 1 : ramp(t, v[i][0], v[i][0] + (v[i][2] ?? RT.PAGE_FADE), E.soft);
    return { cur: v[i][1], prev: i ? v[i - 1][1] : "blank", p };
  }

  function viewHTML(view, t, doc) {
    if (view === "blank") return "";
    if (view === "live") return RT.pageHTML(RT.layout(doc.els), null);
    if (view === "final") return RT.pageHTML(RT.layout(PAGES[0]), null);
    if (view === "title") {
      const clicked = t >= T.clickAuthor;
      const n = RT.typed(RT.AUTHOR_TYPING.keys, t);
      return RT.titleHTML(RT.SCRIPT.title, RT.SCRIPT.author.slice(0, n), clicked ? "" : "Writer");
    }
    return "";
  }

  function drawPage(t) {
    const doc = RT.docAt(t);
    const v = pageView(t);
    setHTML($("faceA"), viewHTML(v.prev, t, doc));
    setHTML($("faceB"), viewHTML(v.cur, t, doc));
    show($("faceA"), 1 - v.p);
    show($("faceB"), v.p);

    // Selection highlight, one rect per wrapped line.
    let sel = "";
    if (v.cur === "live" && doc.sel && doc.sel.b > doc.sel.a) {
      const lines = RT.layout(doc.els).filter((l) => l.idx === doc.sel.el);
      for (const l of lines) {
        const a = Math.max(doc.sel.a, l.s), b = Math.min(doc.sel.b, l.e);
        if (b > a) sel += `<div class="selrect" style="top:${96 + l.row * 16}px;left:${(l.x + (a - l.s) * 0.1) * 96}px;width:${(b - a) * 9.6}px"></div>`;
      }
    }
    setHTML($("sel"), sel);

    // Caret: solid while keys are going down, blinking when idle.
    const caret = $("caret");
    let on = false, cx = 0, cy = 0;
    if (v.cur === "live" && t >= T.caretOn && t < T.wake && !(doc.sel && doc.sel.b > doc.sel.a)) {
      const c = caretPage(doc, doc.caret.off);
      cx = c.x; cy = c.y;
      on = t - doc.lastKey < 0.5 ? true : blink(t, Math.max(doc.lastKey, T.caretOn));
    } else if (v.cur === "title" && t >= T.clickAuthor && t < T.clickPdf) {
      const n = RT.typed(RT.AUTHOR_TYPING.keys, t);
      cx = 432 + n * 4.8;
      cy = RT.TITLE_ROWS.author * 16;
      const last = n ? RT.AUTHOR_TYPING.keys.times[n - 1] : T.clickAuthor;
      on = t - last < 0.5 ? true : blink(t, last);
    }
    caret.style.display = on ? "block" : "none";
    caret.style.left = px(cx - 0.8);
    caret.style.top = px(cy - 0.5);
    return v;
  }

  function drawControls(t, v) {
    // Nav: glides from the centre of the page to the top when a script opens.
    const nav = $("nav");
    nav.style.transform = `translate(${navLeft()}px, ${navCy(t) - UI.nav.h / 2}px)`;
    show(nav, curve(RT.ALPHA.nav, t));
    for (const s of nav.children) s.classList.toggle("pressed", pressed(`nav:${s.dataset.name}`, t));

    // Light and Sound switches.
    const lightP = ramp(t, T.clickLight + 0.02, T.clickLight + 0.26, E.std); // 0 on, 1 off
    const soundP = ramp(t, T.clickTrack + 0.08, T.clickTrack + 0.32, E.std); // 0 off, 1 on
    const setSwitch = (name, label, onAmt) => {
      const el = $(`sw-${name}`);
      el.querySelector(".swl").textContent = label;
      const tr = el.querySelector(".track"), kn = el.querySelector(".knob");
      const travel = tr.offsetWidth - kn.offsetWidth - 4;
      kn.style.left = px(2 + travel * onAmt);
      tr.style.background = `rgba(${Math.round(lerp(255, 161, onAmt))}, ${Math.round(lerp(255, 123, onAmt))}, ${Math.round(lerp(255, 64, onAmt))}, ${lerp(0.2, 0.95, onAmt).toFixed(3)})`;
      el.classList.toggle("pressed", pressed(`switch:${name}`, t));
    };
    setSwitch("light", lightP < 0.5 ? "Light on" : "Light off", 1 - lightP);
    setSwitch("sound", soundP < 0.5 ? "Sound off" : "Sound on", soundP);
    show($("switches"), curve(RT.ALPHA.switches, t));

    // Page nav and zoom along the bottom edge.
    const title = v.cur === "title";
    $("pn-label").textContent = title ? `Title page · 1/${TOTAL}` : `Page 1 · 2/${TOTAL}`;
    for (const id of ["first", "prev"]) $(`pn-${id}`).style.opacity = title ? 0.35 : 1;
    $("pn-first").classList.toggle("pressed", pressed("pageNav:first", t));
    const bar = curve(RT.ALPHA.bar, t);
    show($("pageNav"), bar);
    $("zoom").style.opacity = (bar * 0.5).toFixed(4);
    show($("saved"), curve(RT.ALPHA.saved, t));

    // Panels.
    const panel = (el, [a, b], box) => {
      const o = Math.min(ramp(t, a, a + 0.22, E.out), 1 - ramp(t, b, b + 0.18, E.std));
      el.style.display = o > 0.001 ? "" : "none";
      if (o <= 0.001) return 0;
      show(el, o);
      el.style.left = px(box.left);
      el.style.top = px(box.top);
      el.style.transform = `translateY(${(1 - ramp(t, a, a + 0.3, E.out)) * -5}px) scale(${lerp(0.97, 1, ramp(t, a, a + 0.3, E.out))})`;
      return o;
    };
    const so = panel($("sound"), RT.PANELS.sound, soundBox());
    const picked = t >= T.clickTrack;
    RT.TRACKS.forEach((_, i) => {
      $(`row-${i}`).classList.toggle("on", picked && i === RT.TRACK_PICK);
      $(`row-${i}`).classList.toggle("pressed", pressed(`row:${i}`, t));
      const on = picked && i === RT.TRACK_PICK;
      setHTML($(`lvl-${i}`), on ? [0, 1, 2].map((j) => `<i style="height:${(3 + 7 * (0.5 + 0.5 * Math.sin(t * (5.1 + j * 1.7) + j * 2.1))).toFixed(1)}px"></i>`).join("") : "");
    });
    const pb = pillBox();
    const po = panel($("pill"), RT.PANELS.pill, { left: pb.left, top: pb.top });
    $("pillI").classList.toggle("pressed", pressed("pill:I", t) || (t >= T.clickItalic && t < RT.PANELS.pill[1]));
    const mo = panel($("menu"), RT.PANELS.menu, menuBox());
    $("exportBtn").classList.toggle("pressed", pressed("menu:export", t));

    const stand = [];
    if (so > 0.01) stand.push("Sound panel");
    if (po > 0.01) stand.push("format pill");
    if (mo > 0.01) stand.push("PDF menu");
    const tag = $("tag");
    tag.textContent = RT.SHOW_STANDIN_TAG && stand.length ? `Draft · stand-in UI: ${stand.join(", ")}` : "";
  }

  function drawPointer(t, cam) {
    const P = RT.POINTER;
    const vis = Math.max(0, ...P.visible.map(([a, b]) => win(t, a, b, 0.25, 0.3)));
    const el = $("pointer");
    el.style.display = vis > 0.001 ? "block" : "none";
    if (vis <= 0.001) return;
    const keys = P.keys;
    let i = 0;
    while (i + 1 < keys.length && t >= keys[i + 1].t) i++;
    const k0 = keys[i], k1 = keys[i + 1];
    let x, y, shape = k0.shape;
    const p0 = resolve(k0.at, k0.t);
    if (!k1 || t <= k0.t || k1.t - k0.t > 3) {
      [x, y] = p0;
    } else {
      const p1 = resolve(k1.at, k1.t);
      const e = k1.ease === "std" ? E.std : E.inOut;
      const p = e((t - k0.t) / (k1.t - k0.t));
      // A slight arc reads as a hand on a trackpad rather than a robot.
      const bend = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) * 0.06 * Math.sin(Math.PI * p);
      const nx = -(p1[1] - p0[1]), ny = p1[0] - p0[0], nl = Math.hypot(nx, ny) || 1;
      x = lerp(p0[0], p1[0], p) + (nx / nl) * bend;
      y = lerp(p0[1], p1[1], p) + (ny / nl) * bend;
      shape = p < 0.5 ? k0.shape : k1.shape;
    }
    const click = P.clicks.some((c) => t >= c.t && t < c.t + 0.14);
    const s = Math.pow(cam.z, 0.5) / cam.z * (click ? 0.88 : 1);
    el.style.transform = `translate(${x}px, ${y}px) scale(${s})`;
    show(el, vis);
    $("arrow").style.display = shape === "arrow" ? "block" : "none";
    $("ibeam").style.display = shape === "ibeam" ? "block" : "none";
  }

  function drawPdf(t) {
    const pdf = $("pdf");
    const o = ramp(t, T.pdfIn, T.pdfIn + 0.55, E.soft);
    pdf.style.display = o > 0.001 && t < T.morph + T.morphDur + 0.05 ? "block" : "none";
    if (pdf.style.display === "none") return;
    const D = RT.PDF;
    const c = RT.camera(RT.PDF_CAM, t, (x) => (x === "pair" ? D.pairX : x));
    $("pdfCam").style.transform = `translate(960px, 540px) scale(${c.z}) translate(${-c.x}px, ${-c.y}px)`;

    // Hand-off: the other sheets clear, the backdrop lifts, and page 1 of
    // the PDF settles onto the desk page before the app's own text takes over.
    const m = ramp(t, T.morph, T.morph + T.morphDur, E.inOut);
    const others = 1 - ramp(t, T.morph, T.morph + 0.4, E.soft);
    const back = 1 - ramp(t, T.morph + 0.25, T.morph + 0.9, E.soft);
    pdf.style.background = `rgba(22, 20, 18, ${back.toFixed(4)})`;
    show(pdf, o);
    for (let i = 0; i < TOTAL; i++) {
      const pg = $(`pdf-${i}`);
      if (i !== 1) {
        show(pg, others);
        pg.style.transform = `translateY(${(1 - others) * 10}px)`;
        continue;
      }
      const L = D.startX + (D.pageW + D.gap), s = lerp(1, PAGE.width / D.pageW, m);
      pg.style.transform = `translate(${lerp(0, PAGE.left - L, m)}px, ${lerp(0, PAGE.top - D.top, m)}px) scale(${s})`;
      pg.style.transformOrigin = "0 0";
      pg.style.boxShadow = m > 0 ? `0 ${18 * (1 - m)}px ${50 * (1 - m)}px rgba(0,0,0,${0.45 * (1 - m)})` : "";
      show(pg, 1 - ramp(t, T.morph + T.morphDur - 0.3, T.morph + T.morphDur, E.soft));
    }
  }

  function drawType(t) {
    // Copy lines and their scrims.
    let left = 0, right = 0, html = "";
    for (const c of RT.COPY) {
      const o = win(t, c.in, c.out, 0.7, 0.45);
      if (o <= 0) continue;
      const rise = (1 - ramp(t, c.in, c.in + 0.9, E.out)) * 14;
      const tx = c.align === "right" ? "translateX(-100%)" : "";
      html += `<div class="copy" style="left:${c.x}px;top:${c.y - 36 + rise}px;opacity:${o.toFixed(4)};transform:${tx}">${c.text}</div>`;
      if (c.scrim === "left") left = Math.max(left, o);
      if (c.scrim === "right") right = Math.max(right, o);
    }
    $("copy").innerHTML = html;

    const keys = $("keys");
    let ko = 0;
    for (const k of RT.KEYS) {
      const o = win(t, k.in, k.out, 0.22, 0.2);
      if (o > ko) {
        ko = o;
        keys.querySelector(".cap").textContent = k.key;
        keys.querySelector(".lbl").textContent = k.label;
      }
    }
    show(keys, ko);
    left = Math.max(left, ko);
    show($("scrimL"), left);
    show($("scrimR"), right);

    // Black: fades up into the app at the start, down for the end card.
    const black = Math.max(1 - ramp(t, T.appIn, T.appIn + T.appInDur, E.soft), 0.86 * ramp(t, T.endDim, T.endDim + 1.0, E.soft));
    show($("black"), black);

    const word = $("word");
    const opening = t < T.appIn + 0.5;
    const caret = `<span class="caret" style="opacity:${blink(t, opening ? T.wordIn + 0.6 : T.endWord + 0.7) ? 1 : 0}"></span>`;
    if (opening) {
      setHTML(word, `Room Tone.${caret}`);
      word.style.fontSize = "100px";
      word.style.top = px(540 - 62 - (1 - ramp(t, T.wordIn, T.wordIn + 1.2, E.out)) * -10);
      show(word, win(t, T.wordIn, T.wordOut, 1.0, 0.55));
    } else {
      setHTML(word, `Room Tone${caret}`);
      word.style.fontSize = "112px";
      word.style.top = px(440 + (1 - ramp(t, T.endWord, T.endWord + 1.2, E.out)) * 12);
      show(word, ramp(t, T.endWord, T.endWord + 0.9, E.soft));
    }
    const line = $("line");
    line.style.top = px(600 + (1 - ramp(t, T.endLine, T.endLine + 1.1, E.out)) * 10);
    show(line, ramp(t, T.endLine, T.endLine + 0.9, E.soft));
  }

  function draw(t) {
    t = clamp(t, 0, RT.DURATION);
    const cam = RT.clampCam(RT.camera(RT.CAM, t));
    $("app").style.transform = `translate(960px, 540px) scale(${cam.z}) translate(${-cam.x}px, ${-cam.y}px)`;
    show($("plateOff"), ramp(t, T.clickLight + 0.05, T.clickLight + 0.05 + T.lightFade, E.soft));
    const v = drawPage(t);
    drawControls(t, v);
    drawPointer(t, cam);
    drawPdf(t);
    drawType(t);
    return t;
  }

  // ------------------------------------------------------------ startup
  async function start() {
    await Promise.all([
      document.fonts.load('16px "Script"'), document.fonts.load('italic 16px "Script"'),
      document.fonts.load('700 16px "Script"'), document.fonts.load('600 16px "UI"'), document.fonts.load('500 16px "UI"'),
      ...[...document.images].map((im) => im.decode().catch(() => {})),
    ]);
    build();
    draw(0);
  }
  window.ready = start();
  window.draw = draw;

  if (RENDER) return;

  // Preview player.
  const stage = $("stage"), vp = $("viewport");
  function fit() {
    const r = vp.getBoundingClientRect();
    const s = Math.min(r.width / RT.W, r.height / RT.H);
    vp.style.display = "block";
    stage.style.position = "absolute";
    stage.style.left = px((r.width - RT.W * s) / 2);
    stage.style.top = px((r.height - RT.H * s) / 2);
    stage.style.transform = `scale(${s})`;
  }
  addEventListener("resize", fit);
  fit();

  const scrub = $("scrub"), time = $("time"), play = $("play");
  scrub.max = String(RT.DURATION * RT.FPS);
  let now = Number(params.get("t") || 0), playing = false, last = 0;
  const show_t = (t) => {
    now = t;
    draw(t);
    scrub.value = String(Math.round(t * RT.FPS));
    time.textContent = `${t.toFixed(2)} s · f${Math.round(t * RT.FPS)}`;
  };
  const jumps = document.querySelector(".jumps");
  for (const s of [0, 5, 11, 20, 26, 34, 40]) {
    const b = document.createElement("button");
    b.textContent = `${s}s`;
    b.onclick = () => show_t(s);
    jumps.appendChild(b);
  }
  const loop = (ms) => {
    if (!playing) return;
    const dt = last ? (ms - last) / 1000 : 0;
    last = ms;
    let t = now + dt;
    if (t >= RT.DURATION) t = 0;
    show_t(t);
    requestAnimationFrame(loop);
  };
  const toggle = () => {
    playing = !playing;
    play.textContent = playing ? "Pause" : "Play";
    last = 0;
    if (playing) requestAnimationFrame(loop);
  };
  play.onclick = toggle;
  scrub.oninput = () => show_t(Number(scrub.value) / RT.FPS);
  addEventListener("keydown", (e) => {
    if (e.code === "Space") { e.preventDefault(); toggle(); }
    if (e.code === "ArrowRight") show_t(Math.min(RT.DURATION, now + (e.shiftKey ? 1 : 1 / RT.FPS)));
    if (e.code === "ArrowLeft") show_t(Math.max(0, now - (e.shiftKey ? 1 : 1 / RT.FPS)));
  });
  window.ready.then(() => show_t(now));
})();
