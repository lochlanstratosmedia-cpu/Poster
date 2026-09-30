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

THREE_CDN = "https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"
s = s.replace('<script src="vendor/three.min.js"></script>', f'<script src="{THREE_CDN}"></script>')

# Concatenate the modules in dependency order. Named imports resolve to the
# shared top-level scope; `import * as X` gets an object of that file's exports.
order = ["library.js", "shapes.js", "warp.js", "scene3d.js", "prompt.js", "app.js"]
exports = {}
js = ""
for name in order:
    t = (pub / name).read_text()
    namespaces = re.findall(r'^import \* as (\w+) from "\./([\w.]+)";', t, flags=re.M)
    exports[name] = re.findall(r"^export (?:async )?(?:const|let|function) (\w+)", t, flags=re.M)
    t = re.sub(r"^import .*?;\n", "", t, flags=re.M)
    t = re.sub(r"^export ", "", t, flags=re.M)
    head = "".join(f"const {ns} = {{ {', '.join(exports[f])} }};\n" for ns, f in namespaces)
    js += f"// ---- {name} ----\n{head}{t}\n"
s = s.replace('<script type="module" src="app.js"></script>', f'<script type="module">\n{js}</script>')

out = here / "dist" / "index.html"
out.parent.mkdir(exist_ok=True)
out.write_text(s)
print(f"Wrote {out} ({len(s):,} bytes)")
