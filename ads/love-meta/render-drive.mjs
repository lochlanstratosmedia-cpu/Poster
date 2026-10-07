// Renders drive.html, the six designs from Drive (Meta Ads > Animate), at 9:16.
//
//   node ads/love-meta/render-drive.mjs            # all six
//   node ads/love-meta/render-drive.mjs 9 17       # just these

import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const designs = process.argv.slice(2).length ? process.argv.slice(2) : ["9", "11", "13", "16", "17", "18"];
const out = resolve(here, "renders");
mkdirSync(`${out}/stills`, { recursive: true });
const fps = 30;
const write = (s, b) => new Promise(ok => (s.write(b) ? ok() : s.once("drain", ok)));

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1080, height: 1920 } });
for (const d of designs) {
  await page.goto(pathToFileURL(resolve(here, "drive.html")).href + "?" + new URLSearchParams({ d, render: "1" }));
  await page.evaluate(() => window.ready);
  const seconds = await page.evaluate(() => window.DURATION);
  const name = `drive-${d}-story`;
  const p = spawn("ffmpeg", ["-y", "-loglevel", "error", "-f", "image2pipe", "-framerate", String(fps), "-i", "-", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "20", "-maxrate", "9M", "-bufsize", "18M", "-preset", "slow", "-movflags", "+faststart", `${out}/${name}.mp4`], { stdio: ["pipe", "inherit", "inherit"] });
  const done = new Promise((ok, bad) => p.on("close", c => (c === 0 ? ok() : bad(new Error(`ffmpeg exited ${c}`)))));
  for (let f = 0; f < seconds * fps; f++) {
    await page.evaluate(t => window.draw(t), f / fps);
    await write(p.stdin, await page.screenshot({ type: "jpeg", quality: 95 }));
  }
  p.stdin.end(); await done;
  await page.evaluate(t => window.draw(t), seconds);
  await page.screenshot({ path: `${out}/stills/${name}.png` });
  console.log(name);
}
await browser.close();
