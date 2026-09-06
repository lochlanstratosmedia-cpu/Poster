import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod/v4';
import { SCENARIOS, RUBRIC, publicScenario } from './scenarios.js';
import { PLAYBOOK } from './knowledge.js';

const here = path.dirname(fileURLToPath(import.meta.url));
loadDotEnv(path.join(here, '.env'));

const PORT = Number(process.env.PORT || 3000);
const MODEL = process.env.ANTHROPIC_MODEL || 'claude-opus-5';
const TTS_PROVIDER = (process.env.TTS_PROVIDER || 'browser').toLowerCase();
const ACCESS_CODE = process.env.ACCESS_CODE || '';
const ADMIN_KEY = process.env.ADMIN_KEY || '';
const DATA_DIR = path.join(here, 'data');

const client = new Anthropic();
const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(here, 'public')));

// ---------- Access gate ----------
function gate(req, res, next) {
  if (!ACCESS_CODE) return next();
  if ((req.get('x-access-code') || '') === ACCESS_CODE) return next();
  res.status(401).json({ error: 'access_code', message: 'Enter the access code Lochlan gave you.' });
}

// ---------- Scenarios ----------
app.get('/api/config', (req, res) => {
  res.json({
    needsAccessCode: Boolean(ACCESS_CODE),
    ttsProvider: TTS_PROVIDER,
    scenarios: SCENARIOS.map(publicScenario)
  });
});

function findScenario(id) {
  return SCENARIOS.find((s) => s.id === id);
}

function transcriptText(turns) {
  return turns.map((t) => `${t.role === 'agent' ? 'Agent' : 'Prospect'}: ${t.text}`).join('\n');
}

function cleanTurns(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((t) => t && (t.role === 'agent' || t.role === 'prospect') && typeof t.text === 'string')
    .slice(-60)
    .map((t) => ({ role: t.role, text: t.text.slice(0, 2000), at: Number(t.at) || 0 }));
}

// ---------- Prospect ----------
const ProspectReply = z.object({
  reply: z.string(),
  status: z.enum(['continue', 'won', 'hungup', 'ended'])
});

function prospectSystem(sc) {
  return [
    'You are role-playing a phone call for a real estate sales training tool. Play the PROSPECT only. The trainee is the AGENT.',
    '',
    `PERSONA: ${sc.persona}`,
    `OBJECTIONS: ${sc.objections}`,
    `WIN CONDITION (the agent has succeeded when): ${sc.win}`,
    `HANG UP RULE: ${sc.hangup}`,
    '',
    'RULES:',
    '- Speak like a real person on the phone in Australia. One to three short sentences per reply. Plain spoken words, no stage directions, no asterisks, no lists.',
    '- Do not volunteer information the agent has not asked for. Make them earn it with questions.',
    '- Do not be a pushover. Do not agree to the win condition until the agent has genuinely handled your concerns and asked for a specific next step.',
    '- Never break character, never mention being an AI, never coach the agent.',
    '- If the agent says goodbye or ends the call politely, say a short goodbye and set status to "ended".',
    '- Use "won" only when the win condition has just been met in this exchange. Use "hungup" when the hang up rule is triggered and make the reply your last words before hanging up.',
    '',
    'The user message contains the conversation so far. Reply as the prospect with the next line.'
  ].join('\n');
}

app.post('/api/prospect', gate, async (req, res) => {
  const sc = findScenario(req.body?.scenarioId);
  const turns = cleanTurns(req.body?.turns);
  if (!sc) return res.status(400).json({ error: 'bad_scenario' });
  if (!turns.length || turns[turns.length - 1].role !== 'agent') return res.status(400).json({ error: 'no_agent_turn' });
  try {
    const response = await client.messages.parse({
      model: MODEL,
      max_tokens: 1024,
      system: [{ type: 'text', text: prospectSystem(sc), cache_control: { type: 'ephemeral' } }],
      output_config: { effort: 'low', format: zodOutputFormat(ProspectReply) },
      messages: [{ role: 'user', content: `CONVERSATION SO FAR:\n${transcriptText(turns)}` }]
    });
    if (response.stop_reason === 'refusal' || !response.parsed_output) {
      return res.status(502).json({ error: 'no_reply' });
    }
    res.json(response.parsed_output);
  } catch (e) {
    console.error('prospect', e?.status, e?.message);
    res.status(502).json({ error: apiErrorCode(e), message: e?.message });
  }
});

// ---------- Scoring ----------
const AreaScore = z.object({ score: z.number(), note: z.string() });
const Report = z.object({
  areas: z.object({
    opening: AreaScore,
    discovery: AreaScore,
    listening: AreaScore,
    objections: AreaScore,
    close: AreaScore,
    delivery: AreaScore
  }),
  summary: z.string(),
  takeaways: z.array(z.object({ type: z.enum(['well', 'change']), text: z.string(), quote: z.string() })),
  swaps: z.array(z.object({ moment: z.string(), said: z.string(), better: z.string() }))
});

const SCORER_SYSTEM = [
  'You score practice sales calls for a real estate agent training tool. Judge the agent against the playbook below, which combines what leading real estate call trainers and published sales call research teach. Be direct, specific, and quote the transcript.',
  '',
  'PLAYBOOK:',
  PLAYBOOK
].join('\n');

function scoringPrompt(sc, turns, m) {
  const rub = RUBRIC.map((r) => `- ${r.key} (max ${r.max}): ${r.desc}`).join('\n');
  const outcome = m.outcome === 'won' ? 'The prospect agreed to the next step.' : m.outcome === 'hungup' ? 'The prospect hung up.' : 'The call ended without the prospect agreeing to a next step.';
  return [
    'You are scoring a practice sales call for a real estate agent training tool. Be direct and specific. Quote the transcript.',
    '',
    `SCENARIO: Level ${sc.level}, ${sc.title}. ${sc.situation}`,
    `AGENT GOAL: ${sc.goal}`,
    `PROSPECT PERSONA (for context): ${sc.persona}`,
    `OUTCOME: ${outcome}`,
    '',
    'MEASURED FROM THE AUDIO AND TRANSCRIPT:',
    `- Agent talk share: ${m.talkShare}% of words`,
    `- Filler words: ${m.fillers}`,
    `- Questions asked by agent: ${m.questions}${m.firstQuestionTurn ? ` (first question on agent turn ${m.firstQuestionTurn})` : ' (no questions asked)'}`,
    `- Longest agent turn: ${m.longestTurnWords} words`,
    `- Agent turns: ${m.agentTurns}, duration ${m.durationLabel}`,
    '',
    'RUBRIC (score each area from 0 to its max):',
    rub,
    '',
    'TRANSCRIPT:',
    transcriptText(turns),
    '',
    'Scoring guidance: a very short call with one or two agent turns should score low across the board. Reward genuine open questions and acknowledgement of objections. Penalise pitching before discovery, talking over the prospect, and vague closes. If the prospect hung up, the close area is at most a third of its max.',
    '',
    'Return: per-area scores with a one sentence note each; a two sentence summary; exactly three takeaways (one "well", two "change"), each quoting an exact Agent line; and two swaps, each with the moment, the exact Agent line said, and a stronger line to try instead. Quotes must be copied word for word from Agent lines. Keep every note under 30 words.'
  ].join('\n');
}

app.post('/api/score', gate, async (req, res) => {
  const sc = findScenario(req.body?.scenarioId);
  const turns = cleanTurns(req.body?.turns);
  const m = req.body?.measured || {};
  if (!sc) return res.status(400).json({ error: 'bad_scenario' });
  if (!turns.some((t) => t.role === 'agent')) return res.status(400).json({ error: 'no_agent_turn' });
  try {
    const response = await client.messages.parse({
      model: MODEL,
      max_tokens: 8000,
      system: [{ type: 'text', text: SCORER_SYSTEM, cache_control: { type: 'ephemeral' } }],
      output_config: { format: zodOutputFormat(Report) },
      messages: [{ role: 'user', content: scoringPrompt(sc, turns, m) }]
    });
    if (response.stop_reason === 'refusal' || !response.parsed_output) {
      return res.status(502).json({ error: 'no_report' });
    }
    res.json(response.parsed_output);
  } catch (e) {
    console.error('score', e?.status, e?.message);
    res.status(502).json({ error: apiErrorCode(e), message: e?.message });
  }
});

// ---------- Coaching: what a top performer would have said ----------
const Coaching = z.object({
  openingLine: z.string(),
  closingLine: z.string(),
  turns: z.array(z.object({
    prospectSaid: z.string(),
    youSaid: z.string(),
    better: z.string(),
    why: z.string(),
    technique: z.string(),
    source: z.string()
  })),
  idealCall: z.array(z.object({ speaker: z.enum(['agent', 'prospect']), line: z.string() })),
  techniques: z.array(z.object({ name: z.string(), what: z.string(), source: z.string() })),
  drills: z.array(z.object({ title: z.string(), how: z.string() }))
});

const COACH_SYSTEM = [
  'You are a real estate sales coach. After a trainee agent finishes a practice phone call, you show them what a top performer would have said at each moment, drawing only on the playbook below. Sound like a straight-talking Australian coach: plain words, no hype, no jargon the agent would not use on a call. Every suggested line must be something a real agent could say out loud in one breath, in Australian English.',
  '',
  'PLAYBOOK:',
  PLAYBOOK
].join('\n');

function coachPrompt(sc, turns, m, report) {
  const weakest = (report?.areas || []).slice().sort((a, b) => (a.score / a.max) - (b.score / b.max)).slice(0, 2).map((a) => a.name).join(' and ');
  return [
    `SCENARIO: Level ${sc.level}, ${sc.title}. ${sc.situation}`,
    `AGENT GOAL: ${sc.goal}`,
    `PROSPECT PERSONA (for context): ${sc.persona}`,
    `PROSPECT OBJECTIONS IN PLAY: ${sc.objections}`,
    `OUTCOME: ${m.outcome === 'won' ? 'The prospect agreed to the next step.' : m.outcome === 'hungup' ? 'The prospect hung up.' : 'No next step was agreed.'}`,
    weakest ? `WEAKEST AREAS FROM THE SCORE: ${weakest}` : '',
    '',
    'TRANSCRIPT:',
    transcriptText(turns),
    '',
    'Produce:',
    '1. openingLine: the strongest first line the agent could have opened this exact call with.',
    '2. closingLine: the strongest line to ask for the next step in this exact call.',
    '3. turns: one entry for EVERY Agent line in the transcript, in order. prospectSaid is the prospect line just before it (or "(start of call)"). youSaid is the exact Agent line copied word for word. better is what a top performer would have said instead (if the agent line was already strong, say so in why and make better a small polish). why is one or two sentences on what the better line does. technique is the playbook technique name. source is the trainer or research the technique comes from, as named in the playbook.',
    '4. idealCall: the whole call as a top performer would have run it against this prospect, 8 to 14 lines alternating prospect and agent, starting with the prospect\'s opener. Prospect lines should stay true to the persona and objections.',
    '5. techniques: the three playbook techniques this agent most needs next, each with a one sentence what and the source.',
    '6. drills: two or three short practice drills the agent can do before the next attempt, each with a title and a how of one to three sentences.',
    'Keep every better line under 40 words. Never invent a source: use only sources named in the playbook, or write "general practice" if none applies.'
  ].filter(Boolean).join('\n');
}

app.post('/api/coach', gate, async (req, res) => {
  const sc = findScenario(req.body?.scenarioId);
  const turns = cleanTurns(req.body?.turns);
  const m = req.body?.measured || {};
  const report = req.body?.report || null;
  if (!sc) return res.status(400).json({ error: 'bad_scenario' });
  if (!turns.some((t) => t.role === 'agent')) return res.status(400).json({ error: 'no_agent_turn' });
  try {
    const response = await client.messages.parse({
      model: MODEL,
      max_tokens: 12000,
      system: [{ type: 'text', text: COACH_SYSTEM, cache_control: { type: 'ephemeral' } }],
      output_config: { format: zodOutputFormat(Coaching) },
      messages: [{ role: 'user', content: coachPrompt(sc, turns, m, report) }]
    });
    if (response.stop_reason === 'refusal' || !response.parsed_output) {
      return res.status(502).json({ error: 'no_coaching' });
    }
    res.json(response.parsed_output);
  } catch (e) {
    console.error('coach', e?.status, e?.message);
    res.status(502).json({ error: apiErrorCode(e), message: e?.message });
  }
});

function apiErrorCode(e) {
  if (e instanceof Anthropic.AuthenticationError) return 'bad_api_key';
  if (/authentication method/i.test(e?.message || '')) return 'bad_api_key';
  if (e instanceof Anthropic.RateLimitError) return 'rate_limited';
  if (e instanceof Anthropic.APIConnectionError) return 'network';
  if (e instanceof Anthropic.APIError) return 'api_error';
  return 'error';
}

// ---------- Text to speech ----------
function voiceFor(sc) {
  return process.env[`TTS_VOICE_${sc.voiceKey}`] || process.env.TTS_VOICE_DEFAULT || '';
}

app.post('/api/tts', gate, async (req, res) => {
  const sc = findScenario(req.body?.scenarioId);
  const text = String(req.body?.text || '').slice(0, 1000).trim();
  if (!sc || !text) return res.status(400).json({ error: 'bad_request' });
  if (TTS_PROVIDER === 'browser') return res.status(404).json({ error: 'browser_tts' });
  const voice = voiceFor(sc);
  if (!voice) return res.status(500).json({ error: 'no_voice', message: 'Set TTS_VOICE_DEFAULT or a per-prospect voice id in .env.' });
  try {
    let upstream;
    if (TTS_PROVIDER === 'elevenlabs') {
      if (!process.env.ELEVENLABS_API_KEY) return res.status(500).json({ error: 'no_key', message: 'ELEVENLABS_API_KEY is not set.' });
      upstream = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice)}/stream?output_format=mp3_44100_128`, {
        method: 'POST',
        headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
        body: JSON.stringify({
          text,
          model_id: process.env.ELEVENLABS_MODEL_ID || 'eleven_flash_v2_5',
          voice_settings: { stability: 0.45, similarity_boost: 0.8, style: 0.2 }
        })
      });
    } else if (TTS_PROVIDER === 'fish') {
      if (!process.env.FISH_API_KEY) return res.status(500).json({ error: 'no_key', message: 'FISH_API_KEY is not set.' });
      upstream = await fetch('https://api.fish.audio/v1/tts', {
        method: 'POST',
        headers: { Authorization: `Bearer ${process.env.FISH_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, reference_id: voice, format: 'mp3', latency: 'balanced' })
      });
    } else {
      return res.status(500).json({ error: 'bad_provider', message: `Unknown TTS_PROVIDER "${TTS_PROVIDER}".` });
    }
    if (!upstream.ok) {
      const detail = await upstream.text().catch(() => '');
      console.error('tts', TTS_PROVIDER, upstream.status, detail.slice(0, 300));
      return res.status(502).json({ error: 'tts_failed', status: upstream.status, message: detail.slice(0, 300) });
    }
    res.setHeader('Content-Type', upstream.headers.get('content-type') || 'audio/mpeg');
    res.setHeader('Cache-Control', 'no-store');
    const reader = upstream.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(Buffer.from(value));
    }
    res.end();
  } catch (e) {
    console.error('tts', e?.message);
    if (!res.headersSent) res.status(502).json({ error: 'tts_failed', message: e?.message });
    else res.end();
  }
});

// ---------- Feedback and attempts ----------
function appendJsonl(name, obj) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.appendFileSync(path.join(DATA_DIR, `${name}.jsonl`), JSON.stringify(obj) + '\n');
}
function readJsonl(name) {
  const p = path.join(DATA_DIR, `${name}.jsonl`);
  if (!fs.existsSync(p)) return [];
  return fs.readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}

app.post('/api/attempt', gate, (req, res) => {
  const b = req.body || {};
  appendJsonl('attempts', { ...b, receivedAt: new Date().toISOString() });
  res.json({ ok: true });
});

app.post('/api/feedback', gate, (req, res) => {
  const b = req.body || {};
  if (!b.name) return res.status(400).json({ error: 'name_required' });
  appendJsonl('feedback', { ...b, receivedAt: new Date().toISOString() });
  res.json({ ok: true });
});

function admin(req, res, next) {
  if (ADMIN_KEY && req.query.key === ADMIN_KEY) return next();
  res.status(401).json({ error: 'admin_key', message: 'Add ?key=ADMIN_KEY from your .env.' });
}
app.get('/api/playbook', (req, res) => { res.type('text/plain').send(PLAYBOOK); });
app.get('/admin/feedback', admin, (req, res) => res.json(readJsonl('feedback')));
app.get('/admin/attempts', admin, (req, res) => res.json(readJsonl('attempts')));

app.listen(PORT, () => {
  console.log(`Call Drill listening on http://localhost:${PORT}`);
  console.log(`  model: ${MODEL}  tts: ${TTS_PROVIDER}  access code: ${ACCESS_CODE ? 'on' : 'off'}`);
  if (!process.env.ANTHROPIC_API_KEY) console.log('  warning: ANTHROPIC_API_KEY is not set (the SDK will try other credentials)');
});

// Tiny .env loader so there is no extra dependency.
function loadDotEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m || line.trim().startsWith('#')) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (process.env[m[1]] === undefined) process.env[m[1]] = v;
  }
}
