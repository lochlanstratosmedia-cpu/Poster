# Stager

Stager is a layout tool for virtual staging. You upload a room photo, drop
furniture placeholders from a library onto it, and size and position each one
by hand. Stager then sends Nano Banana Pro three things: the original photo, a
copy with the coloured, numbered placeholders drawn on it (the layout guide),
and a prompt that describes each numbered placeholder. The model renders real
furniture where the placeholders are instead of choosing its own layout.

## Open it

A hosted copy is at https://claude.ai/artifact/6tqzEp83pBwhHMQ8FyLDkW. It is
private until you share it from the page's Share menu. The hosted copy does
everything except Render, because it cannot reach the Gemini API. Use Download
pack and run the files in Higgsfield, or run Stager locally to render.

To rebuild the hosted copy after changing `public/`, run
`python3 build-page.py` and publish `dist/index.html`.

## Run it locally

You need Node 18 or newer. There is nothing to install.

```bash
cd tools/stager
GEMINI_API_KEY=your-key npm start
```

Then open http://localhost:5173.

Without a key the editor and the Higgsfield export still work. Only the
Render button is off.

| Variable | Default | What it does |
|---|---|---|
| `GEMINI_API_KEY` | none | Google AI Studio key used for renders |
| `STAGER_MODEL` | `gemini-3-pro-image-preview` | Model ID. This is Nano Banana Pro |
| `PORT` | `5173` | Local port |

The key stays on the server. The browser never sees it.

## Using it

1. Upload a photo. You can also drag a file onto the canvas or paste one.
2. Drag items from the library onto the photo, or click one to drop it in.
3. Drag to move. Pull a corner to resize (hold Shift to keep proportions).
   The round handle rotates (hold Shift to snap to 15 degrees).
4. With an item selected, fill in "What to render" and the material and colour
   notes. Set which way it faces and whether it sits on the floor, on the wall,
   on a surface, or hangs from the ceiling.
5. Optional: attach a product photo to an item. The model is told to match it.
6. Set the room type, style and palette under Scene.
7. Click Render, or use Download pack to run it in Higgsfield.

Keyboard: Delete removes the selected item, Ctrl+D duplicates it, the arrow
keys nudge it (Shift for bigger steps), Ctrl+Z undoes, Esc deselects.

### Tips for placement

- The bottom edge of a floor placeholder is where the item meets the floor.
  Line it up with the floor in the photo and the scale usually comes out right.
- Things further back in the room should be drawn smaller.
- Put rugs at the back of the layer order (Send back) so other pieces sit on
  top of them. New rugs start there.
- Use Rotate to follow the line of a wall seen at an angle.

### Angled and off-centre shots

Most photos are not taken straight on, so every placeholder can be put in
perspective. Select an item and use the sliders under "Angle and perspective":

- Skew across and Skew up and down slant the shape.
- Turn away makes one side shorter, as if it is further from the camera. Use
  it for a sofa along a side wall.
- Tilt back makes the top edge narrower. Use it for rugs, beds and tables seen
  from above.

For full control, click Drag corners (or double-click the item) and drag each
corner onto the photo. This works well for rugs: put the four corners where
the rug's corners should sit on the floor. Click Done or press Esc to finish.
Reset angle clears all of it, and double-clicking a slider zeroes that one.

The guide image shows the warped shape, and the prompt gives the model the
positions of each corner so it matches the angle instead of rendering the
piece straight on.
- For big rooms, stage in two passes. Render the main pieces, click "Use as
  base" on the best result, then add decor and render again.

## Running it in Higgsfield

Download pack saves the photo, the guide image, the prompt as a text file, and
any product photos. In Higgsfield, choose Nano Banana Pro, add the photo first
and the guide second (then any product photos, in item order), and paste the
prompt. The prompt refers to the images by position, so the order matters.

## Your own library

Select an item you have set up (shape, size, notes, product photo) and click
"Save to my library". It shows up under "My library" in this browser. Use
"Export my library" to save it as a file and "Import library" to load it on
another computer, so the team can share one set of pieces.

The built-in pieces are in `public/library.js`. Each entry has a name, a
category, a silhouette shape, a default width as a fraction of the photo, a
width to height ratio, and the text the model is given.

## Projects

Save project writes a JSON file with the photo, placeholders, scene settings
and finished renders. Open project loads it back.

## Files

| Path | What it does |
|---|---|
| `server.mjs` | Serves the app and forwards renders to the Gemini API |
| `public/index.html`, `public/styles.css` | Page and layout |
| `public/app.js` | Editor, guide image, render calls, projects |
| `public/library.js` | Built-in furniture, styles, room types, placeholder colours |
| `public/shapes.js` | Silhouettes drawn for each placeholder |
| `public/prompt.js` | Builds the prompt from the layout |

## Limits

The model follows the guide closely but not perfectly. Expect to run two or
three variations and pick the best one. Placeholders are flat outlines, so
the model still decides the exact 3D angle of each piece. Use the Facing
setting when that matters.
