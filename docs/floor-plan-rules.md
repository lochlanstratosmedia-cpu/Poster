# Floor plan and site plan sheet rules

These are Lochlan's rules for real estate plan sheets, collected from the
original "Siteplan auto-drawing with assets" session (30 Sep to 13 Nov 2026).
The engine in `tools/plan-sheet/` already applies them. Every sheet goes
through that engine. Never redraw a sheet by hand from Cubicasa's own SVG.

## Tools

- `tools/plan-sheet/plan-sheet-builder.html` is the Plan Sheet Builder (the
  hosted copy is https://claude.ai/artifact/1LY63ur2NMa5Hz8pEHQkaw). The media
  team drops in a drone photo and a Cubicasa SVG and downloads the sheet.
- `tools/plan-sheet/engine.js` is the same engine on its own. It runs in a
  browser because it needs DOM geometry.
- `tools/plan-sheet/run.js` runs the engine headless with Playwright:

  ```
  ROT=0 node tools/plan-sheet/run.js plan.svg site.json love "24 Bula Street," "Suburb" out/24-bula-street.svg
  ```

  Use `-` for no plan or no site. `ROT` turns the plan (0, 90, 180, 270).
  `NORTH=<deg>` overrides the north point and `NORTH=off` hides it. It writes
  the SVG, a PNG preview and prints the engine's report.
- `tools/plan-sheet/data.json` holds the brand logos, the tree symbol and the
  Willandra Crescent example job.

When the engine changes, update `engine.js` and the Builder together, and
republish the Builder artifact so the team gets the change.

## Sheet

- A3 landscape, 1400 x 990 units, written as 420 mm x 297 mm.
- Brands: love. (Proxima Nova), creer (Area Normal), reeves (Proxima Nova).
  love. is the default.
- Footer, left to right: disclaimer ("Plans are indicative only. All
  dimensions and areas are approximate. Independent enquiries recommended
  prior to purchase."), purple north point (#512262), address, brand logo
  bottom right.
- Address: line 1 is the street with a trailing comma, in regular weight.
  Line 2 is the suburb, in semibold.
- The suburb never comes from a Cubicasa file name. "Newcastle" there is only
  Cubicasa's city setting. Ask Lochlan for the suburb, and write "Suburb" on
  line 2 until Lochlan answers.
- Flag any clash between the address Lochlan gives and the file name.

## Floor plan

- Source is the Cubicasa SVG with live text (`svg-with-dim/all_floors_*`).
- Never change the linework. Walls, doors, windows and fixtures stay exactly
  as Cubicasa drew them.
- Remove Cubicasa's junk text: the credit line, the disclaimer, the Total,
  the floor area lines, the "Excluded areas" line, any m2 lines, and embedded
  images or logos.
- Remove these room names (and their measurement): Other, Yard, Entry,
  Entrance, Foyer, Hall, Hallway, Corridor, Landing, Passage, Gallery,
  Vestibule. "Room" goes too, unless it has a measurement.
- Keep the name but hide the measurement for wet and storage rooms and the
  kitchen: Bath, Bathroom, Ensuite, Shower, WC, Toilet, Powder, Laundry,
  Utility, Pantry, Linen, Robe, WIR, WIC, Closet, Storage, Store, Cupboard,
  Mud room, Kitchen, Kitchenette.
- Always keep the measurement for bedrooms, living, dining, family, lounge and
  meals, even when the name also has a word from the list above (so "Kitchen /
  Dining" keeps its size). Every other room (garage, deck, porch, carport,
  patio, shed and so on) keeps its measurement.
- Remove the small measurement triangles for any room that is not showing a
  measurement, and any triangle not tied to a room label. A room that keeps
  its measurement keeps its 4 triangles.
- When Cubicasa traces a Yard, Garden or Lawn as a room, remove its outline
  and its fence lines with the label. Otherwise it ties sheds to the house and
  the plan prints tiny.
- Fonts: room names semibold, measurements regular, in the brand font.
- Label size: 12 units on the 1400 wide sheet (about 10 pt printed), the same
  on every sheet. Tight rooms step down to 11/12 and then 10/12, never smaller.
  Labels that still do not fit are flagged for a hand check.
- Labels sit in the middle of their room and off fixtures. Bath sits in the
  middle of the bathroom, never on the sink.
- Floor titles: Cubicasa's "1st Floor", "2nd Floor" and so on become captions
  under each level. Levels sit left to right in floor order.
- The plan is as large as the sheet allows without overlaps, turned the right
  way: street side (porch, entry, garage door) at the bottom where possible.
  Sheds, pools and other outbuildings are packed around the house.
- North point follows Cubicasa's arrow, turned with the plan. A slider in the
  Builder overrides it.

## Site plan

Only when Lochlan sends an aerial. With no aerial, the sheet is floor plan
only.

- Sources: drone photos, or a Google top-down. Lochlan often draws the
  boundary in white. Google top-down plus a drawn boundary is the most
  reliable source; drone photos help identify structures.
- An oblique drone shot is redrawn as fully top-down (cross-check it against
  the Google top-down if one comes with it).
- Style: stippled yard clipped to the lot, title boundary in #333333, the
  house as a white "Residence" with a black outline, other buildings
  unlabelled, driveway #a5a5a5, paving #d9d9d9, pools as a white double
  outline labelled "Pool", trees drawn with Lochlan's tree symbol.
- Street at the bottom. Include every structure inside the boundary, rear
  sheds too.
- The site plan sits in the space the floor plan leaves: its long side is at
  least 440 and at most 640 units.

## Delivery

- An editable SVG for Affinity plus a PNG preview, named after the address
  slug: `24-bula-street.svg` and `24-bula-street-preview.png`.
- In the reply, list what was removed, which measurements were hidden and
  kept, the orientation, where north came from, and anything to check.

## Special cases

- Architect PDFs (not Cubicasa) are traced by hand from the linework: walls
  filled solid like Cubicasa walls, dimensions, notes, hatching and window
  codes removed, sizes converted to metres. Flag any room names that had to
  be added.
- Two scans of one building get joined at true scale (each scan measured from
  its own room sizes), using a shared feature such as a window as the anchor.
