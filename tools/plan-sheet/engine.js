/* Site plan sheet engine. Runs in a browser (needs DOM layout for geometry).
   SheetEngine.processFloorPlan(svgText, opts) cleans a Cubicasa floor plan SVG.
   SheetEngine.buildSheet({plan, site, brand, address, ...}) lays out the A3 sheet. */
(function (global) {
  const NS = 'http://www.w3.org/2000/svg';
  const XLINK = 'http://www.w3.org/1999/xlink';

  const BRANDS = {
    love: { font: "'Proxima Nova', 'proxima-nova', sans-serif", logo: 'love' },
    creer: { font: "'Area Normal', 'area-normal', sans-serif", logo: 'creer' },
    reeves: { font: "'Proxima Nova', 'proxima-nova', sans-serif", logo: 'reeves' }
  };

  const DEFAULT_RULES = {
    // Labels removed entirely (name and measurement).
    removeNames: ['other', 'room', 'yard', 'entry', 'entrance', 'foyer', 'hall', 'hallway', 'corridor', 'landing', 'passage', 'gallery', 'vestibule'],
    // Rooms that keep their name but lose the measurement line.
    noMeasure: ['bath', 'bathroom', 'ensuite', 'en suite', 'shower', 'wc', 'toilet', 'powder', 'powder room', 'laundry', "l'dry", 'ldry',
      'utility', 'pantry', 'linen', 'robe', 'wir', 'wic', 'w.i.c.', 'w.i.r.', 'walk-in robe', 'walk in robe', 'closet', 'storage', 'store', 'cupboard', 'mud room', 'mudroom', 'kitchen', 'kitchenette'],
    // Rooms that always keep their measurement, even when a name also matches a word above (e.g. "Bedroom / WIR").
    keepMeasure: ['bedroom', 'bedrooms', 'bed', 'beds', 'living', 'dining', 'family', 'lounge', 'meals'],
    // Summary lines and credits removed from the drawing.
    junk: [/^\s*disclaimer\b/i, /plans are indicative/i, /^\s*total\s*:/i, /\b\d+(\.\d+)?\s*m2\b/i, /excluded areas/i, /floor plan created by/i, /cubicasa/i, /measurements deemed/i]
  };

  const MEASURE_RE = /^\s*\d+(\.\d+)?\s*m?\s*[x×]\s*\d+(\.\d+)?\s*m?\s*$/i;
  const INHERIT = ['fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-width', 'stroke-opacity', 'stroke-dasharray',
    'stroke-dashoffset', 'stroke-linecap', 'stroke-linejoin', 'stroke-miterlimit', 'marker-start', 'marker-mid', 'marker-end',
    'font-family', 'font-size', 'font-weight', 'font-style', 'text-anchor', 'dominant-baseline', 'letter-spacing'];
  const LEAVES = 'polygon,polyline,line,path,rect,circle,ellipse,text,image,use';

  const norm = (s) => s.replace(/\s+/g, ' ').trim().toLowerCase().replace(/\s*\d+$/, '');
  // Whole-word phrase match: "Main Bathroom" contains "bathroom", "Bathroom" does not contain "bath".
  const words = (s) => s.toLowerCase().replace(/[’`]/g, "'").split(/[^a-z0-9']+/).filter(Boolean);
  const hasPhrase = (name, phrase) => {
    const w = words(name), p = words(phrase);
    if (!p.length) return false;
    for (let i = 0; i + p.length <= w.length; i++) if (p.every((x, j) => w[i + j] === x)) return true;
    return false;
  };
  const fmt = (m) => 'matrix(' + [m.a, m.b, m.c, m.d, m.e, m.f].map((v) => +v.toFixed(5)).join(',') + ')';

  function mount(svgText) {
    const host = document.createElement('div');
    host.style.cssText = 'position:absolute;left:-20000px;top:0;visibility:hidden';
    host.innerHTML = svgText.replace(/<\?xml[^>]*\?>/, '');
    document.body.appendChild(host);
    const root = host.querySelector('svg');
    const vb = (root.getAttribute('viewBox') || '').split(/[\s,]+/).map(Number);
    if (vb.length === 4) { root.setAttribute('width', vb[2]); root.setAttribute('height', vb[3]); }
    return { host, root };
  }

  function insideNonRender(el) {
    return !!el.closest('defs,pattern,marker,clipPath,mask,symbol');
  }

  function processFloorPlan(svgText, opts) {
    opts = opts || {};
    const rules = Object.assign({}, DEFAULT_RULES, opts.rules || {});
    const removeNames = new Set(rules.removeNames.map(norm));
    const noMeasure = rules.noMeasure;
    const keepMeasure = rules.keepMeasure || DEFAULT_RULES.keepMeasure;
    const report = { removedJunk: [], removedRooms: [], strippedMeasure: [], kept: [], north: null };
    const { host, root } = mount(svgText);
    const rootInv = root.getScreenCTM().inverse();
    const toRoot = (el) => rootInv.multiply(el.getScreenCTM());

    // North arrow: Cubicasa nests a small <svg> whose arrow points along +x in its own space.
    let north = null;
    root.querySelectorAll('svg').forEach((inner) => {
      if (inner === root || north !== null) return;
      const poly = inner.querySelector('polygon');
      if (!poly) return;
      const m = toRoot(inner);
      north = (Math.atan2(m.b, m.a) * 180 / Math.PI + 90 + 360) % 360;
      const g = inner.parentElement;
      (g && g !== root ? g : inner).remove();
    });
    report.north = north;

    // Text handling.
    const texts = [...root.querySelectorAll('text')].filter((t) => !insideNonRender(t));
    const center = (t) => { const b = t.getBBox(); const m = toRoot(t); const p = new DOMPoint(b.x + b.width / 2, b.y + b.height / 2).matrixTransform(m); return p; };
    const dead = new Set();
    texts.forEach((t) => {
      const s = t.textContent;
      if (rules.junk.some((re) => re.test(s))) { dead.add(t); report.removedJunk.push(s.trim()); }
    });
    const live = texts.filter((t) => !dead.has(t));
    const measures = live.filter((t) => MEASURE_RE.test(t.textContent));
    // Floor titles ("1st Floor", "Ground Floor", "Level 2") are captions for a whole level, not room names.
    const CAPTION_RE = /^\s*((\d+(st|nd|rd|th)|ground|first|second|third|lower|upper|basement|mezzanine|main|lower ground)\s+(floor|level)|level\s+\d+|floor\s+\d+|basement|attic|loft|mezzanine|ground)\s*$/i;
    const captions = [];
    // A bare "Basement", "Attic" or "Loft" with a room size right under it is a room name, not a level title.
    const BARE_RE = /^\s*(basement|attic|loft|mezzanine|ground)\s*$/i;
    const hasOwnMeasure = (t) => { const c = center(t), h = t.getBBox().height * Math.hypot(toRoot(t).a, toRoot(t).b) || 10; return measures.some((m) => { const d = center(m); return Math.abs(d.x - c.x) < 4 * h && d.y > c.y && d.y - c.y < 2.5 * h; }); };
    live.forEach((t) => { if (CAPTION_RE.test(t.textContent) && !(BARE_RE.test(t.textContent) && hasOwnMeasure(t))) { captions.push({ text: t.textContent.trim().replace(/\b\w/g, (c) => c.toUpperCase()).replace(/\b(Floor|Level)\b/, (w) => w.toLowerCase()), c: center(t) }); dead.add(t); } });
    const names = live.filter((t) => !MEASURE_RE.test(t.textContent) && !dead.has(t));
    const pairOf = new Map();
    measures.forEach((mt) => {
      const pm = center(mt);
      let best = null, bd = Infinity;
      names.forEach((nt) => {
        const pn = center(nt);
        const d = Math.hypot(pn.x - pm.x, pn.y - pm.y);
        if (d < bd) { bd = d; best = nt; }
      });
      const fs = parseFloat(getComputedStyle(mt).fontSize) || 10;
      const scale = Math.hypot(toRoot(mt).a, toRoot(mt).b);
      if (best && bd < fs * scale * 3) pairOf.set(best, mt);
    });
    // The small triangles Cubicasa puts on a room's walls to show where its measurement runs. They sit in the
    // same group as the room's label, so walk up from the label until a group holds them (and no other label).
    const isMarker = (el) => {
      const pts = el.getAttribute('points'); if (!pts) return false;
      const n = pts.trim().split(/[\s,]+/).map(Number);
      if (n.length !== 6 || n.some(isNaN)) return false;
      const xs = [n[0], n[2], n[4]], ys = [n[1], n[3], n[5]];
      return Math.max(...xs) - Math.min(...xs) <= 16 && Math.max(...ys) - Math.min(...ys) <= 16;
    };
    const markersFor = (nt, mt) => {
      for (let g = nt.parentElement; g && g !== root; g = g.parentElement) {
        if ([...g.querySelectorAll('text')].some((t) => t !== nt && t !== mt && !dead.has(t) && t.textContent.trim())) return [];
        const m = [...g.querySelectorAll('polygon')].filter(isMarker);
        if (m.length) return m;
      }
      return [];
    };
    const keepMarker = new Set();
    // A yard or garden Cubicasa traced as a room is the lot, not a building: its outline goes with its name,
    // or it ties every shed to the house and shrinks the plan. The outline is the smallest shape around the label.
    const OUTDOOR = new Set(['yard', 'front yard', 'back yard', 'backyard', 'rear yard', 'garden', 'lawn'].map(norm));
    const svgVB = root.viewBox.baseVal; const allArea = svgVB.width * svgVB.height;
    const dropOutline = (nt) => {
      const c = center(nt); const tb = nt.getBBox(); let best = null, ba = Infinity;
      root.querySelectorAll('polygon,path,rect,polyline').forEach((el) => {
        if (insideNonRender(el) || dead.has(el) || el.closest('text')) return;
        let bb; try { bb = el.getBBox(); } catch (e) { return; }
        const m = toRoot(el);
        const q = [[bb.x, bb.y], [bb.x + bb.width, bb.y], [bb.x, bb.y + bb.height], [bb.x + bb.width, bb.y + bb.height]].map(([x, y]) => new DOMPoint(x, y).matrixTransform(m));
        const x0 = Math.min(...q.map((p) => p.x)), x1 = Math.max(...q.map((p) => p.x)), y0 = Math.min(...q.map((p) => p.y)), y1 = Math.max(...q.map((p) => p.y));
        const area = (x1 - x0) * (y1 - y0);
        if (!(c.x > x0 && c.x < x1 && c.y > y0 && c.y < y1) || area > allArea * 0.5 || area < tb.width * tb.height * 20) return;
        if (area < ba) { ba = area; best = el; }
      });
      if (!best) return;
      dead.add(best); report.removedOutlines = (report.removedOutlines || 0) + 1;
      // Its boundary fences are thin open walls (dashed outline, no fill) that share the yard's edges.
      const ptsOf = (el) => { const m = toRoot(el); return (el.getAttribute('points') || '').trim().split(/[\s,]+/).map(Number).reduce((a, v, i, arr) => (i % 2 ? a : a.concat([new DOMPoint(v, arr[i + 1]).matrixTransform(m)])), []); };
      if (best.tagName !== 'polygon') return;
      const Y = ptsOf(best); const E = Y.map((p, i) => [p, Y[(i + 1) % Y.length]]);
      const tol = Math.max(svgVB.width, svgVB.height) * 0.006;
      const onEdge = (q) => E.some(([a, b]) => { const dx = b.x - a.x, dy = b.y - a.y; const t = Math.max(0, Math.min(1, ((q.x - a.x) * dx + (q.y - a.y) * dy) / ((dx * dx + dy * dy) || 1))); return Math.hypot(q.x - a.x - t * dx, q.y - a.y - t * dy) < tol; });
      root.querySelectorAll('polygon').forEach((el) => {
        if (el === best || dead.has(el) || insideNonRender(el)) return;
        const cs = getComputedStyle(el);
        if (!(cs.strokeDasharray && cs.strokeDasharray !== 'none') || parseFloat(cs.fillOpacity) > 0.01) return;
        const q = ptsOf(el); if (q.length < 3) return;
        if (q.filter(onEdge).length >= 2) { dead.add(el); report.removedOutlines++; }
      });
    };
    const dropMarkers = (nt, mt) => { const m = markersFor(nt, mt); m.forEach((el) => dead.add(el)); report.removedMarkers = (report.removedMarkers || 0) + m.length; };
    names.forEach((nt) => {
      const key = norm(nt.textContent);
      const mt = pairOf.get(nt);
      if (removeNames.has(key) && !(key === 'room' && mt)) {
        dropMarkers(nt, mt);
        if (OUTDOOR.has(key)) dropOutline(nt);
        dead.add(nt); if (mt) dead.add(mt); report.removedRooms.push(nt.textContent.trim());
      } else if (!keepMeasure.some((k) => hasPhrase(nt.textContent, k)) && noMeasure.some((k) => hasPhrase(nt.textContent, k))) {
        dropMarkers(nt, mt);
        if (mt) { dead.add(mt); report.strippedMeasure.push(nt.textContent.trim()); }
      } else {
        // A room with no measurement has nothing for its triangles to mark.
        if (!mt) dropMarkers(nt, mt); else markersFor(nt, mt).forEach((el) => keepMarker.add(el));
        report.kept.push(nt.textContent.trim() + (mt ? ' (' + mt.textContent.trim() + ')' : ''));
      }
    });
    // Any Cubicasa measurement triangle left that does not belong to a room still showing its measurement goes too
    // (e.g. rooms Cubicasa left unnamed).
    root.querySelectorAll('polygon').forEach((el) => {
      if (dead.has(el) || keepMarker.has(el) || insideNonRender(el)) return;
      const n = (el.getAttribute('points') || '').trim().split(/[\s,]+/).map(Number);
      if (n.length !== 6 || n.some((v) => isNaN(v) || Math.abs(v) > 5.01)) return;
      let apex = false; for (let i = 0; i < 6; i += 2) if (n[i] === 0 && n[i + 1] === 0) apex = true;
      if (!apex) return;
      dead.add(el); report.removedMarkers = (report.removedMarkers || 0) + 1;
    });
    const keptNames = new Set(names.filter((n) => !dead.has(n)));
    const keptMeasures = new Set(measures.filter((m) => !dead.has(m)));

    // Label centres in plan coordinates: a name and its measurement move as one block.
    const labelCentre = new Map();
    keptNames.forEach((nt) => {
      const a = center(nt); const mt = pairOf.get(nt);
      if (mt && keptMeasures.has(mt)) { const b = center(mt); const c = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; labelCentre.set(nt, c); labelCentre.set(mt, c); }
      else labelCentre.set(nt, { x: a.x, y: a.y });
    });

    // Collect visible leaves, skipping removed text and the white backdrop.
    const vb = root.viewBox.baseVal;
    const vbArea = vb.width * vb.height;
    const leaves = [];
    root.querySelectorAll(LEAVES).forEach((el) => {
      if (insideNonRender(el) || dead.has(el)) return;
      // Logos and other pictures embedded in the plan are dropped: the sheet footer carries the branding.
      if (el.tagName === 'image') { report.removedImages = (report.removedImages || 0) + 1; return; }
      if (el.closest('text') && el.tagName !== 'text') return;
      if (el.checkVisibility && !el.checkVisibility()) return;
      const r = el.getBoundingClientRect();
      const rb = root.getBoundingClientRect();
      const box = { x: vb.x + (r.left - rb.left) * vb.width / rb.width, y: vb.y + (r.top - rb.top) * vb.height / rb.height,
        w: r.width * vb.width / rb.width, h: r.height * vb.height / rb.height };
      if (el.tagName === 'rect' && box.w * box.h > vbArea * 0.5) return;
      if (box.w === 0 && box.h === 0) return;
      leaves.push({ el, box });
    });

    // Flatten each leaf into a self-contained clone (own matrix + resolved inherited style).
    leaves.forEach((L) => {
      const el = L.el;
      const cs = getComputedStyle(el);
      const c = el.cloneNode(true);
      c.removeAttribute('transform');
      c.removeAttribute('class');
      const st = [];
      INHERIT.forEach((p) => {
        const v = cs.getPropertyValue(p);
        if (p === 'fill' || p === 'stroke' || (v && v !== 'none' && v !== 'normal')) st.push(p + ':' + v);
      });
      let op = 1; for (let a = el; a && a !== root; a = a.parentElement) { const o = parseFloat(getComputedStyle(a).opacity); if (!isNaN(o)) op *= o; }
      if (op < 1) st.push('opacity:' + op);
      if (el.tagName === 'text') {
        const isName = keptNames.has(el);
        const isMeasure = keptMeasures.has(el);
        if (isName || isMeasure) {
          L.role = isName ? 'name' : 'measure';
        } else {
          L.role = 'name';
        }
      }
      if (el.tagName === 'text') {
        const lc = labelCentre.get(el) || center(el); L.anchor = { x: lc.x, y: lc.y };
        const m = toRoot(el); L.matrix = m; L.matrix0 = m; L.anchor0 = { x: lc.x, y: lc.y };
        L.angle = Math.atan2(m.b, m.a) * 180 / Math.PI;
        L.fontPlan = (parseFloat(cs.fontSize) || 10) * Math.hypot(m.a, m.b); // font size in plan units
      }
      c.setAttribute('style', st.join(';'));
      L.m = toRoot(el);
      c.setAttribute('transform', fmt(L.m));
      if (el.tagName === 'polygon' || el.tagName === 'polyline') {
        L.pts = [...el.points].map((p) => { const q = new DOMPoint(p.x, p.y).matrixTransform(L.m); return [q.x, q.y]; });
      }
      L.clone = c;
    });

    // Cluster leaves that touch (tolerance in plan units).
    const tol = Math.max(vb.width, vb.height) * 0.004;
    const parent = leaves.map((_, i) => i);
    const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
    for (let i = 0; i < leaves.length; i++) {
      const a = leaves[i].box;
      for (let j = i + 1; j < leaves.length; j++) {
        const b = leaves[j].box;
        if (a.x - tol <= b.x + b.w && b.x - tol <= a.x + a.w && a.y - tol <= b.y + b.h && b.y - tol <= a.y + a.h) {
          const ri = find(i), rj = find(j); if (ri !== rj) parent[ri] = rj;
        }
      }
    }
    const groups = new Map();
    leaves.forEach((L, i) => { const r = find(i); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(L); });
    let clusters = [...groups.values()].map((items) => {
      const x0 = Math.min(...items.map((l) => l.box.x)), y0 = Math.min(...items.map((l) => l.box.y));
      const x1 = Math.max(...items.map((l) => l.box.x + l.box.w)), y1 = Math.max(...items.map((l) => l.box.y + l.box.h));
      const labels = items.filter((l) => l.role === 'name').map((l) => l.el.textContent.trim());
      return { items, box: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }, labels, rooms: labels.length };
    });
    // Drop specks with no labels and a tiny footprint (stray marks).
    const maxArea = Math.max(...clusters.map((c) => c.box.w * c.box.h));
    clusters = clusters.filter((c) => c.rooms > 0 || c.box.w * c.box.h > maxArea * 0.02);
    clusters.sort((a, b) => b.rooms - a.rooms || b.box.w * b.box.h - a.box.w * a.box.h);
    const main = clusters[0];
    // Each floor title belongs to the nearest level (Cubicasa sets it just below the bottom-left corner).
    const distTo = (p, b) => Math.hypot(Math.max(b.x - p.x, 0, p.x - b.x - b.w), Math.max(b.y - p.y, 0, p.y - b.y - b.h));
    // Match titles to levels closest pair first, so each level gets the title set right under it.
    const pairs = [];
    captions.forEach((cap, ci) => clusters.forEach((c, k) => { if (c.rooms >= 1) pairs.push({ ci, k, d: distTo(cap.c, c.box) }); }));
    pairs.sort((a, b) => a.d - b.d);
    const usedCap = new Set(), usedCl = new Set();
    pairs.forEach((p) => { if (usedCap.has(p.ci) || usedCl.has(p.k)) return; usedCap.add(p.ci); usedCl.add(p.k); clusters[p.k].caption = captions[p.ci].text; });
    report.captions = captions.map((c) => c.text);
    clusters.forEach((c) => {
      if (captions.length) c.kind = c.caption ? 'floor' : 'outbuilding';
      else c.kind = (c === main || (c.rooms >= 4 && c.box.w * c.box.h > main.box.w * main.box.h * 0.35)) ? 'floor' : 'outbuilding';
      c.name = c.caption || (c.kind === 'floor' ? 'Floor' : (c.labels[0] || 'Structure'));
    });
    // Levels in floor order (1st, 2nd, 3rd ... or as found), so they sit left to right.
    const order = (c) => { if (!c.caption) return 99; const m = c.caption.match(/\d+/); if (m) return +m[0]; if (/basement|lower ground/i.test(c.caption)) return -1; if (/ground|lower/i.test(c.caption)) return 0; if (/first|main/i.test(c.caption)) return 1; if (/attic|loft/i.test(c.caption)) return 50; return 9; };
    clusters.sort((a, b) => order(a) - order(b));

    const defs = [...root.querySelectorAll('defs')].map((d) => d.cloneNode(true)).filter((d) => d.querySelector('marker,pattern,linearGradient,radialGradient,clipPath'));
    defs.forEach((d) => d.querySelectorAll('style').forEach((s) => s.remove()));
    host.remove();
    // Label blocks: a kept name with its measurement, moved together by fitLabels.
    const byEl = new Map(leaves.map((L) => [L.el, L]));
    const labels = [];
    keptNames.forEach((nt) => {
      const a = byEl.get(nt); if (!a) return;
      const mt = pairOf.get(nt); const b = mt && keptMeasures.has(mt) ? byEl.get(mt) : null;
      labels.push({ texts: b ? [a, b] : [a], name: nt.textContent.trim() });
    });
    const vbInfo = { x: vb.x, y: vb.y, w: vb.width, h: vb.height };
    return { clusters, defs, north, report, labels, vb: vbInfo, leaves };
  }

  // ---- label fitting: keep room names and measurements off fixtures ----
  async function fitLabels(plan, opts) {
    opts = opts || {};
    if (!plan || !plan.labels || !plan.labels.length) return [];
    const k = 4; // raster pixels per plan unit
    const vb = plan.vb, W = Math.ceil(vb.w * k), H = Math.ceil(vb.h * k);
    // Put every label back where the source had it, so fitting can be re-run at a new sheet scale.
    plan.labels.forEach((lab) => lab.texts.forEach((L) => { L.matrix = L.matrix0; L.anchor = { x: L.anchor0.x, y: L.anchor0.y }; L.clone.setAttribute('transform', fmt(L.matrix0)); }));
    let S = plan._occ, SS = plan._soft;
    if (!S) {
    // Draw the drawing (no text) straight onto a canvas. Building paths ourselves, rather than drawing an
    // SVG image, keeps the canvas readable in Safari and the Claude apps.
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const cx = cv.getContext('2d'); cx.fillStyle = '#fff'; cx.fillRect(0, 0, W, H);
    const num = (v, d) => { const f = parseFloat(v); return isNaN(f) ? d : f; };
    plan.leaves.forEach((L) => {
      const el = L.clone; if (!el || L.el.tagName === 'text' || L.el.tagName === 'image' || L.el.tagName === 'use') return;
      const tag = L.el.tagName; let p;
      try {
        if (tag === 'path') p = new Path2D(el.getAttribute('d') || '');
        else if (tag === 'polygon' || tag === 'polyline') {
          p = new Path2D(); const pts = (el.getAttribute('points') || '').trim().split(/[\s,]+/).map(Number);
          for (let i = 0; i + 1 < pts.length; i += 2) (i ? p.lineTo(pts[i], pts[i + 1]) : p.moveTo(pts[i], pts[i + 1]));
          if (tag === 'polygon') p.closePath();
        } else if (tag === 'line') { p = new Path2D(); p.moveTo(num(el.getAttribute('x1'), 0), num(el.getAttribute('y1'), 0)); p.lineTo(num(el.getAttribute('x2'), 0), num(el.getAttribute('y2'), 0)); }
        else if (tag === 'rect') { p = new Path2D(); p.rect(num(el.getAttribute('x'), 0), num(el.getAttribute('y'), 0), num(el.getAttribute('width'), 0), num(el.getAttribute('height'), 0)); }
        else if (tag === 'circle' || tag === 'ellipse') { p = new Path2D(); const r = num(el.getAttribute('r'), 0); p.ellipse(num(el.getAttribute('cx'), 0), num(el.getAttribute('cy'), 0), num(el.getAttribute('rx'), r), num(el.getAttribute('ry'), r), 0, 0, Math.PI * 2); }
        else return;
      } catch (e) { return; }
      const st = el.style, m = L.m;
      cx.setTransform(k, 0, 0, k, -vb.x * k, -vb.y * k); cx.transform(m.a, m.b, m.c, m.d, m.e, m.f);
      cx.globalAlpha = num(st.opacity, 1);
      const fill = st.fill, stroke = st.stroke;
      if (fill && fill !== 'none' && !/^url/.test(fill) && tag !== 'line' && tag !== 'polyline') {
        cx.globalAlpha *= num(st.fillOpacity, 1); cx.fillStyle = fill;
        cx.fill(p, st.fillRule === 'evenodd' ? 'evenodd' : 'nonzero'); cx.globalAlpha = num(st.opacity, 1);
      }
      if (stroke && stroke !== 'none' && !/^url/.test(stroke)) {
        cx.globalAlpha *= num(st.strokeOpacity, 1); cx.strokeStyle = stroke; cx.lineWidth = num(st.strokeWidth, 1); cx.stroke(p);
      }
    });
    cx.setTransform(1, 0, 0, 1, 0, 0); cx.globalAlpha = 1;
    const px = cx.getImageData(0, 0, W, H).data;
    if (opts.debug) plan._raster = cv.toDataURL('image/png');
    S = new Int32Array((W + 1) * (H + 1)); // integral image of dark pixels (lines, walls)
    SS = new Int32Array((W + 1) * (H + 1)); // light grey fills (pools, paving)
    for (let y = 0; y < H; y++) {
      let row = 0, srow = 0;
      for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4, v = px[i] + px[i + 1] + px[i + 2];
        if (v < 600) row++; else if (v < 735) srow++;
        S[(y + 1) * (W + 1) + x + 1] = S[y * (W + 1) + x + 1] + row;
        SS[(y + 1) * (W + 1) + x + 1] = SS[y * (W + 1) + x + 1] + srow;
      }
    }
    plan._occ = S; plan._soft = SS;
    }
    const sum = (A, x0, y0, x1, y1) => {
      x0 = Math.max(0, Math.floor((x0 - vb.x) * k)); y0 = Math.max(0, Math.floor((y0 - vb.y) * k));
      x1 = Math.min(W, Math.ceil((x1 - vb.x) * k)); y1 = Math.min(H, Math.ceil((y1 - vb.y) * k));
      if (x1 <= x0 || y1 <= y0) return Infinity;
      return A[y1 * (W + 1) + x1] - A[y0 * (W + 1) + x1] - A[y1 * (W + 1) + x0] + A[y0 * (W + 1) + x0];
    };
    const soft = (x0, y0, x1, y1) => sum(SS, x0, y0, x1, y1);
    const dark = (x0, y0, x1, y1) => {
      x0 = Math.max(0, Math.floor((x0 - vb.x) * k)); y0 = Math.max(0, Math.floor((y0 - vb.y) * k));
      x1 = Math.min(W, Math.ceil((x1 - vb.x) * k)); y1 = Math.min(H, Math.ceil((y1 - vb.y) * k));
      if (x1 <= x0 || y1 <= y0) return Infinity;
      return S[y1 * (W + 1) + x1] - S[y0 * (W + 1) + x1] - S[y1 * (W + 1) + x0] + S[y0 * (W + 1) + x0];
    };
    // Room outlines: closed shapes big enough to be a room. A label belongs to the smallest one around it.
    const inPoly = (pt, poly) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const a = poly[i], b = poly[j]; if ((a[1] > pt.y) !== (b[1] > pt.y) && pt.x < (b[0] - a[0]) * (pt.y - a[1]) / (b[1] - a[1]) + a[0]) c = !c; } return c; };
    const polyArea = (P) => Math.abs(P.reduce((t, a, i) => { const b = P[(i + 1) % P.length]; return t + a[0] * b[1] - b[0] * a[1]; }, 0)) / 2;
    const rooms = plan.leaves.filter((L) => L.pts && L.pts.length >= 3 && L.el.tagName === 'polygon').map((L) => ({ pts: L.pts, area: polyArea(L.pts) }));
    const roomCentre = (c, minArea) => {
      const r = rooms.filter((q) => q.area >= minArea && inPoly(c, q.pts)).sort((a, b) => a.area - b.area)[0];
      if (!r) return null;
      // Centroid of the outline; for odd shapes where that falls outside, use the middle of its bounds.
      let A = 0, X = 0, Y = 0; r.pts.forEach((a, i) => { const b = r.pts[(i + 1) % r.pts.length]; const f = a[0] * b[1] - b[0] * a[1]; A += f; X += (a[0] + b[0]) * f; Y += (a[1] + b[1]) * f; });
      let ctr = A ? { x: X / (3 * A), y: Y / (3 * A) } : null;
      if (!ctr || !inPoly(ctr, r.pts)) { const xs = r.pts.map((p) => p[0]), ys = r.pts.map((p) => p[1]); ctr = { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 }; }
      return { ctr, pts: r.pts };
    };
    // Text size: one printed size for every room name and measurement (opts.targetPlanSize, in plan
    // units), stepping down for tight rooms but never below the smallest step.
    const T = opts.targetPlanSize || null;
    const steps = [1, 11 / 12, 10 / 12];
    const placed = [];
    const hitsPlaced = (b) => placed.some((p) => b.x0 < p.x1 && p.x0 < b.x1 && b.y0 < p.y1 && p.y0 < b.y1);
    const moves = [];
    plan.labels.forEach((lab) => {
      const bx = lab.texts.map((L) => L.box);
      const x0 = Math.min(...bx.map((b) => b.x)), y0 = Math.min(...bx.map((b) => b.y));
      const x1 = Math.max(...bx.map((b) => b.x + b.w)), y1 = Math.max(...bx.map((b) => b.y + b.h));
      const c0 = { x: (x0 + x1) / 2, y: (y0 + y1) / 2 };
      const ang = lab.texts[0].angle || 0;
      const vertical = Math.abs(Math.abs(ang) - 90) < 5;
      const bw = (x1 - x0), bh = (y1 - y0);
      const f0 = lab.texts[0].fontPlan || 1;
      // Brand fonts set in semibold run wider than the source font.
      const grow = 1.15;
      // When the plan is turned a quarter on the sheet, labels stay upright there, so in plan space a label
      // that reads across the sheet runs up and down.
      const quarter = (((opts.rotate || 0) % 180) + 180) % 180 === 90;
      // sv: on a quarter-turned plan, read the label up the sheet (for narrow rooms) instead of across it.
      const sizeFor = (horiz, sc, sv) => {
        const lw = (vertical ? bh : bw) * grow * sc, lh = (vertical ? bw : bh) * sc, pad = Math.max(lw, lh) * 0.05;
        const across = { w: lw + 2 * pad, h: lh + 2 * pad }, down = { w: lh + 2 * pad, h: lw + 2 * pad };
        return ((horiz !== quarter) !== !!sv) ? across : down;
      };
      const boxAt = (c, sz) => ({ x0: c.x - sz.w / 2, y0: c.y - sz.h / 2, x1: c.x + sz.w / 2, y1: c.y + sz.h / 2 });
      // A label that starts on a grey fill (e.g. "Swimming Pool") may stay on it; others must keep off fills.
      const startArea = bw * bh * k * k;
      const onFill = soft(x0, y0, x1, y1) > startArea * 0.3;
      const fits = (c, sz) => { const b = boxAt(c, sz); const area = (b.x1 - b.x0) * (b.y1 - b.y0) * k * k; return dark(b.x0, b.y0, b.x1, b.y1) <= area * 0.004 && (onFill || soft(b.x0, b.y0, b.x1, b.y1) <= area * 0.02) && !hitsPlaced(b); };
      const scales = T ? steps.map((st) => T * st / f0) : [1, 0.85, 0.72];
      const room = roomCentre(c0, bw * bh * 25) || roomCentre(c0, bw * bh * 3);
      const target = room ? room.ctr : c0;
      const apply = (c, horiz, sc, why, sv) => {
        const delta = (horiz ? 0 : -90) - ang;
        const P = new DOMMatrix().translate(c.x, c.y).rotate(delta).scale(sc).translate(-c0.x, -c0.y);
        lab.texts.forEach((L) => { const m = P.multiply(L.matrix0); L.matrix = m; L.clone.setAttribute('transform', fmt(m)); L.anchor = { x: c.x, y: c.y }; L.sheetVertical = !!sv; });
        const sz = sizeFor(horiz, sc, sv);
        placed.push(boxAt(c, sz));
        moves.push({ name: lab.name, moved: Math.hypot(c.x - c0.x, c.y - c0.y) > 0.5, horizontal: horiz, step: T ? +(sc * f0 / T).toFixed(2) : sc, why: sv ? why + ' (reads up the sheet)' : why });
      };
      // Candidate spots: flood out from the label through clear floor (thin fixture lines can be crossed, walls cannot).
      let cand = null;
      const candidates = () => {
        if (cand) return cand;
        cand = [];
        const R = room ? Math.max(Math.max(bw, bh) * 3.5, Math.hypot(target.x - c0.x, target.y - c0.y) + Math.max(bw, bh) * 2) : Math.max(bw, bh) * 1.6, step = 0.5;
        const n = Math.ceil(R / step), size = 2 * n + 1, cellPx = step * step * k * k;
        const seen = new Uint8Array(size * size), q = [];
        const clear = (i, j) => dark(c0.x + (i - n) * step - step / 2, c0.y + (j - n) * step - step / 2, c0.x + (i - n) * step + step / 2, c0.y + (j - n) * step + step / 2) < cellPx * 0.6;
        let start = null;
        for (let r = 0; r <= n && !start; r++) for (let i = n - r; i <= n + r && !start; i++) for (let j = n - r; j <= n + r && !start; j++) if (clear(i, j)) start = [i, j];
        if (!start) return cand;
        q.push(start); seen[start[1] * size + start[0]] = 1;
        while (q.length) {
          const [i, j] = q.shift();
          const c = { x: c0.x + (i - n) * step, y: c0.y + (j - n) * step };
          if (!room || inPoly(c, room.pts)) cand.push({ c, d: Math.hypot(c.x - target.x, c.y - target.y) });
          [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(([di, dj]) => {
            const a = i + di, b = j + dj; if (a < 0 || b < 0 || a >= size || b >= size || seen[b * size + a]) return;
            seen[b * size + a] = 1; if (clear(a, b)) q.push([a, b]);
          });
        }
        cand.sort((p, q2) => p.d - q2.d);
        return cand;
      };
      for (const sc of scales) {
        for (const [horiz, sv] of (quarter ? [[true, false], [true, true]] : [[true, false], [false, false]])) {
          if ((!horiz || sv) && !vertical && sc === scales[0]) continue; // keep horizontal labels horizontal at full size
          const sz = sizeFor(horiz, sc, sv);
          // 1. Where the source put it (only if its orientation is kept).
          if (!sv && horiz === !vertical && fits(c0, sz)) { apply(c0, horiz, sc, 'in place'); return; }
          // 2. The middle of its room.
          if (room && fits(target, sz)) { apply(target, horiz, sc, 'room centre', sv); return; }
          // 3. The clear spot nearest the middle, preferring open floor.
          const ok = candidates().filter((p) => fits(p.c, sz)).slice(0, 400);
          if (ok.length) {
            const clearAround = (c) => { let m = 0; while (m < 4 && fits(c, { w: sz.w + 2 * (m + 0.25), h: sz.h + 2 * (m + 0.25) })) m += 0.25; return m; };
            let hit = null, best = Infinity;
            ok.forEach((p) => { const score = p.d - 0.5 * clearAround(p.c); if (score < best) { best = score; hit = p; } });
            apply(hit.c, horiz, sc, 'clear spot', sv); return;
          }
        }
      }
      // Still nothing: at the smallest size, allow the label over thin fixture lines (never walls or other labels).
      {
        const sc = scales[scales.length - 1];
        // Only inside a known room, and the whole label must stay within that room's outline.
        const insideRoom = (b) => room && [[b.x0, b.y0], [b.x1, b.y0], [b.x0, b.y1], [b.x1, b.y1]].every(([x, y]) => inPoly({ x, y }, room.pts));
        const loose = (c, sz) => { const b = boxAt(c, sz); const area = (b.x1 - b.x0) * (b.y1 - b.y0) * k * k; return insideRoom(b) && dark(b.x0, b.y0, b.x1, b.y1) <= area * 0.04 && !hitsPlaced(b); };
        for (const [horiz, sv] of (quarter ? [[true, false], [true, true]] : [[true, false], [false, false]])) {
          const sz = sizeFor(horiz, sc, sv);
          if (room && loose(target, sz)) { apply(target, horiz, sc, 'over fixtures', sv); return; }
          const ok = candidates().filter((p) => loose(p.c, sz));
          if (ok.length) { apply(ok[0].c, horiz, sc, 'over fixtures', sv); return; }
        }
      }
      // Nothing fits even at the smallest size: place it at the smallest size in the middle of the room and flag it.
      // Turn it if that keeps it inside the room's walls better (e.g. a long name in a narrow ensuite).
      {
        const sc = scales[scales.length - 1];
        let pick = [true, false], over = Infinity;
        if (room) {
          const xs = room.pts.map((q) => q[0]), ys = room.pts.map((q) => q[1]);
          const rw = Math.max(...xs) - Math.min(...xs), rh = Math.max(...ys) - Math.min(...ys);
          for (const o of (quarter ? [[true, false], [true, true]] : [[true, false], [false, false]])) {
            const sz = sizeFor(o[0], sc, o[1]); const v = Math.max(sz.w / rw, sz.h / rh);
            if (v < over - 0.05) { over = v; pick = o; }
          }
        }
        // Within the room, take the spot whose box covers the least linework (ties go to the centre).
        let spot = target;
        if (room) {
          const sz = sizeFor(pick[0], sc, pick[1]);
          const xs = room.pts.map((q) => q[0]), ys = room.pts.map((q) => q[1]);
          const R = { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
          // Any part of the label outside the room counts as fully covered.
          const cost = (c) => { const b = boxAt(c, sz); const inW = Math.max(0, Math.min(b.x1, R.x1) - Math.max(b.x0, R.x0)), inH = Math.max(0, Math.min(b.y1, R.y1) - Math.max(b.y0, R.y0)); return dark(b.x0, b.y0, b.x1, b.y1) + ((b.x1 - b.x0) * (b.y1 - b.y0) - inW * inH) * k * k; };
          let bestCost = cost(target) - 1e-6;
          candidates().forEach((p) => { if (!inPoly(p.c, room.pts) || hitsPlaced(boxAt(p.c, sz))) return; const v = cost(p.c) + p.d * 1e-3; if (v < bestCost) { bestCost = v; spot = p.c; } });
        }
        apply(spot, pick[0], sc, 'tight', pick[1]);
      }
    });
    plan.report.labelMoves = moves;
    return moves;
  }

  // ---- packing (MaxRects, best short side fit) ----
  function pack(region, rects, fixed) {
    let free = [{ x: region.x, y: region.y, w: region.w, h: region.h }];
    const placed = [];
    const cut = (p) => {
      const next = [];
      for (const f of free) {
        if (p.x >= f.x + f.w || p.x + p.w <= f.x || p.y >= f.y + f.h || p.y + p.h <= f.y) { next.push(f); continue; }
        if (p.x > f.x) next.push({ x: f.x, y: f.y, w: p.x - f.x, h: f.h });
        if (p.x + p.w < f.x + f.w) next.push({ x: p.x + p.w, y: f.y, w: f.x + f.w - p.x - p.w, h: f.h });
        if (p.y > f.y) next.push({ x: f.x, y: f.y, w: f.w, h: p.y - f.y });
        if (p.y + p.h < f.y + f.h) next.push({ x: f.x, y: p.y + p.h, w: f.w, h: f.y + f.h - p.y - p.h });
      }
      free = next.filter((a, i) => !next.some((b, j) => j !== i && a.x >= b.x && a.y >= b.y && a.x + a.w <= b.x + b.w && a.y + a.h <= b.y + b.h && (j < i || a.w * a.h < b.w * b.h)));
    };
    (fixed || []).forEach((p) => { placed.push(p); cut(p); });
    for (const r of rects) {
      let best = null, bs = Infinity, bl = Infinity;
      for (const f of free) {
        if (r.w <= f.w + 1e-6 && r.h <= f.h + 1e-6) {
          const ss = Math.min(f.w - r.w, f.h - r.h), ls = Math.max(f.w - r.w, f.h - r.h);
          // Prefer the lowest-left slot so plans sit on a common baseline.
          const score = ss + (r.prefer === 'bottom' ? (region.y + region.h - (f.y + f.h)) * 4 : 0);
          if (score < bs || (score === bs && ls < bl)) { bs = score; bl = ls; best = { x: f.x, y: r.prefer === 'bottom' ? f.y + f.h - r.h : f.y }; }
        }
      }
      if (!best) return null;
      const p = { x: best.x, y: best.y, w: r.w, h: r.h, ref: r.ref };
      placed.push(p);
      const next = [];
      for (const f of free) {
        if (p.x >= f.x + f.w || p.x + p.w <= f.x || p.y >= f.y + f.h || p.y + p.h <= f.y) { next.push(f); continue; }
        if (p.x > f.x) next.push({ x: f.x, y: f.y, w: p.x - f.x, h: f.h });
        if (p.x + p.w < f.x + f.w) next.push({ x: p.x + p.w, y: f.y, w: f.x + f.w - p.x - p.w, h: f.h });
        if (p.y > f.y) next.push({ x: f.x, y: f.y, w: f.w, h: p.y - f.y });
        if (p.y + p.h < f.y + f.h) next.push({ x: f.x, y: p.y + p.h, w: f.w, h: f.y + f.h - p.y - p.h });
      }
      free = next.filter((a, i) => !next.some((b, j) => j !== i && a.x >= b.x && a.y >= b.y && a.x + a.w <= b.x + b.w && a.y + a.h <= b.y + b.h && (j < i || a.w * a.h < b.w * b.h)));
    }
    return placed;
  }

  // ---- site plan (traced drone data) ----
  function sitePlanGeometry(site) {
    const iw = site.img[0], ih = site.img[1];
    const turn = site.turn === 'cw' ? (q) => [ih - q[1], q[0]] : site.turn === 'ccw' ? (q) => [q[1], iw - q[0]]
      : site.turn === 'flip' ? (q) => [iw - q[0], ih - q[1]] : (q) => [q[0], q[1]];
    const L = site.lot.map(turn);
    const xs = L.map((q) => q[0]), ys = L.map((q) => q[1]);
    const box = { x: Math.min(...xs), y: Math.min(...ys) };
    box.w = Math.max(...xs) - box.x; box.h = Math.max(...ys) - box.y;
    const maxTree = Math.max(0, ...site.trees.map((t) => t[2]));
    return { turn, box, pad: maxTree * 0.4 };
  }

  function drawSitePlan(site, rect, treePath, font) {
    const G = sitePlanGeometry(site);
    const bw = G.box.w + 2 * G.pad, bh = G.box.h + 2 * G.pad;
    const s = Math.min(rect.w / bw, rect.h / bh);
    const ox = rect.x + (rect.w - bw * s) / 2 + (G.pad - G.box.x) * s;
    const oy = rect.y + (rect.h - bh * s) / 2 + (G.pad - G.box.y) * s;
    const pt = (q) => { const t = G.turn(q); return [ox + t[0] * s, oy + t[1] * s]; };
    const poly = (l) => l.map((q) => pt(q).map((v) => v.toFixed(2)).join(',')).join(' ');
    const lp = site.lot.map(pt);
    const lx0 = Math.min(...lp.map((p) => p[0])), lx1 = Math.max(...lp.map((p) => p[0]));
    const ly0 = Math.min(...lp.map((p) => p[1])), ly1 = Math.max(...lp.map((p) => p[1]));
    const r = 0.75, step = 5; let d = '';
    for (let y = Math.ceil(ly0 / step) * step; y <= ly1; y += step) {
      for (let x = Math.ceil(lx0 / step) * step; x <= lx1; x += step) {
        d += 'M' + (x - r).toFixed(2) + ' ' + y.toFixed(2) + 'a' + r + ' ' + r + ' 0 1 0 ' + 2 * r + ' 0a' + r + ' ' + r + ' 0 1 0 ' + -2 * r + ' 0Z';
        if (x + step / 2 <= lx1 && y + step / 2 <= ly1) { const xx = x + step / 2, yy = y + step / 2; d += 'M' + (xx - r).toFixed(2) + ' ' + yy.toFixed(2) + 'a' + r + ' ' + r + ' 0 1 0 ' + 2 * r + ' 0a' + r + ' ' + r + ' 0 1 0 ' + -2 * r + ' 0Z'; }
      }
    }
    const tp = treePath.match(/-?[\d.]+ -?[\d.]+/g).map((p) => p.split(' ').map(Number));
    let out = '<g id="Site plan">';
    out += '<polygon id="Yard" points="' + poly(site.lot) + '" fill="#ffffff"/>';
    out += '<clipPath id="lotClip"><polygon points="' + poly(site.lot) + '"/></clipPath>';
    out += '<path id="Yard stipple" d="' + d + '" fill="#8c8c8c" clip-path="url(#lotClip)"/>';
    if (site.paving.length) out += '<g id="Paving">' + site.paving.map((g) => '<polygon points="' + poly(g) + '" fill="#d9d9d9"/>').join('') + '</g>';
    if (site.pools && site.pools.length) {
      out += '<g id="Pools">' + site.pools.map((g) => '<polygon points="' + poly(g) + '" fill="#ffffff" stroke="#1a1a1a" stroke-width="1.4" stroke-linejoin="round"/>' +
        '<polygon points="' + poly(g) + '" fill="none" stroke="#1a1a1a" stroke-width="0.6" transform="' + (() => { const c = g.map(pt).reduce((a, q) => [a[0] + q[0] / g.length, a[1] + q[1] / g.length], [0, 0]); return 'translate(' + c[0].toFixed(2) + ' ' + c[1].toFixed(2) + ') scale(0.86) translate(' + (-c[0]).toFixed(2) + ' ' + (-c[1]).toFixed(2) + ')'; })() + '"/>' +
        (() => { const c = g.map(pt).reduce((a, q) => [a[0] + q[0] / g.length, a[1] + q[1] / g.length], [0, 0]); return '<text x="' + c[0].toFixed(2) + '" y="' + (c[1] + 3.5).toFixed(2) + '" style="font-family:' + font + ';font-size:10px;font-weight:600" fill="#1a1a1a" text-anchor="middle">Pool</text>'; })()).join('') + '</g>';
    }
    if (site.drive.length) out += '<g id="Driveway">' + site.drive.map((g) => '<polygon points="' + poly(g) + '" fill="#a5a5a5"/>').join('') + '</g>';
    out += '<g id="Buildings">' + site.buildings.map((b) => '<polygon points="' + poly(b.pts) + '" fill="#ffffff" stroke="#1a1a1a" stroke-width="2" stroke-linejoin="miter"/>').join('');
    site.buildings.forEach((b) => {
      if (!b.label) return;
      const c = pt(b.at);
      out += '<text x="' + c[0].toFixed(2) + '" y="' + (c[1] + 3.5).toFixed(2) + '" style="font-family:' + font + ';font-size:10px;font-weight:600" fill="#1a1a1a" text-anchor="middle">' + b.label + '</text>';
    });
    out += '</g><polygon id="Title boundary" points="' + poly(site.lot) + '" fill="none" stroke="#333333" stroke-width="1.6"/>';
    out += '<g id="Trees">' + site.trees.map((t) => {
      const c = pt(t), R = t[2] * s, a = t[3] * Math.PI / 180, ca = Math.cos(a), sa = Math.sin(a);
      return '<path d="M' + tp.map((q) => (c[0] + R * (q[0] * ca - q[1] * sa)).toFixed(2) + ' ' + (c[1] + R * (q[0] * sa + q[1] * ca)).toFixed(2)).join(' L') + ' Z" fill="#ffffff" stroke="#4d4d4d" stroke-width="1.1" stroke-linejoin="round"/>';
    }).join('') + '</g></g>';
    return out;
  }

  // ---- sheet ----
  function buildSheet(o) {
    const brand = BRANDS[o.brand] || BRANDS.love;
    const font = brand.font;
    const W = 1400, H = 990;
    const region = { x: 56, y: 44, w: W - 112, h: 806 };
    const gap = 36, CAP_H = 30;
    const plan = o.plan || { clusters: [], defs: [], north: null };
    const rot = ((o.rotate || 0) % 360 + 360) % 360;
    const rad = rot * Math.PI / 180;

    // Rotated boxes (90-degree steps keep boxes exact).
    const rb = (b) => (rot === 90 || rot === 270) ? { w: b.h, h: b.w } : { w: b.w, h: b.h };

    // Site plan aspect.
    const SG = o.site ? sitePlanGeometry(o.site) : null;
    const siteAspect = SG ? (SG.box.w + 2 * SG.pad) / (SG.box.h + 2 * SG.pad) : 0;
    // Smallest the site plan may get: its longer side at least 520 px (about 156 mm on A3), so wide lots aren't forced huge.
    const siteMinLong = o.siteMinLong || 440;
    const siteMinH = siteAspect > 1 ? siteMinLong / siteAspect : siteMinLong;

    // Several packing orders are tried; the one that lets the floor plan print largest wins.
    const titled = plan.clusters.filter((c) => c.caption).length >= 2;
    const tryPack = (s, siteH, v) => {
      const rects = plan.clusters.map((c, i) => { const b = rb(c.box); return { w: b.w * s + gap, h: b.h * s + gap + (c.caption ? CAP_H : 0), ref: i, prefer: c.kind === 'floor' && v !== 4 ? 'bottom' : null }; });
      const floors = rects.filter((r) => plan.clusters[r.ref].kind === 'floor');
      const outs = rects.filter((r) => plan.clusters[r.ref].kind !== 'floor').sort((a, b) => b.w * b.h - a.w * a.h);
      const site = SG ? [{ w: siteH * siteAspect + gap, h: siteH + gap, ref: 'site' }] : [];
      const R = { x: region.x, y: region.y, w: region.w + gap, h: region.h + gap };
      if (titled) {
        // Titled levels sit in floor order along the bottom, left to right; everything else packs around them.
        let x = R.x; const row = [];
        const top = v >= 2 && v < 4; // levels along the top, others below; or along the bottom
        for (const f of floors) { if (x + f.w > R.x + R.w || f.h > R.h) return null; row.push({ x, y: top ? R.y : R.y + R.h - f.h, w: f.w, h: f.h, ref: f.ref }); x += f.w; }
        if (v >= 4) { // centre the row of levels and let the rest fill both sides
          const used = x - R.x, off = (R.w - used) / 2; row.forEach((p) => { p.x += off; });
        }
        const rest = [[...outs, ...site], [...site, ...outs]][v % 2];
        return pack(R, rest, row);
      }
      const order = [[...floors, ...outs, ...site], [...floors, ...site, ...outs], [...site, ...floors, ...outs], [...outs, ...floors, ...site], [...floors, ...outs, ...site], [...outs, ...site, ...floors]][v];
      return pack(R, order);
    };
    let lo = 0.01, hi = 50, best = null, s = 1, siteH = siteMinH, bestV = 0;
    if (plan.clusters.length) {
      let bestS = 0;
      for (let v = 0; v < 6; v++) {
        let l = 0.01, h = 50, b = null;
        for (let k = 0; k < 36; k++) { const mid = (l + h) / 2; const p = tryPack(mid, siteMinH, v); if (p) { l = mid; b = p; } else h = mid; }
        if (b && l > bestS * 1.005) { bestS = l; best = b; bestV = v; }
      }
      s = lo = bestS || 0.01;
      if (!best) best = tryPack(lo, siteMinH, 0) || [];
      // Let the site plan grow into what is left, up to a sensible size so it never dominates the sheet.
      const siteMaxLong = o.siteMaxLong || 640;
      const siteMaxH = Math.max(siteMinH, siteAspect > 1 ? siteMaxLong / siteAspect : siteMaxLong);
      if (SG) { for (let h = Math.min(region.h, siteMaxH); h > siteMinH; h -= 10) { const p = tryPack(s, h, bestV); if (p) { siteH = h; best = p; break; } } }
    } else if (SG) {
      siteH = Math.min(region.h, region.w / siteAspect);
      best = [{ x: region.x, y: region.y, w: siteH * siteAspect + gap, h: siteH + gap, ref: 'site' }];
    } else {
      best = [];
    }
    if (!best.length) best = [{ x: region.x, y: region.y, w: gap, h: gap, ref: 'none' }];

    // Centre the packed group in the region.
    const gx0 = Math.min(...best.map((p) => p.x)), gy0 = Math.min(...best.map((p) => p.y));
    const gx1 = Math.max(...best.map((p) => p.x + p.w - gap)), gy1 = Math.max(...best.map((p) => p.y + p.h - gap));
    const dx = region.x + (region.w - (gx1 - gx0)) / 2 - gx0, dy = region.y + (region.h - (gy1 - gy0)) / 2 - gy0;

    let svg = '<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="' + NS + '" xmlns:xlink="' + XLINK + '" width="420mm" height="297mm" viewBox="0 0 ' + W + ' ' + H + '">';
    const ser = new XMLSerializer();
    svg += plan.defs.map((d) => ser.serializeToString(d)).join('');
    svg += '<rect id="Page" x="0" y="0" width="' + W + '" height="' + H + '" fill="#ffffff"/>';
    svg += '<g id="Floor plan">';
    let fi = 0, capSvg = '';
    best.forEach((p) => {
      if (p.ref === 'site' || p.ref === 'none') return;
      const c = plan.clusters[p.ref];
      const b = c.box, r = rb(b);
      const cx = p.x + dx + r.w * s / 2, cy = p.y + dy + r.h * s / 2;
      if (c.caption) capSvg += '<text style="font-family:' + font + ';font-size:14px;font-weight:600" fill="#1a1a1a" text-anchor="middle" x="' + cx.toFixed(2) + '" y="' + (p.y + dy + r.h * s + 24).toFixed(2) + '">' + c.caption.replace(/&/g, '&amp;').replace(/</g, '&lt;') + '</text>';
      const gT = 'translate(' + cx.toFixed(2) + ' ' + cy.toFixed(2) + ') rotate(' + rot + ') scale(' + s.toFixed(5) + ') translate(' + (-(b.x + b.w / 2)).toFixed(3) + ' ' + (-(b.y + b.h / 2)).toFixed(3) + ')';
      const label = c.caption || (c.kind === 'floor' ? (plan.clusters.filter((q) => q.kind === 'floor').length > 1 ? 'Floor ' + (++fi) : 'Floor plan') : c.name);
      svg += '<g id="' + label.replace(/"/g, '') + '" transform="' + gT + '">';
      c.items.forEach((L) => {
        const n = L.clone.cloneNode(true);
        if (n.tagName === 'text') {
          n.style.fontFamily = font;
          n.style.fontWeight = L.role === 'measure' ? '400' : '600';
          n.style.fontStyle = 'normal';
          n.style.cursor = '';
          if (rot) {
            // Labels move with the plan as a block. Horizontal labels stay horizontal; labels
            // turned to fit a narrow room follow the plan, then flip so they never read upside down.
            const m = n.transform.baseVal.consolidate().matrix;
            const orig = Math.atan2(m.b, m.a) * 180 / Math.PI;
            let a = (((orig + rot) % 360) + 540) % 360 - 180;
            if (a > 90) a -= 180; else if (a <= -90) a += 180;
            if (Math.abs(orig) < 1) a = 0;
            if (L.sheetVertical) a = -90;
            const C = L.anchor;
            n.setAttribute('transform', 'rotate(' + (a - orig - rot).toFixed(3) + ' ' + C.x.toFixed(3) + ' ' + C.y.toFixed(3) + ') ' + fmt(m));
          }
        }
        svg += ser.serializeToString(n).replace(/ xmlns="[^"]*"/, '');
      });
      svg += '</g>';
    });
    if (capSvg) svg += '<g id="Floor titles">' + capSvg + '</g>';
    svg += '</g>';

    if (SG) {
      const p = best.find((q) => q.ref === 'site');
      svg += drawSitePlan(o.site, { x: p.x + dx, y: p.y + dy, w: siteH * siteAspect, h: siteH }, o.treePath, font);
    }

    // Footer.
    const north = o.north === false ? null : o.north != null ? o.north : (plan.north != null ? (plan.north + rot) % 360 : null);
    const lines = ['Disclaimer: Plans are indicative only. All', 'dimensions and areas are approximate.', 'Independent enquiries recommended prior to', 'purchase.'];
    svg += '<g id="Footer">';
    svg += '<text id="Disclaimer" style="font-family:' + font + ';font-size:10px;font-weight:400" fill="#333333">' + lines.map((l, i) => '<tspan x="64" y="' + (901 + 14 * i) + '">' + l + '</tspan>').join('') + '</text>';
    if (north != null) svg += '<g id="North point"><circle cx="378" cy="922" r="21" fill="none" stroke="#512262" stroke-width="2"/><polygon points="378,906 387,934 378,927 369,934" fill="#512262" transform="rotate(' + north.toFixed(1) + ' 378 922)"/></g>';
    svg += '<text id="Address" style="font-family:' + font + ';font-size:21px" fill="#1a1a1a"><tspan x="442" y="914" style="font-weight:400">' + o.address[0] + '</tspan><tspan x="442" y="940" style="font-weight:600">' + o.address[1] + '</tspan></text>';
    if (o.logo) svg += '<image id="Logo" x="' + o.logo.x + '" y="' + o.logo.y + '" width="' + o.logo.w + '" height="' + o.logo.h + '" xlink:href="' + o.logo.href + '" href="' + o.logo.href + '"/>';
    svg += '</g></svg>';
    return { svg, scale: s, siteHeight: siteH, north: north };
  }

  global.SheetEngine = { processFloorPlan, fitLabels, buildSheet, DEFAULT_RULES, BRANDS, _hasPhrase: hasPhrase };
})(window);
