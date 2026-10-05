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
3. Every school, beach, park, station, shopping centre, hospital, sport
   ground, landmark and suburb in the shot gets a pin. Switch off the ones
   you don't want in the Places tab (Hide all, then switch a few back on, is
   quickest), rename them inline, or press P and click to add your own.
   Drag any pin to move just that one; Reset in the list puts it back.
4. Export (Cmd+E) at full resolution, one photo or all of them as a zip.

Pins are placed from the camera data DJI drones write into each JPG: GPS
position, height above takeoff, gimbal heading and tilt, and focal length.
Upload the original file, not one exported from Lightroom or a phone app,
because those usually strip it. Compass heading is the value most often off
by a few degrees. Switch to Map (or press M) for a top-down street map with
distance rings and the patch of ground the camera can see. Drag on the map
to turn the camera, drag the drone to move it, and click a place to show or
hide it. The Camera tab has sliders for heading, tilt, height and lens.
Photos with no location data start from the address with a guessed camera;
place the drone on the map first.

Brand styles live in the Style tab: six pin designs (Classic, Glass,
Beacon, Editorial, Bold, Tag), colours, font, size, line length, capitals,
distances, icons and a logo for the property pin. Brands save in the browser.
Use the ... menu to export a brand as a `.pinpoint.json` file and import it
on another machine.

Place data and address search come from OpenStreetMap through Photon
(photon.komoot.io). The public Overpass servers are the fallback for places,
and Nominatim for addresses, so the tool needs internet access. Results are
cached in the browser for 14 days per area.
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
