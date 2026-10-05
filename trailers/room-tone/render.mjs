// Renders index.html to video, one frame at a time, so timing is exact.
//
//   node trailers/room-tone/render.mjs                       # full film, 1920x1080 60 fps
//   node trailers/room-tone/render.mjs --from 20 --to 26     # one section
//   node trailers/room-tone/render.mjs --stills 6.3,6.8,7.3  # PNG frames to renders/stills
//   node trailers/room-tone/render.mjs --fps 30 --name preview
//
// Needs Playwright (global install is fine) and ffmpeg.

import { createRequire } from "node:module";
import { execSync, spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
let playwright;
try {
  playwright = require("playwright");
} catch {
  playwright = require(`${execSync("npm root -g").toString().trim()}/playwright`);
}

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i < 0 ? fallback : args[i + 1];
};
const fps = Number(opt("fps", 60));
const from = Number(opt("from", 0));
const to = Number(opt("to", 45));
const name = opt("name", "room-tone-trailer");
const stills = opt("stills", null);
const out = resolve(here, "renders");
mkdirSync(out, { recursive: true });

const browser = await playwright.chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
page.on("pageerror", (e) => console.error("page error:", e.message));
await page.goto(pathToFileURL(resolve(here, "index.html")).href + "?render=1");
await page.evaluate(() => window.ready);

const shot = () => page.screenshot({ type: "png", clip: { x: 0, y: 0, width: 1920, height: 1080 } });

if (stills) {
  const dir = resolve(out, "stills");
  mkdirSync(dir, { recursive: true });
  for (const s of stills.split(",").map(Number)) {
    await page.evaluate((t) => window.draw(t), s);
    await page.screenshot({ path: `${dir}/t${s.toFixed(2).padStart(5, "0")}.png`, clip: { x: 0, y: 0, width: 1920, height: 1080 } });
  }
  console.log(`stills in ${dir}`);
} else {
  const file = `${out}/${name}.mp4`;
  const ff = spawn("ffmpeg", ["-y", "-loglevel", "error", "-f", "image2pipe", "-framerate", String(fps), "-i", "-",
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "15", "-preset", "slow", "-tune", "film", "-r", String(fps),
    "-movflags", "+faststart", file], { stdio: ["pipe", "inherit", "inherit"] });
  const done = new Promise((ok, bad) => ff.on("close", (c) => (c === 0 ? ok() : bad(new Error(`ffmpeg exited ${c}`)))));
  const frames = Math.round((to - from) * fps);
  const t0 = Date.now();
  for (let f = 0; f < frames; f++) {
    await page.evaluate((t) => window.draw(t), from + f / fps);
    const buf = await shot();
    if (!ff.stdin.write(buf)) await new Promise((ok) => ff.stdin.once("drain", ok));
    if (f % 300 === 0) console.log(`frame ${f}/${frames} (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
  }
  ff.stdin.end();
  await done;
  console.log(`${file}: ${frames} frames at ${fps} fps`);
}
await browser.close();
