# Architect PDF trace (161 Main Rd, Speers Point)

Turns architect floor plan PDFs (vector linework, not Cubicasa) into a
Cubicasa-style SVG that `run.js` can read. Used for the 161 Main Rd unit set.

- `segs.py` reads every stroke from a PDF and turns the page a quarter so the
  plan reads upright (view x = page y, view y = 842 - page x).
- `gen.py` drops text, dimension lines, leaders, tile hatching and dashed
  overhead lines, then fills walls: pairs of parallel lines 1.85 to 3.3 pt
  apart, cut where a window or door frame sits in the wall. `HOUSE`, `EXTRA`,
  `ADD` and `erase.json` are the per-plan hand fixes.
- `labels.py` holds the room names and sizes (from the PDFs, in metres).
- `build.py` writes the four levels into one SVG with a floor title under each.

PDFs go in `../pdf/` as u12L.pdf, u12U.pdf, u345L.pdf, u345U.pdf. Then:

```
python3 build.py
LEVELS='[{"caption":"Units 1 & 2 lower floor","row":0},{"caption":"Units 1 & 2 upper floor","row":0},{"caption":"Units 3, 4 & 5 lower floor","row":1},{"caption":"Units 3, 4 & 5 upper floor","row":1}]' \
  NORTH=85.5 LABEL=10 node ../run.js 161-main-rd-traced.svg - love "161 Main Road," "Speers Point" out/161-main-rd-speers-point.svg
```
