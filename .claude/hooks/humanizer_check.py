#!/usr/bin/env python3
"""Flag AI-writing tells in prose files right after Claude writes them.

Runs as a PostToolUse hook on Write and Edit. It never blocks a tool call.
When it finds tells, it hands Claude a note asking it to apply the humanizer
skill to that file.

Pattern numbers refer to .claude/skills/humanizer/SKILL.md.
"""

import json
import os
import re
import sys

# Only prose gets checked.
PROSE_SUFFIXES = (".md", ".mdx", ".markdown", ".txt")

# Meta files that describe the patterns, so they are full of deliberate examples.
SKIP_PREFIXES = (".claude/", "docs/", "node_modules/", ".git/")
SKIP_NAMES = ("README.md", "CLAUDE.md", "AGENTS.md")

MAX_BYTES = 400_000
MAX_REPORTED = 12

# (pattern id, label, compiled regex)
CHECKS = [
    ("7", "stock AI word", re.compile(
        r"\b(?:delve|delves|delving|testament|tapestry|realm|landscape|"
        r"showcas(?:e|es|ing)|underscor(?:e|es|ing)|pivotal|crucial|vital|"
        r"nestled|vibrant|bustling|seamless(?:ly)?|robust|leverage[sd]?|"
        r"navigat(?:e|es|ing) the|myriad|plethora|meticulous(?:ly)?|"
        r"ever-(?:evolving|changing|growing)|in today'?s|game-?chang(?:er|ing)|"
        r"unlock(?:ing)? the|harness(?:ing)? the|elevate your)\b", re.I)),
    ("8", "avoiding is/are", re.compile(
        r"\b(?:serves? as|stands? as|boasts?|features? a|represents? a)\b", re.I)),
    ("9", "not X but Y", re.compile(
        r"\b(?:it'?s not just|isn'?t just|not only .{0,40}? but also|"
        r"it'?s not about .{0,40}?,? it'?s about)\b", re.I)),
    ("14", "em or en dash", re.compile(r"[–—]")),
    ("18", "emoji", re.compile(
        "[\U0001F300-\U0001FAFF☀-➿️✨⭐]")),
    ("19", "curly quote", re.compile("[‘’“”]")),
    ("20", "chatbot leftover", re.compile(
        r"\b(?:i hope this helps|let me know if|feel free to (?:ask|reach)|"
        r"great question|happy to help|as an ai)\b", re.I)),
    ("21", "knowledge-limit hedge", re.compile(
        r"\b(?:while details are limited|as of my (?:last )?(?:update|knowledge)|"
        r"available sources suggest|it is (?:widely )?believed that)\b", re.I)),
    ("22", "overly agreeable", re.compile(
        r"\b(?:you'?re absolutely right|absolutely!|great point|excellent question)\b", re.I)),
    ("23", "filler phrase", re.compile(
        r"\b(?:in order to|due to the fact that|it (?:is|'s) important to note|"
        r"it (?:is|'s) worth noting|needless to say|at the end of the day|"
        r"when it comes to|in the world of)\b", re.I)),
    ("24", "stacked qualifiers", re.compile(
        r"\b(?:could potentially|may possibly|might potentially|"
        r"can potentially|somewhat of a|fairly quite)\b", re.I)),
    ("25", "generic upbeat ending", re.compile(
        r"\b(?:the future looks bright|only time will tell|the possibilities are endless|"
        r"one thing (?:is|'s) (?:for )?certain|remains to be seen)\b", re.I)),
    ("27", "fake deeper truth", re.compile(
        r"\b(?:at its core|at the heart of it|what (?:this )?really (?:means|matters)|"
        r"the real (?:question|story) (?:is|here))\b", re.I)),
    ("28", "announcing the point", re.compile(
        r"\b(?:let'?s dive in|let'?s (?:take a look|explore|unpack|break)|"
        r"here'?s the (?:thing|kicker)|buckle up|without further ado)\b", re.I)),
    ("33", "fake-candid opening", re.compile(
        r"(?:^|[.!?]\s+)(?:honestly|look|truth be told|real talk)[,?]", re.I)),
    ("16", "bold mini-heading in list", re.compile(r"^\s*[-*+]\s+\*\*[^*]{1,60}\*\*\s*:")),
]

STOPWORDS = {
    "a", "an", "and", "as", "at", "but", "by", "for", "from", "in", "into",
    "is", "it", "of", "on", "or", "the", "to", "with", "your", "you",
}


def blank(text, start, end):
    """Replace a span with spaces, keeping newlines so line numbers hold."""
    span = text[start:end]
    return text[:start] + "".join(c if c == "\n" else " " for c in span) + text[end:]


def mask_non_prose(text):
    """Blank out frontmatter, code, link targets, and URLs."""
    if text.startswith("---\n"):
        close = text.find("\n---", 4)
        if close != -1:
            text = blank(text, 0, close + 4)
    for pattern in (
        re.compile(r"^```.*?^```", re.S | re.M),
        re.compile(r"^~~~.*?^~~~", re.S | re.M),
        re.compile(r"`[^`\n]*`"),
        re.compile(r"\]\([^)\s]+"),
        re.compile(r"https?://\S+"),
        re.compile(r"^(?: {4}|\t)\S.*$", re.M),
    ):
        while True:
            m = pattern.search(text)
            if not m:
                break
            text = blank(text, m.start(), m.end())
    return text


def title_case_heading(line):
    """Flag a heading that capitalizes most of its words (pattern 17)."""
    m = re.match(r"^#{1,6}\s+(.*)$", line)
    if not m:
        return False
    words = m.group(1).split()
    if len(words) < 4:
        return False
    capped = [
        w for w in words[1:]
        if w[:1].isupper() and w.lower() in STOPWORDS or (w[:1].isupper() and w.isalpha())
    ]
    return len(capped) >= 3


def relative(path, root):
    try:
        return os.path.relpath(path, root).replace(os.sep, "/")
    except ValueError:
        return path


def should_check(rel):
    if rel.startswith("../") or os.path.isabs(rel):
        return False
    if not rel.lower().endswith(PROSE_SUFFIXES):
        return False
    if any(rel.startswith(p) for p in SKIP_PREFIXES):
        return False
    return os.path.basename(rel) not in SKIP_NAMES


def scan(text):
    findings = []
    masked = mask_non_prose(text)
    for num, line in enumerate(masked.split("\n"), 1):
        if not line.strip():
            continue
        for pid, label, rx in CHECKS:
            m = rx.search(line)
            if m:
                findings.append((num, pid, label, m.group(0).strip()))
        if title_case_heading(line):
            findings.append((num, "17", "title case in heading", line.strip()[:60]))
    return findings


def main():
    try:
        payload = json.load(sys.stdin)
    except (json.JSONDecodeError, ValueError):
        return 0

    file_path = (payload.get("tool_input") or {}).get("file_path")
    if not file_path:
        return 0

    root = payload.get("cwd") or os.getcwd()
    rel = relative(file_path, root)
    if not should_check(rel):
        return 0

    try:
        if os.path.getsize(file_path) > MAX_BYTES:
            return 0
        with open(file_path, "r", encoding="utf-8", errors="replace") as fh:
            text = fh.read()
    except OSError:
        return 0

    findings = scan(text)
    if not findings:
        return 0

    shown = findings[:MAX_REPORTED]
    lines = [f"  {rel}:{num} - §{pid} {label}: {snippet!r}"
             for num, pid, label, snippet in shown]
    if len(findings) > len(shown):
        lines.append(f"  ...and {len(findings) - len(shown)} more.")

    note = (
        f"Humanizer check found {len(findings)} AI-writing tell(s) in {rel}:\n"
        + "\n".join(lines)
        + "\n\nApply the humanizer skill (.claude/skills/humanizer/SKILL.md) to this "
        "file in file mode: rewrite the prose only, keep every claim, invent nothing, "
        "and leave code, frontmatter, data, and link targets alone. "
        "This check is a hint, not a verdict. Leave a line as it is when the wording "
        "is deliberate or quoted."
    )

    json.dump({
        "hookSpecificOutput": {
            "hookEventName": "PostToolUse",
            "additionalContext": note,
        }
    }, sys.stdout)
    return 0


if __name__ == "__main__":
    sys.exit(main())
