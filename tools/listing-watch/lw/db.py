"""SQLite storage. One file holds everything; back it up by copying it."""

import json
import os
import sqlite3

SCHEMA = """
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS agents (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  phone TEXT DEFAULT '', active INTEGER NOT NULL DEFAULT 1);

CREATE TABLE IF NOT EXISTS imports (
  id INTEGER PRIMARY KEY, kind TEXT NOT NULL, filename TEXT, imported_at TEXT NOT NULL,
  imported_by TEXT DEFAULT '', rows_total INTEGER, rows_used INTEGER, rows_skipped INTEGER,
  problems TEXT DEFAULT '[]', full_snapshot INTEGER DEFAULT 1);

CREATE TABLE IF NOT EXISTS contacts (
  id INTEGER PRIMARY KEY, import_id INTEGER, name TEXT NOT NULL, phone TEXT, phone2 TEXT,
  email TEXT, address_raw TEXT, parts TEXT NOT NULL, block TEXT, do_not_contact INTEGER DEFAULT 0,
  notes TEXT DEFAULT '');
CREATE INDEX IF NOT EXISTS contacts_block ON contacts(block);

CREATE TABLE IF NOT EXISTS listings (
  id INTEGER PRIMARY KEY, address_key TEXT NOT NULL UNIQUE, address_raw TEXT, parts TEXT NOT NULL,
  block TEXT, agency TEXT, agent TEXT, listed_date TEXT NOT NULL, price TEXT, property_type TEXT,
  bedrooms TEXT, url TEXT, first_seen TEXT NOT NULL, last_seen TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1, off_market_on TEXT);

-- One lead per listing. Tracks the outreach and when it crossed the threshold.
CREATE TABLE IF NOT EXISTS leads (
  id INTEGER PRIMARY KEY, listing_id INTEGER NOT NULL UNIQUE REFERENCES listings(id),
  status TEXT NOT NULL DEFAULT 'new', agent_id INTEGER REFERENCES agents(id), sheet_id INTEGER,
  assigned_on TEXT, follow_up_on TEXT, attempts INTEGER NOT NULL DEFAULT 0,
  last_contact_on TEXT, eligible_on TEXT, crossed_notified INTEGER NOT NULL DEFAULT 0,
  seen_below INTEGER NOT NULL DEFAULT 0, ours INTEGER NOT NULL DEFAULT 0,
  do_not_contact INTEGER NOT NULL DEFAULT 0, created_on TEXT NOT NULL, updated_at TEXT);

-- Which contacts in our database belong to which lead, and how sure we are.
CREATE TABLE IF NOT EXISTS lead_contacts (
  lead_id INTEGER NOT NULL, contact_id INTEGER NOT NULL, quality TEXT NOT NULL,
  PRIMARY KEY (lead_id, contact_id));

-- A person's answer to a "check this match" question. Keyed on text so it
-- survives a contacts re-import.
CREATE TABLE IF NOT EXISTS match_reviews (
  listing_key TEXT NOT NULL, contact_sig TEXT NOT NULL, decision TEXT NOT NULL,
  decided_by TEXT, decided_at TEXT, PRIMARY KEY (listing_key, contact_sig));

CREATE TABLE IF NOT EXISTS sheets (
  id INTEGER PRIMARY KEY, agent_id INTEGER NOT NULL REFERENCES agents(id),
  created_at TEXT NOT NULL, created_by TEXT DEFAULT '', note TEXT DEFAULT '');
CREATE TABLE IF NOT EXISTS sheet_leads (
  sheet_id INTEGER NOT NULL, lead_id INTEGER NOT NULL, position INTEGER NOT NULL,
  PRIMARY KEY (sheet_id, lead_id));

CREATE TABLE IF NOT EXISTS activity (
  id INTEGER PRIMARY KEY, lead_id INTEGER NOT NULL, at TEXT NOT NULL, by TEXT DEFAULT '',
  kind TEXT NOT NULL, outcome TEXT, method TEXT, note TEXT DEFAULT '', follow_up_on TEXT,
  prev TEXT DEFAULT '{}');
CREATE INDEX IF NOT EXISTS activity_lead ON activity(lead_id);

CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY, created_at TEXT NOT NULL, kind TEXT NOT NULL, title TEXT NOT NULL,
  body TEXT DEFAULT '', lead_ids TEXT DEFAULT '[]', read_at TEXT, emailed INTEGER DEFAULT 0);
"""

DEFAULT_SETTINGS = {
    "threshold_days": 70,
    "soon_days": 14,
    "our_agencies": [],
    "date_order": "DMY",
    "stale_after_days": 7,
    "timezone": "Australia/Sydney",
    "office_name": "",
}


def default_path():
    here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    return os.environ.get("LISTING_WATCH_DB", os.path.join(here, "data", "listing-watch.sqlite3"))


def connect(path=None):
    path = path or default_path()
    if path != ":memory:":
        os.makedirs(os.path.dirname(path), exist_ok=True)
    conn = sqlite3.connect(path, timeout=30)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL") if path != ":memory:" else None
    conn.executescript(SCHEMA)
    return conn


def get_settings(conn):
    out = dict(DEFAULT_SETTINGS)
    for row in conn.execute("SELECT key, value FROM settings"):
        if row["key"] in DEFAULT_SETTINGS:
            out[row["key"]] = json.loads(row["value"])
    return out


def set_settings(conn, values):
    for k, v in values.items():
        if k in DEFAULT_SETTINGS:
            conn.execute("INSERT INTO settings(key, value) VALUES(?, ?) "
                         "ON CONFLICT(key) DO UPDATE SET value = excluded.value", (k, json.dumps(v)))
