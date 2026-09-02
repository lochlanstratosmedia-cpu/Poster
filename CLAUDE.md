# Poster

Working notes for Claude. Poster is a script and content repo. Drafts live in
`content/`.

## Writing rules

Every draft written here must go through the humanizer skill before it counts
as done. The skill lives at `.claude/skills/humanizer/SKILL.md` and holds 35
patterns taken from Wikipedia's "Signs of AI writing".

1. Write the draft.
2. Run the humanizer skill on it in file mode. Rewrite the prose only. Leave
   code, frontmatter, data, and link targets alone.
3. Read the result and fix whatever still sounds like a chatbot.

Invoke it with `/humanizer`, by asking in plain language ("humanize
content/ep-12.md"), or by following the note the write hook returns.

### Never invent facts

Do not add a name, number, date, price, quote, statistic, or citation that did
not come from the source or from Lochlan. If a sentence needs a detail that is
missing, ask for it or write a simpler sentence. Fiction is the exception,
since invented detail is the point there.

### House defaults

These repeat the rules the hook checks for. The full list is in the skill.

- No em dashes or en dashes. Use a period, comma, colon, or parentheses.
- Straight quotes only.
- No emoji in scripts.
- Sentence case in headings, not Title Case.
- Say "is" and "has". Avoid "serves as", "stands as", and "boasts".
- Cut filler: "in order to" becomes "to", "due to the fact that" becomes
  "because".
- No generic upbeat ending. End on a fact or a real next step.

If Lochlan gives a writing sample, follow the sample instead of these defaults.
The sample wins, including on dashes.

## The write hook

`.claude/settings.json` runs `.claude/hooks/humanizer_check.py` after every
Write and Edit. It scans prose files, and when it finds tells it returns a note
listing them by line and pattern number.

The hook never blocks an edit and it is not a verdict. It reads plain text, so
it cannot tell a deliberate phrase from a lazy one. Check each hit and leave
the line as it is when the wording is intentional or quoted.

It skips `.claude/`, `docs/`, `README.md`, `CLAUDE.md`, and `AGENTS.md`,
because those files quote the patterns on purpose.

## Narrative work

For story and narrative scripts, `docs/storyscope-narrative-checks.md` covers
the structural side that word-level editing misses. Read it when a draft reads
clean sentence by sentence but still feels machine made.

## Updating the skill

`scripts/update-humanizer.sh` pulls the current `SKILL.md` from
github.com/blader/humanizer. Run it, read the diff, then commit.
