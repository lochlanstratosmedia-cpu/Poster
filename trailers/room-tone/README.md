# Room Tone trailer

A 45 second product reveal for Room Tone, 1920x1080 at 60 fps. It is built in
HTML and drawn frame by frame from a single timeline, so every render is
identical and any cue can be retimed by changing one number.

## Files

| Path | What it does |
|---|---|
| `index.html` | The film plus a preview player (play, scrub, jump to each section) |
| `src/config.js` | All timing: cues, camera moves, pointer path, control fades, copy |
| `src/screenplay.js` | The fictional sample script (*Low Tide*) and title sheet |
| `src/engine.js` | Easing, typing rhythm, smart Tab/Enter, screenplay layout, pagination |
| `src/draw.js` | Builds the controls and draws every element for a given time |
| `render.mjs` | Renders to MP4 or to PNG stills through Playwright and ffmpeg |
| `tools/build_plates.py` | Makes clean desk plates from the app screenshots |
| `tools/check.mjs` | Checks typing fits its cues and the script paginates cleanly |

## Preview and render

```bash
# 1. Put the app screenshots in source/ (names below), then build the plates
pip install opencv-python-headless numpy
python3 trailers/room-tone/tools/build_plates.py

# 2. Preview: open index.html in Chrome (space plays, arrow keys step a frame)

# 3. Render
node trailers/room-tone/tools/check.mjs
node trailers/room-tone/render.mjs                        # renders/room-tone-trailer.mp4
node trailers/room-tone/render.mjs --from 20 --to 26      # one section
node trailers/room-tone/render.mjs --stills 6.3,7.0,21.9  # frames to check by eye
```

`index.html?t=21.9` opens the preview on a given second. Playwright can be a
global install; the renderer finds it.

Screenshots expected in `source/`:

```
desk1-light-on.webp    typewriter desk, light on
desk1-light-off.webp   same desk, light off
desk2-light-off.webp   field desk (not used yet)
ui-nav-pill.png        close-up of the nav pill
ui-page-nav.png        close-up of the page nav and zoom controls
```

`source/`, `plates/` and `renders/` are gitignored because this repo is
public and the screenshots are unreleased product imagery.

## Sequence

| Time | Beat | Copy |
|---|---|---|
| 0-5 | Wordmark, then the desk and centred nav fade up with a slow settle | "Room Tone." |
| 5-11 | Click Script. The nav glides to the top and the page fills | "A space to write." |
| 11-20 | Type an action line, Tab to a Character cue, Return to Dialogue | "Stay in the scene." |
| 20-26 | Drag-select "still out", italicise it from the format pill, keep writing while the controls fade | |
| 26-34 | Open Sound, pick a track (Sound switch turns on), turn the light off | "Set your tone." |
| 34-40 | Page nav to the title sheet, type the author, PDF > Export PDF, PDF preview | "Ready for the next draft." |
| 40-45 | PDF page 1 settles back onto the desk, end card | "Room Tone" / "Make room for the story." |

## What is real and what is a stand-in

Taken from the screenshots: both desk lighting states, the paper and its
position, the nav pill (Home, Script, Desk, Sound, Import, PDF), the Light and
Sound switches, the page nav ("Title page · 1/N") and zoom pill, and "Saved on
this device". Sizes and positions are measured from the screenshots, and the
page grid matches the app: US Letter, 12 pt Courier, 10 characters and 6 lines
to the inch.

Stand-ins drawn in the same glass style, flagged on screen with a small
"Draft · stand-in UI" tag while they are visible (`RT.SHOW_STANDIN_TAG`):

- the Sound panel and its four track names ("Track 1" to "Track 4")
- the formatting pill (B, I, U)
- the PDF menu with its "Export PDF" button

Assumptions to check against the app:

- Home layout: the nav sits at the centre of a blank page.
- Script page label reads "Page 1 · 2/4".
- Smart Tab and Enter follow the usual screenplay rules: Tab on an empty
  Action line makes a Character cue, Return after a cue goes to Dialogue,
  Return after Dialogue goes back to Action.
- Fonts: Courier Prime stands in for the app's Courier, Inter for the system
  UI face. Both are OFL; Courier Prime is in `fonts/` and Inter in `assets/fonts/`. Change `--script` and `--ui` in
  `index.html` to swap them.
- The bottom 24 px of the desk photo is a mirrored strip of wood, added so the
  page nav fits a 16:9 frame (the screenshots stop just under it).

## Sound

The film is silent and works without sound. The app's ambient tracks are not
included and should only be added once promotional rights are confirmed.
