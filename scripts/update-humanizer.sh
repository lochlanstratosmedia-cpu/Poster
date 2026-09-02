#!/usr/bin/env bash
# Refresh the vendored humanizer skill from upstream.
#
# Usage: scripts/update-humanizer.sh [ref]
# Default ref is main.

set -euo pipefail

ref="${1:-main}"
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
dest="$root/.claude/skills/humanizer"
base="https://raw.githubusercontent.com/blader/humanizer/$ref"

mkdir -p "$dest"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

for file in SKILL.md LICENSE; do
  echo "Fetching $file from $ref"
  curl -fsS --max-time 60 -o "$tmp/$file" "$base/$file"
done

if [ ! -s "$tmp/SKILL.md" ] || ! head -n 1 "$tmp/SKILL.md" | grep -q '^---$'; then
  echo "SKILL.md does not look like a skill file. Nothing changed." >&2
  exit 1
fi

old_version="$(grep -m1 'version:' "$dest/SKILL.md" 2>/dev/null | tr -d ' "' || true)"
mv "$tmp/SKILL.md" "$dest/SKILL.md"
mv "$tmp/LICENSE" "$dest/LICENSE"
new_version="$(grep -m1 'version:' "$dest/SKILL.md" | tr -d ' "')"

echo "Was: ${old_version:-unknown}"
echo "Now: $new_version"
echo "Review the diff, then commit."
