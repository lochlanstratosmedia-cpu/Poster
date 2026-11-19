// node run.js <plan.svg|-> <site.json|-> <brand> "<address line 1>" "<address line 2>" <out.svg>
// env ROT=0|90|180|270, NORTH=<deg> override, NORTH=off hides it.
const fs = require('fs'), path = require('path');
const { chromium } = require('playwright');
(async () => {
  const [planPath, sitePath, brand, a1, a2, out] = process.argv.slice(2);
  const engine = fs.readFileSync(path.join(__dirname, 'engine.js'), 'utf8');
  const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'data.json'), 'utf8'));
  const plan = planPath && planPath !== '-' ? fs.readFileSync(planPath, 'utf8') : null;
  const site = sitePath && sitePath !== '-' ? JSON.parse(fs.readFileSync(sitePath, 'utf8')) : null;
  const ROT = +(process.env.ROT || 0);
  const LABEL = +(process.env.LABEL || 12);
  const NORTH = process.env.NORTH === 'off' ? false : (process.env.NORTH != null && process.env.NORTH !== '' ? +process.env.NORTH : null);
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1400, height: 990 }, deviceScaleFactor: +(process.env.DPR || 2) });
  await p.setContent('<!doctype html><html><body style="margin:0"></body></html>');
  await p.addScriptTag({ content: engine });
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const res = await p.evaluate(async ({ plan, site, brand, address, data, ROT, NORTH, LABEL }) => {
    const L = data.logos[brand];
    const pl = plan ? SheetEngine.processFloorPlan(plan) : null;
    const north = NORTH === false ? false : NORTH != null ? NORTH : (pl && pl.north != null ? ((pl.north + ROT) % 360 + 360) % 360 : false);
    const args = { plan: pl, site, brand, rotate: ROT, north, address, treePath: data.tree, logo: { href: L.href, w: L.w, h: L.h, x: 1336 - L.w, y: 946 - L.h } };
    let sheet = SheetEngine.buildSheet(args);
    if (pl) { pl.report.labelMoves = await SheetEngine.fitLabels(pl, { targetPlanSize: LABEL / sheet.scale, rotate: ROT }); sheet = SheetEngine.buildSheet(args); }
    return { svg: sheet.svg, scale: sheet.scale, siteHeight: sheet.siteHeight, north: sheet.north, report: pl && pl.report,
      clusters: pl && pl.clusters.map((c) => ({ kind: c.kind, name: c.name, caption: c.caption, rooms: c.rooms, box: c.box })) };
  }, { plan, site, brand, address: [esc(a1), esc(a2)], data, ROT, NORTH, LABEL });
  fs.writeFileSync(out, res.svg);
  const view = out.replace(/\.svg$/, '.view.html');
  fs.writeFileSync(view, '<!doctype html><html><body style="margin:0">' + res.svg.replace(/^<\?xml[^>]*\?>/, '').replace('width="420mm" height="297mm"', 'width="1400" height="990"') + '</body></html>');
  await p.goto('file://' + path.resolve(view));
  await p.screenshot({ path: out.replace(/\.svg$/, '-preview.png') });
  delete res.svg; console.log(JSON.stringify(res, null, 1));
  await b.close();
})();
