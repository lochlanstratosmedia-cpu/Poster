# Listing Watch

Finds every property that has been listed with another agency for 70 days or
more, matches it to the owner in our database, and turns the matches into
contact sheets for the associate agents. It tracks every call after that, and
keeps a watchlist of properties that haven't reached 70 days yet. You get a
notification on the day one of them does.

It runs on one office computer and agents open it in a browser. Nothing is
sent anywhere else.

## Start it

You need Python 3.9 or newer (already on most Macs; on Windows install it from
python.org). Nothing else gets installed.

```
cd tools/listing-watch
python3 listing_watch.py
```

Then open http://localhost:8770.

To let other computers in the office use it, start it with `--network` and
have them open `http://<this computer's IP address>:8770`. Use this on the
office network only. There is no login, so don't expose it to the internet.

To try it first with made-up data:

```
python3 listing_watch.py demo
```

## First-time setup

1. **Settings**: type our agency name exactly as it appears in the for-sale
   data, one line per brand or office. Our own listings are then never put on
   a contact sheet.
2. **Settings**: add each associate agent.
3. **Import data > Our database**: upload the CRM export (CSV or .xlsx) with
   owner names, phone numbers and property addresses.
4. **Import data > Everything for sale**: upload the export of every property
   currently for sale, with address, agency, and either the date listed or
   days on market.

Each import shows which column it picked for each field, with the first values
from that column beside it, then a preview of the rows as they will be saved.
Dates are shown with the month spelled out (Sun 14 Jun 2026) so a day/month
mix-up is easy to spot. Nothing is saved until you press the last button.

## Day to day

| Tab | What it's for |
|---|---|
| Today | Counts, notifications, and anything that needs action |
| Ready to assign | 70+ days, still for sale, owner known, nobody calling yet. Tick properties, pick an agent, make the sheet |
| Watchlist | Under 70 days, sorted by the day each one will hit 70 |
| Tracker | Everything handed out, with status, next follow-up and call count |
| Contact sheets | Each sheet, its progress, and print or spreadsheet versions |

Agents open a property, press what happened (no answer, left message, call
back, appraisal booked, listed with us, not interested, wrong number, asked
not to be contacted), add a note, and save. Call back and appraisal need a
date. The last entry can be undone.

Import a fresh for-sale export every few days. A full export also tells the
app which properties have sold or been withdrawn, and anyone working one of
those is told to stop calling. The app warns once the data is 7 days old.

## How mistakes are kept out

- Each property can be on one agent's sheet at a time. Making a sheet is all
  or nothing: if any property can't go on, none are assigned and the reason is
  shown.
- Our own listings, do-not-contact owners, sold or withdrawn properties, and
  properties whose owner match is uncertain never go on a sheet.
- An owner is matched automatically only when unit, number, street, street
  type and suburb all agree. "3/12 Smith St" and "Unit 3, 12 Smith Street"
  count as the same. A near miss, such as a missing suburb, goes to "Owner
  match to check" for a person to confirm or reject. That answer is
  remembered across future imports.
- A call can't be logged against a property that hasn't been assigned, and
  every change records who made it. Choose your name in the "You are" box.
- A printed sheet can go out of date. The on-screen sheet marks rows that
  sold, went do-not-contact or moved to another agent, and the print shows
  DO NOT CALL on those rows if it's reprinted.
- The day count is worked out from the date listed every day, so it doesn't
  depend on when the last import happened.

## Notifications

The app checks every 10 minutes while it's running. When a watchlist property
reaches 70 days it adds a notification ("2 properties hit 70 days") and the
property moves to Ready to assign. It also tells you about follow-ups due today
and properties that sold while being worked. Turn on pop-up alerts in Settings
to get them on screen.

A property that is already past 70 days the first time it's imported goes
straight to Ready to assign without a notification, so the first import
doesn't flood you.

### Email and scheduled checks (optional)

`python3 listing_watch.py check` runs the same check once and prints the
results. To have it email them, set these environment variables:

```
LW_SMTP_HOST=smtp.office365.com
LW_SMTP_PORT=587
LW_SMTP_USER=alerts@youragency.com.au
LW_SMTP_PASSWORD=...
LW_NOTIFY_TO=sales@youragency.com.au
LW_APP_URL=http://192.168.1.20:8770
```

Then schedule it each morning: on a Mac or Linux with cron
(`45 7 * * * cd /path/to/tools/listing-watch && python3 listing_watch.py check`),
or on Windows with Task Scheduler running the same command.

## Your data

Everything is stored in `data/listing-watch.sqlite3`. Copy that file to back
it up. Uploaded files are read in memory and not kept.

The `data/` folder is gitignored. This repository is public, so never commit
a real export or the database. The files in `sample-data/` are made up,
including the phone numbers, which are in the 0491 570 range set aside for
fiction.

## Settings

- **Day threshold**: 70 by default.
- **Hitting soon window**: how far ahead the Today page counts (14 days).
- **Date format**: day first (Australian) or month first. Check this before
  the first import.
- **Time zone**: decides when a new day starts. Australia/Sydney by default.

## Online demo

`web-demo/` builds a one-page version that runs entirely in the browser with
made-up data, for trying the app without installing it. `demo-server.js`
repeats the rules from `lw/` in JavaScript, so change both when a rule
changes. Build it with `python3 web-demo/build.py`.

## Tests

```
python3 -m unittest discover tools/listing-watch/tests
```
