---
name: cover-shot
description: |
  Turn a good property photo (phone or camera) into a magazine-cover grade
  image for an image-led real estate post: just listed, coming soon, just
  sold, or an announcement. Re-renders light, perspective and grade with
  Nano Banana Pro through the Higgsfield connector while keeping the
  property's real details, then crops to a social format and sets a small
  caption. Use when Lochlan shares a home, room, kitchen or texture photo
  and wants it to look like the cover of an architecture or interiors
  magazine, or runs /cover-shot.
---

# Cover shot

One photo in, one post-ready image out. The render must still be an honest
picture of the property. It gets better light and a cleaner frame, not new
features.

Tooling: `scripts/cover_shot.py` (Pillow) does everything local. The
Higgsfield MCP tools do the generation. Outputs go in `covers/<photo-name>/`.

## 1. Get the inputs

Photos arrive two ways. Handle both the same:

- **Inbox.** Lochlan drops photos in `inbox/` and says "run the inbox". Run
  `python3 scripts/cover_shot.py intake`. Each photo moves to
  `covers/<name>/` as `source.jpg` (HEIC converted, rotation fixed), and
  `intake.json` records phone or camera from the EXIF maker plus any options
  found in the filename (`kitchen golden just-sold.jpg`).
- **Chat attachments.** Copy each attached photo into `inbox/` with a short
  descriptive name, then run `intake`. Chat uploads lose their camera data,
  so they default to phone.

Then work through every new `covers/<name>/` folder. Look at each photo to
choose the shot and light where `intake.json` has none. Ask only for what you
can't see: the post type if not given, and any second line or agency mark.
One question covering the whole batch beats one per photo. Defaults in brackets.

| Input | Options |
|---|---|
| Photo | a path in the repo, or an attachment (copy it into `covers/<name>/source.jpg`) |
| Source | `phone` or `camera` [phone] |
| Shot | `exterior`, `interior`, `living`, `bedroom`, `kitchen`, `bathroom`, `garden`, `detail` |
| Light | `keep`, `golden`, `soft`, `morning`, `dusk` [keep] |
| Post | `just-listed`, `coming-soon`, `just-sold`, `for-lease`, `open-home`, or custom text |
| Second line | suburb or street, only if Lochlan gives it. Never guess an address. |
| Mark | agency name for the opposite corner, optional |
| Format | `4:5` feed [default], `9:16` story, `1:1`, `3:4` |

Choosing light: use `keep` when the photo already has good light (sun
through a doorway, dappled shade). Use `golden` for flat or harsh midday
exteriors. Use `soft` for interiors with blown windows or hard patches.
`dusk` only for exteriors with visible light fittings.

## 2. Analyse and build the prompt

```bash
python3 scripts/cover_shot.py analyse covers/<name>/source.jpg
python3 scripts/cover_shot.py prompt covers/<name>/source.jpg \
  --source phone --shot kitchen --light keep \
  --notes "what makes this photo good, in one or two plain sentences"
```

`analyse` measures exposure, clipping, contrast, saturation, colour cast and
the six main colours, and ranks the calmest corners for a caption. `prompt`
feeds that into the edit prompt and writes `covers/<name>/job.json`.

Look at the photo yourself before running `prompt` and put what you see in
`--notes`: the thing that makes it worth a cover (the light on the floor, the
shadow pattern on the weatherboards, the depth through three doorways) so
the model keeps it. Name anything that must survive, such as the house number
or a handrail. Add `--tidy` only when Lochlan asks for small clutter to go.
Add `--sky` only for a dull sky on an exterior.

## 3. Generate on Higgsfield

1. Upload the source. Call `media_upload` with the filename, PUT the bytes to
   the returned `upload_url` with curl (send both `Content-Type` and
   `If-None-Match: *`, since they are signed headers), then `media_confirm`.
   A cloud session needs three hosts allowed: `upload.higgsfield.ai`
   (uploads), `d8j0ntlcm91z4.cloudfront.net` (renders) and
   `d2ol7oe51mr4n9.cloudfront.net` (uploaded sources). If renders can't be
   downloaded, ask Lochlan to save them from Higgsfield and attach them in
   chat, then carry on from step 4.
   If the network blocks `upload.higgsfield.ai`, use `media_upload_widget`
   so Lochlan picks the file in the browser, or `media_import_url` with a
   public HTTPS link to the photo.
2. Run `generate_image` with the `higgsfield` block from `job.json`: model
   `nano_banana_pro`, the source `media_id` with role `image_references`,
   the prompt, `aspect_ratio` (matches the source, so nothing is invented at
   the edges), `resolution` 2k, and `count` 2. Pass `get_cost: true` first
   on a new account.
3. `jobs_wait` until done, then download the results into
   `covers/<name>/render-1.jpg`, `render-2.jpg`.

## 4. Check integrity

```bash
python3 scripts/cover_shot.py compare covers/<name>/source.jpg covers/<name>/render-1.jpg
```

Open the compare sheet and go over it object by object. Reject a render and
regenerate (tighten `--notes`) if any of these happen:

- a window, door, step, railing, fixture, tree or plant was added, removed,
  moved or reshaped
- a surface changed colour (paint, timber, benchtop, tiles)
- honest wear vanished so the place looks newer than it is
- the house number, letterbox or any sign changed or became garbled text
- the scene extends past what the original frame showed
- shadows fall in a direction that does not match the light

Buyers will walk through this property. A render that misrepresents it can
count as misleading advertising, so when in doubt, keep the original detail.

If the render is good but soft, run `upscale_image` (4k) on the job id.

## 5. Finish the post

```bash
python3 scripts/cover_shot.py finish covers/<name>/render-1.jpg \
  --format 4:5 --label just-listed --line "Suburb" --mark "Agency" \
  --out covers/<name>/post-4x5.jpg
```

The caption is small on purpose: tracked caps in Inter for the label, and
Cormorant Garamond for the second line. It picks the calmest corner and light
or dark ink on its own, and lays a faint shade under text only when the spot
is busy. Override with `--position`, `--tone`, `--size`, `--focus x,y`
(crop centre), `--serif-label`, or `--scrim`.

Text never goes into the generation prompt. Image models garble letters, and
Pillow sets them cleanly.

## 6. Hand over

Show Lochlan the compare sheet and the finished post. Say which light preset
you used and anything the model got wrong that you corrected by regenerating.
If a social caption is needed as well, write it in `content/` and run the
humanizer skill on it, per `CLAUDE.md`.
