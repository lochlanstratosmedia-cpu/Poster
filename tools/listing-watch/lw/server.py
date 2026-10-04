"""Small web server for the office. Python standard library only.

Every write goes through one lock so two agents saving at the same moment
can't trip over each other."""

import csv
import html
import io
import json
import mimetypes
import os
import re
import threading
import time
import traceback
from datetime import date
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, unquote, urlparse

from . import db, engine

STATIC = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "static")
LOCK = threading.Lock()
MAX_UPLOAD = 50 * 1024 * 1024


class Handler(BaseHTTPRequestHandler):
    server_version = "ListingWatch/1"
    db_path = None

    def log_message(self, fmt, *args):  # quieter console
        if os.environ.get("LISTING_WATCH_VERBOSE"):
            super().log_message(fmt, *args)

    # ---------- plumbing ----------

    def _send(self, code, body, ctype="application/json; charset=utf-8", headers=None):
        if isinstance(body, (dict, list)):
            body = json.dumps(body, default=str)
        if isinstance(body, str):
            body = body.encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        for k, v in (headers or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body)

    def _body(self):
        n = int(self.headers.get("Content-Length") or 0)
        if n > MAX_UPLOAD:
            raise engine.Problem("That file is larger than 50 MB.")
        return self.rfile.read(n) if n else b""

    def _json(self):
        raw = self._body()
        return json.loads(raw) if raw else {}

    def _person(self):
        return unquote(self.headers.get("X-Person", "")).strip()

    def _run(self, fn, write=False):
        try:
            if write:
                with LOCK:
                    conn = db.connect(self.db_path)
                    try:
                        with conn:
                            result = fn(conn)
                    finally:
                        conn.close()
            else:
                conn = db.connect(self.db_path)
                try:
                    result = fn(conn)
                finally:
                    conn.close()
            if isinstance(result, tuple):
                self._send(*result)
            else:
                self._send(200, result if result is not None else {"ok": True})
        except engine.Problem as e:
            self._send(400, {"error": str(e)})
        except Exception as e:  # pragma: no cover - shown to the user, logged to console
            traceback.print_exc()
            self._send(400 if "import" in self.path else 500, {"error": f"{type(e).__name__}: {e}"})

    # ---------- routes ----------

    def do_GET(self):
        url = urlparse(self.path)
        path, qs = url.path, parse_qs(url.query)
        if path in ("/", "/index.html"):
            return self._static("index.html")
        if path == "/favicon.ico":
            return self._send(204, b"", "image/x-icon")
        if path.startswith("/static/"):
            return self._static(path[len("/static/"):])
        m = re.fullmatch(r"/sheet/(\d+)/print", path)
        if m:
            return self._run(lambda c: (200, render_sheet(c, int(m.group(1))), "text/html; charset=utf-8"))
        m = re.fullmatch(r"/sheet/(\d+)\.csv", path)
        if m:
            return self._run(lambda c: sheet_csv(c, int(m.group(1))))
        if path == "/export/leads.csv":
            return self._run(lambda c: leads_csv(c, qs.get("view", ["all"])[0]))
        routes = {
            "/api/summary": lambda c: engine.summary(c),
            "/api/meta": lambda c: {"statuses": engine.STATUSES, "outcomes": engine.OUTCOMES, "methods": engine.METHODS},
            "/api/leads": lambda c: engine.leads_view(c, qs.get("view", ["ready"])[0]),
            "/api/agents": lambda c: [dict(r) for r in c.execute("SELECT * FROM agents ORDER BY active DESC, name")],
            "/api/sheets": lambda c: engine.sheets_list(c),
            "/api/notifications": lambda c: [dict(r) for r in c.execute("SELECT * FROM notifications ORDER BY id DESC LIMIT 100")],
            "/api/imports": lambda c: [dict(r) for r in c.execute("SELECT * FROM imports ORDER BY id DESC LIMIT 50")],
        }
        if path in routes:
            return self._run(routes[path])
        m = re.fullmatch(r"/api/leads/(\d+)", path)
        if m:
            return self._run(lambda c: engine.lead_detail(c, int(m.group(1))))
        m = re.fullmatch(r"/api/sheets/(\d+)", path)
        if m:
            return self._run(lambda c: engine.sheet(c, int(m.group(1))))
        self._send(404, {"error": "Not found"})

    def do_POST(self):
        path = urlparse(self.path).path
        qs = parse_qs(urlparse(self.path).query)
        by = self._person()
        try:
            if path == "/api/import/preview":
                data = self._body()
                kind, name = qs.get("kind", [""])[0], qs.get("filename", ["upload.csv"])[0]
                return self._run(lambda c: engine.preview_import(kind, name, data, c))
            body = self._json()
        except engine.Problem as e:
            return self._send(400, {"error": str(e)})
        except Exception as e:
            return self._send(400, {"error": str(e)})

        if path == "/api/import/check":
            return self._run(lambda c: engine.dry_run(body.get("token"), body.get("mapping"), c))
        if path == "/api/import/commit":
            return self._run(lambda c: engine.commit_import(body.get("token"), body.get("mapping"),
                                                            bool(body.get("full_snapshot", True)), by, c), write=True)
        if path == "/api/sheets":
            return self._run(lambda c: {"sheet_id": engine.create_sheet(c, body.get("agent_id"), body.get("lead_ids", []), by, body.get("note", ""))}, write=True)
        if path == "/api/agents":
            return self._run(lambda c: engine.save_agent(c, body.get("name"), body.get("phone", ""), body.get("id"), body.get("active", True)), write=True)
        if path == "/api/settings":
            return self._run(lambda c: save_settings(c, body, by), write=True)
        if path == "/api/notifications/read":
            return self._run(lambda c: c.execute("UPDATE notifications SET read_at = ? WHERE read_at IS NULL", (engine.now_iso(),)) and None, write=True)
        if path == "/api/rebuild":
            return self._run(lambda c: engine.daily_check(c), write=True)
        m = re.fullmatch(r"/api/leads/(\d+)/(\w+)", path)
        if m:
            lid, action = int(m.group(1)), m.group(2)
            actions = {
                "log": lambda c: engine.log_outcome(c, lid, body.get("outcome"), by, body.get("method", "call"),
                                                    body.get("note", ""), body.get("follow_up_on")),
                "undo": lambda c: engine.undo_last(c, lid, by),
                "release": lambda c: engine.release(c, lid, by, body.get("reason", "")),
                "reassign": lambda c: engine.reassign(c, lid, body.get("agent_id"), by),
                "match": lambda c: engine.review_match(c, lid, body.get("contact_id"), body.get("decision"), by),
            }
            if action in actions:
                return self._run(actions[action], write=True)
        self._send(404, {"error": "Not found"})

    def _static(self, rel):
        full = os.path.normpath(os.path.join(STATIC, rel))
        if not full.startswith(STATIC) or not os.path.isfile(full):
            return self._send(404, {"error": "Not found"})
        ctype = mimetypes.guess_type(full)[0] or "application/octet-stream"
        if ctype.startswith("text/") or ctype.endswith("javascript"):
            ctype += "; charset=utf-8"
        with open(full, "rb") as f:
            self._send(200, f.read(), ctype)


def save_settings(conn, body, by):
    engine._require_person(by)
    clean = {}
    if "threshold_days" in body:
        t = int(body["threshold_days"])
        if not 1 <= t <= 365:
            raise engine.Problem("The day threshold must be between 1 and 365.")
        clean["threshold_days"] = t
    if "soon_days" in body:
        clean["soon_days"] = max(1, min(60, int(body["soon_days"])))
    if "stale_after_days" in body:
        clean["stale_after_days"] = max(1, min(60, int(body["stale_after_days"])))
    if "our_agencies" in body:
        names = body["our_agencies"]
        if isinstance(names, str):
            names = names.split("\n")
        clean["our_agencies"] = [n.strip() for n in names if n.strip()]
    if "date_order" in body:
        if body["date_order"] not in ("DMY", "MDY"):
            raise engine.Problem("Unknown date order.")
        clean["date_order"] = body["date_order"]
    if "office_name" in body:
        clean["office_name"] = str(body["office_name"]).strip()[:80]
    if "timezone" in body:
        try:
            from zoneinfo import ZoneInfo
            ZoneInfo(body["timezone"])
        except Exception:
            raise engine.Problem(f"Unknown time zone '{body['timezone']}'. Use a name like Australia/Sydney.")
        clean["timezone"] = body["timezone"]
    db.set_settings(conn, clean)
    engine.rebuild(conn)


# ---------- printable sheet ----------

def _fmt_date(iso, fmt="%a %d %b %Y"):
    return date.fromisoformat(iso).strftime(fmt) if iso else ""


def render_sheet(conn, sheet_id):
    s = engine.sheet(conn, sheet_id)
    settings = db.get_settings(conn)
    e = html.escape
    rows = []
    for n, l in enumerate(s["leads"], 1):
        warn = ""
        if not l["for_sale"]:
            warn = '<div class="warn">NO LONGER FOR SALE. DO NOT CALL.</div>'
        elif l["do_not_contact"]:
            warn = '<div class="warn">DO NOT CONTACT.</div>'
        elif l["moved"]:
            warn = '<div class="warn">MOVED OFF THIS SHEET. DO NOT CALL.</div>'
        people = []
        for c in l["contacts"]:
            if c["quality"] not in ("exact", "confirmed"):
                continue
            phones = " &middot; ".join(e(p) for p in (c["phone"], c["phone2"]) if p) or '<span class="none">No phone on file</span>'
            people.append(f'<div class="person"><b>{e(c["name"])}</b>{" <span class=dnc>DNC</span>" if c["do_not_contact"] else ""}'
                          f'<div class="phone">{phones}</div>'
                          f'{"<div class=email>" + e(c["email"]) + "</div>" if c["email"] else ""}</div>')
        listing = " &middot; ".join(e(x) for x in [l["property_type"], (l["bedrooms"] + " bed") if l["bedrooms"] else "", l["price"]] if x)
        rows.append(f"""
<tr class="{'struck' if warn else ''}">
  <td class="n">{n}</td>
  <td><div class="addr">{e(l['address'])}</div>{warn}
      <div class="small">{listing}</div>
      <div class="small">Lead #{l['id']}</div></td>
  <td>{''.join(people)}</td>
  <td><div class="days">{l['days']}</div><div class="small">days listed<br>since {_fmt_date(l['listed_date'], '%d %b %Y')}</div></td>
  <td><div>{e(l['agency'])}</div><div class="small">{e(l['listing_agent'] or '')}</div></td>
  <td class="boxes">
    <div>&#9744; No answer &nbsp; &#9744; Left message</div>
    <div>&#9744; Call back: ____/____ &nbsp; &#9744; Appraisal: ____/____</div>
    <div>&#9744; Not interested &nbsp; &#9744; Wrong number &nbsp; &#9744; Do not contact</div>
    <div class="lines"></div>
  </td>
</tr>""")
    office = e(settings.get("office_name") or "")
    return f"""<!doctype html>
<html lang="en-AU"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Contact sheet #{s['id']} - {e(s['agent'])}</title>
<style>
@page {{ size: A4 landscape; margin: 12mm; }}
* {{ box-sizing: border-box; }}
body {{ font: 11pt/1.35 -apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", "Segoe UI", Arial, sans-serif; -webkit-font-smoothing: antialiased; color: #111; margin: 0; padding: 16px; background: #fff; }}
header {{ display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 3px solid #111; padding-bottom: 8px; margin-bottom: 10px; gap: 16px; flex-wrap: wrap; }}
h1 {{ font-size: 20pt; margin: 0; }}
.meta {{ text-align: right; font-size: 10pt; }}
.meta b {{ font-size: 13pt; }}
.rules {{ font-size: 9.5pt; background: #f2f2f2; padding: 6px 10px; margin-bottom: 10px; border-left: 4px solid #111; }}
table {{ width: 100%; border-collapse: collapse; }}
th {{ text-align: left; font-size: 9pt; text-transform: uppercase; letter-spacing: .04em; border-bottom: 2px solid #111; padding: 4px 6px; }}
td {{ vertical-align: top; padding: 8px 6px; border-bottom: 1px solid #999; }}
tr {{ page-break-inside: avoid; }}
.n {{ font-weight: 700; width: 24px; }}
.addr {{ font-weight: 700; font-size: 12pt; }}
.person + .person {{ margin-top: 6px; }}
.phone {{ font-size: 13pt; font-weight: 600; letter-spacing: .02em; font-variant-numeric: tabular-nums; }}
.email, .small {{ font-size: 9pt; color: #333; }}
.none {{ color: #a00; font-size: 10pt; font-weight: 400; }}
.days {{ font-size: 18pt; font-weight: 800; font-variant-numeric: tabular-nums; }}
.boxes {{ font-size: 9.5pt; width: 34%; }}
.boxes div {{ margin-bottom: 3px; }}
.lines {{ border-bottom: 1px solid #bbb; height: 18px; margin-top: 6px; }}
.warn {{ background: #111; color: #fff; font-weight: 800; padding: 2px 6px; display: inline-block; margin: 3px 0; }}
.dnc {{ background: #a00; color: #fff; font-size: 8pt; padding: 1px 4px; margin-left: 4px; }}
tr.struck .addr, tr.struck .phone {{ text-decoration: line-through; }}
.toolbar {{ margin-bottom: 12px; display: flex; gap: 8px; }}
.toolbar button, .toolbar a {{ font: 500 14px/1 inherit; padding: 10px 18px; border: 0; background: #007aff; color: #fff; border-radius: 980px; cursor: pointer; text-decoration: none; }}
.toolbar a {{ background: rgba(118,118,128,.12); color: #007aff; }}
@media print {{ .toolbar {{ display: none; }} body {{ padding: 0; }} }}
</style></head><body>
<div class="toolbar"><button onclick="window.print()">Print this sheet</button><a href="/sheet/{s['id']}.csv">Download as spreadsheet</a><a href="/#/sheets/{s['id']}">Back to the app</a></div>
<header>
  <div><h1>Contact sheet #{s['id']}</h1><div>{office}{' &middot; ' if office else ''}Properties listed {settings['threshold_days']}+ days with another agency</div></div>
  <div class="meta">For <b>{e(s['agent'])}</b><br>Made {_fmt_date(s['created_at'][:10])} by {e(s['created_by'] or '')}<br>{len(s['leads'])} propert{'y' if len(s['leads']) == 1 else 'ies'}</div>
</header>
<div class="rules">Call only the people on this sheet. Log every call in Listing Watch the same day, including no answers. A row marked DO NOT CALL changed after this sheet was printed: skip it.</div>
<table><thead><tr><th>#</th><th>Property</th><th>Owner</th><th>Listed</th><th>Current agency</th><th>Outcome</th></tr></thead>
<tbody>{''.join(rows)}</tbody></table>
</body></html>"""


def _csv_response(rows, filename):
    buf = io.StringIO()
    w = csv.writer(buf)
    for r in rows:
        # Imported text can't be trusted: stop Excel reading a cell as a formula.
        w.writerow(["'" + c if isinstance(c, str) and c[:1] in ("=", "+", "@", "\t", "\r") else c for c in r])
    return (200, "﻿" + buf.getvalue(), "text/csv; charset=utf-8")


def _lead_csv_rows(leads, extra_first=None):
    header = ["Lead #", "Address", "Owner(s)", "Phone", "Other phone", "Email", "Days listed", "Date listed",
              "Agency", "Listing agent", "Price", "Status", "Agent", "Follow-up", "Attempts", "For sale", "Do not contact", "Listing link"]
    rows = [header]
    for l in leads:
        usable = [c for c in l["contacts"] if c["quality"] in ("exact", "confirmed")]
        rows.append([l["id"], l["address"], "; ".join(c["name"] for c in usable),
                     "; ".join(c["phone"] for c in usable if c["phone"]), "; ".join(c["phone2"] for c in usable if c["phone2"]),
                     "; ".join(c["email"] for c in usable if c["email"]), l["days"], l["listed_date"], l["agency"],
                     l["listing_agent"] or "", l["price"] or "", l["status_label"], l["agent_name"] or "",
                     l["follow_up_on"] or "", l["attempts"], "Yes" if l["for_sale"] else "No",
                     "Yes" if l["do_not_contact"] else "", l["url"] or ""])
    return rows


def sheet_csv(conn, sheet_id):
    s = engine.sheet(conn, sheet_id)
    status, body, ctype = _csv_response(_lead_csv_rows(s["leads"]), "")
    return (200, body, ctype, {"Content-Disposition": f'attachment; filename="contact-sheet-{sheet_id}-{re.sub(r"[^A-Za-z0-9]+", "-", s["agent"])}.csv"'})


def leads_csv(conn, view):
    leads = engine.leads_view(conn, view)
    status, body, ctype = _csv_response(_lead_csv_rows(leads), "")
    return (200, body, ctype, {"Content-Disposition": f'attachment; filename="listing-watch-{view}-{engine.today(conn)}.csv"'})


# ---------- background daily check ----------

def _daily_loop(db_path, every=600):
    while True:
        try:
            with LOCK:
                conn = db.connect(db_path)
                try:
                    with conn:
                        engine.daily_check(conn)
                finally:
                    conn.close()
        except Exception:
            traceback.print_exc()
        time.sleep(every)


def serve(host="127.0.0.1", port=8770, db_path=None):
    Handler.db_path = db_path
    threading.Thread(target=_daily_loop, args=(db_path,), daemon=True).start()
    httpd = ThreadingHTTPServer((host, port), Handler)
    shown = "localhost" if host in ("127.0.0.1", "0.0.0.0") else host
    print(f"Listing Watch is running. Open http://{shown}:{port} in your browser.")
    if host == "0.0.0.0":
        print("Other computers on the office network can use this computer's address with the same port.")
    print("Press Ctrl+C to stop.")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")
