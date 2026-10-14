# Reels

Property reels in the Love card-scroll style: sound effects, the end card, and
an Instagram cover for each listing.

## Cover

`make_cover.py` builds a 1080x1920 reel cover. It has one rounded exterior
card with the address in white, a lavender pill with bed, bath and car counts,
and the love. logo, all on the striped white background from the reel end
card.

```
python3 reels/make_cover.py <exterior photo> \
    --address "295 Main Road" --address "Fennell Bay" \
    --bed 4 --bath 1 --car 6 \
    --out reels/<property>/cover.png --guides
```

- Give each address line its own `--address`.
- Leave out `--bed`, `--bath` or `--car` to drop that stat.
- `--focus X Y` moves the crop (0 to 1 each). Pick a photo with sky at the top
  left, because the address sits there.
- `--guides` writes a second copy with the profile-grid crop marked. The grid
  shows only the middle 3:4 (y 240 to 1680), and the layout keeps everything
  inside it.

Use the original listing photo when there is one. A frame pulled from a reel
works, but it is softer.

## Assets

| File | What it is |
|---|---|
| `assets/stripe-bg.png` | The reel end-card background with the logo painted out |
| `assets/icon-bed.png`, `icon-bath.png`, `icon-car.png` | White stat icons, keyed from the reel's stats card |
| `assets/love-dark.png` | `outros/knights/logos/love.png` with the letters set to near black for light backgrounds |

## Properties

Each listing gets a folder. `295-main-road/` has:

| File | What it is |
|---|---|
| `cover.png` | Instagram cover |
| `exterior-from-reel.png` | The exterior frame the cover uses, taken from the reel at 16.6s |
| `reel-sfx.mp4` | Test reel with UI sound effects |
| `reel-sfx-listed-with-love.mp4` | The same reel, with "listed with" added above the logo on the end card |
| `sfx-track.wav` | The sound effects alone, to lay over the full-quality original at 0:00 |
| `sfx.py` | Builds `sfx-track.wav`. Cue times are set by hand for this reel |
| `endcard.filter` | ffmpeg drawtext filter that adds "listed with" at 18.85s |

The sound cues in `sfx.py` follow this reel's motion, so a new reel needs its
own cue times.
