# Poster

Script and content repo, set up so Claude edits prose against a fixed list of
AI-writing patterns instead of its own instincts.

## What is installed

| Path | What it does |
|---|---|
| `.claude/skills/humanizer/SKILL.md` | The humanizer skill, 35 patterns from Wikipedia's "Signs of AI writing" |
| `.claude/settings.json` | Runs the check hook after every Write and Edit |
| `.claude/hooks/humanizer_check.py` | Scans prose files and reports tells by line and pattern number |
| `CLAUDE.md` | Standing instructions: humanize every draft, invent no facts |
| `docs/storyscope-narrative-checks.md` | Structural checklist for narrative scripts |
| `scripts/update-humanizer.sh` | Pulls a fresh copy of the skill from upstream |
| `content/` | Drafts |

## How it works

Write a draft in `content/`. The hook fires on save and returns a note like
this when it finds something:

```
Humanizer check found 4 AI-writing tell(s) in content/ep-12.md:
  content/ep-12.md:7 - §7 stock AI word: "In today's"
  content/ep-12.md:8 - §14 em or en dash: '—'
```

Claude then applies the skill to the file. The hook never blocks an edit, and
it is a hint rather than a verdict. Regex cannot tell a deliberate phrase from
a lazy one, so check each hit.

You can also call the skill directly:

```
/humanizer

[paste your text]
```

Or point it at a file: `humanize the prose in content/ep-12.md`.

### Voice matching

Paste two or three paragraphs of your own writing with the request and the
rewrite follows your rhythm, word choice, and quirks instead of the house
defaults. A sample overrides the style rules, including the rule against
dashes.

## Checking the hook by hand

```bash
printf '{"tool_name":"Write","cwd":"%s","tool_input":{"file_path":"%s/content/ep-12.md"}}' "$PWD" "$PWD" \
  | python3 .claude/hooks/humanizer_check.py
```

No output means nothing was flagged. It needs Python 3 and no packages.

### Tuning it

The pattern list is at the top of `.claude/hooks/humanizer_check.py`, in
`CHECKS`. Each entry carries the pattern number from `SKILL.md`. `SKIP_PREFIXES`
and `SKIP_NAMES` control which files are exempt, and `PROSE_SUFFIXES` controls
which get read at all.

## Why the skill is vendored

`SKILL.md` is copied into this repo rather than installed as a plugin, so it
works in Claude Code on the web and for anyone who clones this. Run
`scripts/update-humanizer.sh` to pull a newer version.

Two other install routes exist if you want it everywhere, not just here:

```bash
npx skills add blader/humanizer --global
```

```text
/plugin marketplace add blader/humanizer
/plugin install humanizer@humanizer
```

## Credits

- Humanizer by [blader](https://github.com/blader/humanizer), MIT licensed.
  The copy in `.claude/skills/humanizer/` is version 2.11.2 and keeps its
  LICENSE file.
- Patterns come from
  [Wikipedia: Signs of AI writing](https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing),
  maintained by WikiProject AI Cleanup.
- StoryScope by Russell, Rajendhran, Pham, Iyyer, and Wieting.
  [Repo](https://github.com/jenna-russell/storyscope),
  [paper](https://arxiv.org/abs/2604.03136). Only summarized here, not installed.
