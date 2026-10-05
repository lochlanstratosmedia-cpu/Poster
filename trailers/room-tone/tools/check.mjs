// Sanity check for the timeline: typing must finish before the next cue,
// pointer keys must be in order, and the script should paginate cleanly.
//
//   node trailers/room-tone/tools/check.mjs
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const here = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ctx = { window: {} };
ctx.window.window = ctx.window;
vm.createContext(ctx.window);
for (const f of ["screenplay.js", "config.js", "engine.js"]) vm.runInContext(readFileSync(resolve(here, "src", f), "utf8"), ctx.window);
const RT = ctx.window.RT;

let ok = true;
const warn = (m) => { ok = false; console.log("WARN", m); };

RT.EDITS.forEach((e, i) => {
  if (!e.keys) return;
  const next = RT.EDITS[i + 1];
  console.log(`type  ${e.t.toFixed(2)} -> ${e.keys.end.toFixed(2)}  ${JSON.stringify(e.text)}`);
  if (next && e.keys.end + 0.15 > next.t) warn(`typing "${e.text}" ends ${e.keys.end.toFixed(2)}, next cue at ${next.t}`);
});
const a = RT.AUTHOR_TYPING;
console.log(`type  ${a.t.toFixed(2)} -> ${a.keys.end.toFixed(2)}  author`);
if (a.keys.end > RT.T.clickPdf - 0.3) warn("author typing runs into the PDF click");

const keys = RT.POINTER.keys;
for (let i = 1; i < keys.length; i++) if (keys[i].t <= keys[i - 1].t) warn(`pointer key ${i} at ${keys[i].t} is not after ${keys[i - 1].t}`);
for (let i = 1; i < RT.CAM.length; i++) if (RT.CAM[i].t < RT.CAM[i - 1].t) warn(`camera key ${i} out of order`);

const pages = RT.paginate(RT.finalDoc());
pages.forEach((p, i) => {
  const rows = RT.layout(p).reduce((m, l) => Math.max(m, l.row + 1), 0);
  console.log(`page ${i + 1}: ${rows}/${RT.LINES_PER_PAGE} lines, starts "${p[0].text.slice(0, 40)}"`);
  if (rows > RT.LINES_PER_PAGE) warn(`page ${i + 1} overflows`);
});
console.log(`PDF: title page + ${pages.length} script pages`);
console.log(ok ? "OK" : "check the warnings above");
process.exit(ok ? 0 : 1);
