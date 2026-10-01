// Renders outro.html to 1080x1920 video, frame by frame.
//
//   node outros/knights/render.mjs                      # all variants
//   node outros/knights/render.mjs card badge           # just these
//   node outros/knights/render.mjs --love a.png --knights b.png
//
// Without --love/--knights it uses logos/love.png and logos/knights.png if they
// exist, and a labelled placeholder if they do not.
//   node outros/knights/render.mjs --fps 25 --seconds 10
//
// Opaque variants come out as H.264 MP4. The overlay variant also comes out
// as a PNG-codec .mov and VP9 .webm with alpha, for laying over footage.

import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const ALL = ["card", "heartbeat", "hoops", "badge", "overlay"];
const ALPHA = new Set(["overlay"]);

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  if (i < 0) return fallback;
  const v = args[i + 1];
  args.splice(i, 2);
  return v;
};
const fps = Number(opt("fps", 30));
const seconds = Number(opt("seconds", 8));
const logos = { love: opt("love", null), knights: opt("knights", null) };
const out = resolve(opt("out", resolve(here, "renders")));
const variants = args.length ? args : ALL;
mkdirSync(out, { recursive: true });

function ffmpeg(outArgs) {
  const p = spawn("ffmpeg", ["-y", "-loglevel", "error", "-f", "image2pipe", "-framerate", String(fps), "-i", "-", ...outArgs], { stdio: ["pipe", "inherit", "inherit"] });
  const done = new Promise((ok, bad) => p.on("close", c => (c === 0 ? ok() : bad(new Error(`ffmpeg exited ${c}`)))));
  return { stdin: p.stdin, done };
}
const write = (stream, buf) => new Promise(ok => (stream.write(buf) ? ok() : stream.once("drain", ok)));

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });

for (const v of variants) {
  const q = new URLSearchParams({ v, render: "1" });
  for (const k in logos) if (logos[k]) q.set(k, pathToFileURL(resolve(logos[k])).href);
  await page.goto(pathToFileURL(resolve(here, "outro.html")).href + "?" + q);
  await page.evaluate(() => window.ready);

  const alpha = ALPHA.has(v);
  const encoders = alpha
    ? [
        ffmpeg(["-c:v", "png", "-pix_fmt", "rgba", `${out}/knights-outro-${v}.mov`]),
        ffmpeg(["-c:v", "libvpx-vp9", "-pix_fmt", "yuva420p", "-b:v", "0", "-crf", "28", `${out}/knights-outro-${v}.webm`]),
      ]
    : [ffmpeg(["-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "16", "-preset", "slow", "-movflags", "+faststart", `${out}/knights-outro-${v}.mp4`])];

  const frames = Math.round(seconds * fps);
  for (let f = 0; f < frames; f++) {
    await page.evaluate(t => window.draw(t), f / fps);
    const png = await page.screenshot({ type: "png", omitBackground: alpha, clip: { x: 0, y: 0, width: 1080, height: 1920 } });
    for (const e of encoders) await write(e.stdin, png);
  }
  for (const e of encoders) { e.stdin.end(); await e.done; }
  console.log(`${v}: ${frames} frames`);
}
await browser.close();
