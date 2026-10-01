# Knights outro

Animated 9:16 end cards (1080x1920, 30 fps, 8 seconds) for Liam's message to
the Newcastle Knights. The song plays over the end, so every variant settles by
about 5 seconds and holds. Trim the tail to land on the music.

| Variant | Look |
|---|---|
| `heartbeat` | Pulse line traces a heart, it fills red and beats, then "GO KNIGHTS" |
| `stripes` | Red and blue bands sweep through, "NEWCASTLE IS BEHIND YOU" on navy |
| `goldenhour` | Sunrise over a row of red, white and blue houses, hearts drift up |
| `painted` | Brush strokes in club colours, signed "Love, Newcastle" |
| `overlay` | Transparent lower card to sit over the last shot of footage |

Renders are in `renders/`. The overlay comes as `.webm` with alpha; the `.mov`
alpha master (PNG codec, about 27 MB) is gitignored, so rebuild it with the
script.

## Logo

Every variant has a "YOUR LOGO" placeholder. Drop the real logo in (a PNG with
a transparent background works best) and re-render:

```bash
node outros/knights/render.mjs --logo path/to/logo.png
node outros/knights/render.mjs heartbeat --logo path/to/logo.png --seconds 10
```

Needs Node with Playwright and ffmpeg. Open `outro.html` in a browser to
preview any variant live; the buttons at the top switch between them.
