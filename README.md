# Poster

Script and content repo, set up so Claude edits prose against a fixed list of
AI-writing patterns instead of its own instincts.

## What is installed

| Path | What it does |
|---|---|
| `.claude/skills/humanizer/SKILL.md` | The humanizer skill, 35 patterns from Wikipedia's "Signs of AI writing" |
| `.claude/settings.json` | Runs the check hook after every Write and Edit |
| `.claude/hooks/humanizer_check.py` | Scans prose files and reports tells by line and pattern number |
| `CLAUDE.md` | Standing instructions: humanize every draft, invent no facts |
| `docs/storyscope-narrative-checks.md` | Structural checklist for narrative scripts |
| `scripts/update-humanizer.sh` | Pulls a fresh copy of the skill from upstream |
| `content/` | Drafts |
| `.claude/skills/cover-shot/SKILL.md` | Turns a property photo into a magazine-grade social post via Higgsfield |
| `scripts/cover_shot.py` | Photo analysis, prompt builder, caption overlay and compare sheet for cover shots |
| `tools/cover-editor.html` | Listing Cover Studio: edit cover text and layout by hand in the browser |
| `tools/drone-pins.html` | Pinpoint: drop drone photos, add the address, export photos with branded pins on nearby places |
| `assets/fonts/` | Inter and Cormorant Garamond (OFL) for captions |

## How it works

Write a draft in `content/`. The hook fires on save and returns a note like
this when it finds something:

```
Humanizer check found 4 AI-writing tell(s) in content/ep-12.md:
  content/ep-12.md:7 - §7 stock AI word: "In today's"
  content/ep-12.md:8 - §14 em or en dash: '—'
```

Claude then applies the skill to the file. The hook never blocks an edit, and
it is a hint rather than a verdict. Regex cannot tell a deliberate phrase from
a lazy one, so check each hit.

You can also call the skill directly:

```
/humanizer

[paste your text]
```

Or point it at a file: `humanize the prose in content/ep-12.md`.

### Voice matching

Paste two or three paragraphs of your own writing with the request and the
rewrite follows your rhythm, word choice, and quirks instead of the house
defaults. A sample overrides the style rules, including the rule against
dashes.

## Cover shots

Drop photos in `inbox/` (or attach them in chat) and say "run the inbox", or
run `/cover-shot`. Filenames can carry options, such as
`kitchen golden just-listed.jpg`; see `inbox/README.md`. Claude measures the
photo, builds a Nano Banana Pro prompt that keeps the property's real
details, renders it on Higgsfield, checks the render against the original,
then crops it to 4:5 or 9:16 and sets a small caption.

The local steps run on their own too:

```bash
pip install pillow pillow-heif
python3 scripts/cover_shot.py intake        # inbox/ -> covers/<name>/
python3 scripts/cover_shot.py analyse photo.jpg
python3 scripts/cover_shot.py prompt photo.jpg --source phone --shot kitchen --light keep
python3 scripts/cover_shot.py finish render.jpg --label just-sold --line "Suburb"
python3 scripts/cover_shot.py cover render.jpg --layout masthead --title "Just Listed" --line "Street name"
python3 scripts/cover_shot.py compare photo.jpg render.jpg
```

Generation needs the Higgsfield connector, and in a cloud session the
network has to allow `upload.higgsfield.ai`. Photos and renders in
`covers/` are gitignored.

## Drone pins

Open it here: https://raw.githack.com/lochlanstratosmedia-cpu/Poster/claude/eloquent-cannon-61h5oa/tools/drone-pins.html

That link always serves the latest version on this branch. You can also open
`tools/drone-pins.html` from a download or clone. No install or build step.

1. Drop one or more drone photos on the window.
2. Type the property address in the search field and pick the match.
3. Pinpoint switches on the key places for the address: the nearest public
   primary and high school (catchments go by government schools), the
   nearest childcare, the nearest train station, the closest shops and the
   area's major shopping centre (ranked by its department stores), the
   nearest park and the nearest beach. Each says why it was picked. Every
   other place in the shot is listed under More in this shot, switched off,
   and key places that fall outside the shot are listed too. Start with:
   Everything switches all of them on instead. Rename pins inline, press P
   and click to add your own, and drag any pin to move just that one; Reset
   in the list puts it back. A pin you add takes its icon and distance from
   its name: a place already found, a map search near the property, or else
   keywords in the name and the ground under the pin (marked est. in the
   list). Click its icon in the list to choose the type or hide the distance.
   Distances can show as km, or as walk or drive times from the property
   (OpenStreetMap routing by FOSSGIS at routing.openstreetmap.de; when it
   can't be reached the time is estimated and marked est. in the list).
4. Property outline: Find lot draws the lot boundary from NSW Spatial
   Services' public cadastre for the address (NSW only). Draw traces an
   outline by hand anywhere: click the corners, then Enter, double-click or
   click the first corner. Drag inside the outline to line it up and drag a
   corner to reshape it (select it first). Outline width and fill are in the
   Style tab. The nearest public school is a guide to the
   catchment, not the official boundary.
5. Export (Cmd+E) at full resolution, one photo or all of them as a zip.

Pins are placed from the camera data DJI drones write into each JPG: GPS
position, height above takeoff, gimbal heading and tilt, and focal length.
Upload the original file, not one exported from Lightroom or a phone app,
because those usually strip it. Compass heading is the value most often off
by a few degrees. Switch to Satellite (or press M) for a top-down aerial view with
distance rings and the patch of ground the camera can see. Drag to move
around, scroll or pinch to zoom (double-click zooms in), and Re-centre jumps
back to the drone. Drag the arrow handle to turn the camera, drag the drone
to move it, and click a place to show or hide it. The Camera tab has sliders for heading, tilt, height and lens.
Photos with no location data start from the address with a guessed camera;
place the drone on the map first.

Brand styles live in the Style tab: seven pin designs (Classic, Glass,
Liquid, Beacon, Editorial, Bold, Tag), colours, font, size, line length, capitals,
distances, icons, a Shadow slider (off to heavy, for bright or busy photos)
and a logo for the property pin. Customise all changes the brand; Customise
clicked changes only the pin you click (Reset this pin undoes it). Turn on Logo only to show
just the logo on the property pin; it sits on the brand's Label colour, so
pick a light Label for a dark logo and a dark one for a white logo. Brands save in the browser.
Use the ... menu to export a brand as a `.pinpoint.json` file and import it
on another machine.

Place data and address search come from OpenStreetMap through Photon
(photon.komoot.io). The public Overpass servers are the fallback for places,
and Nominatim for addresses, so the tool needs internet access. Results are
cached in the browser for 14 days per area. Train stations, ferry terminals
and airports are always looked up to 10 km whatever the Range, because they
are often visible from far off in a wide shot. The aerial view comes from
Esri World Imagery, a free tier meant for light use; heavy commercial use
needs an Esri key.
Places are only as good as the map: check names before posting. Ground is
treated as flat at takeoff height, so pins on hills well above or below the
takeoff point drift a little until you drag one.

## Checking the hook by hand

```bash
printf '{"tool_name":"Write","cwd":"%s","tool_input":{"file_path":"%s/content/ep-12.md"}}' "$PWD" "$PWD" \
  | python3 .claude/hooks/humanizer_check.py
```

No output means nothing was flagged. It needs Python 3 and no packages.

### Tuning it

The pattern list is at the top of `.claude/hooks/humanizer_check.py`, in
`CHECKS`. Each entry carries the pattern number from `SKILL.md`. `SKIP_PREFIXES`
and `SKIP_NAMES` control which files are exempt, and `PROSE_SUFFIXES` controls
which get read at all.

## Why the skill is vendored

`SKILL.md` is copied into this repo rather than installed as a plugin, so it
works in Claude Code on the web and for anyone who clones this. Run
`scripts/update-humanizer.sh` to pull a newer version.

Two other install routes exist if you want it everywhere, not just here:

```bash
npx skills add blader/humanizer --global
```

```text
/plugin marketplace add blader/humanizer
/plugin install humanizer@humanizer
```

## Credits

- Humanizer by [blader](https://github.com/blader/humanizer), MIT licensed.
  The copy in `.claude/skills/humanizer/` is version 2.11.2 and keeps its
  LICENSE file.
- Patterns come from
  [Wikipedia: Signs of AI writing](https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing),
  maintained by WikiProject AI Cleanup.
- StoryScope by Russell, Rajendhran, Pham, Iyyer, and Wieting.
  [Repo](https://github.com/jenna-russell/storyscope),
  [paper](https://arxiv.org/abs/2604.03136). Only summarized here, not installed.
