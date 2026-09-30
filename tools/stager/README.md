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
3. Match the camera (see below), then drag each piece into place, turn it,
   and set its size.
4. With an item selected, fill in "What to render" and the material and colour
   notes. Set which way it faces and whether it sits on the floor, on the wall,
   on a surface, or hangs from the ceiling.
5. Optional: attach a product photo to an item. The model is told to match it.
6. Set the room type, style and palette under Scene.
7. Click Render, or use Download pack to run it in Higgsfield.

Keyboard: Delete removes the selected item, Ctrl+D duplicates it, the arrow
keys nudge it (Shift for bigger steps), Ctrl+Z undoes, Esc deselects.

### 3D blocks and the camera match

Floor furniture (sofas, beds, tables, chairs, cabinets, rugs, plants, lamps)
goes in as a 3D block model at real size, in centimetres. Stager draws it
through a virtual camera matched to the photo, so a piece gets smaller as you
drag it further back and follows the room's perspective on its own.

Match the camera once per photo, under Camera match:

1. Click Match camera. A yellow line and a floor grid appear.
2. Drag the yellow line to eye level: the height where lines running along the
   floor and the ceiling would meet. In most real estate shots it sits a little
   below the middle of the frame.
3. Change Lens width until the grid runs with the floorboards, tiles or skirting.
4. Set Camera height. Anything as tall as the camera touches the yellow line, so
   if a 140 cm high object in the photo reaches the line, the camera is at
   140 cm. The default is 140.
5. Click Done.

Then, with a 3D piece selected:

- Drag it to slide it across the floor.
- Drag the round handle in front of it to turn it (Shift snaps to 15 degrees),
  or press Q and E. The solid coloured edge is the front.
- Set width, depth and height in centimetres, and "Height off the floor" for
  things that sit on other furniture, like a table lamp on a bedside table.
- Arrow keys move it 5 cm (Shift for 25 cm). Up moves it further away.

The guide image shows the shaded blocks, and the prompt gives the model each
piece's real size, which way it faces, and where its front and back edges sit
in the frame.

The camera match assumes the camera was level, with upright walls in the photo.
For a photo tilted up or down, or for any piece the blocks do not suit, click
"Switch to flat placeholder" and use the flat tools below. Wall art, mirrors,
curtains and pendant lights are always flat.

### Flat placeholders

Flat placeholders are 2D silhouettes. Drag to move, pull a corner to resize
(Shift keeps proportions), and use the round handle to rotate. Under "Angle and
perspective":

- Skew across and Skew up and down slant the shape.
- Turn away makes one side shorter, as if it is further from the camera.
- Tilt back makes the top edge narrower.
- Drag corners (or double-click the item) lets you drag each corner onto the
  photo. Click Done or press Esc to finish.

Reset angle clears all of it, and double-clicking a slider zeroes that one. Put
flat rugs at the back of the layer order (Send back) so other pieces sit on
top.

### Tips

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
width to height ratio, the text the model is given, and for floor pieces a real
size in metres. The 3D block models are in `public/scene3d.js`.

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
| `public/scene3d.js` | 3D block models and the camera match |
| `public/warp.js` | Perspective warp for flat placeholders |
| `public/vendor/three.min.js` | three.js r128 (MIT), used for the 3D blocks |

## Limits

The model follows the guide closely but not perfectly. Expect to run two or
three variations and pick the best one. Placeholders are flat outlines, so
the model still decides the exact 3D angle of each piece. Use the Facing
setting when that matters.
