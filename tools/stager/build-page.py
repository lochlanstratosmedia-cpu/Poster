#!/usr/bin/env python3
"""Bundle public/ into one self-contained HTML file for publishing as a
claude.ai page. Writes dist/index.html. Usage: python3 build-page.py"""

import pathlib
import re

here = pathlib.Path(__file__).parent
pub = here / "public"
s = (pub / "index.html").read_text()

# The publishing skeleton adds doctype, html, head, body and meta tags.
for pat in [r"<!doctype html>\s*", r"<html[^>]*>\s*", r"</html>\s*", r"<head>\s*", r"</head>\s*",
            r"<body>\s*", r"</body>\s*", r"\s*<meta charset[^>]*>", r'\s*<meta name="viewport"[^>]*>']:
    s = re.sub(pat, "", s, flags=re.I)

css = (pub / "styles.css").read_text()
s = s.replace('<link rel="stylesheet" href="styles.css" />', f"<style>\n{css}</style>")

js = ""
for name in ["library.js", "shapes.js", "warp.js", "prompt.js", "app.js"]:
    t = (pub / name).read_text()
    t = re.sub(r"^import .*?;\n", "", t, flags=re.M)
    t = re.sub(r"^export ", "", t, flags=re.M)
    js += f"// ---- {name} ----\n{t}\n"
s = s.replace('<script type="module" src="app.js"></script>', f'<script type="module">\n{js}</script>')

out = here / "dist" / "index.html"
out.parent.mkdir(exist_ok=True)
out.write_text(s)
print(f"Wrote {out} ({len(s):,} bytes)")
