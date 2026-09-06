# Call Drill prototype

For the version with a realistic voice from ElevenLabs or Fish Audio, see
`app/`. This file is the zero-setup claude.ai artifact version.

Draft working model of the real estate call trainer described in
`content/real-estate-training-platform.md`. One HTML file, no build step.

Published as a Claude artifact:
https://claude.ai/code/artifact/e3ec709e-c348-4f5c-82a1-f42fc2caf69e

## What it does

- Three levels, one scenario each: warm lead follow-up, open home follow-up,
  expired listing. Passing a level opens the next. A testing link unlocks all.
- The agent talks out loud. The browser's own speech recognition turns it
  into text, Claude plays the prospect, and the browser's own text to speech
  reads the reply back.
- When the call ends, Claude scores the transcript against the six-area
  rubric out of 100 and writes takeaways, "try this instead" lines, and
  per-area notes. Talk share, filler words, question count, and longest turn
  are measured in the page.
- A feedback form saves to the artifact's database, along with every scored
  attempt and its transcript.

## Limits of the draft

- Runs only inside the claude.ai viewer. The prospect and scoring use the
  viewer's own Claude account, so testers must be signed in and click Allow
  when the page asks.
- Voice recognition needs Chrome or Edge. Other browsers fall back to typing.
- Tap to talk, not open mic. The prospect cannot interrupt the agent, so the
  page cannot measure interruptions yet.
- Prospect voice is the browser's built-in voice, not a cloned or studio one.
- Progress is stored in the tester's browser, not on a server.

## Reading the results

From a Claude Code session that owns the artifact, read the `feedback` and
`attempts` collections with the Artifact tool's `read_db` action.
