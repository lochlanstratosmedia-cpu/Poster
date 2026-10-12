// Renders opener.html to video, frame by frame, with its sound effects.
//
//   node openers/render.mjs --photo house.jpg --text "Homes for Sale in Nords Wharf, NSW"
//   node openers/render.mjs --clip drone.mp4 --text "..."      # bar over a video clip
//   node openers/render.mjs --alpha --text "..."               # transparent overlay only
//   node openers/render.mjs --green --text "..."               # green screen
//
// Any setting from the page can be passed as --name value:
//   --fmt 4x5  --pos 0.3  --width 0.86  --size 1  --cps 14  --hold 1.2
//   --ending fade|zoom|stay  --tail 0.6  --tap 0  --push 0  --sound 0
// Also: --fps 30  --out openers/renders  --name my-opener
//
// Photos render in the page. A --clip is composited under a transparent
// render with ffmpeg, because Playwright's Chromium cannot decode H.264 or
// HEVC. Without --photo or --clip the stand-in dusk sky is used.

import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flags = new Set();
const opts = {};
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (!a.startsWith("--")) continue;
  const k = a.slice(2);
  if (["alpha", "green"].includes(k)) flags.add(k);
  else opts[k] = args[++i];
}
const fps = Number(opts.fps || 30);
const out = resolve(opts.out || resolve(here, "renders"));
const slug = s => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "opener";
const text = opts.text || "Homes for Sale in Nords Wharf, NSW";
const name = opts.name || `opener-${slug(text)}`;
const clip = opts.clip ? resolve(opts.clip) : null;
const alpha = flags.has("alpha") || !!clip;
mkdirSync(out, { recursive: true });

const q = new URLSearchParams({ render: "1", text });
for (const k of ["fmt", "pos", "width", "size", "cps", "hold", "ending", "tail", "tap", "push", "sound"]) if (opts[k] != null) q.set(k, opts[k]);
if (alpha) q.set("bg", "alpha");
else if (flags.has("green")) q.set("bg", "green");
if (opts.photo) q.set("photo", pathToFileURL(resolve(opts.photo)).href);

function ffmpeg(argv, stdin = true) {
  const p = spawn("ffmpeg", ["-y", "-loglevel", "error", ...argv], { stdio: [stdin ? "pipe" : "ignore", "inherit", "inherit"] });
  const done = new Promise((ok, bad) => p.on("close", c => (c === 0 ? ok() : bad(new Error(`ffmpeg exited ${c}`)))));
  return { stdin: p.stdin, done };
}
const write = (stream, buf) => new Promise(ok => (stream.write(buf) ? ok() : stream.once("drain", ok)));

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
await page.goto(pathToFileURL(resolve(here, "opener.html")).href + "?" + q);
const { end, W, H } = await page.evaluate(() => window.ready);

const wav = resolve(out, `${name}.sfx.wav`);
const sound = opts.sound !== "0";
if (sound) writeFileSync(wav, Buffer.from(await page.evaluate(() => window.audioWav()), "base64"));
const audioIn = sound ? ["-i", wav] : [];
const audioOut = sound ? ["-map", "0:v", "-map", "1:a", "-c:a", "aac", "-b:a", "192k"] : [];
const frameIn = ["-f", "image2pipe", "-framerate", String(fps), "-i", "-"];

const overlay = clip ? resolve(out, `${name}.overlay.mov`) : null;
const encoders = clip
  ? [ffmpeg([...frameIn, "-c:v", "png", "-pix_fmt", "rgba", overlay])]
  : alpha
    ? [
        ffmpeg([...frameIn, "-c:v", "prores_ks", "-profile:v", "4444", "-pix_fmt", "yuva444p10le", `${out}/${name}.mov`]),
        ffmpeg([...frameIn, ...audioIn, ...(sound ? ["-map", "0:v", "-map", "1:a", "-c:a", "libopus"] : []), "-c:v", "libvpx-vp9", "-pix_fmt", "yuva420p", "-b:v", "0", "-crf", "28", `${out}/${name}.webm`]),
      ]
    : [ffmpeg([...frameIn, ...audioIn, ...audioOut, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "16", "-preset", "slow", "-movflags", "+faststart", "-shortest", `${out}/${name}.mp4`])];

const frames = Math.round(end * fps);
for (let f = 0; f < frames; f++) {
  await page.evaluate(t => window.draw(t), f / fps);
  const png = await page.screenshot({ type: "png", omitBackground: alpha, clip: { x: 0, y: 0, width: W, height: H } });
  for (const e of encoders) await write(e.stdin, png);
}
for (const e of encoders) { e.stdin.end(); await e.done; }
await browser.close();

if (clip) {
  // Fill the frame with the clip, freeze its last frame if it is shorter than
  // the opener, then lay the bar over it.
  const fc = `[0:v]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1,fps=${fps},tpad=stop_mode=clone:stop_duration=${Math.ceil(end)}[bg];[bg][1:v]overlay=0:0:shortest=1[v]`;
  await ffmpeg(["-i", clip, "-i", overlay, ...audioIn, "-filter_complex", fc, "-map", "[v]", ...(sound ? ["-map", "2:a", "-c:a", "aac", "-b:a", "192k"] : []),
    "-t", end.toFixed(3), "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "16", "-preset", "slow", "-movflags", "+faststart", `${out}/${name}.mp4`], false).done;
  rmSync(overlay);
}
console.log(`${name}: ${frames} frames, ${end.toFixed(2)} s, ${W}x${H}`);
