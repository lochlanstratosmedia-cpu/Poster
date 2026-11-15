# Plan sheet engine

Recovered from the Plan Sheet Builder artifact (version 17,
https://claude.ai/artifact/1LY63ur2NMa5Hz8pEHQkaw) so it lives in the repo.
The rules it applies are in `docs/floor-plan-rules.md`.

- `plan-sheet-builder.html`: the full Builder page as published.
- `engine.js`: `SheetEngine.processFloorPlan`, `fitLabels`, `buildSheet`.
- `data.json`: brand logos, tree symbol, Willandra Crescent example.
- `run.js`: headless runner (Playwright).

```
ROT=0 node tools/plan-sheet/run.js plan.svg - love "24 Bula Street," "Suburb" out/24-bula-street.svg
```
