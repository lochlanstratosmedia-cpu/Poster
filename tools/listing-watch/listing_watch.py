#!/usr/bin/env python3
"""Listing Watch: finds properties listed 70+ days with other agencies, matches
them to owners in our database, and tracks the calls.

  python3 listing_watch.py              start the app (http://localhost:8770)
  python3 listing_watch.py --network    let other office computers open it too
  python3 listing_watch.py check        run the daily check (for a scheduled task)
  python3 listing_watch.py demo         try it with made-up sample data

Needs Python 3.9 or newer. Nothing else to install.
"""

import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from lw import db, engine, notify, server  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))


def main():
    ap = argparse.ArgumentParser(description="Listing Watch")
    ap.add_argument("command", nargs="?", default="serve", choices=["serve", "check", "demo"])
    ap.add_argument("--port", type=int, default=8770)
    ap.add_argument("--network", action="store_true", help="allow other computers on the office network to connect")
    ap.add_argument("--db", default=None, help="database file (default: data/listing-watch.sqlite3)")
    args = ap.parse_args()
    host = "0.0.0.0" if args.network else "127.0.0.1"

    if args.command == "demo":
        from lw import demo
        path = os.path.join(HERE, "data", "demo.sqlite3")
        demo.load(path, os.path.join(HERE, "sample-data"))
        print("Demo data loaded. Everything in it is made up.")
        server.serve(host, args.port, path)
    elif args.command == "check":
        conn = db.connect(args.db)
        with conn:
            result = engine.daily_check(conn)
        unread = conn.execute("SELECT title, body FROM notifications WHERE read_at IS NULL ORDER BY id DESC LIMIT 20").fetchall()
        print(f"Checked. {result['crossed']} propert{'y' if result['crossed'] == 1 else 'ies'} crossed the threshold since the last run.")
        for n in unread:
            print(f"\n* {n['title']}\n  " + n["body"].replace("\n", "\n  "))
        if notify.email_configured():
            with conn:
                sent = notify.send_pending(conn)
            print(f"\nEmailed {sent} notification(s)." if sent else "\nNothing new to email.")
        conn.close()
    else:
        server.serve(host, args.port, args.db)


if __name__ == "__main__":
    main()
