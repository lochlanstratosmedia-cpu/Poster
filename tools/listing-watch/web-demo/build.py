#!/usr/bin/env python3
"""Build the one-file online demo of Listing Watch.

  python3 web-demo/build.py [output.html] [--listings forSaleExport.xlsx] [--office NAME] [--ours "A,B"]

Bundles static/app.css, static/app.js and the page markup with
web-demo/demo-server.js, which stands in for the Python back end. The demo
holds made-up data only and keeps nothing after a reload."""

import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)


def read(*parts):
    with open(os.path.join(*parts), encoding="utf-8") as f:
        return f.read()


DEMO_CSS = """
/* demo only */
.topbar { top: env(safe-area-inset-top, 0px); }
.demo-note { background: var(--accent-soft); color: var(--ink); font-size: 13px; text-align: center; padding: 8px 16px; }
.demo-note b { color: var(--accent); }
.paper { position: fixed; inset: 0; z-index: 45; background: rgb(0 0 0 / .45); overflow-y: auto; padding: 24px 16px; }
.paper-sheet { background: #ffffff; color: #111111; max-width: 800px; margin: 0 auto; border-radius: 6px; box-shadow: 0 20px 60px rgb(0 0 0 / .35);
  padding: 24px; font: 14px/1.35 -apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", Arial, sans-serif; color-scheme: light; }
.paper-bar { max-width: 800px; margin: 0 auto 12px; display: flex; gap: 10px; align-items: center; color: #ffffff; flex-wrap: wrap; }
.paper-bar span { font-size: 13px; opacity: .85; }
.paper-sheet .sheet { margin-bottom: 24px; padding-bottom: 20px; border-bottom: 2px dashed #c7c7cc; }
.paper-sheet .sheet:last-child { border-bottom: 0; }
"""

NOTE = """<div class="demo-note"><b>Online demo.</b> Everything here is made up, and your changes last until you reload the page.</div>"""
PAPER = """<div id="paper" class="paper" hidden role="dialog" aria-modal="true" aria-label="Contact sheet preview">
  <div class="paper-bar"><button class="btn" data-paper-close>Close preview</button><span>This is the printed contact sheet, one page per property. The installed version prints it from your browser.</span></div>
  <div class="paper-sheet" id="paper-body"></div>
</div>"""


REAL_NOTE = """<div class="demo-note"><b>Online version.</b> For-sale list from the RP Data export of {when}. Changes you make last until you reload the page.</div>"""


def seed_script(path, settings=None):
    """Embed a for-sale export (CSV or .xlsx) so the page opens on real data.
    The result holds client data: never commit it."""
    import csv
    import io
    import json
    import re
    sys.path.insert(0, ROOT)
    from lw import importer
    with open(path, "rb") as f:
        headers, rows = importer.read_table(path, f.read())
    keep = [i for i, h in enumerate(headers) if h and h.lower() != "property photo"]
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow([headers[i] for i in keep])
    for r in rows:
        w.writerow([r[i] for i in keep])
    stamp = re.search(r"(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})", os.path.basename(path))
    if stamp:
        y, mo, d, hh, mi, ss = stamp.groups()
        date, at = f"{y}-{mo}-{d}", f"{y}-{mo}-{d} {hh}:{mi}:{ss}"
    else:
        from datetime import datetime
        t = datetime.fromtimestamp(os.path.getmtime(path))
        date, at = t.date().isoformat(), t.strftime("%Y-%m-%d %H:%M:%S")
    seed = {"filename": re.sub(r"^[0-9a-f]{8}-", "", os.path.basename(path)), "date": date, "imported_at": at,
            "source": "RP Data export", "csv": buf.getvalue(), "settings": settings or {}}
    from datetime import date as _d
    when = _d.fromisoformat(date).strftime("%-d %B %Y")
    return "<script>window.LW_SEED = " + json.dumps(seed).replace("</", "<\\/") + ";</script>", when, len(rows)


def sheet_css():
    """The printed sheet's CSS from lw/server.py, scoped to the preview panel."""
    sys.path.insert(0, ROOT)
    from lw import server
    css = re.sub(r"@page[^}]*}", "", server.SHEET_CSS)
    css = re.sub(r"@media print\s*{.*}\s*$", "", css.strip(), flags=re.S)
    out = []
    for sel, body in re.findall(r"([^{}]+){([^}]*)}", css):
        sel = ", ".join(".paper-sheet" if s.strip() in ("body", "*") else ".paper-sheet " + s.strip() for s in sel.split(","))
        out.append(f"{sel} {{{body}}}")
    return "\n".join(out)


def build(out, listings=None, settings=None):
    index = read(ROOT, "static", "index.html")
    body = index[index.index("<body>") + len("<body>"):index.index('<script src="/static/app.js">')]
    seed, note = "", NOTE
    if listings:
        seed, when, n = seed_script(listings, settings)
        note = REAL_NOTE.format(when=when)
        print(f"Embedded {n} listings from {listings}")
    page = "\n".join([
        "<title>Listing Watch</title>",
        "<style>\n" + read(ROOT, "static", "app.css") + DEMO_CSS + sheet_css() + "</style>",
        note,
        body.strip(),
        PAPER,
        seed,
        "<script>\n" + read(HERE, "demo-server.js") + "</script>",
        "<script>\n" + read(ROOT, "static", "app.js") + "</script>",
    ])
    with open(out, "w", encoding="utf-8") as f:
        f.write(page + "\n")
    print(f"Wrote {out} ({len(page) // 1024} KB)")


if __name__ == "__main__":
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("out", nargs="?", default=os.path.join(HERE, "listing-watch-demo.html"))
    ap.add_argument("--listings", help="for-sale export to load instead of the made-up demo data (never commit the output)")
    ap.add_argument("--office", default="", help="office name printed on contact sheets")
    ap.add_argument("--ours", default="", help="our agency names, comma separated, so our listings are left out")
    a = ap.parse_args()
    settings = {}
    if a.office:
        settings["office_name"] = a.office
    if a.ours:
        settings["our_agencies"] = [x.strip() for x in a.ours.split(",") if x.strip()]
    build(a.out, a.listings, settings)
