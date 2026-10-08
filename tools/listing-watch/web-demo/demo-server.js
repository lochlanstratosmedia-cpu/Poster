/* Listing Watch online demo: the Python back end (lw/address.py, importer.py,
   engine.py, demo.py and the sheet printout) ported to the browser, so the
   unchanged front end can run without installing anything. Everything lives
   in memory and resets when the page reloads. Keep it in step with lw/. */
"use strict";
(function () {

// ---------------- dates ----------------

const pad = (n, w = 2) => String(n).padStart(w, "0");
function isoFromParts(y, m, d) { return `${pad(y, 4)}-${pad(m)}-${pad(d)}`; }
function safeDate(y, m, d) {
  const t = new Date(Date.UTC(y, m - 1, d));
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== m - 1 || t.getUTCDate() !== d) return null;
  return isoFromParts(y, m, d);
}
function addDays(iso, n) {
  const [y, m, d] = iso.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return isoFromParts(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}
function diffDays(a, b) { // a - b in days
  const f = (s) => { const [y, m, d] = s.split("-").map(Number); return Date.UTC(y, m - 1, d); };
  return Math.round((f(a) - f(b)) / 86400000);
}
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
function fmt(iso, style) {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  if (style === "dmy") return `${pad(d)}/${pad(m)}/${y}`;
  if (style === "short") return `${pad(d)} ${MON[m - 1]} ${y}`;
  return `${DOW[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]} ${pad(d)} ${MON[m - 1]} ${y}`;
}

// ---------------- address ----------------

const STREET_TYPES_LIST = {
  st: ["street", "st", "str"], rd: ["road", "rd"], ave: ["avenue", "ave", "av"], dr: ["drive", "dr", "drv"],
  ct: ["court", "ct", "crt"], cres: ["crescent", "cres", "cr", "cresc"], pl: ["place", "pl"], pde: ["parade", "pde"],
  ln: ["lane", "ln"], cl: ["close", "cl"], tce: ["terrace", "tce", "terr"], bvd: ["boulevard", "boulevarde", "bvd", "blvd", "bvde"],
  hwy: ["highway", "hwy"], cct: ["circuit", "cct", "cir"], way: ["way", "wy"], gr: ["grove", "gr", "gve"], sq: ["square", "sq"],
  esp: ["esplanade", "esp"], pkwy: ["parkway", "pkwy"], glen: ["glen", "gln"], rise: ["rise"], walk: ["walk", "wlk"],
  mews: ["mews"], row: ["row"], view: ["view", "vw"], vista: ["vista"], ridge: ["ridge", "rdg"], loop: ["loop"], link: ["link"],
  rtt: ["retreat", "rtt"], gdns: ["gardens", "gdns"], hts: ["heights", "hts"], pt: ["point", "pt"], ch: ["chase", "ch"],
  cnr: ["corner", "cnr"], app: ["approach", "app"], arc: ["arcade", "arc"], bay: ["bay"], end: ["end"], gate: ["gate"],
  grn: ["green", "grn"], hill: ["hill"], pass: ["pass"], path: ["path"], plaza: ["plaza"], prom: ["promenade", "prom"],
  qy: ["quay", "qy"], rch: ["reach", "rch"], run: ["run"], tr: ["track", "trk", "tr"], trl: ["trail", "trl"],
};
const STREET_TYPES = {};
for (const [canon, sp] of Object.entries(STREET_TYPES_LIST)) for (const s of sp) STREET_TYPES[s] = canon;
const UNIT_WORDS = "(?:unit|units|u|apartment|apt|flat|villa|townhouse|th|suite|ste|shop|lot)";
const NUMBER = "\\d+[a-z]?(?:\\s*-\\s*\\d+[a-z]?)?";
const RE_SLASH = new RegExp(`^(?:${UNIT_WORDS}\\.?\\s*)?(\\w+)\\s*/\\s*(${NUMBER})\\s+(.+)$`);
const RE_UNIT_WORD = new RegExp(`^${UNIT_WORDS}\\.?\\s*(\\w+)\\s+(${NUMBER})\\s+(.+)$`);
const RE_PLAIN = new RegExp(`^(${NUMBER})\\s+(.+)$`);
const RE_TAIL = /^(.*?)(?:\s+(nsw|vic|qld|sa|wa|tas|nt|act))?(?:\s+(\d{4}))?$/;
const RE_UNIT_ONLY = new RegExp(`^${UNIT_WORDS}\\.?\\s*\\w+$`);

function cleanAddr(t) {
  t = String(t || "").toLowerCase().replace(/[–—]/g, "-");
  t = t.replace(/[^\w\s/,\-]/g, " ").replace(/\s*-\s*/g, "-").replace(/\s*\/\s*/g, "/");
  return t.replace(/\s+/g, " ").trim();
}
const normWords = (t) => String(t || "").toLowerCase().replace(/[^\w\s]/g, " ").replace(/\s+/g, " ").trim();
function splitTail(text) { const m = text.trim().match(RE_TAIL); return [m[1].trim(), m[2] || "", m[3] || ""]; }
function streetAndSuburb(rest, hasSuburb) {
  const words = rest.split(" ").filter(Boolean);
  for (let i = 1; i < words.length; i++) {
    if (STREET_TYPES[words[i]]) {
      let street = words.slice(0, i).join(" ");
      const suburb = hasSuburb ? "" : words.slice(i + 1).join(" ");
      if (hasSuburb && i + 1 < words.length) street = words.slice(0, i).concat(words.slice(i + 1)).join(" ");
      return [street, STREET_TYPES[words[i]], suburb];
    }
  }
  return [rest, "", ""];
}
function parseAddr(addr, suburb = "", state = "", postcode = "") {
  const raw = cleanAddr(addr);
  const p = { unit: "", number: "", street: "", type: "", suburb: normWords(suburb), state: normWords(state),
    postcode: String(postcode || "").replace(/\D/g, "").slice(0, 4) };
  let segs = raw.split(",").map((s) => s.trim()).filter(Boolean);
  if (segs.length > 1 && RE_UNIT_ONLY.test(segs[0])) segs = [segs[0] + " " + segs[1], ...segs.slice(2)];
  if (!segs.length) return p;
  let line = segs[0];
  const tail = segs.slice(1).join(" ");
  if (tail) {
    const [sub, st, pc] = splitTail(tail);
    p.suburb = p.suburb || sub; p.state = p.state || st; p.postcode = p.postcode || pc;
  } else {
    const [rest, st, pc] = splitTail(line);
    if (st || pc) { line = rest; p.state = p.state || st; p.postcode = p.postcode || pc; }
  }
  let rest;
  let m = line.match(RE_SLASH) || line.match(RE_UNIT_WORD);
  if (m) { p.unit = m[1]; p.number = m[2]; rest = m[3]; }
  else { m = line.match(RE_PLAIN); if (m) { p.number = m[1]; rest = m[2]; } else rest = line; }
  const hasSub = !!p.suburb;
  const [street, type, sub] = streetAndSuburb(rest.replaceAll("/", " "), hasSub);
  p.street = street; p.type = type;
  if (!hasSub) p.suburb = sub;
  p.number = p.number.replaceAll(" ", "");
  return p;
}
const addrKey = (p) => [p.unit, p.number, p.street, p.type, p.suburb, p.postcode].join("|");
const blockKey = (p) => (!p.number || !p.street ? null : JSON.stringify([p.unit, p.number, p.street]));
function compareAddr(a, b) {
  if (blockKey(a) === null || blockKey(a) !== blockKey(b)) return null;
  if (a.suburb && b.suburb && a.suburb !== b.suburb) return null;
  if (a.postcode && b.postcode && a.postcode !== b.postcode) return null;
  if (!a.suburb || !b.suburb) return "check";
  if (a.type !== b.type) return "check";
  return "exact";
}
const title = (s) => s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());
function displayAddr(p) {
  const num = (p.unit ? `${p.unit}/${p.number}` : p.number).toUpperCase();
  const type = STREET_TYPES_LIST[p.type] ? STREET_TYPES_LIST[p.type][0] : p.type;
  const street = [num, title(p.street), title(type)].filter(Boolean).join(" ");
  const place = [title(p.suburb), p.state.toUpperCase(), p.postcode].filter(Boolean).join(" ");
  return [street, place].filter(Boolean).join(", ");
}

// ---------------- importer ----------------

const FIELDS = {
  listings: [["address", "Property address", true], ["suburb", "Suburb", false], ["state", "State", false],
    ["postcode", "Postcode", false], ["agency", "Listing agency", true], ["agent", "Listing agent", false],
    ["listed_date", "Date listed", false], ["days_on_market", "Days on market", false], ["price", "Price / price guide", false],
    ["property_type", "Property type", false], ["bedrooms", "Bedrooms", false], ["bathrooms", "Bathrooms", false],
    ["car_spaces", "Car spaces", false], ["land_size", "Land size (m²)", false], ["owner_type", "Owner type", false],
    ["listing_type", "Sale method", false], ["first_price", "First listed price", false], ["owner_1", "Owner 1 name (on title)", false],
    ["owner_2", "Owner 2 name (on title)", false], ["owner_3", "Owner 3 name (on title)", false], ["url", "Listing link", false]],
  contacts: [["name", "Owner name", true], ["first_name", "First name", false], ["last_name", "Last name", false],
    ["phone", "Phone (mobile)", false], ["phone2", "Other phone", false], ["email", "Email", false],
    ["address", "Property address", true], ["suburb", "Suburb", false], ["state", "State", false], ["postcode", "Postcode", false],
    ["do_not_contact", "Do not contact flag", false], ["tags", "Tags", false], ["source", "Lead source", false],
    ["last_note", "Last note", false], ["last_note_at", "Last note date", false], ["last_note_by", "Last note by", false],
    ["contact_owner", "Contact owner (staff)", false], ["notes", "Notes", false]],
};
const EXTRA_FIELDS = {
  listings: ["bathrooms", "car_spaces", "land_size", "owner_type", "listing_type", "first_price", "owner_1", "owner_2", "owner_3"],
  contacts: ["tags", "source", "last_note", "last_note_at", "last_note_by", "contact_owner"],
};
const HINTS = {
  listed_date: ["first listed date", "date listed", "listed date", "listing date", "list date", "date on market", "first listed", "listed on", "listed"],
  days_on_market: ["days on market", "dom", "days listed", "days on site", "days"],
  address: ["property address", "street address", "address physical", "physical address", "full address", "address line 1", "address1", "street", "address"],
  suburb: ["suburb", "locality", "city", "town"], state: ["state"], postcode: ["postcode", "post code", "postal code", "zip"],
  agency: ["listing agency", "agency name", "agency", "office", "brand"], agent: ["listing agent", "agent name", "agent"],
  price: ["last listed price", "current price", "price guide", "asking price", "price"], property_type: ["property type", "type"], bedrooms: ["bedrooms", "beds", "bed"],
  url: ["listing url", "listing link", "url", "link", "web"], first_name: ["first name", "firstname", "given name"],
  last_name: ["last name", "lastname", "surname", "family name"],
  name: ["owner name", "full name", "contact name", "vendor name", "owner", "name"],
  phone: ["mobile", "mobile phone", "cell", "phone 1", "phone", "contact number", "telephone"],
  phone2: ["home phone", "work phone", "phone 2", "other phone", "landline"], email: ["email", "e-mail", "email address"],
  do_not_contact: ["do not contact", "do not call", "dnc", "opt out", "unsubscribed"], notes: ["notes", "comments", "comment"],
  tags: ["tags", "tag", "categories", "groups"],
  bathrooms: ["bathrooms", "baths", "bath"], car_spaces: ["car spaces", "carspaces", "parking", "garages", "cars", "car"],
  land_size: ["land size m2", "land size m²", "land size", "land area", "land"], owner_type: ["owner type", "occupancy"],
  listing_type: ["listing type", "sale method", "method of sale", "sale type"], first_price: ["first listed price", "original price"],
  owner_1: ["owner 1 name", "owner 1", "owner name", "owner names", "registered owner"], owner_2: ["owner 2 name", "owner 2"], owner_3: ["owner 3 name", "owner 3"],
  source: ["enquiry source", "lead source", "marketing enquiry source", "source"], last_note: ["last note content", "last note", "latest note"],
  last_note_at: ["last note created at", "last note date", "last contacted", "last contact date"],
  last_note_by: ["last note created by", "last note by"], contact_owner: ["audit owned by", "owned by", "contact owner", "account manager"],
};
const EXCLUDE = {
  postcode: ["marketing", "interest"], suburb: ["marketing", "interest"], email: ["company", "secondary"],
  phone: ["company", "fax"], phone2: ["company", "fax"], address: ["email", "postal", "mailing"],
  name: ["company", "legal", "salutation", "addressee", "formal"], notes: ["created", "by"],
  property_type: ["listing", "owner", "sale"], price: ["first"], land_size: ["use"],
  owner_1: ["type"], owner_2: ["type"], owner_3: ["type"],
};

function readCsv(text) {
  text = text.replace(/^﻿/, "");
  const first = text.split(/\r?\n/, 1)[0] || "";
  const delim = [",", ";", "\t", "|"].map((d) => [d, first.split(d).length]).sort((a, b) => b[1] - a[1])[0][0];
  const rows = []; let row = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === delim) { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const kept = rows.filter((r) => r.some((c) => c.trim())).map((r) => r.map((c) => c.trim()));
  if (!kept.length) throw new Problem("The file is empty.");
  // Exports such as RP Data put search settings above the headings: take the
  // fullest row in the first 20 as the headings and pad short rows.
  const width = Math.max(...kept.map((r) => r.length));
  const padded = kept.map((r) => r.concat(Array(width - r.length).fill("")));
  const filled = padded.slice(0, 20).map((r) => r.filter((c) => c).length);
  const at = filled.indexOf(Math.max(...filled));
  return [padded[at], padded.slice(at + 1)];
}
const normHeader = (h) => h.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
function guessMapping(kind, headers) {
  const normed = headers.map(normHeader), used = new Set(), mapping = {};
  const fields = FIELDS[kind].map((f) => f[0]);
  for (const exact of [true, false]) {
    for (const field of fields) {
      if (field in mapping) continue;
      for (const hint of HINTS[field] || []) {
        const re = new RegExp(`\\b${reEsc(hint)}\\b`);
        const ruledOut = (h) => (EXCLUDE[field] || []).some((x) => new RegExp(`\\b${reEsc(x)}\\b`).test(h));
        const hit = normed.findIndex((h, i) => !used.has(i) && !ruledOut(h) && (exact ? h === hint : re.test(h)));
        if (hit >= 0) { mapping[field] = hit; used.add(hit); break; }
      }
    }
  }
  return mapping;
}
function missingRequired(kind, mapping) {
  let missing = FIELDS[kind].filter(([f, , req]) => req && mapping[f] == null).map(([, l]) => l);
  if (kind === "listings" && mapping.listed_date == null && mapping.days_on_market == null) missing.push("Date listed or Days on market");
  if (kind === "contacts" && mapping.name == null && mapping.last_name != null) missing = missing.filter((m) => m !== "Owner name");
  return missing;
}
const MONTHS = Object.fromEntries(["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"].map((m, i) => [m, i + 1]));
function parseDate(text, order = "DMY") {
  let s = String(text || "").trim();
  if (!s) return null;
  s = s.replace(/[T ]\d{1,2}:\d{2}.*$/, "");
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (m) return safeDate(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/);
  if (m) {
    let y = +m[3]; y = y < 100 ? y + 2000 : y;
    return order === "DMY" ? safeDate(y, +m[2], +m[1]) : safeDate(y, +m[1], +m[2]);
  }
  const l = s.toLowerCase();
  m = l.match(/^(?:[a-z]+,?\s+)?(\d{1,2})(?:st|nd|rd|th)?[\s-]+([a-z]{3})[a-z]*\.?,?[\s-]+(\d{2,4})$/);
  if (m && MONTHS[m[2]]) { const y = +m[3]; return safeDate(y < 100 ? y + 2000 : y, MONTHS[m[2]], +m[1]); }
  m = l.match(/^(?:[a-z]+,?\s+)?([a-z]{3})[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})$/);
  if (m && MONTHS[m[1]]) return safeDate(+m[3], MONTHS[m[1]], +m[2]);
  if (/^\d{5}(\.0+)?$/.test(s)) return addDays("1899-12-30", Math.floor(+s));
  return null;
}
function cleanPhone(text) {
  const raw = String(text || "").trim();
  let d = raw.replace(/\D/g, "");
  if (d.startsWith("61") && d.length === 11) d = "0" + d.slice(2);
  if (d.length === 10 && d.startsWith("04")) return `${d.slice(0, 4)} ${d.slice(4, 7)} ${d.slice(7)}`;
  if (d.length === 10 && d.startsWith("0")) return `(${d.slice(0, 2)}) ${d.slice(2, 6)} ${d.slice(6)}`;
  if (d.length === 8) return `${d.slice(0, 4)} ${d.slice(4)}`;
  return raw;
}
const PHONE_DNC = /do\s*not\s*(call|contact)|\bdnc\b/i;
const PHONE_DANGER = /deceased|passed away|\bdied\b|do\s*not\s*(call|contact)|\bdnc\b|wrong number|disconnected/i;
function splitPhone(text) {
  const raw = String(text || "").trim();
  if (!raw) return ["", "", ""];
  if (raw.replace(/\D/g, "").length < 8) return ["", "", raw];
  const m = raw.match(/^([\d\s()+.]+?)\s*(?:[-\u2013:,/]\s*|\s+)([A-Za-z].*)$/);
  if (m && m[1].replace(/\D/g, "").length >= 8) return [cleanPhone(m[1]), m[2].trim(), ""];
  return [cleanPhone(raw), "", ""];
}
const truthy = (t) => ["y", "yes", "true", "1", "x", "dnc", "do not contact", "do not call", "opted out", "unsubscribed"].includes(String(t || "").trim().toLowerCase());

function buildRecords(kind, headers, rows, mapping, today, order) {
  const get = (row, f) => { const i = mapping[f]; return i == null || i >= row.length ? "" : row[i].trim(); };
  const records = [], problems = [];
  const extras = (row) => Object.fromEntries(EXTRA_FIELDS[kind].map((f) => [f, get(row, f)]).filter(([, v]) => v && v !== "-"));
  rows.forEach((row, idx) => {
    const n = idx + 2;
    if (!row.some((c) => c.trim())) return;
    const addr = get(row, "address");
    const parts = parseAddr(addr, get(row, "suburb"), get(row, "state"), get(row, "postcode"));
    if (!parts.number || !parts.street) { problems.push([n, `Address '${addr || "(blank)"}' has no street number or street name`]); return; }
    const rec = { row: n, address_raw: addr, parts };
    if (kind === "listings") {
      const agency = get(row, "agency");
      if (!agency) { problems.push([n, "No listing agency"]); return; }
      let listed = null;
      if (mapping.listed_date != null && get(row, "listed_date")) {
        listed = parseDate(get(row, "listed_date"), order);
        if (!listed) { problems.push([n, `Can't read the date '${get(row, "listed_date")}'`]); return; }
      } else if (mapping.days_on_market != null && get(row, "days_on_market")) {
        const dom = get(row, "days_on_market").replace(/[^\d]/g, "");
        if (!dom) { problems.push([n, `Days on market '${get(row, "days_on_market")}' is not a number`]); return; }
        listed = addDays(today, -Number(dom));
      } else { problems.push([n, "No listed date or days on market"]); return; }
      if (listed > today) { problems.push([n, `Listed date ${fmt(listed, "dmy")} is in the future. Check the date format setting (day/month or month/day)`]); return; }
      if (diffDays(today, listed) > 3 * 365) { problems.push([n, `Listed date ${fmt(listed, "dmy")} is more than 3 years ago, which looks wrong`]); return; }
      Object.assign(rec, { agency, agent: get(row, "agent"), listed_date: listed, price: get(row, "price"),
        property_type: get(row, "property_type"), bedrooms: get(row, "bedrooms"), url: get(row, "url"), extra: extras(row) });
    } else {
      const name = get(row, "name") || [get(row, "first_name"), get(row, "last_name")].filter(Boolean).join(" ");
      if (!name) { problems.push([n, "No owner name"]); return; }
      const extra = extras(row), numbers = [], notes = [];
      for (const f of ["phone", "phone2"]) {
        const [num, label, note] = splitPhone(get(row, f));
        if (note) notes.push(note);
        else if (num && !numbers.some(([n]) => n === num)) numbers.push([num, label]);
      }
      while (numbers.length < 2) numbers.push(["", ""]);
      const [[phone, l1], [phone2, l2]] = numbers;
      if (l1 || l2) extra.phone_labels = [l1, l2];
      if (notes.length) extra.phone_notes = notes;
      const tagDnc = /do not (contact|call)|\bdnc\b/.test(get(row, "tags").toLowerCase()) || notes.some((n) => PHONE_DNC.test(n));
      Object.assign(rec, { name, phone, phone2, email: get(row, "email"), do_not_contact: truthy(get(row, "do_not_contact")) || tagDnc, notes: get(row, "notes"), extra });
    }
    records.push(rec);
  });
  return [records, problems];
}

// ---------------- engine ----------------

class Problem extends Error {}
const STATUSES = { new: "Ready to assign", assigned: "Assigned, not called yet", no_answer: "No answer", left_message: "Left message",
  call_back: "Call back", appraisal: "Appraisal booked", won: "Listed with us", not_interested: "Not interested",
  wrong_number: "Wrong number", dnc: "Do not contact" };
const OUTCOMES = {
  no_answer: { label: "No answer", attempt: true }, left_message: { label: "Left message", attempt: true },
  call_back: { label: "Call back later", attempt: true, needs_date: true }, appraisal: { label: "Appraisal booked", attempt: true, needs_date: true },
  won: { label: "Listed with us", attempt: false }, not_interested: { label: "Not interested", attempt: true },
  wrong_number: { label: "Wrong number", attempt: true }, dnc: { label: "Asked not to be contacted", attempt: true },
  note: { label: "Add a note only", attempt: false },
};
const METHODS = { call: "Phone call", sms: "Text message", email: "Email", door: "Door knock", other: "Other" };
const OPEN = new Set(["assigned", "no_answer", "left_message", "call_back", "appraisal"]);
const DEFAULT_SETTINGS = { threshold_days: 70, soon_days: 14, our_agencies: [], date_order: "DMY", stale_after_days: 7,
  timezone: "Australia/Sydney", office_name: "", agreement_days: 90 };

let S;
function freshState() {
  return { settings: { ...DEFAULT_SETTINGS, our_agencies: [] }, agents: [], imports: [], contacts: [], listings: [], leads: [],
    leadContacts: {}, reviews: {}, sheets: [], sheetLeads: [], activity: [], notifications: [], meta: {}, seq: {} };
}
const nextId = (t) => (S.seq[t] = (S.seq[t] || 0) + 1);
let TODAY_OVERRIDE = null;

function zonedParts() {
  try {
    const f = new Intl.DateTimeFormat("en-CA", { timeZone: S.settings.timezone, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
    return Object.fromEntries(f.formatToParts(new Date()).map((p) => [p.type, p.value]));
  } catch {
    const d = new Date();
    return { year: d.getFullYear(), month: pad(d.getMonth() + 1), day: pad(d.getDate()), hour: pad(d.getHours()), minute: pad(d.getMinutes()), second: pad(d.getSeconds()) };
  }
}
function today() { if (TODAY_OVERRIDE) return TODAY_OVERRIDE; const p = zonedParts(); return `${p.year}-${p.month}-${p.day}`; }
function nowIso() { const p = zonedParts(); return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`; }
const normAgency = (t) => String(t || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const isOurs = (agency, ours) => { const a = normAgency(agency); return ours.some((o) => { o = normAgency(o); return o && a.includes(o); }); };
// Owner names on title (RP Data's Owner 1/2/3 Name), same rules as lw/engine.py.
const NAME_NOISE = new Set(["and", "the", "mr", "mrs", "ms", "miss", "dr", "of", "estate", "late"]);
const COMPANY = /\b(pty|ltd|limited|trust|trustee|super|superannuation|holdings|investments|corporation|council|housing|nsw|department)\b/i;
const titleOwners = (x) => ["owner_1", "owner_2", "owner_3"].map((k) => (x || {})[k]).filter(Boolean);
const nameWords = (t) => new Set(String(t || "").toLowerCase().replace(/[^a-z ]/g, " ").split(/\s+/).filter((w) => w.length > 1 && !NAME_NOISE.has(w)));
function nameMatches(name, owners) {
  const people = owners.filter((o) => !COMPANY.test(o));
  if (!people.length) return null;
  const mine = nameWords(name);
  return people.some((o) => [...nameWords(o)].some((w) => mine.has(w)));
}
const contactSig = (name, parts) => String(name || "").toLowerCase().replace(/[^a-z]/g, "") + "@" + addrKey(parts);
const agentById = (id) => S.agents.find((a) => a.id === Number(id));
const listingOf = (lead) => S.listings.find((l) => l.id === lead.listing_id);
const requirePerson = (by) => { if (!String(by || "").trim()) throw new Problem("Choose who you are (top right) before making changes, so the history shows who did what."); return by.trim(); };

let PENDING = null;
function previewImport(kind, filename, bytes) {
  if (!FIELDS[kind]) throw new Problem("Unknown import type.");
  if (/\.(xlsx|xlsm|xls)$/i.test(filename) || (bytes[0] === 0x50 && bytes[1] === 0x4b))
    throw new Problem("The online version reads CSV files only. In Excel use File > Save As > CSV. The installed version reads .xlsx too.");
  const [headers, rows] = readCsv(new TextDecoder().decode(bytes));
  if (!rows.length) throw new Problem("The file has a header row but no data rows.");
  const mapping = guessMapping(kind, headers);
  const token = `${kind}-${Date.now()}`;
  PENDING = { token, kind, filename, headers, rows };
  return { token, kind, filename, headers, sample: rows.slice(0, 6), row_count: rows.length, mapping,
    fields: FIELDS[kind].map(([key, label, required]) => ({ key, label, required })), missing: missingRequired(kind, mapping) };
}
function pending(token) { if (!PENDING || PENDING.token !== token) throw new Problem("That upload has expired. Please choose the file again."); return PENDING; }
function cleanMapping(mapping, headers) {
  const out = {};
  for (const [k, v] of Object.entries(mapping || {})) {
    if (v === null || v === "" || v === undefined) continue;
    const n = Number(v); if (n >= 0 && n < headers.length) out[k] = n;
  }
  return out;
}
function recordExample(kind, r) {
  if (kind === "listings") return { "Address": displayAddr(r.parts), "Agency": r.agency, "Date listed": fmt(r.listed_date), "Price": r.price };
  return { "Owner": r.name, "Address": displayAddr(r.parts), "Phone": r.phone, "Email": r.email, "Do not contact": r.do_not_contact ? "Yes" : "" };
}
function dryRun(token, mapping) {
  const p = pending(token); mapping = cleanMapping(mapping, p.headers);
  const missing = missingRequired(p.kind, mapping);
  if (missing.length) return { missing };
  const t = today();
  const [records, problems] = buildRecords(p.kind, p.headers, p.rows, mapping, t, S.settings.date_order);
  const out = { missing: [], usable: records.length, skipped: problems.length,
    problems: problems.slice(0, 200).map(([row, reason]) => ({ row, reason })), examples: records.slice(0, 5).map((r) => recordExample(p.kind, r)) };
  if (p.kind === "listings") {
    out.ours = records.filter((r) => isOurs(r.agency, S.settings.our_agencies)).length;
    out.over_threshold = records.filter((r) => diffDays(t, r.listed_date) >= S.settings.threshold_days).length;
  }
  return out;
}
function commitImport(token, mapping, full, by) {
  const p = pending(token); mapping = cleanMapping(mapping, p.headers);
  const missing = missingRequired(p.kind, mapping);
  if (missing.length) throw new Problem("These columns still need to be chosen: " + missing.join(", "));
  const t = today();
  const [records, problems] = buildRecords(p.kind, p.headers, p.rows, mapping, t, S.settings.date_order);
  if (!records.length) throw new Problem("No usable rows were found, so nothing was imported. Check the column choices.");
  const imp = { id: nextId("imports"), kind: p.kind, filename: p.filename, imported_at: nowIso(), imported_by: by || "",
    rows_total: p.rows.length, rows_used: 0, rows_skipped: 0, problems: "[]", full_snapshot: full ? 1 : 0 };
  S.imports.push(imp);
  let used = 0;
  if (p.kind === "contacts") {
    if (full) S.contacts = [];
    for (const r of records) S.contacts.push({ id: nextId("contacts"), import_id: imp.id, name: r.name, phone: r.phone, phone2: r.phone2,
      email: r.email, address_raw: r.address_raw, parts: r.parts, block: blockKey(r.parts), do_not_contact: r.do_not_contact ? 1 : 0, notes: r.notes, extra: r.extra || {} });
    used = records.length;
  } else {
    const seen = new Set();
    for (const r of records) {
      const k = addrKey(r.parts);
      if (seen.has(k)) { problems.push([r.row, `Same property appears twice in the file (${displayAddr(r.parts)}). Kept the first row`]); continue; }
      seen.add(k); used++;
      const vals = { address_raw: r.address_raw, parts: r.parts, block: blockKey(r.parts), agency: r.agency, agent: r.agent,
        listed_date: r.listed_date, price: r.price, property_type: r.property_type, bedrooms: r.bedrooms, url: r.url, extra: r.extra || {} };
      const ex = S.listings.find((l) => l.address_key === k);
      if (ex) Object.assign(ex, vals, { last_seen: t, active: 1, off_market_on: null });
      else S.listings.push({ id: nextId("listings"), address_key: k, ...vals, first_seen: t, last_seen: t, active: 1, off_market_on: null });
    }
    if (full) {
      const gone = S.listings.filter((l) => l.active && !seen.has(l.address_key));
      gone.forEach((l) => { l.active = 0; l.off_market_on = t; });
      notifyOffMarket(gone.map((l) => l.id));
    }
  }
  Object.assign(imp, { rows_used: used, rows_skipped: problems.length,
    problems: JSON.stringify(problems.slice(0, 500).map(([row, reason]) => ({ row, reason }))) });
  PENDING = null;
  return { import_id: imp.id, used, skipped: problems.length, ...rebuild() };
}
function notifyOffMarket(listingIds) {
  if (!listingIds.length) return;
  const working = S.leads.filter((l) => listingIds.includes(l.listing_id) && OPEN.has(l.status));
  if (!working.length) return;
  const lines = working.map((l) => `${displayAddr(listingOf(l).parts)} (${agentById(l.agent_id)?.name || "unassigned"}, ${STATUSES[l.status]})`);
  addNotification("off_market", `Stop calling: ${working.length} propert${working.length === 1 ? "y is" : "ies are"} no longer for sale`,
    "Sold or withdrawn since the last import:\n" + lines.join("\n"), working.map((l) => l.id));
}
function rebuild() {
  const t = today(), threshold = Number(S.settings.threshold_days);
  const byBlock = {};
  for (const c of S.contacts) (byBlock[c.block] ||= []).push(c);
  const crossed = [];
  for (const l of [...S.listings].sort((a, b) => a.id - b.id)) {
    let lead = S.leads.find((x) => x.listing_id === l.id);
    if (!lead) {
      lead = { id: nextId("leads"), listing_id: l.id, status: "new", agent_id: null, sheet_id: null, assigned_on: null, follow_up_on: null,
        attempts: 0, last_contact_on: null, eligible_on: null, crossed_notified: 0, seen_below: 0, ours: 0, do_not_contact: 0, created_on: t, updated_at: null };
      S.leads.push(lead);
    }
    const lc = []; let contactDnc = false;
    for (const c of byBlock[l.block] || []) {
      let q = compareAddr(l.parts, c.parts);
      if (!q) continue;
      if (q === "exact" && nameMatches(c.name, titleOwners(l.extra)) === false) q = "name";
      const d = S.reviews[l.address_key + "§" + contactSig(c.name, c.parts)]?.decision;
      if (d === "reject") continue;
      if (d === "confirm") q = "confirmed";
      lc.push({ contact_id: c.id, quality: q });
      contactDnc = contactDnc || !!c.do_not_contact;
    }
    S.leadContacts[lead.id] = lc;
    const ours = isOurs(l.agency, S.settings.our_agencies);
    const days = diffDays(t, l.listed_date);
    if (l.active) {
      if (days < threshold) { lead.seen_below = 1; lead.eligible_on = null; lead.crossed_notified = 0; }
      else if (!lead.crossed_notified) {
        lead.eligible_on = addDays(l.listed_date, threshold);
        if (lead.seen_below && !ours) crossed.push([lead.id, l.parts, l.agency, !!(byBlock[l.block] || []).length]);
        lead.crossed_notified = 1;
      }
    }
    lead.ours = ours ? 1 : 0;
    lead.do_not_contact = contactDnc || lead.status === "dnc" ? 1 : 0;
  }
  if (crossed.length) {
    const withOwner = crossed.filter((c) => c[3]).length;
    const lines = crossed.map(([, p, agency, has]) => `${displayAddr(p)} (${agency})${has ? "" : " - owner not in our database"}`);
    addNotification("crossed", `${crossed.length} propert${crossed.length === 1 ? "y" : "ies"} hit ${threshold} days` +
      (withOwner !== crossed.length ? ` (${withOwner} with owner details)` : ""), lines.join("\n"), crossed.map((c) => c[0]));
  }
  return { crossed: crossed.length };
}
function dailyCheck() {
  const t = today(), result = rebuild(), marker = `daily:${t}`;
  if (S.meta.last_daily === marker) return result;
  const due = S.leads.filter((l) => l.follow_up_on && l.follow_up_on <= t && ["call_back", "appraisal"].includes(l.status))
    .sort((a, b) => (a.follow_up_on < b.follow_up_on ? -1 : 1));
  if (due.length) addNotification("follow_up", `${due.length} follow-up${due.length !== 1 ? "s" : ""} due today or overdue`,
    due.map((l) => `${displayAddr(listingOf(l).parts)}: ${STATUSES[l.status]} ${fmt(l.follow_up_on).replace(/ \d{4}$/, "")} (${agentById(l.agent_id)?.name || "unassigned"})`).join("\n"), due.map((l) => l.id));
  const age = dataAge();
  if (age !== null && age >= S.settings.stale_after_days)
    addNotification("stale", `For-sale data is ${age} days old`, "Import a fresh export of everything currently for sale so the day counts and sold properties are right.");
  S.meta.last_daily = marker;
  return result;
}
function dataAge() {
  const at = S.imports.filter((i) => i.kind === "listings").map((i) => i.imported_at).sort().pop();
  return at ? diffDays(today(), at.slice(0, 10)) : null;
}
function addNotification(kind, title, body = "", leadIds = []) {
  S.notifications.push({ id: nextId("notifications"), created_at: nowIso(), kind, title, body, lead_ids: JSON.stringify(leadIds), read_at: null, emailed: 0 });
}

function leadRow(lead) {
  const l = listingOf(lead);
  return { ...lead, parts: l.parts, address_key: l.address_key, agency: l.agency, listing_agent: l.agent, listed_date: l.listed_date,
    price: l.price, url: l.url, property_type: l.property_type, bedrooms: l.bedrooms, active: l.active, off_market_on: l.off_market_on,
    address_raw: l.address_raw, listing_extra: l.extra || {}, agent_name: agentById(lead.agent_id)?.name || null };
}
function contactsFor(leadId) {
  return (S.leadContacts[leadId] || []).map(({ contact_id, quality }) => {
    const c = S.contacts.find((x) => x.id === contact_id);
    return { id: c.id, name: c.name, phone: c.phone, phone2: c.phone2, email: c.email, quality, do_not_contact: !!c.do_not_contact,
      notes: c.notes, extra: c.extra || {}, address: displayAddr(c.parts), address_raw: c.address_raw };
  }).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}
function blockersFor(r, eligible, match, usable, nameIssue = false) {
  const why = [];
  if (r.ours) why.push("Listed with our agency");
  if (!r.active) why.push("No longer for sale");
  if (!eligible) why.push("Hasn't reached the day threshold");
  if (r.do_not_contact) why.push("Do not contact");
  if (match === "none") why.push("Owner not in our database");
  else if (match === "check") why.push(nameIssue ? "Name doesn't match the owner on title" : "Owner match needs checking");
  else if (!usable.some((c) => c.phone || c.phone2 || c.email)) why.push("No phone or email on file");
  if (r.status !== "new") why.push(`Already ${STATUSES[r.status].toLowerCase()}` + (r.agent_name ? ` (${r.agent_name})` : ""));
  return why;
}
function serialize(leads) {
  const t = today(), threshold = Number(S.settings.threshold_days);
  return leads.map((lead) => {
    const r = leadRow(lead), p = r.parts, days = diffDays(t, r.listed_date);
    const cs = contactsFor(r.id), usable = cs.filter((c) => c.quality === "exact" || c.quality === "confirmed");
    const match = usable.length ? "confirmed" : cs.length ? "check" : "none";
    const blockers = blockersFor(r, days >= threshold, match, usable, cs.some((c) => c.quality === "name"));
    let label = STATUSES[r.status];
    if (r.status === "new") {
      if (r.ours) label = "Our listing";
      else if (!r.active) label = "Off the market";
      else if (days < threshold) label = "Watchlist";
      else if (blockers.length) label = "Not ready: " + blockers[0].toLowerCase();
    }
    return {
      id: r.id, address: displayAddr(p), address_raw: r.address_raw, suburb: title(p.suburb),
      street_sort: `${p.suburb} ${p.street} ${p.number.padStart(6)} ${p.unit.padStart(6)}`,
      agency: r.agency, listing_agent: r.listing_agent, price: r.price, url: r.url, property_type: r.property_type, bedrooms: r.bedrooms, extra: r.listing_extra,
      listed_date: r.listed_date, days, hits_on: addDays(r.listed_date, threshold), days_to_go: Math.max(0, threshold - days),
      eligible: days >= threshold, just_hit: !!r.seen_below && threshold <= days && days <= threshold + 3,
      for_sale: !!r.active, off_market_on: r.off_market_on, status: r.status, status_label: label,
      agent_id: r.agent_id, agent_name: r.agent_name, sheet_id: r.sheet_id, assigned_on: r.assigned_on, follow_up_on: r.follow_up_on,
      follow_up_due: !!r.follow_up_on && r.follow_up_on <= t && ["call_back", "appraisal"].includes(r.status),
      attempts: r.attempts, last_contact_on: r.last_contact_on, do_not_contact: !!r.do_not_contact, ours: !!r.ours,
      contacts: cs, match, has_phone: usable.some((c) => c.phone || c.phone2), blockers,
    };
  });
}
const cmp = (a, b) => { for (let i = 0; i < a.length; i++) { if (a[i] < b[i]) return -1; if (a[i] > b[i]) return 1; } return 0; };
function leadsView(view) {
  const rows = serialize(S.leads);
  if (view === "ready") return rows.filter((l) => l.eligible && l.for_sale && !l.ours && l.status === "new").sort((a, b) => cmp([-a.days, a.street_sort], [-b.days, b.street_sort]));
  if (view === "watch") return rows.filter((l) => !l.eligible && l.for_sale && !l.ours).sort((a, b) => cmp([a.days_to_go, a.street_sort], [b.days_to_go, b.street_sort]));
  if (view === "tracker") {
    const rank = { call_back: 0, appraisal: 1, assigned: 2, no_answer: 3, left_message: 4, won: 5, not_interested: 6, wrong_number: 7, dnc: 8 };
    const key = (l) => [OPEN.has(l.status) && !l.for_sale ? 0 : 1, l.follow_up_due ? 0 : 1, rank[l.status] ?? 9, l.follow_up_on || "9999", l.street_sort];
    return rows.filter((l) => l.status !== "new").sort((a, b) => cmp(key(a), key(b)));
  }
  return rows;
}
function leadDetail(id) {
  const lead = S.leads.find((l) => l.id === id);
  if (!lead) throw new Problem("That property no longer exists.");
  const out = serialize([lead])[0], l = listingOf(lead);
  const candidates = [];
  for (const c of S.contacts.filter((c) => c.block === blockKey(l.parts))) {
    let q = compareAddr(l.parts, c.parts);
    if (!q) continue;
    if (q === "exact" && nameMatches(c.name, titleOwners(l.extra)) === false) q = "name";
    candidates.push({ id: c.id, name: c.name, address: displayAddr(c.parts), address_raw: c.address_raw, quality: q,
      decision: S.reviews[l.address_key + "§" + contactSig(c.name, c.parts)]?.decision || null });
  }
  out.candidates = candidates;
  out.listing_address = displayAddr(l.parts);
  out.owners_on_title = titleOwners(l.extra);
  out.activity = S.activity.filter((a) => a.lead_id === id).sort((a, b) => b.id - a.id).map((a) => ({ ...a, prev: null }));
  out.sheets = S.sheetLeads.filter((s) => s.lead_id === id).map((s) => S.sheets.find((x) => x.id === s.sheet_id))
    .sort((a, b) => b.id - a.id).map((s) => ({ id: s.id, created_at: s.created_at, agent: agentById(s.agent_id).name }));
  return out;
}
function summary() {
  const rows = serialize(S.leads), active = rows.filter((l) => l.for_sale && !l.ours);
  const ready = active.filter((l) => l.eligible && l.status === "new");
  const last = (k) => { const i = [...S.imports].reverse().find((x) => x.kind === k); return i ? { imported_at: i.imported_at, filename: i.filename } : null; };
  return {
    today: today(), settings: { ...S.settings }, data_age_days: dataAge(),
    counts: {
      ready_to_assign: ready.filter((l) => !l.blockers.length).length,
      needs_check: ready.filter((l) => l.match === "check" && !l.do_not_contact).length,
      no_owner: ready.filter((l) => l.match === "none").length,
      just_hit: active.filter((l) => l.just_hit && l.status === "new").length,
      hitting_soon: active.filter((l) => !l.eligible && l.days_to_go <= Number(S.settings.soon_days)).length,
      watching: active.filter((l) => !l.eligible).length,
      follow_ups_due: rows.filter((l) => l.follow_up_due).length,
      in_progress: rows.filter((l) => OPEN.has(l.status)).length,
      stop_calling: rows.filter((l) => OPEN.has(l.status) && !l.for_sale).length,
      won: rows.filter((l) => l.status === "won").length,
      listings: rows.length, ours: rows.filter((l) => l.ours && l.for_sale).length, contacts: S.contacts.length,
    },
    last_import: { listings: last("listings"), contacts: last("contacts") },
    unread: S.notifications.filter((n) => !n.read_at).length,
  };
}
function log(leadId, by, kind, { outcome = null, method = null, note = "", follow_up_on = null, prev = {} } = {}) {
  S.activity.push({ id: nextId("activity"), lead_id: leadId, at: nowIso(), by, kind, outcome, method, note, follow_up_on, prev: JSON.stringify(prev) });
}
function reviewMatch(leadId, contactId, decision, by) {
  by = requirePerson(by);
  if (!["confirm", "reject", "clear"].includes(decision)) throw new Problem("Unknown decision.");
  const lead = S.leads.find((l) => l.id === leadId), c = S.contacts.find((x) => x.id === Number(contactId));
  if (!lead || !c) throw new Problem("That property or contact no longer exists. Refresh the page.");
  const k = listingOf(lead).address_key + "§" + contactSig(c.name, c.parts);
  if (decision === "clear") delete S.reviews[k]; else S.reviews[k] = { decision, decided_by: by, decided_at: nowIso() };
  log(leadId, by, "match", { note: `${{ confirm: "Confirmed", reject: "Rejected", clear: "Cleared the decision on" }[decision]} ${c.name} as the owner` });
  rebuild();
}
function createSheet(agentId, leadIds, by, note = "") {
  by = requirePerson(by);
  const agent = S.agents.find((a) => a.id === Number(agentId) && a.active);
  if (!agent) throw new Problem("Choose which agent this contact sheet is for.");
  leadIds = [...new Set((leadIds || []).map(Number))];
  if (!leadIds.length) throw new Problem("Tick at least one property to put on the sheet.");
  const found = S.leads.filter((l) => leadIds.includes(l.id));
  if (found.length !== leadIds.length) throw new Problem("Some of those properties no longer exist. Refresh the page and try again.");
  const leads = serialize(found);
  const bad = leads.filter((l) => l.blockers.length).map((l) => `${l.address}: ${l.blockers.join(", ")}`);
  if (bad.length) throw new Problem("Nothing was assigned. These can't go on a sheet:\n" + bad.join("\n"));
  const sheet = { id: nextId("sheets"), agent_id: agent.id, created_at: nowIso(), created_by: by, note };
  S.sheets.push(sheet);
  const t = today();
  leads.sort((a, b) => cmp([-a.days, a.street_sort], [-b.days, b.street_sort])).forEach((l, i) => {
    S.sheetLeads.push({ sheet_id: sheet.id, lead_id: l.id, position: i + 1 });
    Object.assign(S.leads.find((x) => x.id === l.id), { status: "assigned", agent_id: agent.id, sheet_id: sheet.id, assigned_on: t, updated_at: nowIso() });
    log(l.id, by, "assign", { note: `Put on contact sheet #${sheet.id} for ${agent.name}`, prev: { status: "new" } });
  });
  return sheet.id;
}
function logOutcome(leadId, outcome, by, method = "call", note = "", followUp = null) {
  by = requirePerson(by);
  if (!OUTCOMES[outcome]) throw new Problem("Choose what happened.");
  if (!METHODS[method]) throw new Problem("Choose how you made contact.");
  const lead = S.leads.find((l) => l.id === leadId);
  if (!lead) throw new Problem("That property no longer exists.");
  if (lead.status === "new" && outcome !== "note") throw new Problem("This property isn't on anyone's contact sheet yet. Assign it first so two agents don't call the same owner.");
  const spec = OUTCOMES[outcome], t = today();
  if (spec.needs_date) {
    const d = followUp ? parseDate(followUp) : null;
    if (!d) throw new Problem(`'${spec.label}' needs a date.`);
    if (d < t) throw new Problem("That date is in the past. Choose today or a later date.");
    followUp = d;
  } else followUp = null;
  note = String(note || "").trim();
  if (outcome === "note" && !note) throw new Problem("Type the note first.");
  const prev = { status: lead.status, follow_up_on: lead.follow_up_on, attempts: lead.attempts, last_contact_on: lead.last_contact_on, do_not_contact: lead.do_not_contact };
  if (outcome === "note") { log(leadId, by, "note", { note, prev }); return; }
  Object.assign(lead, { status: outcome, follow_up_on: followUp, attempts: lead.attempts + (spec.attempt ? 1 : 0), last_contact_on: t,
    do_not_contact: lead.do_not_contact || outcome === "dnc" ? 1 : 0, updated_at: nowIso() });
  log(leadId, by, "outcome", { outcome, method, note, follow_up_on: followUp, prev });
}
function undoLast(leadId, by) {
  by = requirePerson(by);
  const acts = S.activity.filter((a) => a.lead_id === leadId).sort((a, b) => b.id - a.id);
  const last = acts.find((a) => a.kind === "outcome" || a.kind === "note");
  if (!last || last.id !== acts[0].id) throw new Problem("Only the most recent outcome or note can be undone.");
  const prev = JSON.parse(last.prev || "{}");
  if (last.kind === "outcome" && Object.keys(prev).length) Object.assign(S.leads.find((l) => l.id === leadId), prev, { updated_at: nowIso() });
  S.activity = S.activity.filter((a) => a.id !== last.id);
  log(leadId, by, "undo", { note: `Undid '${OUTCOMES[last.outcome || "note"]?.label || "note"}' logged by ${last.by} at ${last.at.slice(0, 16)}` });
  rebuild();
}
function reassign(leadId, agentId, by) {
  by = requirePerson(by);
  const lead = S.leads.find((l) => l.id === leadId), agent = S.agents.find((a) => a.id === Number(agentId) && a.active);
  if (!lead || !agent) throw new Problem("Choose an agent.");
  if (lead.status === "new") throw new Problem("Put this property on a contact sheet instead.");
  const old = agentById(lead.agent_id);
  Object.assign(lead, { agent_id: agent.id, updated_at: nowIso() });
  log(leadId, by, "assign", { note: `Moved from ${old ? old.name : "nobody"} to ${agent.name}` });
}
function release(leadId, by, reason = "") {
  by = requirePerson(by);
  const lead = S.leads.find((l) => l.id === leadId);
  if (!lead) throw new Problem("That property no longer exists.");
  if (lead.status === "dnc" || lead.do_not_contact) throw new Problem("This owner asked not to be contacted, so it can't go back in the pool.");
  Object.assign(lead, { status: "new", agent_id: null, sheet_id: null, assigned_on: null, follow_up_on: null, updated_at: nowIso() });
  log(leadId, by, "release", { note: "Returned to the pool" + (reason ? `: ${reason}` : "") });
}
function sheet(id) {
  const s = S.sheets.find((x) => x.id === id);
  if (!s) throw new Problem("That contact sheet doesn't exist.");
  const agent = agentById(s.agent_id);
  const ids = S.sheetLeads.filter((x) => x.sheet_id === id).sort((a, b) => a.position - b.position).map((x) => x.lead_id);
  const byId = Object.fromEntries(serialize(S.leads.filter((l) => ids.includes(l.id))).map((l) => [l.id, l]));
  return { ...s, agent: agent.name, agent_phone: agent.phone, leads: ids.map((i) => ({ ...byId[i], moved: byId[i].sheet_id !== id })) };
}
function sheetsList() {
  return [...S.sheets].sort((a, b) => b.id - a.id).map((s) => {
    const leads = S.sheetLeads.filter((x) => x.sheet_id === s.id).map((x) => S.leads.find((l) => l.id === x.lead_id));
    const on = leads.filter((l) => l.sheet_id === s.id);
    return { ...s, agent: agentById(s.agent_id).name, total: leads.length,
      not_called: on.filter((l) => l.status === "assigned").length,
      working: on.filter((l) => ["no_answer", "left_message", "call_back", "appraisal"].includes(l.status)).length,
      done: on.filter((l) => ["won", "not_interested", "wrong_number", "dnc"].includes(l.status)).length };
  });
}
function saveAgent(name, phone = "", id = null, active = true) {
  name = String(name || "").trim();
  if (!name) throw new Problem("Type the agent's name.");
  if (S.agents.some((a) => a.name.toLowerCase() === name.toLowerCase() && a.id !== id)) throw new Problem(`There is already an agent called ${name}.`);
  if (id) Object.assign(agentById(id), { name, phone, active: active ? 1 : 0 });
  else S.agents.push({ id: nextId("agents"), name, phone, active: 1 });
}
function saveSettings(body, by) {
  requirePerson(by);
  const c = {};
  if ("threshold_days" in body) { const t = parseInt(body.threshold_days, 10); if (!(t >= 1 && t <= 365)) throw new Problem("The day threshold must be between 1 and 365."); c.threshold_days = t; }
  if ("agreement_days" in body) { const a = parseInt(body.agreement_days || 0, 10); if (!(a >= 0 && a <= 365)) throw new Problem("The agreement length must be between 0 and 365 days (0 turns the estimate off)."); c.agreement_days = a; }
  if ("soon_days" in body) c.soon_days = Math.max(1, Math.min(60, parseInt(body.soon_days, 10) || 14));
  if ("stale_after_days" in body) c.stale_after_days = Math.max(1, Math.min(60, parseInt(body.stale_after_days, 10) || 7));
  if ("our_agencies" in body) { let n = body.our_agencies; if (typeof n === "string") n = n.split("\n"); c.our_agencies = n.map((x) => x.trim()).filter(Boolean); }
  if ("date_order" in body) { if (!["DMY", "MDY"].includes(body.date_order)) throw new Problem("Unknown date order."); c.date_order = body.date_order; }
  if ("office_name" in body) c.office_name = String(body.office_name).trim().slice(0, 80);
  if ("timezone" in body) {
    try { new Intl.DateTimeFormat("en", { timeZone: body.timezone }); } catch { throw new Problem(`Unknown time zone '${body.timezone}'. Use a name like Australia/Sydney.`); }
    c.timezone = body.timezone;
  }
  Object.assign(S.settings, c);
  rebuild();
}

// ---------------- the printed sheet, as an in-page preview ----------------

const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const daysPhrase = (n) => (n === 0 ? "today" : n > 0 ? `in ${n} day${n !== 1 ? "s" : ""}` : `${-n} day${n !== -1 ? "s" : ""} ago`);
const longDate = (iso) => { const [y, m, d] = iso.split("-").map(Number); return `${DOW[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]} ${d} ${MON[m - 1]} ${y}`; };
function propertyLine(l) {
  const x = l.extra || {}, beds = l.bedrooms && l.bedrooms !== "-" ? l.bedrooms : "";
  return [beds ? `${beds} bed` : "", x.bathrooms ? `${x.bathrooms} bath` : "", x.car_spaces ? `${x.car_spaces} car` : "", l.property_type || "", x.land_size ? `${x.land_size}m²` : ""].filter(Boolean).join(" · ");
}
function howWeKnow(c) {
  const x = c.extra || {};
  const tags = String(x.tags || "").split(/[,;|]/).map((t) => t.trim()).filter((t) => t && !/do not (contact|call)|\bdnc\b/i.test(t));
  return ["In our database", ...tags.slice(0, 6), x.source ? `source: ${x.source}` : ""].filter(Boolean).join(" · ");
}
// Same page as approach_pages() in lw/server.py.
function approachPages(leads, label, sheetId) {
  const st = S.settings, T = Number(st.threshold_days), agreement = Number(st.agreement_days || 0), t = today();
  const office = (st.office_name || "").trim();
  const lastImport = S.imports.filter((i) => i.kind === "listings").map((i) => i.imported_at).sort().pop();
  const box = '<span class="box"></span>';
  return leads.map((l, i) => {
    const x = l.extra || {};
    let status;
    if (!l.for_sale) status = '<div class="status stop">NO LONGER FOR SALE. DO NOT CALL.</div>';
    else if (l.do_not_contact) status = '<div class="status stop">DO NOT CONTACT THIS OWNER.</div>';
    else if (l.moved) status = `<div class="status stop">MOVED OFF THIS SHEET. DO NOT CALL.<small>${l.agent_name ? esc("Now with " + l.agent_name) : ""}</small></div>`;
    else if (!l.eligible) status = `<div class="status hold">DO NOT CALL BEFORE ${longDate(l.hits_on).toUpperCase()}<small>Listed ${l.days} days. It reaches ${T} days on that date.</small></div>`;
    else status = `<div class="status go">READY TO CALL<small>Listed ${l.days} days with another agency</small></div>`;
    let asking = esc(l.price || "Not shown");
    if (x.first_price && x.first_price !== l.price) asking += ` <small>(first listed at ${esc(x.first_price)})</small>`;
    const rows = [["Property", esc(propertyLine(l)) || "Not shown"], ["Asking now", asking], ["On the market", `${l.days} days`],
      ["First listed", esc(longDate(l.listed_date))], ["Currently with", esc(l.agency + (l.listing_agent ? ` · ${l.listing_agent}` : ""))]];
    if (x.listing_type) rows.push(["Sale method", esc(x.listing_type)]);
    if (x.owner_type) rows.push(["Owner type", esc(x.owner_type)]);
    if (agreement) {
      const ends = addDays(l.listed_date, agreement), gap = diffDays(ends, t);
      rows.push(["Agency agreement", `Estimated to ${gap >= 0 ? "lapse" : "have lapsed"} ${esc(longDate(ends))}, ${daysPhrase(gap)} <small>(assumes ${agreement} days)</small>`]);
    }
    if (l.url) rows.push(["Listing", `<span class="link">${esc(l.url)}</span>`]);
    const owners = l.contacts.filter((c) => c.quality === "exact" || c.quality === "confirmed").map((c) => {
      const cx = c.extra || {}, labels = cx.phone_labels || ["", ""], pn = cx.phone_notes || [];
      const warns = pn.filter((n) => PHONE_DANGER.test(n)).map((n) => `<div class="warn">CRM phone note: ${esc(n.replace(/[.\s]+$/, ""))}.${/deceas|passed away|died/i.test(n) ? " Do not ask for this person." : ""}</div>`).join("");
      let phones = [[c.phone, labels[0]], [c.phone2, labels[1]]].filter(([p]) => p).map(([p, lab]) => `<div class="phone">${esc(p)}${lab ? `<small>${esc(lab)}</small>` : ""}</div>`).join("");
      phones += pn.filter((n) => !PHONE_DANGER.test(n)).map((n) => `<div class="pnote">Note in CRM phone field: ${esc(n)}</div>`).join("");
      const orow = [["Owner", `<b>${esc(c.name)}</b>`], ["Phone", phones || '<b style="color:#b3261e">No phone on file</b>']];
      if (c.email) orow.push(["Email", esc(c.email)]);
      const onTitle = titleOwners(x);
      if (onTitle.length) {
        const ok = nameMatches(c.name, onTitle);
        const verdict = ok === true ? "matches our contact" : ok === false ? '<b style="color:#b3261e">does not match our contact</b>' : "company owner, check before calling";
        orow.push(["Owner on title", `${esc(onTitle.join(", "))} <small>(RP Data, ${verdict})</small>`]);
      }
      orow.push(["How we know them", esc(howWeKnow(c))]);
      if (cx.contact_owner) orow.push(["Contact owner", esc(cx.contact_owner)]);
      let callout = "";
      if (cx.last_note) {
        const when = String(cx.last_note_at || "").slice(0, 10);
        const meta = [/^\d{4}-\d{2}-\d{2}$/.test(when) ? longDate(when) : when, cx.last_note_by || ""].filter(Boolean).join(", ");
        let note = cx.last_note.trim().replace(/\n/g, " ");
        if (note.length > 320) note = note.slice(0, 317).replace(/\s+\S*$/, "") + "...";
        const street = parseAddr(l.address).street;
        const caution = street && cx.last_note.toLowerCase().includes(street) ? "" :
          `<div class="ln-warn">This note doesn't mention ${esc(title(street) || "this street")}. It is the latest note on the person and may be about another property or about them as a buyer.</div>`;
        callout = `<div class="lastnote"><div class="ln-head"><span>Read before calling</span><span>Last note on this contact${meta ? " · " + esc(meta) : ""}</span></div><div class="ln-text">"${esc(note)}"</div>${caution}</div>`;
      }
      orow.push(["In our CRM as", `<small>${esc(c.address_raw.split(/\s+/).join(" "))}</small>`]);
      return `<div class="owner">${warns}<dl>${orow.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("")}</dl>${callout}</div>`;
    }).join("");
    const right = [lastImport ? `For-sale data to ${Number(lastImport.slice(8, 10))} ${MON[Number(lastImport.slice(5, 7)) - 1]} ${lastImport.slice(0, 4)}` : "", sheetId ? `Sheet #${sheetId}` : "", `${i + 1} of ${leads.length}`].filter(Boolean).join(" · ");
    const [street, ...rest] = l.address.split(", ");
    return `<section class="sheet"><div class="top"><span>${esc(office ? office.toUpperCase() + " · " : "")}Approach sheet</span><span>${esc(right)}</span></div>
<h1>${esc(street)}</h1><div class="suburb">${esc(rest.join(", "))}</div>${status}
<h2>The listing</h2><dl>${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("")}</dl>
<h2>The owner</h2>${owners || "<p>No confirmed owner.</p>"}
<h2>Before you make contact</h2><div class="checks"><div>${box}Checked against the Do Not Call Register</div><div>${box}Confirmed it is still on the market</div><div>${box}Checked the agreement has lapsed</div><div>${box}Read the "Read before calling" note</div></div>
<div class="given"><div>Agent: ${esc(label || "")}</div><div>Date given:</div></div>
<h2>The call</h2><table class="log"><tr><th style="width:24%">Date and time</th><th style="width:26%">Number called</th><th>What happened</th></tr>${"<tr><td></td><td></td><td></td></tr>".repeat(3)}</table>
<div class="outcomes">${["No answer", "Left message", "Call back on ________", "Appraisal booked ________", "Not interested", "Wrong number", "Asked not to be contacted"].map((o) => `<span>${box}${o}</span>`).join("")}</div>
<div class="lines"><div></div><div></div></div>
<div class="foot">Owner matched on the exact property address in our CRM. Log every call in Listing Watch the same day, including no answers. Lead #${l.id}.</div></section>`;
  }).join("");
}
function renderSheet(id) { const s = sheet(id); return approachPages(s.leads, s.agent, s.id); }

// ---------------- made-up demo data (port of lw/demo.py) ----------------

const SUBURBS = [["Northvale", "2990"], ["Easton Park", "2991"], ["Riverbend", "2992"], ["Hillcrest Bay", "2993"]];
const STREETS = ["Banksia St", "Wattle Ave", "Harbour Rd", "Kingfisher Cres", "Ironbark Dr", "Seaview Pde", "Fig Tree Lane", "Grevillea Cl", "Station St", "Paperbark Way", "Jacaranda Ct", "Lighthouse Tce"];
const FIRST = ["Alex", "Sam", "Jordan", "Taylor", "Casey", "Morgan", "Riley", "Jamie", "Avery", "Quinn", "Drew", "Harper", "Rowan", "Sydney", "Blake", "Emerson", "Reese", "Parker", "Hayden", "Logan"];
const LAST = ["Example", "Sample", "Placeholder", "Testcase", "Demo", "Mockley", "Fictional", "Madeup", "Pretend", "Notreal"];
const AGENCIES = ["Example Realty", "Sample Property Group", "Placeholder Estate Agents", "Demo Homes & Land"];
const OUR_AGENCY = "Our Agency (demo)";
const TYPES = [["House", "3"], ["House", "4"], ["Unit", "2"], ["Townhouse", "3"], ["Unit", "1"], ["House", "5"]];
const PRICES = ["Contact agent", "Offers over $1,200,000", "$850,000 - $900,000", "Auction", "$1,450,000"];
const DAYS = [112, 98, 91, 84, 77, 74, 70, 70, 69, 69, 69, 66, 60, 58, 52, 45, 40, 33, 28, 21, 15, 9, 4, 120, 88, 73, 101, 64, 57, 81];
const toCsv = (rows) => rows.map((r) => r.map((c) => `"${String(c).replaceAll('"', '""')}"`).join(",")).join("\n") + "\n";

function demoFiles(t) {
  const listings = [["Address", "Suburb", "State", "Postcode", "Agency", "Agent", "Date Listed", "Price", "Property Type", "Bedrooms", "Link"]];
  const contacts = [["First Name", "Surname", "Mobile", "Email", "Street Address", "Suburb", "Postcode", "Do Not Call", "Notes"]];
  DAYS.forEach((dom, i) => {
    const [suburb, pc] = SUBURBS[i % SUBURBS.length], street = STREETS[(i * 5) % STREETS.length];
    const num = 3 + (i * 7) % 90, unit = i % 6 === 2 ? String(1 + i % 9) : "";
    const [ptype, beds] = TYPES[i % TYPES.length];
    const agency = i % 11 === 5 ? OUR_AGENCY : AGENCIES[i % AGENCIES.length];
    listings.push([unit ? `${unit}/${num} ${street}` : `${num} ${street}`, suburb, "NSW", pc, agency,
      `${FIRST[(i + 3) % FIRST.length]} ${LAST[(i + 5) % LAST.length]}`, fmt(addDays(t, -dom), "dmy"), PRICES[(i * 3) % PRICES.length], ptype, beds, ""]);
    if (i % 7 === 6) return;
    const long = street.replaceAll(" St", " Street").replaceAll(" Ave", " Avenue").replaceAll(" Rd", " Road").replaceAll(" Cres", " Crescent")
      .replaceAll(" Dr", " Drive").replaceAll(" Pde", " Parade").replaceAll(" Cl", " Close").replaceAll(" Ct", " Court").replaceAll(" Tce", " Terrace");
    const first = FIRST[i % FIRST.length], last = LAST[i % LAST.length];
    const row = [first, last, `0491 570 ${pad(100 + i, 3)}`, `${first.toLowerCase()}.${last.toLowerCase()}@example.com`,
      unit ? `Unit ${unit}, ${num} ${long}` : `${num} ${long}`, i % 9 === 4 ? "" : suburb, pc, i % 13 === 12 ? "Yes" : "", ""];
    contacts.push(row);
    if (i % 8 === 3) contacts.push([FIRST[(i + 9) % FIRST.length], last, `0491 570 ${pad(200 + i, 3)}`, "", row[4], row[5], row[6], row[7], ""]);
  });
  for (let j = 0; j < 25; j++) {
    const [suburb, pc] = SUBURBS[j % SUBURBS.length];
    contacts.push([FIRST[(j + 7) % FIRST.length], LAST[(j + 2) % LAST.length], `0491 570 ${pad(300 + j, 3)}`, "", `${200 + j} ${STREETS[j % STREETS.length]}`, suburb, pc, "", ""]);
  }
  return { contacts: toCsv(contacts), listings: toCsv(listings) };
}
function loadDemo() {
  S = freshState();
  Object.assign(S.settings, { our_agencies: [OUR_AGENCY], office_name: "Demo office" });
  ["Alex Example", "Sam Sample", "Jordan Placeholder"].forEach((n) => saveAgent(n));
  const real = today(), yesterday = addDays(real, -1);
  TODAY_OVERRIDE = yesterday;
  try {
    const files = demoFiles(real), enc = new TextEncoder();
    for (const [kind, name] of [["contacts", "our-database.csv"], ["listings", "for-sale.csv"]]) {
      const p = previewImport(kind, name, enc.encode(files[kind]));
      commitImport(p.token, p.mapping, true, "Demo setup");
    }
    S.imports.forEach((i) => (i.imported_at = `${yesterday} 09:00:00`));
    S.notifications = [];
  } finally { TODAY_OVERRIDE = null; }
  dailyCheck();
  const ready = leadsView("ready").filter((l) => !l.blockers.length);
  if (ready.length >= 4) {
    createSheet(1, ready.slice(0, 4).map((l) => l.id), "Demo setup");
    logOutcome(ready[0].id, "call_back", "Alex Example", "call", "Said their agency agreement ends soon. Call back then.", real);
    logOutcome(ready[1].id, "no_answer", "Alex Example", "call");
  }
}

// ---------------- request router ----------------

function route(method, path, qs, body, person) {
  const json = () => (body ? JSON.parse(new TextDecoder().decode(body)) : {});
  let m;
  if (method === "GET") {
    if (path === "/api/summary") return summary();
    if (path === "/api/meta") return { statuses: STATUSES, outcomes: OUTCOMES, methods: METHODS };
    if (path === "/api/leads") return leadsView(qs.get("view") || "ready");
    if (path === "/api/agents") return [...S.agents].sort((a, b) => cmp([-a.active, a.name.toLowerCase()], [-b.active, b.name.toLowerCase()]));
    if (path === "/api/sheets") return sheetsList();
    if (path === "/api/notifications") return [...S.notifications].sort((a, b) => b.id - a.id).slice(0, 100);
    if (path === "/api/imports") return [...S.imports].sort((a, b) => b.id - a.id).slice(0, 50);
    if ((m = path.match(/^\/api\/leads\/(\d+)$/))) return leadDetail(+m[1]);
    if ((m = path.match(/^\/api\/sheets\/(\d+)$/))) return sheet(+m[1]);
    return undefined;
  }
  if (path === "/api/import/preview") return previewImport(qs.get("kind") || "", qs.get("filename") || "upload.csv", new Uint8Array(body || new ArrayBuffer(0)));
  const b = json();
  if (path === "/api/import/check") return dryRun(b.token, b.mapping);
  if (path === "/api/import/commit") return commitImport(b.token, b.mapping, b.full_snapshot !== false, person);
  if (path === "/api/sheets") return { sheet_id: createSheet(b.agent_id, b.lead_ids || [], person, b.note || "") };
  if (path === "/api/agents") { saveAgent(b.name, b.phone || "", b.id || null, b.active !== false); return null; }
  if (path === "/api/settings") { saveSettings(b, person); return null; }
  if (path === "/api/notifications/read") { S.notifications.forEach((n) => { if (!n.read_at) n.read_at = nowIso(); }); return null; }
  if (path === "/api/rebuild") return dailyCheck();
  if ((m = path.match(/^\/api\/leads\/(\d+)\/(\w+)$/))) {
    const id = +m[1];
    const actions = {
      log: () => logOutcome(id, b.outcome, person, b.method || "call", b.note || "", b.follow_up_on),
      undo: () => undoLast(id, person), release: () => release(id, person, b.reason || ""),
      reassign: () => reassign(id, b.agent_id, person), match: () => reviewMatch(id, b.contact_id, b.decision, person),
    };
    if (actions[m[2]]) { actions[m[2]](); return null; }
  }
  return undefined;
}

// The real build embeds an export as window.LW_SEED; the demo build doesn't.
function loadSeed(seed) {
  S = freshState();
  Object.assign(S.settings, seed.settings || {});
  // Import as of the export's own date, then run today's check, so anything
  // that reached the threshold since the export raises a notification.
  TODAY_OVERRIDE = seed.date;
  try {
    const p = previewImport("listings", "seed.csv", new TextEncoder().encode(seed.csv));
    commitImport(p.token, p.mapping, true, seed.source);
    S.imports.forEach((i) => Object.assign(i, { imported_at: seed.imported_at, filename: seed.filename }));
    S.notifications = [];
  } finally { TODAY_OVERRIDE = null; }
  dailyCheck();
}
if (window.LW_SEED) loadSeed(window.LW_SEED); else loadDemo();
const realFetch = window.fetch ? window.fetch.bind(window) : null;
window.fetch = async function (input, opts = {}) {
  const url = new URL(typeof input === "string" ? input : input.url, "http://demo.local");
  if (!url.pathname.startsWith("/api/")) return realFetch(input, opts);
  const method = (opts.method || "GET").toUpperCase();
  let person = "";
  try { person = decodeURIComponent((opts.headers || {})["X-Person"] || ""); } catch {}
  let body = opts.body;
  if (typeof body === "string") body = new TextEncoder().encode(body).buffer;
  const backup = method === "POST" ? structuredClone(S) : null;
  const reply = (status, data) => new Response(JSON.stringify(data ?? { ok: true }), { status, headers: { "Content-Type": "application/json" } });
  try {
    const out = route(method, url.pathname, url.searchParams, body, person);
    if (out === undefined) return reply(404, { error: "Not found" });
    return reply(200, out);
  } catch (e) {
    if (backup) S = backup; // all or nothing, like a database transaction
    if (e instanceof Problem) return reply(400, { error: e.message });
    console.error(e);
    return reply(500, { error: `${e.name}: ${e.message}` });
  }
};

// Printouts and spreadsheet downloads are links in the real app. Handle them here.
document.addEventListener("click", (e) => {
  const a = e.target.closest && e.target.closest("a[href]");
  if (!a) return;
  const href = a.getAttribute("href");
  let m;
  if ((m = href.match(/^\/sheet\/(\d+)\/print$/))) {
    e.preventDefault(); e.stopPropagation();
    try {
      document.getElementById("paper-body").innerHTML = renderSheet(+m[1]);
      document.getElementById("paper").hidden = false;
    } catch (err) { console.error(err); }
  } else if (/^\/(sheet\/\d+\.csv|export\/)/.test(href)) {
    e.preventDefault(); e.stopPropagation();
    if (typeof showModal === "function") showModal(`<h2>Spreadsheet downloads</h2><p>The online version can't save files to your computer. In the installed version this button downloads the list as a spreadsheet that opens in Excel or Numbers.</p><div class="row end"><button class="btn" data-close>OK</button></div>`);
  }
}, true);
document.addEventListener("click", (e) => { if (e.target.closest && e.target.closest("[data-paper-close]")) document.getElementById("paper").hidden = true; });
})();
