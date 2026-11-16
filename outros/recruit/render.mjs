// Renders outro.html to a 1080x1920, 30 fps H.264 MP4.
//
//   node outros/recruit/render.mjs
//   node outros/recruit/render.mjs --seconds 10 --love path/to/logo.png

import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf(`--${name}`); return i < 0 ? fallback : args[i + 1]; };
const fps = 30, seconds = Number(opt("seconds", 9)), love = opt("love", null);
const out = resolve(here, "renders");
mkdirSync(out, { recursive: true });

const q = new URLSearchParams({ render: "1" });
if (love) q.set("love", pathToFileURL(resolve(love)).href);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1080, height: 1920 } });
await page.goto(pathToFileURL(resolve(here, "outro.html")).href + "?" + q);
await page.evaluate(() => window.ready);

const ff = spawn("ffmpeg", ["-y", "-loglevel", "error", "-f", "image2pipe", "-framerate", String(fps), "-i", "-",
  "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "16", "-preset", "slow", "-movflags", "+faststart",
  `${out}/recruit-outro.mp4`], { stdio: ["pipe", "inherit", "inherit"] });
const done = new Promise((ok, bad) => ff.on("close", c => (c === 0 ? ok() : bad(new Error(`ffmpeg exited ${c}`)))));
for (let f = 0; f < seconds * fps; f++) {
  await page.evaluate(t => window.draw(t), f / fps);
  const png = await page.screenshot({ type: "png", clip: { x: 0, y: 0, width: 1080, height: 1920 } });
  if (!ff.stdin.write(png)) await new Promise(r => ff.stdin.once("drain", r));
}
ff.stdin.end(); await done; await browser.close();
console.log(`${out}/recruit-outro.mp4: ${seconds * fps} frames`);
