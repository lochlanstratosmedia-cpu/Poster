# StoryScope narrative checks

Word-level editing catches AI phrasing. It does not catch AI *structure*. This
page is a checklist for the structural layer, drawn from StoryScope.

Source: [jenna-russell/storyscope](https://github.com/jenna-russell/storyscope),
"StoryScope: Investigating idiosyncrasies in AI fiction" (Russell, Rajendhran,
Pham, Iyyer, Wieting), [arXiv:2604.03136](https://arxiv.org/abs/2604.03136).

## What the paper found

The authors built a corpus of 10,272 writing prompts, each answered once by a
human author and once by each of five LLMs, for 61,608 stories of about 5,000
words. They then scored every story on 304 narrative features across 10
dimensions.

Three results matter for script work:

- Narrative features alone reach 93.2% macro-F1 at telling human from AI, with
  no style or word-choice signal at all. Structure gives the writer away.
- A compact set of 30 features carries much of that signal.
- AI stories cluster together in narrative space. Human stories spread out.
  The tell is not one bad move, it is the same safe move every time.

## The 10 dimensions

The feature counts and examples below come from the repo's taxonomy table.

| Dimension | Features | What it measures |
|---|---|---|
| Agents | 54 | Character complexity, emotional trajectory, archetype usage |
| Social networks | 39 | Relationship dynamics, power hierarchies, communication patterns |
| Style | 39 | Figurative language, sentence complexity, allusion types |
| Plot | 28 | Conflict structure, resolution type, thematic unity |
| Setting | 27 | Spatial detail, atmosphere, world-building depth |
| Events | 26 | Event causality, escalation patterns, schema types |
| Revelation | 25 | Suspense mechanisms, surprise depth, irony |
| Situatedness | 25 | Genre awareness, thematic explicitness, intertextuality |
| Temporal structure | 24 | Chronological discontinuity, flashback frequency, pacing |
| Perspective | 17 | POV consistency, focalization depth, narrative distance |

## Questions to ask a draft

These are prompts built from the dimension names above, not findings from the
paper. Use them to interrogate a draft. The paper measures these dimensions; it
does not prescribe an answer for any one script.

**Agents.** Does each character want something the story does not hand them? Do
any of them stay wrong about something to the end? Is anyone here an archetype
with a name attached?

**Social networks.** Who has power over whom, and does it shift? Do people talk
past each other, or does everyone say exactly what they mean?

**Plot.** Is the conflict resolved because someone changed, or because the
scene ran out? Does every thread get tied off? Real stories leave some loose.

**Setting.** Which details are specific to this place and could not be moved to
another one? Cut atmosphere that would fit any room.

**Events.** Does each beat cause the next, or do they merely follow it? Does
the escalation only ever go up?

**Revelation.** What does the audience know that the characters do not, and
when? Is the surprise a fact withheld, or a real change in meaning?

**Situatedness.** Is the theme spoken aloud by a character? That is the single
easiest thing to cut.

**Temporal structure.** Does the script run start to finish at an even pace?
Where does time compress or jump?

**Perspective.** Whose head are we in, how close, and does that hold? Sliding
distance is a common giveaway.

## Practical note

The full StoryScope pipeline is a research tool. It needs Python, the story
corpus from Hugging Face or Google Drive, and API keys for OpenAI, Anthropic,
or Vertex to extract features. Its trained XGBoost classifiers score fiction
of roughly 5,000 words, so they do not transfer to short scripts as they are.

Nothing here needs installing. Use the checklist. If we later want the
classifiers, that is a separate build and it needs the dataset downloaded
first.
