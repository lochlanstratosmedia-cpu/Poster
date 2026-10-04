#!/usr/bin/env python3
"""Build the one-file online demo of Listing Watch.

  python3 web-demo/build.py [output.html]

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
.paper-sheet { background: #ffffff; color: #111111; max-width: 1120px; margin: 0 auto; border-radius: 6px; box-shadow: 0 20px 60px rgb(0 0 0 / .35);
  padding: 24px; font: 14px/1.35 -apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", Arial, sans-serif; color-scheme: light; }
.paper-bar { max-width: 1120px; margin: 0 auto 12px; display: flex; gap: 10px; align-items: center; color: #ffffff; flex-wrap: wrap; }
.paper-bar span { font-size: 13px; opacity: .85; }
.paper-head { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 3px solid #111111; padding-bottom: 8px; margin-bottom: 10px; gap: 16px; flex-wrap: wrap; }
.paper-head h1 { font-size: 26px; margin: 0; color: #111111; }
.paper .meta { text-align: right; font-size: 13px; }
.paper .meta b { font-size: 17px; }
.paper .rules { font-size: 12.5px; background: #f2f2f2; padding: 6px 10px; margin-bottom: 10px; border-left: 4px solid #111111; }
.paper-scroll { overflow-x: auto; }
.paper table { width: 100%; border-collapse: collapse; min-width: 860px; }
.paper th { text-align: left; font-size: 11.5px; text-transform: uppercase; letter-spacing: .04em; border-bottom: 2px solid #111111; padding: 4px 6px; color: #111111; }
.paper td { vertical-align: top; padding: 8px 6px; border-bottom: 1px solid #999999; color: #111111; }
.paper .n { font-weight: 700; width: 24px; }
.paper .addr { font-weight: 700; font-size: 15px; }
.paper .person { display: block; color: #111111; font-size: 14px; }
.paper .person + .person { margin-top: 6px; }
.paper .phone { font-size: 16px; font-weight: 600; font-variant-numeric: tabular-nums; }
.paper .email, .paper .small { font-size: 12px; color: #333333; }
.paper .none { color: #aa0000; font-size: 13px; font-weight: 400; }
.paper .days { font-size: 24px; font-weight: 800; }
.paper .boxes { font-size: 12.5px; width: 34%; }
.paper .boxes div { margin-bottom: 3px; }
.paper .lines { border-bottom: 1px solid #bbbbbb; height: 18px; margin-top: 6px; }
.paper .warn { background: #111111; color: #ffffff; font-weight: 800; padding: 2px 6px; display: inline-block; margin: 3px 0; }
.paper .dnc { background: #aa0000; color: #ffffff; font-size: 11px; padding: 1px 4px; margin-left: 4px; }
.paper tr.struck .addr, .paper tr.struck .phone { text-decoration: line-through; }
"""

NOTE = """<div class="demo-note"><b>Online demo.</b> Everything here is made up, and your changes last until you reload the page.</div>"""
PAPER = """<div id="paper" class="paper" hidden role="dialog" aria-modal="true" aria-label="Contact sheet preview">
  <div class="paper-bar"><button class="btn" data-paper-close>Close preview</button><span>This is the printed contact sheet. The installed version prints it from your browser.</span></div>
  <div class="paper-sheet" id="paper-body"></div>
</div>"""


def build(out):
    index = read(ROOT, "static", "index.html")
    body = index[index.index("<body>") + len("<body>"):index.index('<script src="/static/app.js">')]
    page = "\n".join([
        "<title>Listing Watch</title>",
        "<style>\n" + read(ROOT, "static", "app.css") + DEMO_CSS + "</style>",
        NOTE,
        body.strip(),
        PAPER,
        "<script>\n" + read(HERE, "demo-server.js") + "</script>",
        "<script>\n" + read(ROOT, "static", "app.js") + "</script>",
    ])
    with open(out, "w", encoding="utf-8") as f:
        f.write(page + "\n")
    print(f"Wrote {out} ({len(page) // 1024} KB)")


if __name__ == "__main__":
    build(sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, "listing-watch-demo.html"))
