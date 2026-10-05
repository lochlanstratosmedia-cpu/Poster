#!/usr/bin/env python3
"""Turn Meta lead form CSV exports into lead documents for the lead tracker.

Usage: python3 scripts/meta_leads_to_json.py OUT_DIR file1.csv [file2.csv ...]

Writes one JSON file per lead to OUT_DIR, named by the Meta lead id. The
field mapping matches the CSV import built into tools/lead-tracker.html, so a
lead seeded here and a lead imported in the page look the same.

The CSVs hold names, phones and emails. Keep them and the output out of git.
"""
import csv, io, json, os, re, sys
from datetime import datetime, timezone

META_COLS = {"id", "created_time", "ad_id", "ad_name", "adset_id", "adset_name",
             "campaign_id", "campaign_name", "form_id", "form_name",
             "is_organic", "platform", "lead_status"}


def read_rows(path):
    raw = open(path, "rb").read()
    if raw[:2] in (b"\xff\xfe", b"\xfe\xff"):
        text = raw.decode("utf-16")
    else:
        text = raw.decode("utf-8-sig")
    first = text.split("\n", 1)[0]
    delim = "\t" if first.count("\t") > first.count(",") else ","
    return list(csv.DictReader(io.StringIO(text), delimiter=delim))


def label(col):
    s = col.replace("_", " ").strip()
    return s[:1].upper() + s[1:]


def deal_type(form):
    f = form.lower()
    if "granny" in f:
        return "Granny flat"
    if re.search(r"sell|market|strat|apprais|hold|valu", f):
        return "Selling"
    return "Other"


def to_doc(row, now):
    doc = {"answers": []}
    for col, val in row.items():
        if col is None:
            continue
        key = col.strip().lower()
        val = (val or "").strip()
        if key in META_COLS:
            continue
        if key == "full_name":
            doc["name"] = val
        elif key in ("phone", "phone_number"):
            doc["phone"] = val
        elif key == "email":
            doc["email"] = val
        elif "address" in key:
            doc["address"] = val
        else:
            doc["answers"].append({"q": label(col), "a": val})
    meta_id = row["id"].strip().removeprefix("l:")
    form = (row.get("form_name") or "").strip()
    doc.update({
        "metaId": meta_id,
        "createdTime": datetime.fromisoformat(row["created_time"].strip()).astimezone(timezone.utc).isoformat().replace("+00:00", "Z"),
        "form": form,
        "campaign": (row.get("campaign_name") or "").strip(),
        "adset": (row.get("adset_name") or "").strip(),
        "ad": (row.get("ad_name") or "").strip(),
        "platform": (row.get("platform") or "").strip(),
        "dealType": deal_type(form),
        "stage": "new",
        "owner": "",
        "nextAction": "",
        "nextDue": "",
        "appraisalDate": "",
        "firstContactAt": None,
        "lastTouchAt": None,
        "stageChangedAt": now,
        "importedAt": now,
        "updatedAt": now,
        "log": [],
    })
    for k in ("name", "phone", "email", "address"):
        doc.setdefault(k, "")
    return meta_id, doc


def main():
    out, files = sys.argv[1], sys.argv[2:]
    os.makedirs(out, exist_ok=True)
    now = datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")
    n = 0
    for path in files:
        for row in read_rows(path):
            meta_id, doc = to_doc(row, now)
            with open(os.path.join(out, meta_id + ".json"), "w") as fh:
                json.dump(doc, fh, ensure_ascii=False)
            n += 1
    print(f"wrote {n} leads to {out}")


if __name__ == "__main__":
    main()
