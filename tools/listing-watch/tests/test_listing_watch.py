"""Run with: python3 -m unittest discover tools/listing-watch/tests"""

import json
import os
import sys
import unittest
from datetime import date, timedelta

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from lw import address, db, engine, importer  # noqa: E402

TODAY = date(2026, 10, 4)


def csv_bytes(rows):
    return ("\n".join(",".join(f'"{c}"' for c in r) for r in rows) + "\n").encode()


class AddressTests(unittest.TestCase):
    def test_unit_forms_agree(self):
        a = address.parse("Unit 3, 12 Smith Street, Paddington NSW 2021")
        b = address.parse("3/12 Smith St", "Paddington", "NSW", "2021")
        c = address.parse("U3/12 Smith St Paddington NSW 2021")
        self.assertEqual(address.compare(a, b), "exact")
        self.assertEqual(address.compare(a, c), "exact")

    def test_street_named_saint(self):
        p = address.parse("12 St Kilda Road St Kilda VIC 3182")
        self.assertEqual((p["street"], p["type"], p["suburb"]), ("st kilda", "rd", "st kilda"))

    def test_different_unit_is_different_property(self):
        self.assertIsNone(address.compare(address.parse("3/12 Smith St, Paddington"),
                                          address.parse("4/12 Smith St, Paddington")))
        self.assertIsNone(address.compare(address.parse("12 Smith St, Paddington"),
                                          address.parse("3/12 Smith St, Paddington")))

    def test_different_suburb_is_not_a_match(self):
        self.assertIsNone(address.compare(address.parse("12 Smith St, Paddington"),
                                          address.parse("12 Smith St, Bondi")))

    def test_missing_suburb_needs_a_person(self):
        self.assertEqual(address.compare(address.parse("12 Smith St, Paddington"),
                                         address.parse("12 Smith Street")), "check")

    def test_street_type_mismatch_needs_a_person(self):
        self.assertEqual(address.compare(address.parse("12 Smith St, Paddington"),
                                         address.parse("12 Smith Rd, Paddington")), "check")


class ImporterTests(unittest.TestCase):
    def test_dates_are_day_first_by_default(self):
        self.assertEqual(importer.parse_date("03/04/2026"), date(2026, 4, 3))
        self.assertEqual(importer.parse_date("03/04/2026", "MDY"), date(2026, 3, 4))
        self.assertEqual(importer.parse_date("2026-04-03"), date(2026, 4, 3))
        self.assertEqual(importer.parse_date("3 Apr 2026"), date(2026, 4, 3))
        self.assertIsNone(importer.parse_date("31/02/2026"))
        self.assertIsNone(importer.parse_date("soon"))

    def test_future_and_unreadable_dates_are_reported(self):
        headers = ["Address", "Agency", "Date Listed"]
        rows = [["1 A St, X", "Other", "01/01/2027"], ["2 A St, X", "Other", "whenever"], ["3 A St, X", "Other", "01/09/2026"]]
        recs, probs = importer.build_records("listings", headers, rows, importer.guess_mapping("listings", headers), TODAY)
        self.assertEqual(len(recs), 1)
        self.assertEqual([p[0] for p in probs], [2, 3])

    def test_days_on_market_column(self):
        headers = ["Address", "Agency", "DOM"]
        recs, _ = importer.build_records("listings", headers, [["1 A St, X", "Other", "75"]],
                                         importer.guess_mapping("listings", headers), TODAY)
        self.assertEqual(recs[0]["listed_date"], TODAY - timedelta(days=75))

    def test_search_settings_above_headings_are_skipped(self):
        data = csv_bytes([["Search String", "Shape"], ["Listing Date", "05 Apr 2026 - 05 Oct 2026"], [""],
                          ["Street Address", "Suburb", "First Listed Date", "Last Listed Date", "Last Listed Price", "Days on Market", "Agency"],
                          ["26 Bendigo Road", "Barnsley", "18 Sep 2026", "19 Sep 2026", "$1,350,000", "17", "Some Agency"]])
        headers, rows = importer.read_table("export.csv", data)
        self.assertEqual(headers[0], "Street Address")
        self.assertEqual(len(rows), 1)
        m = importer.guess_mapping("listings", headers)
        self.assertEqual(headers[m["listed_date"]], "First Listed Date")
        self.assertEqual(headers[m["price"]], "Last Listed Price")

    def test_crm_columns_and_dnc_tag(self):
        headers = ["id", "name", "name_salutation", "do_not_contact", "address.postal", "address.physical",
                   "primary_info.phone", "primary_info.email", "marketing.postcode", "tags", "company.email_address"]
        m = importer.guess_mapping("contacts", headers)
        self.assertEqual(headers[m["address"]], "address.physical")
        self.assertEqual(headers[m["email"]], "primary_info.email")
        self.assertEqual(headers[m["name"]], "name")
        self.assertNotIn("postcode", m)
        rows = [["1", "Pat Owner", "", "", "", "12 Smith St Northvale NSW 2990", "0491570001", "", "", "Buyer, DO NOT CONTACT", ""]]
        recs, _ = importer.build_records("contacts", headers, rows, m, TODAY)
        self.assertTrue(recs[0]["do_not_contact"])

    def test_phone_format(self):
        self.assertEqual(importer.clean_phone("+61412345678"), "0412 345 678")
        self.assertEqual(importer.clean_phone("0298765432"), "(02) 9876 5432")


class Office:
    """A throwaway database with helpers to import lists as of a given day."""

    def __init__(self):
        self.conn = db.connect(":memory:")
        with self.conn:
            db.set_settings(self.conn, {"our_agencies": ["Our Agency"]})
            engine.save_agent(self.conn, "Alex")
            engine.save_agent(self.conn, "Sam")

    def on(self, day):
        engine.TODAY_OVERRIDE = day
        return self

    def load(self, kind, rows, full=True):
        p = engine.preview_import(kind, f"{kind}.csv", csv_bytes(rows), self.conn)
        with self.conn:
            return engine.commit_import(p["token"], p["mapping"], full, "Tester", self.conn)

    def lead(self, addr_start):
        for l in engine.leads_view(self.conn, "all"):
            if l["address"].startswith(addr_start):
                return l
        raise KeyError(addr_start)


CONTACTS = [["Name", "Mobile", "Address", "Suburb", "Do Not Call"],
            ["Pat Owner", "0491570001", "12 Smith Street", "Northvale", ""],
            ["Lee Owner", "0491570002", "Unit 3, 5 Hill Road", "Northvale", ""],
            ["Kim Owner", "0491570003", "8 Bay St", "", ""],
            ["Dee Owner", "0491570004", "20 Park Ave", "Northvale", "Yes"],
            ["Our Vendor", "0491570005", "1 Main St", "Northvale", ""]]


def listings(today, **days):
    rows = [["Address", "Suburb", "Agency", "Date Listed"]]
    spec = {"smith": ("12 Smith St", "Other Realty"), "hill": ("3/5 Hill Rd", "Other Realty"),
            "bay": ("8 Bay St", "Other Realty"), "park": ("20 Park Ave", "Other Realty"),
            "main": ("1 Main St", "Our Agency Northvale"), "stranger": ("99 Nobody St", "Other Realty")}
    for key, n in days.items():
        addr, agency = spec[key]
        rows.append([addr, "Northvale", agency, (today - timedelta(days=n)).strftime("%d/%m/%Y")])
    return rows


class FlowTests(unittest.TestCase):
    def setUp(self):
        self.o = Office().on(TODAY)
        self.o.load("contacts", CONTACTS)

    def tearDown(self):
        engine.TODAY_OVERRIDE = None

    def test_ready_and_blockers(self):
        self.o.load("listings", listings(TODAY, smith=80, hill=71, bay=90, park=75, main=100, stranger=85))
        ready = {l["address"].split(",")[0]: l["blockers"] for l in engine.leads_view(self.o.conn, "ready")}
        self.assertEqual(ready["12 Smith Street"], [])
        self.assertEqual(ready["3/5 Hill Road"], [])
        self.assertEqual(ready["8 Bay Street"], ["Owner match needs checking"])
        self.assertEqual(ready["20 Park Avenue"], ["Do not contact"])
        self.assertEqual(ready["99 Nobody Street"], ["Owner not in our database"])
        self.assertNotIn("1 Main Street", ready, "our own listing must never show up")

    def test_watchlist_crossing_raises_one_notification(self):
        self.o.load("listings", listings(TODAY, smith=68, hill=40))
        self.assertEqual(self.o.lead("12 Smith")["eligible"], False)
        self.assertEqual(self.o.conn.execute("SELECT COUNT(*) FROM notifications").fetchone()[0], 0)
        # Two days later with no new import, the daily check spots it.
        self.o.on(TODAY + timedelta(days=2))
        with self.o.conn:
            engine.daily_check(self.o.conn)
        notes = self.o.conn.execute("SELECT * FROM notifications WHERE kind = 'crossed'").fetchall()
        self.assertEqual(len(notes), 1)
        self.assertIn("12 Smith Street", notes[0]["body"])
        self.assertTrue(self.o.lead("12 Smith")["eligible"])
        self.assertTrue(self.o.lead("12 Smith")["just_hit"])
        with self.o.conn:
            engine.daily_check(self.o.conn)
            engine.rebuild(self.o.conn)
        self.assertEqual(self.o.conn.execute("SELECT COUNT(*) FROM notifications WHERE kind = 'crossed'").fetchone()[0], 1,
                         "must not notify twice for the same property")

    def test_first_import_over_threshold_is_not_a_crossing(self):
        self.o.load("listings", listings(TODAY, smith=90))
        self.assertEqual(self.o.conn.execute("SELECT COUNT(*) FROM notifications WHERE kind = 'crossed'").fetchone()[0], 0)

    def test_one_agent_per_property(self):
        self.o.load("listings", listings(TODAY, smith=80, hill=71))
        smith = self.o.lead("12 Smith")["id"]
        with self.o.conn:
            engine.create_sheet(self.o.conn, 1, [smith], "Boss")
        with self.assertRaises(engine.Problem):
            with self.o.conn:
                engine.create_sheet(self.o.conn, 2, [smith, self.o.lead("3/5 Hill")["id"]], "Boss")
        # All or nothing: Hill was not assigned either.
        self.assertEqual(self.o.lead("3/5 Hill")["status"], "new")

    def test_blocked_leads_cannot_be_assigned(self):
        self.o.load("listings", listings(TODAY, bay=80, park=80, stranger=80, smith=30))
        for key in ("8 Bay", "20 Park", "99 Nobody", "12 Smith"):
            with self.assertRaises(engine.Problem, msg=key):
                with self.o.conn:
                    engine.create_sheet(self.o.conn, 1, [self.o.lead(key)["id"]], "Boss")

    def test_outcomes_need_a_name_a_date_and_an_assignment(self):
        self.o.load("listings", listings(TODAY, smith=80))
        lid = self.o.lead("12 Smith")["id"]
        with self.assertRaises(engine.Problem):
            engine.log_outcome(self.o.conn, lid, "no_answer", "Alex")  # not assigned yet
        with self.o.conn:
            engine.create_sheet(self.o.conn, 1, [lid], "Boss")
        with self.assertRaises(engine.Problem):
            engine.log_outcome(self.o.conn, lid, "no_answer", "")  # nobody named
        with self.assertRaises(engine.Problem):
            engine.log_outcome(self.o.conn, lid, "call_back", "Alex")  # no date
        with self.assertRaises(engine.Problem):
            engine.log_outcome(self.o.conn, lid, "call_back", "Alex", follow_up_on=(TODAY - timedelta(days=1)).isoformat())
        with self.o.conn:
            engine.log_outcome(self.o.conn, lid, "call_back", "Alex", follow_up_on=TODAY.isoformat(), note="Ring Friday")
        l = self.o.lead("12 Smith")
        self.assertEqual((l["status"], l["attempts"], l["follow_up_due"]), ("call_back", 1, True))

    def test_undo_restores_previous_state(self):
        self.o.load("listings", listings(TODAY, smith=80))
        lid = self.o.lead("12 Smith")["id"]
        with self.o.conn:
            engine.create_sheet(self.o.conn, 1, [lid], "Boss")
            engine.log_outcome(self.o.conn, lid, "dnc", "Alex")
        self.assertTrue(self.o.lead("12 Smith")["do_not_contact"])
        with self.o.conn:
            engine.undo_last(self.o.conn, lid, "Alex")
        l = self.o.lead("12 Smith")
        self.assertEqual((l["status"], l["attempts"], l["do_not_contact"]), ("assigned", 0, False))

    def test_sold_while_being_worked_says_stop(self):
        self.o.load("listings", listings(TODAY, smith=80, hill=75))
        lid = self.o.lead("12 Smith")["id"]
        with self.o.conn:
            engine.create_sheet(self.o.conn, 1, [lid], "Boss")
        self.o.load("listings", listings(TODAY, hill=75))  # Smith is gone from the full export
        l = self.o.lead("12 Smith")
        self.assertFalse(l["for_sale"])
        self.assertIn("No longer for sale", l["blockers"])
        n = self.o.conn.execute("SELECT * FROM notifications WHERE kind = 'off_market'").fetchone()
        self.assertIn("12 Smith Street", n["body"])
        self.assertEqual(engine.summary(self.o.conn)["counts"]["stop_calling"], 1)

    def test_partial_import_does_not_mark_others_sold(self):
        self.o.load("listings", listings(TODAY, smith=80, hill=75))
        self.o.load("listings", listings(TODAY, hill=75), full=False)
        self.assertTrue(self.o.lead("12 Smith")["for_sale"])

    def test_match_decision_survives_contacts_reimport(self):
        self.o.load("listings", listings(TODAY, bay=80))
        lead = self.o.lead("8 Bay")
        cid = engine.lead_detail(self.o.conn, lead["id"])["candidates"][0]["id"]
        with self.o.conn:
            engine.review_match(self.o.conn, lead["id"], cid, "confirm", "Boss")
        self.assertEqual(self.o.lead("8 Bay")["blockers"], [])
        self.o.load("contacts", CONTACTS)  # contact ids change
        self.assertEqual(self.o.lead("8 Bay")["match"], "confirmed")

    def test_rejected_match_is_dropped(self):
        self.o.load("listings", listings(TODAY, bay=80))
        lead = self.o.lead("8 Bay")
        cid = engine.lead_detail(self.o.conn, lead["id"])["candidates"][0]["id"]
        with self.o.conn:
            engine.review_match(self.o.conn, lead["id"], cid, "reject", "Boss")
        self.assertEqual(self.o.lead("8 Bay")["match"], "none")

    def test_release_and_reassign(self):
        self.o.load("listings", listings(TODAY, smith=80))
        lid = self.o.lead("12 Smith")["id"]
        with self.o.conn:
            sid = engine.create_sheet(self.o.conn, 1, [lid], "Boss")
            engine.reassign(self.o.conn, lid, 2, "Boss")
        self.assertEqual(self.o.lead("12 Smith")["agent_name"], "Sam")
        self.assertTrue(engine.sheet(self.o.conn, sid)["leads"][0]["moved"] is False)
        with self.o.conn:
            engine.release(self.o.conn, lid, "Boss")
        self.assertEqual(self.o.lead("12 Smith")["status"], "new")
        self.assertTrue(engine.sheet(self.o.conn, sid)["leads"][0]["moved"], "old sheet must flag it")

    def test_threshold_change_resorts(self):
        self.o.load("listings", listings(TODAY, smith=65))
        self.assertFalse(self.o.lead("12 Smith")["eligible"])
        with self.o.conn:
            db.set_settings(self.o.conn, {"threshold_days": 60})
            engine.rebuild(self.o.conn)
        self.assertTrue(self.o.lead("12 Smith")["eligible"])

    def test_relisted_property_goes_back_to_watchlist(self):
        self.o.load("listings", listings(TODAY, smith=90))
        self.o.load("listings", listings(TODAY, smith=5))
        l = self.o.lead("12 Smith")
        self.assertFalse(l["eligible"])
        self.assertEqual(l["days"], 5)


class ServerTests(unittest.TestCase):
    """Smoke test the HTTP layer end to end."""

    @classmethod
    def setUpClass(cls):
        import tempfile
        import threading
        from http.server import ThreadingHTTPServer
        from lw import server
        cls.tmp = tempfile.mkdtemp()
        server.Handler.db_path = os.path.join(cls.tmp, "t.sqlite3")
        cls.httpd = ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
        threading.Thread(target=cls.httpd.serve_forever, daemon=True).start()
        cls.base = f"http://127.0.0.1:{cls.httpd.server_address[1]}"

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()

    def call(self, path, body=None, raw=None, person="Tester"):
        import urllib.error
        import urllib.request
        data = raw if raw is not None else (json.dumps(body).encode() if body is not None else None)
        req = urllib.request.Request(self.base + path, data=data, headers={"X-Person": person})
        try:
            with urllib.request.urlopen(req) as r:
                return r.status, r.read()
        except urllib.error.HTTPError as e:
            return e.code, e.read()

    def test_import_and_sheet_over_http(self):
        self.assertEqual(self.call("/")[0], 200)
        self.assertEqual(self.call("/api/agents", {"name": "Alex"})[0], 200)
        self.assertEqual(self.call("/api/settings", {"our_agencies": "Our Agency"})[0], 200)
        for kind, rows in (("contacts", CONTACTS), ("listings", listings(date.today(), smith=80, hill=10))):
            code, body = self.call(f"/api/import/preview?kind={kind}&filename={kind}.csv", raw=csv_bytes(rows))
            self.assertEqual(code, 200, body)
            p = json.loads(body)
            code, body = self.call("/api/import/commit", {"token": p["token"], "mapping": p["mapping"], "full_snapshot": True})
            self.assertEqual(code, 200, body)
        ready = json.loads(self.call("/api/leads?view=ready")[1])
        lid = [l for l in ready if not l["blockers"]][0]["id"]
        code, body = self.call("/api/sheets", {"agent_id": 1, "lead_ids": [lid]}, person="")
        self.assertEqual(code, 400, "changes without a name must be refused")
        code, body = self.call("/api/sheets", {"agent_id": 1, "lead_ids": [lid]})
        sid = json.loads(body)["sheet_id"]
        code, html = self.call(f"/sheet/{sid}/print")
        self.assertEqual(code, 200)
        self.assertIn(b"12 Smith Street", html)
        self.assertIn(b"0491 570 001", html)
        code, csv = self.call(f"/sheet/{sid}.csv")
        self.assertIn(b"Pat Owner", csv)


if __name__ == "__main__":
    unittest.main()
