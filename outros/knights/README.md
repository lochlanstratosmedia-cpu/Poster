# Knights outro

Animated 9:16 end cards (1080x1920, 30 fps, 8 seconds) for Liam's message to
the Newcastle Knights, branded for Love Property Group. The song plays over the
end, so every variant settles by about 4 seconds and holds. Trim the tail to
land on the music.

All of them sit on red and blue stripes and finish on the Love and Knights
logos side by side.

| Variant | Look |
|---|---|
| `card` | Diagonal stripes sweep in, a white card rises with a heart, "Go Knights" and both logos |
| `heartbeat` | Vertical stripes drop in, a pulse line traces a white heart, logos on a white bar |
| `hoops` | Jersey-style hoops roll in, big "Go Knights", logos on a white panel |
| `badge` | A white seal stamps on, "With love from Newcastle" turns round the rim, logos inside |
| `overlay` | Transparent: a striped ribbon and white card slide up over the last shot |

Renders are in `renders/`. The overlay comes as `.webm` with alpha. The `.mov`
alpha master (PNG codec) is gitignored, so rebuild it with the script.

## Logos

Save the two logos here and re-render. PNGs with transparent backgrounds work
best. Until they exist, each slot shows a labelled placeholder.

```
outros/knights/logos/love.png
outros/knights/logos/knights.png
```

```bash
node outros/knights/render.mjs                 # all five
node outros/knights/render.mjs card badge      # just these
node outros/knights/render.mjs --love a.png --knights b.png --seconds 10
```

## Fonts

Headlines are set in Gloock (`assets/fonts/Gloock.ttf`, OFL). Proxima Nova is a
paid font, so it is not in the repo. Montserrat stands in until these files are
added to `assets/fonts/`, at which point they take over automatically:

```
ProximaNova-Regular.otf
ProximaNova-Semibold.otf
ProximaNova-Extrabold.otf
```

Needs Node with Playwright and ffmpeg. Open `outro.html` in a browser to
preview any variant live; the buttons at the top switch between them.
