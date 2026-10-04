"""Fictional sample data so the app can be tried before real exports arrive.

Every name, phone number, agency and suburb here is made up. Phone numbers use
the 0491 570 xxx range that ACMA reserves for fiction."""

import csv
import os
import random
from datetime import timedelta

from . import db, engine

SUBURBS = [("Northvale", "2990"), ("Easton Park", "2991"), ("Riverbend", "2992"), ("Hillcrest Bay", "2993")]
STREETS = ["Banksia St", "Wattle Ave", "Harbour Rd", "Kingfisher Cres", "Ironbark Dr", "Seaview Pde",
           "Fig Tree Lane", "Grevillea Cl", "Station St", "Paperbark Way", "Jacaranda Ct", "Lighthouse Tce"]
FIRST = ["Alex", "Sam", "Jordan", "Taylor", "Casey", "Morgan", "Riley", "Jamie", "Avery", "Quinn", "Drew", "Harper",
         "Rowan", "Sydney", "Blake", "Emerson", "Reese", "Parker", "Hayden", "Logan"]
LAST = ["Example", "Sample", "Placeholder", "Testcase", "Demo", "Mockley", "Fictional", "Madeup", "Pretend", "Notreal"]
AGENCIES = ["Example Realty", "Sample Property Group", "Placeholder Estate Agents", "Demo Homes & Land"]
OUR_AGENCY = "Our Agency (demo)"
TYPES = [("House", "3"), ("House", "4"), ("Unit", "2"), ("Townhouse", "3"), ("Unit", "1"), ("House", "5")]
# Days on market for the demo. A few sit at 69 so a "hit 70 days" notice fires on the second day.
DAYS = [112, 98, 91, 84, 77, 74, 70, 70, 69, 69, 69, 66, 60, 58, 52, 45, 40, 33, 28, 21, 15, 9, 4, 120, 88, 73, 101, 64, 57, 81]


def make_files(folder, today, seed=7):
    rnd = random.Random(seed)
    os.makedirs(folder, exist_ok=True)
    listings, contacts = [], []
    for i, dom in enumerate(DAYS):
        suburb, pc = SUBURBS[i % len(SUBURBS)]
        street = STREETS[(i * 5) % len(STREETS)]
        num = 3 + (i * 7) % 90
        unit = (i % 6 == 2) and str(1 + i % 9)
        ptype, beds = TYPES[i % len(TYPES)]
        agency = OUR_AGENCY if i % 11 == 5 else AGENCIES[i % len(AGENCIES)]
        street_line = f"{unit}/{num} {street}" if unit else f"{num} {street}"
        listings.append({
            "Address": street_line, "Suburb": suburb, "State": "NSW", "Postcode": pc,
            "Agency": agency, "Agent": f"{FIRST[(i + 3) % len(FIRST)]} {LAST[(i + 5) % len(LAST)]}",
            "Date Listed": (today - timedelta(days=dom)).strftime("%d/%m/%Y"),
            "Price": rnd.choice(["Contact agent", "Offers over $1,200,000", "$850,000 - $900,000", "Auction", "$1,450,000"]),
            "Property Type": ptype, "Bedrooms": beds, "Link": "",
        })
        if i % 7 == 6:
            continue  # owner not in our database
        long_street = street.replace(" St", " Street").replace(" Ave", " Avenue").replace(" Rd", " Road") \
            .replace(" Cres", " Crescent").replace(" Dr", " Drive").replace(" Pde", " Parade").replace(" Cl", " Close") \
            .replace(" Ct", " Court").replace(" Tce", " Terrace")
        addr = f"Unit {unit}, {num} {long_street}" if unit else f"{num} {long_street}"
        first, last = FIRST[i % len(FIRST)], LAST[i % len(LAST)]
        contacts.append({
            "First Name": first, "Surname": last, "Mobile": f"0491 570 {100 + i:03d}",
            "Email": f"{first.lower()}.{last.lower()}@example.com",
            "Street Address": addr, "Suburb": "" if i % 9 == 4 else suburb, "Postcode": pc,
            "Do Not Call": "Yes" if i % 13 == 12 else "", "Notes": "",
        })
        if i % 8 == 3:  # a second owner at the same address
            contacts.append({**contacts[-1], "First Name": FIRST[(i + 9) % len(FIRST)],
                             "Mobile": f"0491 570 {200 + i:03d}", "Email": ""})
    # Contacts who aren't selling, so the database looks like a real one.
    for j in range(25):
        suburb, pc = SUBURBS[j % len(SUBURBS)]
        contacts.append({"First Name": FIRST[(j + 7) % len(FIRST)], "Surname": LAST[(j + 2) % len(LAST)],
                         "Mobile": f"0491 570 {300 + j:03d}", "Email": "",
                         "Street Address": f"{200 + j} {STREETS[j % len(STREETS)]}", "Suburb": suburb,
                         "Postcode": pc, "Do Not Call": "", "Notes": ""})
    paths = {}
    for name, rows in (("our-database.csv", contacts), ("for-sale.csv", listings)):
        path = os.path.join(folder, name)
        with open(path, "w", newline="", encoding="utf-8") as f:
            w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
            w.writeheader()
            w.writerows(rows)
        paths[name] = path
    return paths


def load(db_path, folder):
    """Build a demo database: import as of yesterday, then run today's check
    so the watchlist-to-ready notification shows up."""
    if os.path.exists(db_path):
        os.remove(db_path)
    real_today = engine.today()
    yesterday = real_today - timedelta(days=1)
    conn = db.connect(db_path)
    with conn:
        db.set_settings(conn, {"our_agencies": [OUR_AGENCY], "office_name": "Demo office"})
        for name in ("Alex Example", "Sam Sample", "Jordan Placeholder"):
            engine.save_agent(conn, name)
    engine.TODAY_OVERRIDE = yesterday
    try:
        paths = make_files(folder, real_today)
        for kind, fname in (("contacts", "our-database.csv"), ("listings", "for-sale.csv")):
            with open(paths[fname], "rb") as f:
                p = engine.preview_import(kind, fname, f.read(), conn)
            with conn:
                engine.commit_import(p["token"], p["mapping"], True, "Demo setup", conn)
        with conn:
            conn.execute("UPDATE imports SET imported_at = ?", (f"{yesterday} 09:00:00",))
            conn.execute("DELETE FROM notifications")
    finally:
        engine.TODAY_OVERRIDE = None
    with conn:
        engine.daily_check(conn)
        # Some work already under way, so the tracker has something in it.
        ready = [l for l in engine.leads_view(conn, "ready") if not l["blockers"]]
        if len(ready) >= 4:
            sid = engine.create_sheet(conn, 1, [l["id"] for l in ready[:4]], "Demo setup")
            engine.log_outcome(conn, ready[0]["id"], "call_back", "Alex Example", "call",
                               "Said their agency agreement ends soon. Call back then.",
                               real_today.isoformat())
            engine.log_outcome(conn, ready[1]["id"], "no_answer", "Alex Example", "call")
    conn.close()
