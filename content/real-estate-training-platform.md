# Real estate call training platform

Working concept and build plan. Nothing here is final. Rubric weights, level
names, and the tech picks are proposals to react to.

## The idea in one paragraph

A training app where a real estate agent practises phone calls against an AI
prospect. The app is built like a game. The agent starts at level one, works
through call scenarios that get harder, and moves up a level by hitting a
score. After every call the app plays back what the agent said, scores it out
of 100, and gives a written breakdown of what worked and what to say
differently next time.

## How one session runs

1. The agent picks a scenario, or the app picks the next one in their track.
2. A briefing card tells them who they are calling, what the prospect wants,
   and what a win looks like for this call.
3. They press call. The AI prospect answers in voice and reacts to what the
   agent says as they say it. It objects, stalls, changes the subject, or
   warms up, depending on how the agent handles it.
4. The call ends when the agent closes, the prospect hangs up, or the timer
   runs out.
5. The app transcribes the agent's side, scores the call, and shows the report.
6. The agent reads the report, then either retries the scenario or moves on.

The loop should take under ten minutes so an agent can run one between real
calls.

## Levels

Each level is a track of scenarios around one type of call. The agent needs a
passing score on every scenario in a level before the next level opens.
Higher levels reuse the same call types with tougher prospects.

| Level | Track | What changes |
|---|---|---|
| 1 | Warm lead follow-up | Friendly prospect, clear intent, no objections |
| 2 | Open home follow-up | Mild objections ("just looking", "still thinking") |
| 3 | Buyer qualification | Agent has to ask the right questions to uncover budget, timing, and must-haves |
| 4 | Expired listing | Prospect is frustrated with their last agent and sceptical |
| 5 | For sale by owner | Prospect thinks they do not need an agent at all |
| 6 | Price reduction talk | Existing vendor, agent has to deliver bad news and keep the listing |
| 7 | Cold call, no prior contact | Short window to earn a reason to keep talking |
| 8 | Listing presentation on the phone | Multi-part call, agent has to hold structure and close for an appointment |
| 9 | Difficult prospect | Rude, distracted, or testing the agent on purpose |
| 10 | Mixed drill | Random scenario from any level, no briefing card |

Ten levels is a starting shape, not a rule. The list uses common Australian
call types. Lochlan should confirm which ones matter for the agents he has in
mind and drop or add tracks.

## Scenario design

Every scenario is a small script package with five parts.

The prospect persona gives the name, situation, mood, what the prospect
actually wants, and what they will not say unless asked.

The objection set lists three to five objections the prospect will raise,
each with a trigger. For example, raise the commission objection the first
time the agent mentions fees.

The win condition is the concrete outcome that counts as a pass: a booked
appraisal, an agreed callback time, permission to send a report.

Fail triggers end the call early. Talking over the prospect twice, or
pitching before asking a single question, would both count.

Model answers give one or two example lines for each key moment. The
feedback report uses them as "here is one way to say it".

The AI prospect runs off the persona and objection set, so the same scenario
plays out differently each time. That matters for replay value and stops
agents memorising a script.

## Scoring out of 100

Proposed rubric. Weights are a first guess and should be tuned after real
agents run through it.

| Area | Points | What it measures |
|---|---|---|
| Opening | 15 | Named themselves and the agency, gave a reason for the call, asked for time |
| Discovery | 20 | Asked open questions, uncovered timing, motivation, and constraints before pitching |
| Listening | 15 | Did not interrupt, reflected back what the prospect said, followed threads the prospect opened |
| Objection handling | 20 | Acknowledged before answering, gave a specific response, checked the objection was resolved |
| Close | 15 | Asked for a clear next step, handled hesitation, confirmed details |
| Delivery | 15 | Pace, filler words, talk-to-listen ratio, confidence |

The score comes from two sources. Measured signals come straight from the
audio and transcript: talk-to-listen ratio, interruptions, filler word count,
pace, how long before the first question, and whether the win condition was
reached. Judged signals come from a language model reading the transcript
against the rubric. Did the agent acknowledge the objection? Was the
discovery question open or closed? Was the close specific?

Show the measured numbers as numbers and the judged items as short written
findings with the transcript line they refer to. Agents will trust a score
more when they can see the line that cost them points.

## The feedback report

The report the agent sees after each call, in order:

1. Score out of 100 and pass or fail for the level.
2. Three key takeaways. One thing done well, two things to change. Each one
   quotes the line from the transcript.
3. The full transcript with moments marked: good question, missed objection,
   interruption, filler cluster.
4. Per-area scores against the rubric.
5. "Try this instead" lines for the two weakest moments, taken from the
   scenario's model answers.
6. Delivery stats: talk time, pace, filler words, longest monologue.
7. Trend against their previous attempts at the same scenario.

Keep the tone direct. The agent wants to know what to fix.

## The game layer

The game elements exist to get agents to come back daily. Keep them light.

- Levels and progression, as above.
- Score history per scenario so the agent can see improvement.
- Streaks for consecutive days with at least one completed call.
- Badges for specific skills, such as five calls without an interruption or
  a first booked appraisal at level four.
- A team leaderboard, optional and switchable by the office. Some teams will
  want it and some will not.
- Retry without penalty. The best score counts, not the last one. Agents
  should feel free to fail.

Avoid anything that rewards volume over quality, like points per call. The
score is the point.

## How it would be built

A first version can be a web app. A browser can record voice and play audio
without a native app.

The front end shows the briefing card, runs the call screen with a live
timer, and renders the report. Voice capture goes through the browser's
microphone API.

The AI prospect is three pieces chained together during the call. Speech to
text runs on the agent's audio, streamed so the prospect can respond without
a long pause. A language model plays the prospect, given the persona, the
objection set, and the conversation so far. Claude is the obvious pick here
because the persona and objection triggers can be written in plain language.
Text to speech turns the prospect's replies into voice.

Latency is the hard part. If the prospect takes more than a couple of seconds
to answer, the call stops feeling real. Prototype this piece first, before
building anything else.

Scoring runs after the call. Send the full transcript and the audio metrics
through a second model call with the rubric and the scenario's model answers,
and get back structured output: per-area scores, takeaways with line
references, and the "try this instead" lines. Store all of it.

The data model needs users, teams, scenarios, attempts (audio file,
transcript, scores, report), and progress state. Keep the audio so an agent
or manager can listen back.

An admin screen for writing and editing scenarios matters more than it
sounds, since the scenario library is the product. Lochlan or a trainer
should be able to add a persona and objection set without touching code.

## What to build first

Do not build ten levels. Build one scenario end to end and get real agents to
use it.

1. One scenario at level two (open home follow-up) with a full persona,
   objection set, and model answers.
2. The live call loop with a voice AI prospect. Measure the response delay and
   get it acceptable.
3. Scoring and the feedback report for that one scenario.
4. Put it in front of a handful of agents. Watch them use it. Ask whether the
   score matched their own sense of the call.
5. Only then add scenarios, levels, and the game layer.

## Open questions for Lochlan

- Which call types matter most for the agents this is for? The level list
  above is a guess.
- Is this for one agency, a franchise group, or sold to any agent?
- Should a manager be able to see their team's calls and reports?
- Australian voices and settings only, or does it need to work in other
  markets?
- Should the AI prospect ever be a video avatar, or is voice only fine for the
  first version?
- Do you already have call scripts, objection lists, or training material?
  Those become the first scenarios and model answers.

Next step: answer the open questions, then prototype the live call loop with
one scenario.
