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
from datetime import date, timedelta
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, unquote, urlparse

from . import db, engine, importer

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
    if "agreement_days" in body:
        a = int(body["agreement_days"] or 0)
        if not 0 <= a <= 365:
            raise engine.Problem("The agreement length must be between 0 and 365 days (0 turns the estimate off).")
        clean["agreement_days"] = a
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


def _days_phrase(n):
    if n == 0:
        return "today"
    return f"in {n} day{'s' if n != 1 else ''}" if n > 0 else f"{-n} day{'s' if n != -1 else ''} ago"


SHEET_CSS = """
@page { size: A4 portrait; margin: 11mm 12mm; }
* { box-sizing: border-box; }
body { margin: 0; padding: 16px; background: #fff; color: #1d1d1f;
  font: 10.5pt/1.38 -apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", Arial, sans-serif; -webkit-font-smoothing: antialiased; }
.toolbar { margin-bottom: 14px; display: flex; gap: 8px; flex-wrap: wrap; }
.toolbar button, .toolbar a { font: 500 14px/1 inherit; padding: 10px 18px; border: 0; background: #007aff; color: #fff; border-radius: 980px; cursor: pointer; text-decoration: none; }
.toolbar a { background: rgba(118,118,128,.12); color: #007aff; }
.sheet { max-width: 186mm; margin: 0 auto 28px; page-break-after: always; break-after: page; }
.sheet:last-child { page-break-after: auto; break-after: auto; }
.top { display: flex; justify-content: space-between; gap: 12px; align-items: baseline; border-bottom: 2px solid #1d1d1f; padding-bottom: 5px; font-size: 8.5pt; letter-spacing: .1em; text-transform: uppercase; font-weight: 600; }
.top span:last-child { letter-spacing: .02em; text-transform: none; font-weight: 500; color: #3a3a3c; }
h1 { font-size: 23pt; line-height: 1.1; margin: 12px 0 1px; letter-spacing: -.02em; }
.suburb { font-size: 11pt; letter-spacing: .08em; text-transform: uppercase; font-weight: 600; }
.status { margin: 10px 0 2px; padding: 7px 12px; border-radius: 8px; font-weight: 700; font-size: 11.5pt; display: flex; justify-content: space-between; gap: 10px; flex-wrap: wrap; align-items: baseline; }
.status small { font-weight: 500; font-size: 9pt; }
.go { background: #e8f6ec; color: #1d6b3a; border: 1.5px solid #34c759; }
.hold { background: #fff1f0; color: #b3261e; border: 2px solid #ff3b30; }
.stop { background: #1d1d1f; color: #fff; }
h2 { font-size: 8.5pt; letter-spacing: .14em; text-transform: uppercase; font-weight: 600; margin: 13px 0 3px; padding-bottom: 3px; border-bottom: 1px solid #8e8e93; }
dl { display: grid; grid-template-columns: 40mm 1fr; gap: 3px 10px; margin: 5px 0 0; font-size: 10.5pt; }
dt { color: #3a3a3c; }
dd { margin: 0; font-weight: 500; }
dd small { color: #6e6e73; font-weight: 400; }
.phone { font-size: 14pt; font-weight: 700; font-variant-numeric: tabular-nums; letter-spacing: .01em; }
.phone small { font-size: 9pt; font-weight: 500; color: #6e6e73; margin-left: 6px; letter-spacing: 0; }
.quote { font-style: italic; }
.owner + .owner { margin-top: 8px; padding-top: 8px; border-top: 1px dashed #c7c7cc; }
.warn { background: #ff3b30; color: #fff; font-weight: 700; padding: 3px 8px; border-radius: 5px; margin: 5px 0 2px; font-size: 9.5pt; }
.pnote { color: #6e6e73; font-size: 9pt; }
.checks { font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace; font-size: 9.5pt; display: grid; grid-template-columns: 1fr 1fr; gap: 5px 14px; margin-top: 6px; }
.box { display: inline-block; width: 11px; height: 11px; border: 1.3px solid #1d1d1f; margin-right: 7px; vertical-align: -1px; }
.given { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-top: 9px; font-size: 9pt; color: #3a3a3c; }
.given div { border-bottom: 1px solid #8e8e93; padding-bottom: 12px; }
table.log { width: 100%; border-collapse: collapse; margin-top: 4px; }
.log th { font-size: 8pt; text-align: left; color: #6e6e73; font-weight: 600; padding: 2px 4px; border-bottom: 1px solid #1d1d1f; }
.log td { border-bottom: 1px solid #c7c7cc; height: 21px; }
.outcomes { font-size: 9pt; margin: 6px 0 0; line-height: 1.75; }
.outcomes span { white-space: nowrap; margin-right: 12px; }
.lines div { border-bottom: 1px solid #c7c7cc; height: 21px; }
.foot { margin-top: 8px; font-size: 7.5pt; color: #6e6e73; }
.link { word-break: break-all; font-size: 7.5pt; color: #6e6e73; font-weight: 400; }
@media print { body { padding: 0; } .toolbar { display: none; } .sheet { margin: 0; max-width: none; } }
"""


def _property_line(l):
    x = l.get("extra") or {}
    beds = l.get("bedrooms") if l.get("bedrooms") not in (None, "", "-") else ""
    bits = [f"{beds} bed" if beds else "", f"{x['bathrooms']} bath" if x.get("bathrooms") else "",
            f"{x['car_spaces']} car" if x.get("car_spaces") else "", l.get("property_type") or "",
            f"{x['land_size']}m²" if x.get("land_size") else ""]
    return " · ".join(b for b in bits if b)


def _how_we_know(c):
    x = c.get("extra") or {}
    tags = [t.strip() for t in re.split(r"[,;|]", x.get("tags", "")) if t.strip()]
    tags = [t for t in tags if not re.search(r"do not (contact|call)|\bdnc\b", t, re.I)]
    parts = ["In our database"] + tags[:4]
    if x.get("source"):
        parts.append(f"source: {x['source']}")
    return " · ".join(parts)


def approach_pages(leads, settings, data_date, label="", sheet_id=None):
    """One page per property, for an agent to work from. Shared by the app's
    printout and by any batch of sheets made outside the app."""
    e = html.escape
    office = (settings.get("office_name") or "").strip()
    T = int(settings["threshold_days"])
    agreement = int(settings.get("agreement_days") or 0)
    today = date.fromisoformat(data_date["today"])
    out = []
    for n, l in enumerate(leads, 1):
        x = l.get("extra") or {}
        if not l["for_sale"]:
            status = '<div class="status stop">NO LONGER FOR SALE. DO NOT CALL.</div>'
        elif l["do_not_contact"]:
            status = '<div class="status stop">DO NOT CONTACT THIS OWNER.</div>'
        elif l.get("moved"):
            status = f'<div class="status stop">MOVED OFF THIS SHEET. DO NOT CALL.<small>{e("Now with " + l["agent_name"]) if l.get("agent_name") else ""}</small></div>'
        elif not l["eligible"]:
            status = (f'<div class="status hold">DO NOT CALL BEFORE {_fmt_date(l["hits_on"]).upper()}'
                      f'<small>Listed {l["days"]} days. It reaches {T} days on that date.</small></div>')
        else:
            status = f'<div class="status go">READY TO CALL<small>Listed {l["days"]} days with another agency</small></div>'

        asking = e(l["price"] or "Not shown")
        if x.get("first_price") and x["first_price"] != l["price"]:
            asking += f' <small>(first listed at {e(x["first_price"])})</small>'
        rows = [("Property", e(_property_line(l)) or "Not shown"), ("Asking now", asking),
                ("On the market", f'{l["days"]} days'), ("First listed", e(_fmt_date(l["listed_date"]))),
                ("Currently with", e(l["agency"] + (f' · {l["listing_agent"]}' if l.get("listing_agent") else "")))]
        if x.get("listing_type"):
            rows.append(("Sale method", e(x["listing_type"])))
        if x.get("owner_type"):
            rows.append(("Owner type", e(x["owner_type"])))
        if agreement:
            ends = date.fromisoformat(l["listed_date"]) + timedelta(days=agreement)
            gap = (ends - today).days
            verb = "lapse" if gap >= 0 else "have lapsed"
            rows.append(("Agency agreement", f'Estimated to {verb} {e(_fmt_date(ends.isoformat()))}, {_days_phrase(gap)} '
                                             f'<small>(assumes {agreement} days)</small>'))
        if l.get("url"):
            rows.append(("Listing", f'<span class="link">{e(l["url"])}</span>'))
        listing = "".join(f"<dt>{k}</dt><dd>{v}</dd>" for k, v in rows)

        owners = []
        for c in [c for c in l["contacts"] if c["quality"] in ("exact", "confirmed")]:
            cx = c.get("extra") or {}
            labels = cx.get("phone_labels") or ["", ""]
            warns = "".join(f'<div class="warn">CRM phone note: {e(t.rstrip(". "))}.{" Do not ask for this person." if re.search("deceas|passed away|died", t, re.I) else ""}</div>'
                            for t in cx.get("phone_notes", []) if importer.PHONE_DANGER.search(t))
            soft = [t for t in cx.get("phone_notes", []) if not importer.PHONE_DANGER.search(t)]
            phones = "".join(f'<div class="phone">{e(p)}{f"<small>{e(lab)}</small>" if lab else ""}</div>'
                             for p, lab in zip([c["phone"], c["phone2"]], labels) if p)
            if soft:
                phones += "".join(f'<div class="pnote">Note in CRM phone field: {e(t)}</div>' for t in soft)
            orow = [("Owner", f'<b>{e(c["name"])}</b>'), ("Phone", phones or '<b style="color:#b3261e">No phone on file</b>')]
            if c.get("email"):
                orow.append(("Email", e(c["email"])))
            orow.append(("How we know them", e(_how_we_know(c))))
            if cx.get("contact_owner"):
                orow.append(("Contact owner", e(cx["contact_owner"])))
            if cx.get("last_note"):
                when = cx.get("last_note_at", "")[:10]
                who = cx.get("last_note_by", "")
                meta = ", ".join(v for v in [_fmt_date(when) if re.fullmatch(r"\d{4}-\d{2}-\d{2}", when) else when, who] if v)
                note = cx["last_note"].strip().replace("\n", " ")
                note = note if len(note) <= 320 else note[:317].rsplit(" ", 1)[0] + "..."
                orow.append(("Last note", f'{e(meta)}<br><span class="quote">"{e(note)}"</span>'))
            orow.append(("In our CRM as", f'<small>{e(" ".join(c["address_raw"].split()))}</small>'))
            owners.append(f'<div class="owner">{warns}<dl>' + "".join(f"<dt>{k}</dt><dd>{v}</dd>" for k, v in orow) + "</dl></div>")

        head_right = " · ".join(v for v in [f"For-sale data to {_fmt_date(data_date['listings'], '%-d %b %Y')}" if data_date.get("listings") else "",
                                             f"Sheet #{sheet_id}" if sheet_id else "", f"{n} of {len(leads)}"] if v)
        p = l["address"].split(", ", 1)
        out.append(f"""<section class="sheet">
<div class="top"><span>{e(office.upper() + " · " if office else "")}Approach sheet</span><span>{e(head_right)}</span></div>
<h1>{e(p[0])}</h1><div class="suburb">{e(p[1] if len(p) > 1 else "")}</div>
{status}
<h2>The listing</h2><dl>{listing}</dl>
<h2>The owner</h2>{"".join(owners) or '<p>No confirmed owner.</p>'}
<h2>Before you make contact</h2>
<div class="checks"><div><span class="box"></span>Checked against the Do Not Call Register</div><div><span class="box"></span>Confirmed it is still on the market</div>
<div><span class="box"></span>Checked the agreement has lapsed</div><div><span class="box"></span>Read the last note above</div></div>
<div class="given"><div>Agent: {e(label)}</div><div>Date given:</div></div>
<h2>The call</h2>
<table class="log"><tr><th style="width:24%">Date and time</th><th style="width:26%">Number called</th><th>What happened</th></tr>{"<tr><td></td><td></td><td></td></tr>" * 3}</table>
<div class="outcomes"><span><span class="box"></span>No answer</span><span><span class="box"></span>Left message</span><span><span class="box"></span>Call back on ________</span><span><span class="box"></span>Appraisal booked ________</span><span><span class="box"></span>Not interested</span><span><span class="box"></span>Wrong number</span><span><span class="box"></span>Asked not to be contacted</span></div>
<div class="lines"><div></div><div></div><div></div></div>
<div class="foot">Owner matched on the exact property address in our CRM. Log every call in Listing Watch the same day, including no answers. Lead #{l["id"]}.</div>
</section>""")
    return "".join(out)


def data_dates(conn):
    row = conn.execute("SELECT MAX(imported_at) AS at FROM imports WHERE kind = 'listings'").fetchone()
    return {"today": engine.today(conn).isoformat(), "listings": row["at"][:10] if row and row["at"] else ""}


def render_sheet(conn, sheet_id):
    s = engine.sheet(conn, sheet_id)
    settings = db.get_settings(conn)
    e = html.escape
    return f"""<!doctype html>
<html lang="en-AU"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Contact sheet #{s['id']} - {e(s['agent'])}</title><style>{SHEET_CSS}</style></head><body>
<div class="toolbar"><button onclick="window.print()">Print this sheet</button><a href="/sheet/{s['id']}.csv">Download as spreadsheet</a><a href="/#/sheets/{s['id']}">Back to the app</a></div>
{approach_pages(s['leads'], settings, data_dates(conn), s['agent'], s['id'])}
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
