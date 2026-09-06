# Call Drill, hosted version

The same trainer as `prototype/call-drill.html`, moved to a small Node server
so the prospect can speak with a realistic voice from ElevenLabs or Fish Audio.
Claude plays the prospect and scores the call through your own API key, so
testers do not need a Claude account.

## What you need

- Node 20 or newer.
- An Anthropic API key (console.anthropic.com).
- An ElevenLabs API key and the voice ids you want, or a Fish Audio API key
  and model reference ids. Or set `TTS_PROVIDER=browser` to use the free
  built-in voice while you test the rest.

## Run it locally

```
cd app
npm install
cp .env.example .env
# fill in .env
npm start
```

Open http://localhost:3000. To let an agent test it from their own device,
either deploy it (below) or tunnel your laptop with something like
Cloudflare Tunnel or ngrok and send them the link plus the access code.

## Voices

Set one voice per prospect in `.env`:

| Variable | Prospect |
|---|---|
| `TTS_VOICE_PRIYA` | Level 1, Priya, mid thirties, friendly |
| `TTS_VOICE_MARK` | Level 2, Mark, late forties, guarded tradie |
| `TTS_VOICE_HELEN` | Level 3, Helen, early sixties, frustrated |
| `TTS_VOICE_DEFAULT` | Used when a prospect has no voice set |

Pick Australian voices from the provider's library if they have them. The
prompt tells Claude to speak like a person in Australia, so the voice should
match.

If the voice request fails, the page falls back to the browser voice and the
server log shows the provider's error.

## Deploy

Any host that runs a Node server or a Docker container works: Railway,
Render, Fly.io, a small VPS. Set the same variables from `.env.example` as
environment variables on the host. A `Dockerfile` is included.

Feedback and scored attempts append to `data/feedback.jsonl` and
`data/attempts.jsonl`. On a host without a persistent disk those files reset
on redeploy, so download them before you redeploy, or run it somewhere with a
volume.

## Reading feedback

```
https://your-host/admin/feedback?key=ADMIN_KEY
https://your-host/admin/attempts?key=ADMIN_KEY
```

Both return JSON. `ADMIN_KEY` is whatever you set in `.env`.

## Files

| Path | What it is |
|---|---|
| `server.js` | Express server: prospect, scoring, voice proxy, feedback |
| `scenarios.js` | The three scenarios and the rubric. Add scenarios here |
| `public/index.html` | The whole front end |
| `data/` | Feedback and attempts, ignored by git |

## Not yet verified

The ElevenLabs and Fish Audio request shapes were written from their public
API documentation as remembered, not tested against a live key. If the first
call fails, the server log prints the provider's response. The Claude calls
use the current SDK and structured output and were exercised locally up to
the point of needing a key.
