// Renders ad.html to Meta-ready video and stills, frame by frame.
//
//   node ads/love-meta/render.mjs                         # every ad, both formats
//   node ads/love-meta/render.mjs fees offer              # just these
//   node ads/love-meta/render.mjs --fmt story             # 9:16 only (or feed for 4:5)
//   node ads/love-meta/render.mjs --stills                # end-frame PNGs only
//   node ads/love-meta/render.mjs --fps 25 --seconds 12
//
// Video: renders/<ad>-<fmt>.mp4 (H.264, yuv420p). Stills: renders/stills/<ad>-<fmt>.png,
// the settled last frame, which works as the static image ad.

import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const ALL = ["fees", "chat-2287", "price-2287", "chat-2284", "price-2284", "offer"];

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  if (i < 0) return fallback;
  const v = args[i + 1];
  args.splice(i, 2);
  return v;
};
const flag = name => { const i = args.indexOf(`--${name}`); if (i < 0) return false; args.splice(i, 1); return true; };
const fps = Number(opt("fps", 30));
const secondsArg = opt("seconds", null);
const fmts = opt("fmt", "story,feed").split(",");
const out = resolve(opt("out", resolve(here, "renders")));
const stillsOnly = flag("stills");
const ads = args.length ? args : ALL;
mkdirSync(`${out}/stills`, { recursive: true });

function ffmpeg(outArgs) {
  const p = spawn("ffmpeg", ["-y", "-loglevel", "error", "-f", "image2pipe", "-framerate", String(fps), "-i", "-", ...outArgs], { stdio: ["pipe", "inherit", "inherit"] });
  const done = new Promise((ok, bad) => p.on("close", c => (c === 0 ? ok() : bad(new Error(`ffmpeg exited ${c}`)))));
  return { stdin: p.stdin, done };
}
const write = (stream, buf) => new Promise(ok => (stream.write(buf) ? ok() : stream.once("drain", ok)));

const browser = await chromium.launch();
for (const fmt of fmts) {
  const h = fmt === "feed" ? 1350 : 1920;
  const page = await browser.newPage({ viewport: { width: 1080, height: h }, deviceScaleFactor: 1 });
  for (const ad of ads) {
    await page.goto(pathToFileURL(resolve(here, "ad.html")).href + "?" + new URLSearchParams({ ad, fmt, render: "1" }));
    await page.evaluate(() => window.ready);
    const seconds = Number(secondsArg ?? (await page.evaluate(() => window.DURATION)));
    const clip = { x: 0, y: 0, width: 1080, height: h };

    if (!stillsOnly) {
      const enc = ffmpeg(["-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "20", "-maxrate", "9M", "-bufsize", "18M", "-preset", "slow", "-tune", "film", "-movflags", "+faststart", `${out}/${ad}-${fmt}.mp4`]);
      const frames = Math.round(seconds * fps);
      for (let f = 0; f < frames; f++) {
        await page.evaluate(t => window.draw(t), f / fps);
        await write(enc.stdin, await page.screenshot({ type: "jpeg", quality: 95, clip }));
      }
      enc.stdin.end(); await enc.done;
      console.log(`${ad}-${fmt}: ${frames} frames`);
    }
    await page.evaluate(t => window.draw(t), seconds);
    await page.screenshot({ path: `${out}/stills/${ad}-${fmt}.png`, clip });
  }
  await page.close();
}
await browser.close();
