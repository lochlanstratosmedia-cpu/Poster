"""Read CSV and Excel exports, guess which column is which, and turn rows into
clean records. Every row that cannot be used is reported with a reason rather
than dropped quietly."""

import csv
import io
import re
import zipfile
from datetime import date, datetime, timedelta
from xml.etree import ElementTree

from . import address

# Fields each kind of import understands. Required fields must be mapped
# before an import can go ahead.
FIELDS = {
    "listings": [
        ("address", "Property address", True),
        ("suburb", "Suburb", False),
        ("state", "State", False),
        ("postcode", "Postcode", False),
        ("agency", "Listing agency", True),
        ("agent", "Listing agent", False),
        ("listed_date", "Date listed", False),
        ("days_on_market", "Days on market", False),
        ("price", "Price / price guide", False),
        ("property_type", "Property type", False),
        ("bedrooms", "Bedrooms", False),
        ("url", "Listing link", False),
    ],
    "contacts": [
        ("name", "Owner name", True),
        ("first_name", "First name", False),
        ("last_name", "Last name", False),
        ("phone", "Phone (mobile)", False),
        ("phone2", "Other phone", False),
        ("email", "Email", False),
        ("address", "Property address", True),
        ("suburb", "Suburb", False),
        ("state", "State", False),
        ("postcode", "Postcode", False),
        ("do_not_contact", "Do not contact flag", False),
        ("notes", "Notes", False),
    ],
}

# Header words that suggest a field. Checked in order; first match wins.
HINTS = {
    "listed_date": ["first listed date", "date listed", "listed date", "listing date", "list date",
                    "date on market", "first listed", "listed on", "listed"],
    "days_on_market": ["days on market", "dom", "days listed", "days on site", "days"],
    "address": ["property address", "street address", "full address", "address line 1",
                "address1", "street", "address"],
    "suburb": ["suburb", "locality", "city", "town"],
    "state": ["state"],
    "postcode": ["postcode", "post code", "postal code", "zip"],
    "agency": ["listing agency", "agency name", "agency", "office", "brand"],
    "agent": ["listing agent", "agent name", "agent"],
    "price": ["last listed price", "current price", "price guide", "asking price", "price"],
    "property_type": ["property type", "type"],
    "bedrooms": ["bedrooms", "beds", "bed"],
    "url": ["listing url", "listing link", "url", "link", "web"],
    "first_name": ["first name", "firstname", "given name"],
    "last_name": ["last name", "lastname", "surname", "family name"],
    "name": ["owner name", "full name", "contact name", "vendor name", "owner", "name"],
    "phone": ["mobile", "mobile phone", "cell", "phone 1", "phone", "contact number", "telephone"],
    "phone2": ["home phone", "work phone", "phone 2", "other phone", "landline"],
    "email": ["email address", "e-mail", "email"],
    "do_not_contact": ["do not contact", "do not call", "dnc", "opt out", "unsubscribed"],
    "notes": ["notes", "comments", "comment"],
}


class ImportError_(Exception):
    pass


# ---------- reading files ----------

def read_table(filename, data):
    """Return (headers, rows) from CSV or XLSX bytes. Rows are lists of strings."""
    name = (filename or "").lower()
    if name.endswith((".xlsx", ".xlsm")) or data[:2] == b"PK":
        table = _read_xlsx(data)
    elif name.endswith(".xls"):
        raise ImportError_("Old .xls files can't be read. In Excel use File > Save As > CSV or .xlsx, then upload that.")
    else:
        table = _read_csv(data)
    return _split_header(table)


def _split_header(table):
    """Find the real heading row. Exports such as RP Data put a few lines of
    search settings above it, so pick the row in the first 20 with the most
    filled cells, and pad every row to the widest one."""
    if not table:
        raise ImportError_("The file is empty.")
    width = max(len(r) for r in table)
    table = [(r + [""] * width)[:width] for r in table]
    filled = [sum(1 for c in r if c.strip()) for r in table[:20]]
    at = filled.index(max(filled))
    headers = [h.strip() for h in table[at]]
    rows = [r for r in table[at + 1:] if any(c.strip() for c in r)]
    return headers, rows


def _read_csv(data):
    for enc in ("utf-8-sig", "cp1252", "latin-1"):
        try:
            text = data.decode(enc)
            break
        except UnicodeDecodeError:
            continue
    sample = text[:5000]
    try:
        dialect = csv.Sniffer().sniff(sample, delimiters=",;\t|")
    except csv.Error:
        dialect = csv.excel
    rows = [r for r in csv.reader(io.StringIO(text), dialect) if any(c.strip() for c in r)]
    if not rows:
        raise ImportError_("The file is empty.")
    return [[c.strip() for c in r] for r in rows]


def _read_xlsx(data):
    ns = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
    try:
        z = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile:
        raise ImportError_("That file isn't a readable Excel workbook.")
    shared = []
    if "xl/sharedStrings.xml" in z.namelist():
        root = ElementTree.fromstring(z.read("xl/sharedStrings.xml"))
        for si in root.findall("m:si", ns):
            shared.append("".join(t.text or "" for t in si.iter(f"{{{ns['m']}}}t")))
    sheets = sorted(n for n in z.namelist() if re.match(r"xl/worksheets/sheet\d+\.xml$", n))
    if not sheets:
        raise ImportError_("The workbook has no sheets.")
    # Cells formatted as dates come through as serial numbers; find those styles.
    date_styles = _xlsx_date_styles(z, ns)
    root = ElementTree.fromstring(z.read(sheets[0]))
    table = []
    for row in root.iter(f"{{{ns['m']}}}row"):
        cells = {}
        for c in row.findall("m:c", ns):
            ref = c.get("r", "")
            col = _col_index(re.sub(r"\d", "", ref)) if ref else len(cells)
            t = c.get("t")
            v = c.find("m:v", ns)
            if t == "s" and v is not None:
                val = shared[int(v.text)]
            elif t == "inlineStr":
                val = "".join(x.text or "" for x in c.iter(f"{{{ns['m']}}}t"))
            elif v is not None:
                val = v.text or ""
                if c.get("s") and int(c.get("s")) in date_styles:
                    try:
                        val = (date(1899, 12, 30) + timedelta(days=int(float(val)))).isoformat()
                    except ValueError:
                        pass
                elif re.fullmatch(r"-?\d+\.0", val):
                    val = val[:-2]
            else:
                val = ""
            cells[col] = val.strip()
        if cells:
            width = max(cells) + 1
            table.append([cells.get(i, "") for i in range(width)])
    table = [r for r in table if any(r)]
    if not table:
        raise ImportError_("The first sheet is empty.")
    return table


def _col_index(letters):
    n = 0
    for ch in letters.upper():
        n = n * 26 + ord(ch) - 64
    return n - 1


def _xlsx_date_styles(z, ns):
    if "xl/styles.xml" not in z.namelist():
        return set()
    root = ElementTree.fromstring(z.read("xl/styles.xml"))
    custom = {}
    numfmts = root.find("m:numFmts", ns)
    if numfmts is not None:
        for nf in numfmts.findall("m:numFmt", ns):
            custom[int(nf.get("numFmtId"))] = nf.get("formatCode", "").lower()
    builtin_dates = set(range(14, 23)) | {45, 46, 47}
    out = set()
    xfs = root.find("m:cellXfs", ns)
    if xfs is None:
        return out
    for i, xf in enumerate(xfs.findall("m:xf", ns)):
        fid = int(xf.get("numFmtId", "0"))
        code = custom.get(fid, "")
        if fid in builtin_dates or (code and re.search(r"[dy]", code) and "h" not in code):
            out.add(i)
    return out


# ---------- mapping ----------

def _norm_header(h):
    return re.sub(r"[^a-z0-9]+", " ", h.lower()).strip()


def guess_mapping(kind, headers):
    """Map field -> column index using header names. Each column is used once."""
    normed = [_norm_header(h) for h in headers]
    used, mapping = set(), {}
    fields = [f for f, _, _ in FIELDS[kind]]
    # Exact matches first across all fields, then "contains" matches.
    for exact in (True, False):
        for field in fields:
            if field in mapping:
                continue
            for hint in HINTS.get(field, []):
                hit = None
                for i, h in enumerate(normed):
                    if i in used:
                        continue
                    if (h == hint) if exact else (re.search(rf"\b{re.escape(hint)}\b", h)):
                        hit = i
                        break
                if hit is not None:
                    mapping[field] = hit
                    used.add(hit)
                    break
    return mapping


def missing_required(kind, mapping):
    missing = [label for f, label, req in FIELDS[kind] if req and mapping.get(f) is None]
    if kind == "listings" and mapping.get("listed_date") is None and mapping.get("days_on_market") is None:
        missing.append("Date listed or Days on market")
    if kind == "contacts" and mapping.get("name") is None and mapping.get("last_name") is not None:
        missing = [m for m in missing if m != "Owner name"]
    return missing


# ---------- values ----------

_MONTHS = {m: i for i, m in enumerate(
    ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"], 1)}


def parse_date(text, order="DMY"):
    """Parse a date. Slash dates follow `order` (DMY for Australia). Returns a date or None."""
    s = (text or "").strip()
    if not s:
        return None
    s = re.sub(r"[T ]\d{1,2}:\d{2}.*$", "", s)  # drop any time part
    m = re.fullmatch(r"(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})", s)
    if m:
        return _safe_date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
    m = re.fullmatch(r"(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})", s)
    if m:
        a, b, y = int(m.group(1)), int(m.group(2)), int(m.group(3))
        y = y + 2000 if y < 100 else y
        return _safe_date(y, b, a) if order == "DMY" else _safe_date(y, a, b)
    m = re.fullmatch(r"(?:[a-z]+,?\s+)?(\d{1,2})(?:st|nd|rd|th)?[\s-]+([a-z]{3})[a-z]*\.?,?[\s-]+(\d{2,4})", s.lower())
    if m and m.group(2) in _MONTHS:
        y = int(m.group(3))
        return _safe_date(y + 2000 if y < 100 else y, _MONTHS[m.group(2)], int(m.group(1)))
    m = re.fullmatch(r"(?:[a-z]+,?\s+)?([a-z]{3})[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})", s.lower())
    if m and m.group(1) in _MONTHS:
        return _safe_date(int(m.group(3)), _MONTHS[m.group(1)], int(m.group(2)))
    if re.fullmatch(r"\d{5}(\.0+)?", s):  # Excel serial pasted as text
        return date(1899, 12, 30) + timedelta(days=int(float(s)))
    return None


def _safe_date(y, mo, d):
    try:
        return date(y, mo, d)
    except ValueError:
        return None


def clean_phone(text):
    """Format Australian numbers consistently so they are easy to read aloud."""
    raw = (text or "").strip()
    digits = re.sub(r"\D", "", raw)
    if digits.startswith("61") and len(digits) == 11:
        digits = "0" + digits[2:]
    if len(digits) == 10 and digits.startswith("04"):
        return f"{digits[:4]} {digits[4:7]} {digits[7:]}"
    if len(digits) == 10 and digits.startswith("0"):
        return f"({digits[:2]}) {digits[2:6]} {digits[6:]}"
    if len(digits) == 8:
        return f"{digits[:4]} {digits[4:]}"
    return raw


def truthy(text):
    return (text or "").strip().lower() in {"y", "yes", "true", "1", "x", "dnc", "do not contact", "do not call", "opted out", "unsubscribed"}


# ---------- building records ----------

def build_records(kind, headers, rows, mapping, today, date_order="DMY"):
    """Return (records, problems). problems is a list of (row number, reason)."""
    def get(row, field):
        i = mapping.get(field)
        if i is None or i >= len(row):
            return ""
        return row[i].strip()

    records, problems = [], []
    for n, row in enumerate(rows, start=2):  # row 1 is the header
        if not any(c.strip() for c in row):
            continue
        addr = get(row, "address")
        parts = address.parse(addr, get(row, "suburb"), get(row, "state"), get(row, "postcode"))
        if not parts["number"] or not parts["street"]:
            problems.append((n, f"Address '{addr or '(blank)'}' has no street number or street name"))
            continue
        rec = {"row": n, "address_raw": addr, "parts": parts}

        if kind == "listings":
            agency = get(row, "agency")
            if not agency:
                problems.append((n, "No listing agency"))
                continue
            listed = None
            if mapping.get("listed_date") is not None and get(row, "listed_date"):
                listed = parse_date(get(row, "listed_date"), date_order)
                if listed is None:
                    problems.append((n, f"Can't read the date '{get(row, 'listed_date')}'"))
                    continue
            elif mapping.get("days_on_market") is not None and get(row, "days_on_market"):
                dom = re.sub(r"[^\d]", "", get(row, "days_on_market"))
                if not dom:
                    problems.append((n, f"Days on market '{get(row, 'days_on_market')}' is not a number"))
                    continue
                listed = today - timedelta(days=int(dom))
            else:
                problems.append((n, "No listed date or days on market"))
                continue
            if listed > today:
                problems.append((n, f"Listed date {listed:%d/%m/%Y} is in the future. Check the date format setting (day/month or month/day)"))
                continue
            if (today - listed).days > 3 * 365:
                problems.append((n, f"Listed date {listed:%d/%m/%Y} is more than 3 years ago, which looks wrong"))
                continue
            rec.update(agency=agency, agent=get(row, "agent"), listed_date=listed,
                       price=get(row, "price"), property_type=get(row, "property_type"),
                       bedrooms=get(row, "bedrooms"), url=get(row, "url"))
        else:
            name = get(row, "name") or " ".join(filter(None, [get(row, "first_name"), get(row, "last_name")]))
            if not name:
                problems.append((n, "No owner name"))
                continue
            phone, phone2, email = clean_phone(get(row, "phone")), clean_phone(get(row, "phone2")), get(row, "email")
            if phone == phone2:
                phone2 = ""
            if not phone:
                phone, phone2 = phone2, ""
            rec.update(name=name, phone=phone, phone2=phone2, email=email,
                       do_not_contact=truthy(get(row, "do_not_contact")), notes=get(row, "notes"))
        records.append(rec)
    return records, problems
