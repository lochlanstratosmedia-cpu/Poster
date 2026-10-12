# Reel openers

Animated intros for property reels. Open `opener.html` in Chrome, Edge or
Safari, add a photo or clip, type the search, and press Save video.

## Styles

| Style | What happens |
|---|---|
| Search bar | A white circle pops in over the photo, a magnifier draws inside it, the circle stretches into a search bar, the search types out with a caret, the bar is tapped, then it fades up or zooms through |

New styles go in `STYLES` inside `opener.html`. Each one has a `plan()` that
returns its timeline and sound cues, and a `draw()` that paints one frame.
Add a button for it in the `#style` group.

## Settings

| Setting | Default | Notes |
|---|---|---|
| Search text | Homes for Sale in Nords Wharf, NSW | Long searches shrink to fit the bar |
| Typing speed | 14 keys/s | Each key gets a small random gap so it reads as a person typing |
| Hold after typing | 1.2 s | Time on the finished search before the tap |
| Format | 9:16 Reel | 4:5 for feed posts |
| Height on screen | 30% | Where the bar sits, from the top |
| Ending | Fade up | Zoom through, or stay on screen to cut away in the edit |
| Clip after the bar leaves | 0.6 s | Background keeps rolling before the opener ends |
| Background | Photo or clip | Green screen gives a flat #00b140 for keying in CapCut. Transparent saves a WebM with an alpha channel |
| Slow push-in | On | 8% zoom over the length of the opener |
| Sound effects | On | Pop, whoosh, key clicks and a tap, made from noise and sine waves, so there is nothing to license |

Settings stay in the browser between visits.

## Saving

The page records the preview in real time, so keep the tab in front until it
finishes. Chrome 126 and later and Safari save H.264 MP4. Older Chrome saves
WebM, which CapCut opens but Instagram may not; use `render.mjs` for those.

With the Transparent background the page saves a VP9 WebM with alpha instead.
Only Chrome and Edge can record that. Safari cannot, so use
`render.mjs --alpha` there, which also gives a ProRes 4444 `.mov` with sound
for Premiere, Final Cut, DaVinci Resolve and CapCut desktop.

## Frame-exact renders

`render.mjs` steps through every frame in headless Chromium and encodes with
ffmpeg, so nothing drops.

```bash
node openers/render.mjs --photo house.jpg --text "Homes for Sale in Nords Wharf, NSW"
node openers/render.mjs --clip drone.mp4 --text "..."    # bar over a video clip
node openers/render.mjs --alpha --text "..."             # transparent .mov and .webm
node openers/render.mjs --photo house.jpg --ending zoom --fmt 4x5 --cps 18
```

Every page setting works as a flag: `--fmt --pos --width --size --cps --hold
--ending --tail --tap 0 --push 0 --sound 0`. Output goes to `openers/renders/`
as MP4 with sound, plus the effects on their own as `.sfx.wav`.

`--alpha` writes a ProRes 4444 `.mov` and a VP9 `.webm`, both with
transparency, for laying over footage in an editor. `--clip` composites the bar
over the clip with ffmpeg, because Playwright's Chromium cannot decode H.264 or
HEVC. The push-in applies to photos only. Convert HEIC photos to JPG first.

Needs Node with Playwright and ffmpeg, the same as `outros/knights`.
