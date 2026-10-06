"""The rules: what counts as a stale listing, who owns it, who is calling them,
and what happened. Everything that changes data goes through here so the web
app and the command line behave the same way."""

import json
import re
from collections import defaultdict
from datetime import date, datetime, timedelta

from . import address, db, importer

STATUSES = {
    "new": "Ready to assign",
    "assigned": "Assigned, not called yet",
    "no_answer": "No answer",
    "left_message": "Left message",
    "call_back": "Call back",
    "appraisal": "Appraisal booked",
    "won": "Listed with us",
    "not_interested": "Not interested",
    "wrong_number": "Wrong number",
    "dnc": "Do not contact",
}
# Outcomes an agent can log, in the order the buttons appear.
OUTCOMES = {
    "no_answer": {"label": "No answer", "attempt": True},
    "left_message": {"label": "Left message", "attempt": True},
    "call_back": {"label": "Call back later", "attempt": True, "needs_date": True},
    "appraisal": {"label": "Appraisal booked", "attempt": True, "needs_date": True},
    "won": {"label": "Listed with us", "attempt": False},
    "not_interested": {"label": "Not interested", "attempt": True},
    "wrong_number": {"label": "Wrong number", "attempt": True},
    "dnc": {"label": "Asked not to be contacted", "attempt": True},
    "note": {"label": "Add a note only", "attempt": False},
}
METHODS = {"call": "Phone call", "sms": "Text message", "email": "Email", "door": "Door knock", "other": "Other"}
OPEN_STATUSES = {"assigned", "no_answer", "left_message", "call_back", "appraisal"}
CLOSED_STATUSES = {"won", "not_interested", "wrong_number", "dnc"}


class Problem(Exception):
    """A request that would cause a mistake. The message is shown to the user as-is."""


# ---------- time ----------

# Set by tests and the demo to pretend it is another day.
TODAY_OVERRIDE = None
# The office time zone, remembered from the last settings read.
_TZ = None


def today(conn=None):
    if TODAY_OVERRIDE is not None:
        return TODAY_OVERRIDE
    tz = None
    if conn is not None:
        try:
            from zoneinfo import ZoneInfo
            tz = ZoneInfo(db.get_settings(conn)["timezone"])
        except Exception:
            tz = None
        global _TZ
        _TZ = tz
    return datetime.now(tz).date()


def now_iso():
    return datetime.now(_TZ).replace(microsecond=0, tzinfo=None).isoformat(sep=" ")


def _d(text):
    return date.fromisoformat(text) if text else None


def _norm_agency(text):
    return re.sub(r"[^a-z0-9]+", " ", (text or "").lower()).strip()


def _is_ours(agency, ours):
    a = _norm_agency(agency)
    return any(o and (o in a) for o in (_norm_agency(x) for x in ours))


def contact_sig(name, parts):
    return re.sub(r"[^a-z]", "", (name or "").lower()) + "@" + address.key(parts)


# ---------- imports ----------

_PENDING = {}


def preview_import(kind, filename, data, conn):
    if kind not in importer.FIELDS:
        raise Problem("Unknown import type.")
    headers, rows = importer.read_table(filename, data)
    if not rows:
        raise Problem("The file has a header row but no data rows.")
    mapping = importer.guess_mapping(kind, headers)
    token = f"{kind}-{datetime.now().timestamp()}"
    _PENDING.clear()  # one pending import at a time keeps memory small
    _PENDING[token] = (kind, filename, headers, rows)
    return {
        "token": token, "kind": kind, "filename": filename, "headers": headers,
        "sample": rows[:6], "row_count": len(rows), "mapping": mapping,
        "fields": [{"key": f, "label": l, "required": r} for f, l, r in importer.FIELDS[kind]],
        "missing": importer.missing_required(kind, mapping),
    }


def dry_run(token, mapping, conn):
    kind, filename, headers, rows = _pending(token)
    mapping = _clean_mapping(mapping, headers)
    missing = importer.missing_required(kind, mapping)
    if missing:
        return {"missing": missing}
    s = db.get_settings(conn)
    records, problems = importer.build_records(kind, headers, rows, mapping, today(conn), s["date_order"])
    out = {"missing": [], "usable": len(records), "skipped": len(problems),
           "problems": [{"row": r, "reason": why} for r, why in problems[:200]],
           "examples": [_record_example(kind, r) for r in records[:5]]}
    if kind == "listings":
        out["ours"] = sum(1 for r in records if _is_ours(r["agency"], s["our_agencies"]))
        out["over_threshold"] = sum(1 for r in records if (today(conn) - r["listed_date"]).days >= s["threshold_days"])
    return out


def _record_example(kind, r):
    if kind == "listings":
        return {"Address": address.display(r["parts"]), "Agency": r["agency"],
                "Date listed": r["listed_date"].strftime("%a %d %b %Y"), "Price": r["price"]}
    return {"Owner": r["name"], "Address": address.display(r["parts"]), "Phone": r["phone"],
            "Email": r["email"], "Do not contact": "Yes" if r["do_not_contact"] else ""}


def _pending(token):
    if token not in _PENDING:
        raise Problem("That upload has expired. Please choose the file again.")
    return _PENDING[token]


def _clean_mapping(mapping, headers):
    out = {}
    for k, v in (mapping or {}).items():
        if v is None or v == "":
            continue
        v = int(v)
        if 0 <= v < len(headers):
            out[k] = v
    return out


def commit_import(token, mapping, full_snapshot, by, conn):
    kind, filename, headers, rows = _pending(token)
    mapping = _clean_mapping(mapping, headers)
    missing = importer.missing_required(kind, mapping)
    if missing:
        raise Problem("These columns still need to be chosen: " + ", ".join(missing))
    s = db.get_settings(conn)
    t = today(conn)
    records, problems = importer.build_records(kind, headers, rows, mapping, t, s["date_order"])
    if not records:
        raise Problem("No usable rows were found, so nothing was imported. Check the column choices.")

    cur = conn.execute(
        "INSERT INTO imports(kind, filename, imported_at, imported_by, rows_total, rows_used, rows_skipped, problems, full_snapshot) "
        "VALUES (?,?,?,?,?,?,?,?,?)",
        (kind, filename, now_iso(), by, len(rows), 0, 0, "[]", 1 if full_snapshot else 0))
    import_id = cur.lastrowid

    if kind == "contacts":
        if full_snapshot:
            conn.execute("DELETE FROM contacts")
        for r in records:
            p = r["parts"]
            conn.execute(
                "INSERT INTO contacts(import_id, name, phone, phone2, email, address_raw, parts, block, do_not_contact, notes, extra) "
                "VALUES (?,?,?,?,?,?,?,?,?,?,?)",
                (import_id, r["name"], r["phone"], r["phone2"], r["email"], r["address_raw"],
                 json.dumps(p), json.dumps(address.block_key(p)), int(r["do_not_contact"]), r["notes"], json.dumps(r["extra"])))
        used = len(records)
    else:
        seen, used = set(), 0
        for r in records:
            k = address.key(r["parts"])
            if k in seen:
                problems.append((r["row"], f"Same property appears twice in the file ({address.display(r['parts'])}). Kept the first row"))
                continue
            seen.add(k)
            used += 1
            p = r["parts"]
            vals = (r["address_raw"], json.dumps(p), json.dumps(address.block_key(p)), r["agency"], r["agent"],
                    r["listed_date"].isoformat(), r["price"], r["property_type"], r["bedrooms"], r["url"], json.dumps(r["extra"]))
            existing = conn.execute("SELECT id FROM listings WHERE address_key = ?", (k,)).fetchone()
            if existing:
                conn.execute(
                    "UPDATE listings SET address_raw=?, parts=?, block=?, agency=?, agent=?, listed_date=?, price=?, "
                    "property_type=?, bedrooms=?, url=?, extra=?, last_seen=?, active=1, off_market_on=NULL WHERE id=?",
                    vals + (t.isoformat(), existing["id"]))
            else:
                conn.execute(
                    "INSERT INTO listings(address_raw, parts, block, agency, agent, listed_date, price, property_type, "
                    "bedrooms, url, extra, address_key, first_seen, last_seen) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                    vals + (k, t.isoformat(), t.isoformat()))
        if full_snapshot:
            gone = [row["id"] for row in conn.execute("SELECT id, address_key FROM listings WHERE active = 1")
                    if row["address_key"] not in seen]
            for lid in gone:
                conn.execute("UPDATE listings SET active = 0, off_market_on = ? WHERE id = ?", (t.isoformat(), lid))
            _notify_off_market(conn, gone)

    conn.execute("UPDATE imports SET rows_used=?, rows_skipped=?, problems=? WHERE id=?",
                 (used, len(problems), json.dumps([{"row": r, "reason": w} for r, w in problems[:500]]), import_id))
    _PENDING.pop(token, None)
    result = rebuild(conn)
    return {"import_id": import_id, "used": used, "skipped": len(problems), **result}


def _notify_off_market(conn, listing_ids):
    if not listing_ids:
        return
    q = ",".join("?" * len(listing_ids))
    rows = conn.execute(
        f"SELECT leads.id, leads.status, listings.parts, agents.name AS agent FROM leads "
        f"JOIN listings ON listings.id = leads.listing_id LEFT JOIN agents ON agents.id = leads.agent_id "
        f"WHERE leads.listing_id IN ({q})", listing_ids).fetchall()
    working = [r for r in rows if r["status"] in OPEN_STATUSES]
    if working:
        lines = [f"{address.display(json.loads(r['parts']))} ({r['agent'] or 'unassigned'}, {STATUSES[r['status']]})" for r in working]
        add_notification(conn, "off_market",
                         f"Stop calling: {len(working)} propert{'y is' if len(working) == 1 else 'ies are'} no longer for sale",
                         "Sold or withdrawn since the last import:\n" + "\n".join(lines),
                         [r["id"] for r in working])


# ---------- the daily rebuild ----------

def rebuild(conn):
    """Re-match every listing to our contacts, age every listing, and raise a
    notification for anything that crossed the threshold since the last run."""
    s = db.get_settings(conn)
    t = today(conn)
    threshold = int(s["threshold_days"])

    by_block = defaultdict(list)
    for c in conn.execute("SELECT id, name, parts, block, do_not_contact FROM contacts"):
        by_block[c["block"]].append(c)
    reviews = {(r["listing_key"], r["contact_sig"]): r["decision"] for r in conn.execute("SELECT * FROM match_reviews")}

    crossed = []
    for l in conn.execute("SELECT * FROM listings").fetchall():
        lead = conn.execute("SELECT * FROM leads WHERE listing_id = ?", (l["id"],)).fetchone()
        if lead is None:
            lid = conn.execute("INSERT INTO leads(listing_id, created_on) VALUES (?, ?)",
                               (l["id"], t.isoformat())).lastrowid
            lead = conn.execute("SELECT * FROM leads WHERE id = ?", (lid,)).fetchone()

        lparts = json.loads(l["parts"])
        conn.execute("DELETE FROM lead_contacts WHERE lead_id = ?", (lead["id"],))
        contact_dnc = False
        for c in by_block.get(l["block"], []):
            quality = address.compare(lparts, json.loads(c["parts"]))
            if quality is None:
                continue
            decision = reviews.get((l["address_key"], contact_sig(c["name"], json.loads(c["parts"]))))
            if decision == "reject":
                continue
            if decision == "confirm":
                quality = "confirmed"
            conn.execute("INSERT INTO lead_contacts(lead_id, contact_id, quality) VALUES (?,?,?)",
                         (lead["id"], c["id"], quality))
            contact_dnc = contact_dnc or bool(c["do_not_contact"])

        ours = _is_ours(l["agency"], s["our_agencies"])
        listed = _d(l["listed_date"])
        days = (t - listed).days
        eligible_on, crossed_notified, seen_below = lead["eligible_on"], lead["crossed_notified"], lead["seen_below"]
        if l["active"]:
            if days < threshold:
                # Below the line (or relisted, or the threshold was raised).
                seen_below, eligible_on, crossed_notified = 1, None, 0
            elif not crossed_notified:
                eligible_on = (listed + timedelta(days=threshold)).isoformat()
                if seen_below and not ours:
                    crossed.append((lead["id"], lparts, l["agency"], bool(by_block.get(l["block"]))))
                crossed_notified = 1
        conn.execute(
            "UPDATE leads SET eligible_on=?, crossed_notified=?, seen_below=?, ours=?, do_not_contact=? WHERE id=?",
            (eligible_on, crossed_notified, seen_below, int(ours),
             int(contact_dnc or lead["status"] == "dnc"), lead["id"]))

    if crossed:
        with_owner = sum(1 for c in crossed if c[3])
        lines = [f"{address.display(p)} ({agency}){'' if has else ' - owner not in our database'}"
                 for _, p, agency, has in crossed]
        add_notification(
            conn, "crossed",
            f"{len(crossed)} propert{'y' if len(crossed) == 1 else 'ies'} hit {threshold} days"
            + (f" ({with_owner} with owner details)" if with_owner != len(crossed) else ""),
            "\n".join(lines), [c[0] for c in crossed])
    conn.execute("INSERT INTO settings(key, value) VALUES('last_rebuild', ?) "
                 "ON CONFLICT(key) DO UPDATE SET value = excluded.value", (json.dumps(now_iso()),))
    return {"crossed": len(crossed)}


def daily_check(conn):
    """Run once a day (the server does this on its own; cron can call it too)."""
    t = today(conn).isoformat()
    result = rebuild(conn)
    marker = f"daily:{t}"
    if conn.execute("SELECT 1 FROM settings WHERE key = 'last_daily' AND value = ?", (json.dumps(marker),)).fetchone():
        return result
    due = conn.execute(
        "SELECT leads.id, listings.parts, agents.name AS agent, leads.status, leads.follow_up_on FROM leads "
        "JOIN listings ON listings.id = leads.listing_id LEFT JOIN agents ON agents.id = leads.agent_id "
        "WHERE leads.follow_up_on IS NOT NULL AND leads.follow_up_on <= ? AND leads.status IN ('call_back', 'appraisal') "
        "ORDER BY leads.follow_up_on", (t,)).fetchall()
    if due:
        lines = [f"{address.display(json.loads(r['parts']))}: {STATUSES[r['status']]} {_d(r['follow_up_on']):%a %d %b} ({r['agent'] or 'unassigned'})" for r in due]
        add_notification(conn, "follow_up", f"{len(due)} follow-up{'s' if len(due) != 1 else ''} due today or overdue",
                         "\n".join(lines), [r["id"] for r in due])
    age = data_age(conn)
    s = db.get_settings(conn)
    if age is not None and age >= s["stale_after_days"]:
        add_notification(conn, "stale", f"For-sale data is {age} days old",
                         "Import a fresh export of everything currently for sale so the day counts and sold properties are right.")
    conn.execute("INSERT INTO settings(key, value) VALUES('last_daily', ?) "
                 "ON CONFLICT(key) DO UPDATE SET value = excluded.value", (json.dumps(marker),))
    return result


def data_age(conn):
    row = conn.execute("SELECT MAX(imported_at) AS at FROM imports WHERE kind = 'listings'").fetchone()
    if not row or not row["at"]:
        return None
    return (today(conn) - datetime.fromisoformat(row["at"]).date()).days


def add_notification(conn, kind, title, body="", lead_ids=()):
    conn.execute("INSERT INTO notifications(created_at, kind, title, body, lead_ids) VALUES (?,?,?,?,?)",
                 (now_iso(), kind, title, body, json.dumps(list(lead_ids))))


# ---------- reading leads ----------

def _lead_rows(conn, where="1=1", params=()):
    return conn.execute(
        f"SELECT leads.*, listings.parts, listings.address_key, listings.agency, listings.agent AS listing_agent, "
        f"listings.listed_date, listings.price, listings.url, listings.property_type, listings.bedrooms, "
        f"listings.active, listings.off_market_on, listings.address_raw, listings.extra AS listing_extra, agents.name AS agent_name "
        f"FROM leads JOIN listings ON listings.id = leads.listing_id "
        f"LEFT JOIN agents ON agents.id = leads.agent_id WHERE {where}", params).fetchall()


def _contacts_for(conn, lead_ids):
    out = defaultdict(list)
    if not lead_ids:
        return out
    for chunk in range(0, len(lead_ids), 500):
        ids = lead_ids[chunk:chunk + 500]
        q = ",".join("?" * len(ids))
        for r in conn.execute(
                f"SELECT lc.lead_id, lc.quality, c.* FROM lead_contacts lc JOIN contacts c ON c.id = lc.contact_id "
                f"WHERE lc.lead_id IN ({q}) ORDER BY c.name", ids):
            out[r["lead_id"]].append({
                "id": r["id"], "name": r["name"], "phone": r["phone"], "phone2": r["phone2"], "email": r["email"],
                "quality": r["quality"], "do_not_contact": bool(r["do_not_contact"]), "notes": r["notes"],
                "extra": json.loads(r["extra"] or "{}"),
                "address": address.display(json.loads(r["parts"])), "address_raw": r["address_raw"]})
    return out


def serialize(conn, rows):
    s = db.get_settings(conn)
    t = today(conn)
    threshold = int(s["threshold_days"])
    contacts = _contacts_for(conn, [r["id"] for r in rows])
    out = []
    for r in rows:
        parts = json.loads(r["parts"])
        listed = _d(r["listed_date"])
        days = (t - listed).days
        cs = contacts.get(r["id"], [])
        usable = [c for c in cs if c["quality"] in ("exact", "confirmed")]
        match = "confirmed" if usable else ("check" if cs else "none")
        hits_on = listed + timedelta(days=threshold)
        blockers = _blockers(r, days >= threshold, match, usable)
        label = STATUSES[r["status"]]
        if r["status"] == "new":
            # Say where an unassigned property actually stands.
            if r["ours"]:
                label = "Our listing"
            elif not r["active"]:
                label = "Off the market"
            elif days < threshold:
                label = "Watchlist"
            elif blockers:
                label = "Not ready: " + blockers[0].lower()
        out.append({
            "id": r["id"], "address": address.display(parts), "address_raw": r["address_raw"],
            "suburb": parts["suburb"].title(), "street_sort": f"{parts['suburb']} {parts['street']} {parts['number']:>6} {parts['unit']:>6}",
            "agency": r["agency"], "listing_agent": r["listing_agent"], "price": r["price"], "url": r["url"],
            "property_type": r["property_type"], "bedrooms": r["bedrooms"],
            "extra": json.loads(r["listing_extra"] or "{}"),
            "listed_date": r["listed_date"], "days": days, "hits_on": hits_on.isoformat(),
            "days_to_go": max(0, threshold - days), "eligible": days >= threshold,
            "just_hit": bool(r["seen_below"]) and threshold <= days <= threshold + 3,
            "for_sale": bool(r["active"]), "off_market_on": r["off_market_on"],
            "status": r["status"], "status_label": label,
            "agent_id": r["agent_id"], "agent_name": r["agent_name"], "sheet_id": r["sheet_id"],
            "assigned_on": r["assigned_on"], "follow_up_on": r["follow_up_on"],
            "follow_up_due": bool(r["follow_up_on"]) and r["follow_up_on"] <= t.isoformat() and r["status"] in ("call_back", "appraisal"),
            "attempts": r["attempts"], "last_contact_on": r["last_contact_on"],
            "do_not_contact": bool(r["do_not_contact"]), "ours": bool(r["ours"]),
            "contacts": cs, "match": match, "has_phone": any(c["phone"] or c["phone2"] for c in usable),
            "blockers": blockers,
        })
    return out


def _blockers(r, eligible, match, usable):
    """Reasons this lead can't go on a contact sheet right now. Empty means it can."""
    why = []
    if r["ours"]:
        why.append("Listed with our agency")
    if not r["active"]:
        why.append("No longer for sale")
    if not eligible:
        why.append("Hasn't reached the day threshold")
    if r["do_not_contact"]:
        why.append("Do not contact")
    if match == "none":
        why.append("Owner not in our database")
    elif match == "check":
        why.append("Owner match needs checking")
    elif not any(c["phone"] or c["phone2"] or c["email"] for c in usable):
        why.append("No phone or email on file")
    if r["status"] != "new":
        why.append(f"Already {STATUSES[r['status']].lower()}" + (f" ({r['agent_name']})" if r["agent_name"] else ""))
    return why


def leads_view(conn, view):
    t = today(conn)
    s = db.get_settings(conn)
    rows = serialize(conn, _lead_rows(conn))
    if view == "ready":
        # Over the line, still for sale, not ours, not yet worked.
        out = [l for l in rows if l["eligible"] and l["for_sale"] and not l["ours"] and l["status"] == "new"]
        out.sort(key=lambda l: (-l["days"], l["street_sort"]))
    elif view == "watch":
        out = [l for l in rows if not l["eligible"] and l["for_sale"] and not l["ours"]]
        out.sort(key=lambda l: (l["days_to_go"], l["street_sort"]))
    elif view == "tracker":
        out = [l for l in rows if l["status"] != "new"]
        rank = {"call_back": 0, "appraisal": 1, "assigned": 2, "no_answer": 3, "left_message": 4,
                "won": 5, "not_interested": 6, "wrong_number": 7, "dnc": 8}
        # Anything that needs action today floats to the top: stop-calling
        # warnings first, then follow-ups that are due, then the rest by status.
        out.sort(key=lambda l: (not (l["status"] in OPEN_STATUSES and not l["for_sale"]),
                                not l["follow_up_due"], rank.get(l["status"], 9),
                                l["follow_up_on"] or "9999", l["street_sort"]))
    else:
        out = rows
    return out


def lead_detail(conn, lead_id):
    rows = _lead_rows(conn, "leads.id = ?", (lead_id,))
    if not rows:
        raise Problem("That property no longer exists.")
    lead = serialize(conn, rows)[0]
    # Every contact at a similar address, including rejected ones, so a person can review.
    l = rows[0]
    lparts = json.loads(l["parts"])
    reviews = {r["contact_sig"]: r["decision"] for r in conn.execute(
        "SELECT * FROM match_reviews WHERE listing_key = ?", (l["address_key"],))}
    candidates = []
    for c in conn.execute("SELECT * FROM contacts WHERE block = ?", (json.dumps(address.block_key(lparts)),)):
        cparts = json.loads(c["parts"])
        q = address.compare(lparts, cparts)
        if q is None:
            continue
        candidates.append({"id": c["id"], "name": c["name"], "address": address.display(cparts),
                           "address_raw": c["address_raw"], "quality": q,
                           "decision": reviews.get(contact_sig(c["name"], cparts))})
    lead["candidates"] = candidates
    lead["listing_address"] = address.display(lparts)
    lead["activity"] = [dict(a) | {"prev": None} for a in conn.execute(
        "SELECT a.* FROM activity a WHERE a.lead_id = ? ORDER BY a.id DESC", (lead_id,))]
    lead["sheets"] = [dict(r) for r in conn.execute(
        "SELECT sheets.id, sheets.created_at, agents.name AS agent FROM sheet_leads "
        "JOIN sheets ON sheets.id = sheet_leads.sheet_id JOIN agents ON agents.id = sheets.agent_id "
        "WHERE sheet_leads.lead_id = ? ORDER BY sheets.id DESC", (lead_id,))]
    return lead


def summary(conn):
    s = db.get_settings(conn)
    rows = serialize(conn, _lead_rows(conn))
    active = [l for l in rows if l["for_sale"] and not l["ours"]]
    ready = [l for l in active if l["eligible"] and l["status"] == "new"]
    counts = {
        "ready_to_assign": sum(1 for l in ready if not l["blockers"]),
        "needs_check": sum(1 for l in ready if l["match"] == "check" and not l["do_not_contact"]),
        "no_owner": sum(1 for l in ready if l["match"] == "none"),
        "just_hit": sum(1 for l in active if l["just_hit"] and l["status"] == "new"),
        "hitting_soon": sum(1 for l in active if not l["eligible"] and l["days_to_go"] <= int(s["soon_days"])),
        "watching": sum(1 for l in active if not l["eligible"]),
        "follow_ups_due": sum(1 for l in rows if l["follow_up_due"]),
        "in_progress": sum(1 for l in rows if l["status"] in OPEN_STATUSES),
        "stop_calling": sum(1 for l in rows if l["status"] in OPEN_STATUSES and not l["for_sale"]),
        "won": sum(1 for l in rows if l["status"] == "won"),
        "listings": len(rows),
        "ours": sum(1 for l in rows if l["ours"] and l["for_sale"]),
        "contacts": conn.execute("SELECT COUNT(*) FROM contacts").fetchone()[0],
    }
    last = {k: conn.execute("SELECT imported_at, filename FROM imports WHERE kind = ? ORDER BY id DESC LIMIT 1", (k,)).fetchone()
            for k in ("listings", "contacts")}
    return {
        "today": today(conn).isoformat(), "settings": s, "counts": counts,
        "data_age_days": data_age(conn),
        "last_import": {k: (dict(v) if v else None) for k, v in last.items()},
        "unread": conn.execute("SELECT COUNT(*) FROM notifications WHERE read_at IS NULL").fetchone()[0],
    }


# ---------- actions ----------

def _require_person(by):
    if not (by or "").strip():
        raise Problem("Choose who you are (top right) before making changes, so the history shows who did what.")
    return by.strip()


def review_match(conn, lead_id, contact_id, decision, by):
    by = _require_person(by)
    if decision not in ("confirm", "reject", "clear"):
        raise Problem("Unknown decision.")
    l = conn.execute("SELECT listings.address_key FROM leads JOIN listings ON listings.id = leads.listing_id WHERE leads.id = ?",
                     (lead_id,)).fetchone()
    c = conn.execute("SELECT name, parts FROM contacts WHERE id = ?", (contact_id,)).fetchone()
    if not l or not c:
        raise Problem("That property or contact no longer exists. Refresh the page.")
    sig = contact_sig(c["name"], json.loads(c["parts"]))
    if decision == "clear":
        conn.execute("DELETE FROM match_reviews WHERE listing_key = ? AND contact_sig = ?", (l["address_key"], sig))
    else:
        conn.execute("INSERT INTO match_reviews(listing_key, contact_sig, decision, decided_by, decided_at) VALUES (?,?,?,?,?) "
                     "ON CONFLICT(listing_key, contact_sig) DO UPDATE SET decision=excluded.decision, "
                     "decided_by=excluded.decided_by, decided_at=excluded.decided_at",
                     (l["address_key"], sig, decision, by, now_iso()))
    word = {"confirm": "Confirmed", "reject": "Rejected", "clear": "Cleared the decision on"}[decision]
    _log(conn, lead_id, by, "match", note=f"{word} {c['name']} as the owner")
    rebuild(conn)


def _log(conn, lead_id, by, kind, outcome=None, method=None, note="", follow_up_on=None, prev=None):
    conn.execute("INSERT INTO activity(lead_id, at, by, kind, outcome, method, note, follow_up_on, prev) VALUES (?,?,?,?,?,?,?,?,?)",
                 (lead_id, now_iso(), by, kind, outcome, method, note, follow_up_on, json.dumps(prev or {})))


def create_sheet(conn, agent_id, lead_ids, by, note=""):
    by = _require_person(by)
    agent = conn.execute("SELECT * FROM agents WHERE id = ? AND active = 1", (agent_id,)).fetchone()
    if not agent:
        raise Problem("Choose which agent this contact sheet is for.")
    lead_ids = list(dict.fromkeys(int(i) for i in lead_ids))
    if not lead_ids:
        raise Problem("Tick at least one property to put on the sheet.")
    q = ",".join("?" * len(lead_ids))
    leads = serialize(conn, _lead_rows(conn, f"leads.id IN ({q})", lead_ids))
    if len(leads) != len(lead_ids):
        raise Problem("Some of those properties no longer exist. Refresh the page and try again.")
    bad = [f"{l['address']}: {', '.join(l['blockers'])}" for l in leads if l["blockers"]]
    if bad:
        raise Problem("Nothing was assigned. These can't go on a sheet:\n" + "\n".join(bad))
    sheet_id = conn.execute("INSERT INTO sheets(agent_id, created_at, created_by, note) VALUES (?,?,?,?)",
                            (agent_id, now_iso(), by, note)).lastrowid
    t = today(conn).isoformat()
    order = {l["id"]: l for l in leads}
    ordered = sorted(lead_ids, key=lambda i: (-order[i]["days"], order[i]["street_sort"]))
    for pos, lid in enumerate(ordered, 1):
        conn.execute("INSERT INTO sheet_leads(sheet_id, lead_id, position) VALUES (?,?,?)", (sheet_id, lid, pos))
        conn.execute("UPDATE leads SET status='assigned', agent_id=?, sheet_id=?, assigned_on=?, updated_at=? WHERE id=?",
                     (agent_id, sheet_id, t, now_iso(), lid))
        _log(conn, lid, by, "assign", note=f"Put on contact sheet #{sheet_id} for {agent['name']}",
             prev={"status": "new"})
    return sheet_id


def log_outcome(conn, lead_id, outcome, by, method="call", note="", follow_up_on=None):
    by = _require_person(by)
    if outcome not in OUTCOMES:
        raise Problem("Choose what happened.")
    if method not in METHODS:
        raise Problem("Choose how you made contact.")
    lead = conn.execute("SELECT leads.*, listings.active FROM leads JOIN listings ON listings.id = leads.listing_id WHERE leads.id = ?",
                        (lead_id,)).fetchone()
    if not lead:
        raise Problem("That property no longer exists.")
    if lead["status"] == "new" and outcome != "note":
        raise Problem("This property isn't on anyone's contact sheet yet. Assign it first so two agents don't call the same owner.")
    spec = OUTCOMES[outcome]
    t = today(conn)
    if spec.get("needs_date"):
        d = _d(follow_up_on) if follow_up_on else None
        if not d:
            raise Problem(f"'{spec['label']}' needs a date.")
        if d < t:
            raise Problem("That date is in the past. Choose today or a later date.")
        follow_up_on = d.isoformat()
    else:
        follow_up_on = None
    if outcome == "note" and not note.strip():
        raise Problem("Type the note first.")
    prev = {k: lead[k] for k in ("status", "follow_up_on", "attempts", "last_contact_on", "do_not_contact")}
    if outcome == "note":
        _log(conn, lead_id, by, "note", note=note.strip(), prev=prev)
        return
    attempts = lead["attempts"] + (1 if spec["attempt"] else 0)
    conn.execute("UPDATE leads SET status=?, follow_up_on=?, attempts=?, last_contact_on=?, do_not_contact=?, updated_at=? WHERE id=?",
                 (outcome, follow_up_on, attempts, t.isoformat(), int(lead["do_not_contact"] or outcome == "dnc"), now_iso(), lead_id))
    _log(conn, lead_id, by, "outcome", outcome=outcome, method=method, note=note.strip(),
         follow_up_on=follow_up_on, prev=prev)


def undo_last(conn, lead_id, by):
    by = _require_person(by)
    last = conn.execute("SELECT * FROM activity WHERE lead_id = ? AND kind IN ('outcome', 'note') ORDER BY id DESC LIMIT 1",
                        (lead_id,)).fetchone()
    newest = conn.execute("SELECT id FROM activity WHERE lead_id = ? ORDER BY id DESC LIMIT 1", (lead_id,)).fetchone()
    if not last or last["id"] != newest["id"]:
        raise Problem("Only the most recent outcome or note can be undone.")
    prev = json.loads(last["prev"] or "{}")
    if last["kind"] == "outcome" and prev:
        conn.execute("UPDATE leads SET status=?, follow_up_on=?, attempts=?, last_contact_on=?, do_not_contact=?, updated_at=? WHERE id=?",
                     (prev["status"], prev["follow_up_on"], prev["attempts"], prev["last_contact_on"],
                      prev["do_not_contact"], now_iso(), lead_id))
    conn.execute("DELETE FROM activity WHERE id = ?", (last["id"],))
    label = OUTCOMES.get(last["outcome"] or "note", {}).get("label", "note")
    _log(conn, lead_id, by, "undo", note=f"Undid '{label}' logged by {last['by']} at {last['at'][:16]}")
    rebuild(conn)


def reassign(conn, lead_id, agent_id, by):
    by = _require_person(by)
    lead = conn.execute("SELECT * FROM leads WHERE id = ?", (lead_id,)).fetchone()
    agent = conn.execute("SELECT * FROM agents WHERE id = ? AND active = 1", (agent_id,)).fetchone()
    if not lead or not agent:
        raise Problem("Choose an agent.")
    if lead["status"] == "new":
        raise Problem("Put this property on a contact sheet instead.")
    old = conn.execute("SELECT name FROM agents WHERE id = ?", (lead["agent_id"],)).fetchone()
    conn.execute("UPDATE leads SET agent_id=?, updated_at=? WHERE id=?", (agent_id, now_iso(), lead_id))
    _log(conn, lead_id, by, "assign", note=f"Moved from {old['name'] if old else 'nobody'} to {agent['name']}")


def release(conn, lead_id, by, reason=""):
    """Take a property off its agent and put it back in the pool."""
    by = _require_person(by)
    lead = conn.execute("SELECT * FROM leads WHERE id = ?", (lead_id,)).fetchone()
    if not lead:
        raise Problem("That property no longer exists.")
    if lead["status"] == "dnc" or lead["do_not_contact"]:
        raise Problem("This owner asked not to be contacted, so it can't go back in the pool.")
    conn.execute("UPDATE leads SET status='new', agent_id=NULL, sheet_id=NULL, assigned_on=NULL, follow_up_on=NULL, updated_at=? WHERE id=?",
                 (now_iso(), lead_id))
    _log(conn, lead_id, by, "release", note="Returned to the pool" + (f": {reason}" if reason else ""))


# ---------- sheets ----------

def sheet(conn, sheet_id):
    s = conn.execute("SELECT sheets.*, agents.name AS agent, agents.phone AS agent_phone FROM sheets "
                     "JOIN agents ON agents.id = sheets.agent_id WHERE sheets.id = ?", (sheet_id,)).fetchone()
    if not s:
        raise Problem("That contact sheet doesn't exist.")
    ids = [r["lead_id"] for r in conn.execute("SELECT lead_id FROM sheet_leads WHERE sheet_id = ? ORDER BY position", (sheet_id,))]
    q = ",".join("?" * len(ids)) or "NULL"
    by_id = {l["id"]: l for l in serialize(conn, _lead_rows(conn, f"leads.id IN ({q})", ids))}
    leads = []
    for i in ids:
        l = by_id[i]
        l["moved"] = l["sheet_id"] != sheet_id  # reassigned or returned to the pool since printing
        leads.append(l)
    return dict(s) | {"leads": leads}


def sheets_list(conn):
    rows = conn.execute(
        "SELECT sheets.*, agents.name AS agent, COUNT(sl.lead_id) AS total, "
        "SUM(CASE WHEN leads.status IN ('assigned') AND leads.sheet_id = sheets.id THEN 1 ELSE 0 END) AS not_called, "
        "SUM(CASE WHEN leads.status IN ('no_answer','left_message','call_back','appraisal') AND leads.sheet_id = sheets.id THEN 1 ELSE 0 END) AS working, "
        "SUM(CASE WHEN leads.status IN ('won','not_interested','wrong_number','dnc') AND leads.sheet_id = sheets.id THEN 1 ELSE 0 END) AS done "
        "FROM sheets JOIN agents ON agents.id = sheets.agent_id "
        "LEFT JOIN sheet_leads sl ON sl.sheet_id = sheets.id LEFT JOIN leads ON leads.id = sl.lead_id "
        "GROUP BY sheets.id ORDER BY sheets.id DESC").fetchall()
    return [dict(r) for r in rows]


# ---------- agents ----------

def save_agent(conn, name, phone="", agent_id=None, active=True):
    name = (name or "").strip()
    if not name:
        raise Problem("Type the agent's name.")
    clash = conn.execute("SELECT id FROM agents WHERE name = ? COLLATE NOCASE AND id IS NOT ?", (name, agent_id)).fetchone()
    if clash:
        raise Problem(f"There is already an agent called {name}.")
    if agent_id:
        conn.execute("UPDATE agents SET name=?, phone=?, active=? WHERE id=?", (name, phone, int(active), agent_id))
    else:
        conn.execute("INSERT INTO agents(name, phone) VALUES (?, ?)", (name, phone))
