// Renders opener.html to video, frame by frame, with its sound effects.
//
//   node openers/render.mjs --photo house.jpg --text "Homes for Sale in Nords Wharf, NSW"
//   node openers/render.mjs --clip drone.mp4 --text "..."      # bar over a video clip
//   node openers/render.mjs --alpha --text "..."               # transparent overlay only
//   node openers/render.mjs --green --text "..."               # green screen
//
// Any setting from the page can be passed as --name value:
//   --style search|notify|messages|saved|reminder
//   --fmt 4x5  --size 1  --cps 14  --hold 1.2  --ending fade|zoom|stay
//   --tail 0.6  --tap 0  --push 0  --blur 0  --sound 0
//   search:   --text  --pos 0.3  --width 0.86
//   notify:   --nApp  --nTitle  --nBody
//   messages: --mLines "Seen this one?\nme: Send it"   (\n between messages)
//             --mName "Sam Lee"  --mBack screen|photo  --mTheme light|dark
//   saved:    --cTitle  --cSub  --beds  --baths  --cars
//   reminder: --rDay SAT  --rDate 18  --rTitle  --rWhen  --rWhere
// Also: --fps 30  --out openers/renders  --name my-opener
//
// Photos render in the page. Playwright's Chromium cannot decode H.264 or
// HEVC, so a --clip goes through ffmpeg instead. With the search bar the clip
// plays under a transparent render. With the phone styles the clip's first
// frame stands in for the photo, the opener ends on it at full screen, and the
// whole clip follows with its own sound (--clipSound 0 to drop it). Without
// --photo or --clip the stand-in dusk sky is used.

import { chromium } from "playwright";
import { spawn, spawnSync } from "node:child_process";
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
const clip = opts.clip ? resolve(opts.clip) : null;
// Search bar sits over the clip. The phone styles play as an intro that ends
// on the clip's first frame at full screen, then the whole clip follows.
const intro = !!clip && (opts.style || "search") !== "search";
const alpha = !intro && (flags.has("alpha") || !!clip);
mkdirSync(out, { recursive: true });
const probe = (...a) => spawnSync("ffprobe", ["-v", "error", ...a, clip], { encoding: "utf8" }).stdout.trim();
let firstFrame = null;
if (intro) {
  firstFrame = resolve(out, `.first-frame-${process.pid}.png`);
  spawnSync("ffmpeg", ["-y", "-loglevel", "error", "-i", clip, "-frames:v", "1", firstFrame]);
  opts.photo = firstFrame; opts.push = "0"; opts.tail = "0"; opts.clipStill = "1";
}

// Everything else is a page setting: --style notify --nTitle "..." and so on.
const OWN = new Set(["fps", "out", "name", "photo", "clip"]);
const q = new URLSearchParams({ render: "1" });
for (const [k, v] of Object.entries(opts)) if (!OWN.has(k)) q.set(k, v.replace(/\\n/g, "\n"));
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
const ready = await page.evaluate(() => window.ready);
const { end, W, H } = ready;
const name = opts.name || ready.name;

const wav = resolve(out, `${name}.sfx.wav`);
const sound = opts.sound !== "0";
if (sound) writeFileSync(wav, Buffer.from(await page.evaluate(() => window.audioWav()), "base64"));
const audioIn = sound ? ["-i", wav] : [];
const audioOut = sound ? ["-map", "0:v", "-map", "1:a", "-c:a", "aac", "-b:a", "192k"] : [];
const frameIn = ["-f", "image2pipe", "-framerate", String(fps), "-i", "-"];

const overlay = clip && !intro ? resolve(out, `${name}.overlay.mov`) : null;
const introFile = intro ? resolve(out, `${name}.intro.mp4`) : null;
const encoders = overlay
  ? [ffmpeg([...frameIn, "-c:v", "png", "-pix_fmt", "rgba", overlay])]
  : alpha
    ? [
        ffmpeg([...frameIn, ...audioIn, ...(sound ? ["-map", "0:v", "-map", "1:a", "-c:a", "pcm_s16le"] : []), "-c:v", "prores_ks", "-profile:v", "4444", "-pix_fmt", "yuva444p10le", `${out}/${name}.mov`]),
        ffmpeg([...frameIn, ...audioIn, ...(sound ? ["-map", "0:v", "-map", "1:a", "-c:a", "libopus"] : []), "-c:v", "libvpx-vp9", "-pix_fmt", "yuva420p", "-b:v", "0", "-crf", "28", `${out}/${name}.webm`]),
      ]
    : [ffmpeg([...frameIn, ...audioIn, ...audioOut, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "16", "-preset", "slow", "-movflags", "+faststart", "-shortest", introFile || `${out}/${name}.mp4`])];

const frames = Math.round(end * fps);
for (let f = 0; f < frames; f++) {
  await page.evaluate(t => window.draw(t), f / fps);
  const png = await page.screenshot({ type: "png", omitBackground: alpha, clip: { x: 0, y: 0, width: W, height: H } });
  for (const e of encoders) await write(e.stdin, png);
}
for (const e of encoders) { e.stdin.end(); await e.done; }
await browser.close();

if (intro) {
  const clipDur = Number(probe("-show_entries", "format=duration", "-of", "csv=p=0"));
  const clipHasSound = opts.clipSound !== "0" && probe("-select_streams", "a", "-show_entries", "stream=index", "-of", "csv=p=0") !== "";
  const silence = d => `aevalsrc=0:c=stereo:s=48000:d=${d.toFixed(3)}`;
  const fit = "aresample=48000,aformat=channel_layouts=stereo";
  const fc = [
    `[0:v]setsar=1,fps=${fps},format=yuv420p[v0]`,
    `[1:v]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1,fps=${fps},format=yuv420p[v1]`,
    sound ? `[0:a]${fit}[a0]` : `${silence(end)}[a0]`,
    clipHasSound ? `[1:a]${fit}[a1]` : `${silence(clipDur)}[a1]`,
    "[v0][a0][v1][a1]concat=n=2:v=1:a=1[v][a]",
  ].join(";");
  await ffmpeg(["-i", introFile, "-i", clip, "-filter_complex", fc, "-map", "[v]", "-map", "[a]", "-c:a", "aac", "-b:a", "192k",
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "16", "-preset", "slow", "-movflags", "+faststart", `${out}/${name}.mp4`], false).done;
  rmSync(introFile); rmSync(firstFrame);
} else if (clip) {
  // Fill the frame with the clip, freeze its last frame if it is shorter than
  // the opener, then lay the bar over it.
  const fc = `[0:v]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1,fps=${fps},tpad=stop_mode=clone:stop_duration=${Math.ceil(end)}[bg];[bg][1:v]overlay=0:0:shortest=1[v]`;
  await ffmpeg(["-i", clip, "-i", overlay, ...audioIn, "-filter_complex", fc, "-map", "[v]", ...(sound ? ["-map", "2:a", "-c:a", "aac", "-b:a", "192k"] : []),
    "-t", end.toFixed(3), "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "16", "-preset", "slow", "-movflags", "+faststart", `${out}/${name}.mp4`], false).done;
  rmSync(overlay);
}
console.log(`${name}: ${frames} frames, ${end.toFixed(2)} s, ${W}x${H}`);
