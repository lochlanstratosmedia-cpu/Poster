"""Australian street address parsing and matching.

Two data sets rarely write an address the same way ("Unit 3, 12 Smith Street"
against "3/12 Smith St"), so both sides are reduced to the same parts before
they are compared. A match is only "exact" when every part agrees. Anything
weaker is "check" and needs a person to confirm it.
"""

import re

STATES = {"nsw", "vic", "qld", "sa", "wa", "tas", "nt", "act"}

# Every spelling maps to one canonical short form.
_STREET_TYPES = {
    "st": ["street", "st", "str"],
    "rd": ["road", "rd"],
    "ave": ["avenue", "ave", "av"],
    "dr": ["drive", "dr", "drv"],
    "ct": ["court", "ct", "crt"],
    "cres": ["crescent", "cres", "cr", "cresc"],
    "pl": ["place", "pl"],
    "pde": ["parade", "pde"],
    "ln": ["lane", "ln"],
    "cl": ["close", "cl"],
    "tce": ["terrace", "tce", "terr"],
    "bvd": ["boulevard", "boulevarde", "bvd", "blvd", "bvde"],
    "hwy": ["highway", "hwy"],
    "cct": ["circuit", "cct", "cir"],
    "way": ["way", "wy"],
    "gr": ["grove", "gr", "gve"],
    "sq": ["square", "sq"],
    "esp": ["esplanade", "esp"],
    "pkwy": ["parkway", "pkwy"],
    "glen": ["glen", "gln"],
    "rise": ["rise"],
    "walk": ["walk", "wlk"],
    "mews": ["mews"],
    "row": ["row"],
    "view": ["view", "vw"],
    "vista": ["vista"],
    "ridge": ["ridge", "rdg"],
    "loop": ["loop"],
    "link": ["link"],
    "rtt": ["retreat", "rtt"],
    "gdns": ["gardens", "gdns"],
    "hts": ["heights", "hts"],
    "pt": ["point", "pt"],
    "ch": ["chase", "ch"],
    "cnr": ["corner", "cnr"],
    "app": ["approach", "app"],
    "arc": ["arcade", "arc"],
    "bay": ["bay"],
    "end": ["end"],
    "gate": ["gate"],
    "grn": ["green", "grn"],
    "hill": ["hill"],
    "pass": ["pass"],
    "path": ["path"],
    "plaza": ["plaza"],
    "prom": ["promenade", "prom"],
    "qy": ["quay", "qy"],
    "rch": ["reach", "rch"],
    "run": ["run"],
    "tr": ["track", "trk", "tr"],
    "trl": ["trail", "trl"],
}
STREET_TYPES = {spelling: canon for canon, spellings in _STREET_TYPES.items() for spelling in spellings}

_UNIT_WORDS = r"(?:unit|units|u|apartment|apt|flat|villa|townhouse|th|suite|ste|shop|lot)"
_NUMBER = r"\d+[a-z]?(?:\s*-\s*\d+[a-z]?)?"

# "3/12 smith st", "unit 3/12 smith st", "u3/12 smith st"
_RE_SLASH = re.compile(rf"^(?:{_UNIT_WORDS}\.?\s*)?(\w+)\s*/\s*({_NUMBER})\s+(.+)$")
# "unit 3 12 smith st" (left once the comma is gone)
_RE_UNIT_WORD = re.compile(rf"^{_UNIT_WORDS}\.?\s*(\w+)\s+({_NUMBER})\s+(.+)$")
# "12 smith st"
_RE_PLAIN = re.compile(rf"^({_NUMBER})\s+(.+)$")
_RE_TAIL = re.compile(r"^(.*?)(?:\s+(nsw|vic|qld|sa|wa|tas|nt|act))?(?:\s+(\d{4}))?$")


def _clean(text):
    text = (text or "").lower()
    text = text.replace("–", "-").replace("—", "-")
    text = re.sub(r"[^\w\s/,\-]", " ", text)
    text = re.sub(r"\s*-\s*", "-", text)
    text = re.sub(r"\s*/\s*", "/", text)
    return re.sub(r"\s+", " ", text).strip()


def _norm_words(text):
    return re.sub(r"\s+", " ", re.sub(r"[^\w\s]", " ", (text or "").lower())).strip()


def _split_tail(text):
    """Pull a trailing state and postcode off 'paddington nsw 2021'."""
    m = _RE_TAIL.match(text.strip())
    return m.group(1).strip(), (m.group(2) or ""), (m.group(3) or "")


def _street_and_suburb(rest, has_suburb):
    """Split 'smith st paddington' into street name, street type, suburb.

    The street type is the first type word that has at least one name word
    before it, so 'st kilda rd st kilda' reads as St Kilda Road in St Kilda.
    """
    words = rest.split()
    for i, word in enumerate(words):
        if i >= 1 and word in STREET_TYPES:
            street = " ".join(words[:i])
            suburb = "" if has_suburb else " ".join(words[i + 1:])
            if has_suburb and i + 1 < len(words):
                # Extra words after the type with a separate suburb column,
                # e.g. "smith st north". Keep them on the street name.
                street = " ".join(words[:i] + words[i + 1:])
            return street, STREET_TYPES[word], suburb
    # No street type found ("12 the esplanade" style names, or a typo).
    return rest, "", ""


def parse(address, suburb="", state="", postcode=""):
    """Break an address into comparable parts.

    `address` can be a street line ("3/12 Smith St") with the suburb in its
    own column, or a full one-line address ("Unit 3, 12 Smith Street,
    Paddington NSW 2021").
    """
    raw = _clean(address)
    parts = {"unit": "", "number": "", "street": "", "type": "",
             "suburb": _norm_words(suburb), "state": _norm_words(state),
             "postcode": re.sub(r"\D", "", str(postcode or ""))[:4]}

    segments = [s.strip() for s in raw.split(",") if s.strip()]
    # "Unit 3, 12 Smith St" -> join the unit back onto the street line.
    if len(segments) > 1 and re.fullmatch(rf"{_UNIT_WORDS}\.?\s*\w+", segments[0]):
        segments = [segments[0] + " " + segments[1]] + segments[2:]
    if not segments:
        return parts

    street_line = segments[0]
    tail = " ".join(segments[1:])
    if tail:
        sub, st, pc = _split_tail(tail)
        parts["suburb"] = parts["suburb"] or sub
        parts["state"] = parts["state"] or st
        parts["postcode"] = parts["postcode"] or pc
    else:
        rest, st, pc = _split_tail(street_line)
        if st or pc:
            street_line = rest
            parts["state"] = parts["state"] or st
            parts["postcode"] = parts["postcode"] or pc

    m = _RE_SLASH.match(street_line) or _RE_UNIT_WORD.match(street_line)
    if m:
        parts["unit"], parts["number"], rest = m.group(1), m.group(2), m.group(3)
    else:
        m = _RE_PLAIN.match(street_line)
        if m:
            parts["number"], rest = m.group(1), m.group(2)
        else:
            rest = street_line

    has_suburb = bool(parts["suburb"])
    street, stype, sub = _street_and_suburb(rest.replace("/", " "), has_suburb)
    parts["street"], parts["type"] = street, stype
    if not has_suburb:
        parts["suburb"] = sub
    parts["number"] = parts["number"].replace(" ", "")
    return parts


def key(parts):
    """Unique key for one property. Used to recognise the same listing across imports."""
    return "|".join([parts["unit"], parts["number"], parts["street"], parts["type"],
                     parts["suburb"], parts["postcode"]])


def block_key(parts):
    """Coarse key used to find candidate matches: unit, number and street name."""
    if not parts["number"] or not parts["street"]:
        return None
    return (parts["unit"], parts["number"], parts["street"])


def compare(a, b):
    """Return 'exact', 'check' or None for two parsed addresses.

    exact: unit, number, street, street type and suburb all agree.
    check: same unit, number and street name but something is missing or
           written differently, so a person has to look.
    None:  different property.
    """
    if block_key(a) is None or block_key(a) != block_key(b):
        return None
    if a["suburb"] and b["suburb"] and a["suburb"] != b["suburb"]:
        return None
    if a["postcode"] and b["postcode"] and a["postcode"] != b["postcode"]:
        return None
    if not a["suburb"] or not b["suburb"]:
        return "check"
    if a["type"] != b["type"]:
        return "check"
    return "exact"


def display(parts):
    """Tidy one-line address for screens and printouts."""
    types = {canon: spellings[0] for canon, spellings in _STREET_TYPES.items()}
    num = (f"{parts['unit']}/{parts['number']}" if parts["unit"] else parts["number"]).upper()
    street = " ".join(filter(None, [num, parts["street"].title(),
                                    types.get(parts["type"], parts["type"]).title()]))
    place = " ".join(filter(None, [parts["suburb"].title(), parts["state"].upper(), parts["postcode"]]))
    return ", ".join(filter(None, [street, place]))
