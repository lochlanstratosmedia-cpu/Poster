// Renders own-in.html (the flat plum "Own in <postcode>" style).
//
//   node ads/love-meta/render-own-in.mjs                 # 2287 and 2284, both formats
//   node ads/love-meta/render-own-in.mjs 2287 --fmt story
//   node ads/love-meta/render-own-in.mjs 2287 --bg ads/love-meta/photos/house.jpg

import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf(`--${name}`); if (i < 0) return fallback; const v = args[i + 1]; args.splice(i, 2); return v; };
const fps = Number(opt("fps", 30));
const fmts = opt("fmt", "story,feed").split(",");
const bg = opt("bg", null);
const out = resolve(here, "renders");
const codes = args.length ? args : ["2287", "2284"];
mkdirSync(`${out}/stills`, { recursive: true });

const write = (s, b) => new Promise(ok => (s.write(b) ? ok() : s.once("drain", ok)));
const browser = await chromium.launch();
for (const fmt of fmts) {
  const h = fmt === "feed" ? 1350 : 1920;
  const page = await browser.newPage({ viewport: { width: 1080, height: h } });
  for (const pc of codes) {
    const q = new URLSearchParams({ pc, fmt, render: "1" });
    if (bg) q.set("bg", pathToFileURL(resolve(bg)).href);
    await page.goto(pathToFileURL(resolve(here, "own-in.html")).href + "?" + q);
    await page.evaluate(() => window.ready);
    const seconds = await page.evaluate(() => window.DURATION);
    const clip = { x: 0, y: 0, width: 1080, height: h };
    const name = `own-in-${pc}-${fmt}`;
    const p = spawn("ffmpeg", ["-y", "-loglevel", "error", "-f", "image2pipe", "-framerate", String(fps), "-i", "-", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "20", "-maxrate", "9M", "-bufsize", "18M", "-preset", "slow", "-movflags", "+faststart", `${out}/${name}.mp4`], { stdio: ["pipe", "inherit", "inherit"] });
    const done = new Promise((ok, bad) => p.on("close", c => (c === 0 ? ok() : bad(new Error(`ffmpeg exited ${c}`)))));
    for (let f = 0; f < seconds * fps; f++) {
      await page.evaluate(t => window.draw(t), f / fps);
      await write(p.stdin, await page.screenshot({ type: "jpeg", quality: 95, clip }));
    }
    p.stdin.end(); await done;
    await page.evaluate(t => window.draw(t), seconds);
    await page.screenshot({ path: `${out}/stills/${name}.png`, clip });
    console.log(name);
  }
  await page.close();
}
await browser.close();
