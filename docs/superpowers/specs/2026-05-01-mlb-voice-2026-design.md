# MLB-Voice 2026 — Hackathon Redesign

**Status:** draft, pending team review
**Date:** 2026-05-01
**Branch:** `feature/2026-hack`
**Predecessor:** 2025 hackathon build (single commit `f2e3c6c`)

---

## 1. Summary

The 2025 build streamed AI-generated baseball play-by-play to a live HLS audio
player. Each pitch produced a fresh script via OpenAI `gpt-4o`, which Dia 1.6B
TTS turned into audio segments stitched into `playlist.m3u8`. It worked, but
two things kept it from feeling like a real broadcast:

1. The model called every pitch in isolation. It re-read the inning, outs, and
   score on every call, sounding like a scoreboard reader rather than a
   broadcaster.
2. Routine plays and highlight plays were treated identically. Nothing in the
   system understood "this catch was a 17%-probability web gem" or "this is a
   walk-off situation" — so calls were uniformly mid-energy.

The 2026 redesign addresses both, plus adds a between-half-inning ad library
and migrates to Dia2 with prefix-conditioned voices for stable broadcasters.

This spec is the design contract before any code is written.

---

## 2. Goals (in priority order)

1. **Better play-by-play flow.** Smart state injection (only mention what's
   new or relevant), short-term memory (don't repeat phrasing), narrative
   threads (running storylines), and storyline-touch tracking (don't
   over-quote a storyline).
2. **Stats-juiced commentary on highlights.** A deterministic Highlight
   Detector classifies each play (`routine`/`notable`/`highlight`/`holy_shit`),
   curates 1–3 stats worth mentioning, and sets a vibe directive for the LLM.
3. **Silly between-half-inning ads.** Pre-generated library of absurd
   fake-product / old-timey radio ads, framed as "personalized for the
   listener's company." Random selection at half-inning breaks. Zero runtime
   LLM dependency.
4. **Dia2 upgrade.** Migrate to `nari-labs/Dia2-2B` with prefix audio for
   stable `[S1]` (play-by-play) and `[S2]` (color) voices. New API, `uv`
   environment, CUDA 12.8+ on RunPod.

## 3. Non-goals

- **Live game** during demo. Replay-as-live only, starting from a curated
  tense moment in a night-before game.
- **Game-aware ads** (ads that reference what's happening in the game).
- **Real broadcaster impersonation.** Dia2's license forbids it; we use
  archetype voices from a licensed source or friend-recordings.
- **Crowd noise / atmospheric mixing.** Logged as a stretch goal, not in
  plan.
- **Refactor of the Node/Python split.** Keeps as-is (Node = thinking,
  Python = voice).
- **New player UI.** `hls_player.html` stays.

## 4. Phasing

Two phases, sequenced by risk and dependency rather than goal priority. The
non-negotiable: **the Phase 1 demo must work even if Phase 2 doesn't ship.**

### Phase 1 — "It flows" (Weeks 1–3)

End-to-end working system using prompt/context engineering only. Covers all
four goals above.

| Week | Work |
|---|---|
| 1 | Dia2 migration on RunPod. Voice prefixes recorded/sourced. End-to-end smoke test (existing prompt → Dia2-2B → HLS → audible). Unblocks everything else. |
| 2 | GameStateService with Statcast + WP/leverage. NarrativeThreadEngine (Phase 1 thread catalogue). ScriptGenerator with new memory subsystem. Smart state injection in place. |
| 3 | HighlightDetector + two-stage prompting. Pre-generated ad library (script gen + render). The three Phase-1 demo scenarios curated and rehearsed (Section 8). Final integration. |

### Phase 2 — "Fine-tune cherry on top" (Week 4)

Optional layer, scope-droppable.

- Curate ~300–500 examples from Phase 1 logs.
- Fine-tune `gpt-4.1-mini` (or whatever supports it best at the time).
- A/B replay test against Phase 1 baseline. Swap in only if win-rate >60%.

---

## 5. Architecture

```
                         ┌──────────────────────────────────────────────┐
                         │  Local dev box OR RunPod (same code)          │
                         │                                               │
   MLB Stats API ──────► │  GameTicker (Node)                            │
   (timestamps)          │  - polls timestamps endpoint                  │
                         │  - emits play events                          │
                         │            │                                  │
   Baseball Savant ────► │  GameStateService (Node)                      │
   (pybaseball cache)    │  - GUMBO normalizer                           │
                         │  - Statcast lookups (cached)                  │
                         │  - WP / leverage computed locally             │
                         │            │                                  │
                         │  NarrativeThreadEngine (Node)                 │
                         │  - tracks active storylines                   │
                         │            │                                  │
                         │  HighlightDetector (Node)                     │
                         │  - classifies + curates stats + vibe          │
                         │            │                                  │
                         │  ScriptGenerator (Node)                       │
                         │  - smart state injection                      │
                         │  - GameSummary + HalfInningMemory             │
                         │  - storyline-touch tracker                    │
                         │  - gpt-5 (Phase 1) → fine-tune (Phase 2)      │
                         │            │                                  │
                         │       half-inning ──► AdLibrary (static wavs) │
                         │            │                                  │
                         │            ▼                                  │
                         │   HTTP { script, voice_set }                  │
                         └────────────┬──────────────────────────────────┘
                                      │
                          ┌───────────▼────────────────┐
                          │  TTSService (Python, Flask) │
                          │  RunPod (CUDA 12.8+)        │
                          │  - Dia2-2B + prefixes       │
                          │  - dev fallback: OpenAI TTS │
                          └────────────┬────────────────┘
                                       │
                          ┌────────────▼────────────────┐
                          │  HLSSegmenter (Python)       │
                          │  - segments queue/*.wav      │
                          │  - silence padding           │
                          │  - playlist.m3u8 updates     │
                          └────────────┬────────────────┘
                                       │
                                       ▼
                              hls_player.html (browser)
```

### Boundary rules

- Every component reads/writes a single canonical shape: `EnrichedPlay`.
  Raw GUMBO blobs never escape `GameStateService`.
- The HighlightDetector is rules-based, not LLM-based. Cheap, deterministic,
  unit-testable, and the lever for tuning hype-vs-calm calls.
- Ads are off-line of the play pipeline. AdLibrary is static `.wav` files;
  at half-inning breaks, GameTicker enqueues an ad file directly.
- One env var (`TTS_BACKEND=dia2|openai`) flips between RunPod-Dia2 and a
  local OpenAI TTS stand-in. Same Flask service.
- Voice prefixes (`broadcaster_s1.wav`, `ad_s1.wav`, etc.) live on the
  Python side. ScriptGenerator emits `[S1]`/`[S2]` text only.

---

## 6. Components

### 6.1 GameTicker (Node, `src/gameTicker.js`)

- **Responsibility:** poll MLB Stats API timestamps, walk the timestamp list
  from a chosen starting point, emit GUMBO snapshots.
- **Inputs:** game ID, starting timestamp, optional speed multiplier (e.g.,
  2× for compressed-replay dev runs), optional `--scenario <name>` flag
  (Section 8).
- **Outputs:** raw GUMBO snapshots.
- **Modes:**
  - **Replay (default).** As today: walk timestamps from a chosen start until
    the end of the game (or a Ctrl-C).
  - **Scenario.** Loads `scenarios/<name>.yaml`, hydrates bootstrap state
    into GameSummary + NarrativeThreadEngine, walks only the configured
    play range, then stops cleanly.
- **Cleanup vs 2025:** factor out from the inline loop in
  `gameScripting.js`; add the speed multiplier; add scenario mode.

### 6.2 GameStateService (Node, `src/gameState/`)

- **Responsibility:** convert raw GUMBO snapshots into the canonical
  `EnrichedPlay` consumed by every downstream component.
- **Sub-services:**
  1. `GumboNormalizer` — pure function, GUMBO → most fields.
  2. `StatcastClient` — wraps `pybaseball` via a thin Python helper exposed
     by TTSService over HTTP (same `uv` env as Dia2). Heavily cached:
     per-player season stats once per game; per-play fielding stats only
     when the play is a ball in play. (A JS-only port is a fallback if the
     HTTP shim turns out to be a latency problem; not the default.)
  3. `WinProbabilityCalculator` — pure function, lookup-table based.
  4. `LeverageCalculator` — pure function.
- **`EnrichedPlay` shape (illustrative):**
  ```
  EnrichedPlay {
    play_id, timestamp,
    inning, half, outs, balls, strikes,
    batter   { id, name, season_stats },
    pitcher  { id, name, season_stats },
    runners  { first, second, third },
    score    { home, away, home_team, away_team },
    on_deck  { id, name },
    pitch    { type, velocity, spin, location },
    hit      { exit_velocity, launch_angle, distance,
               expected_ba, hit_hardness },
    fielding { catch_probability, sprint_speed,
               distance_covered, fielder_name },
    derived  { leverage_index, win_probability,
               wp_swing_from_prior, late_and_close,
               risp, two_outs_risp, lead_runs },
    result_text,
    is_state_change { half_inning, inning, score, outs }
  }
  ```
- The `is_state_change` flags are the lever ScriptGenerator uses to omit
  inning/outs/score from prompts when nothing changed.

### 6.3 NarrativeThreadEngine (Node, `src/threads/`)

- **Responsibility:** maintain a list of active storylines; return them
  per-play with weight + prose hint.
- **Output shape:** `[{ id, weight, hint }, ...]`.
- **Phase 1 thread catalogue** (deterministic predicates, all in
  `src/threads/registry.js`):

  | Thread ID | Triggers when | Decays |
  |---|---|---|
  | `pitcher_struggling` | ≥2 walks or 3+ hard-hit balls in last 5 BF | 6 BF clean |
  | `pitcher_dealing` | ≥4 K's in last 6 BF or no hard contact in 8 BF | hard contact / walk |
  | `pitcher_pitch_count` | pitch_count > 85 | pitcher exits |
  | `extended_inning` | ≥4 batters this half-inning | inning ends |
  | `comeback_brewing` | trailing team scored 2 of last 3 half-innings *and* deficit ≤3 | next 0-run inning |
  | `same_score_drought` | ≥4 half-innings since either team scored | a run scores |
  | `leverage_spike` | leverage_index +0.5 this play | 1 play |
  | `late_and_close` | inning ≥7 *and* run differential ≤2 | game ends |
  | `risp_jam` | RISP, ≤1 out, leverage > 1.5 | jam resolves |
  | `rare_event` | triple, error, balk, HBP, wild pitch, passed ball, shift highlight | 1 play |
  | `home_run_recent` | HR this inning | end of inning |
  | `streak_at_plate` | batter has 2+ hits this game | rest of game |

- **Adding a thread = appending an object to the registry.** No retraining,
  no system changes.

### 6.4 HighlightDetector (Node, `src/highlightDetector.js`)

- **Responsibility:** classify each play and select stats to mention.
- **Output:** `HighlightVerdict { classification, triggers, stats_to_mention,
  vibe, suggested_length_seconds }`.
- **Classification rules:**

  | Classification | Triggers (any) |
  |---|---|
  | `holy_shit` | HR with WP swing ≥0.20, walk-off, catch prob ≤20%, exit velo ≥115 mph, leverage ≥4.0 with hit |
  | `highlight` | HR (any), catch prob ≤40%, exit velo ≥108, WP swing ≥0.10, K with bases loaded, double play, error in `late_and_close` |
  | `notable` | XBH, K with RISP, runner advance, exit velo ≥100, leverage ≥1.8 |
  | `routine` | everything else |

- **Vibe → directive (passed to LLM in system prompt):**
  - `calm` → "Keep it tight, factual, conversational. Don't oversell."
  - `energetic` → "This was a notable play. Match the energy of the moment."
  - `big_moment` → "This is a highlight. Sustain the call, let S2 react with weight, mention the stat."
  - `explosive` → "This is a holy-shit moment. Sustained call, dramatic pause, S2 disbelief, full stat dump where natural."

- **Stat curation** is a small lookup table from `(classification × play_type)` to which fields of `EnrichedPlay` to surface (catch probability + sprint speed + distance for defensive web gems; exit velocity + projected distance + xBA for monster shots; etc.).

### 6.5 ScriptGenerator (Node, `src/scriptGenerator.js`)

- **Responsibility:** build the LLM prompt and produce the `[S1]/[S2]` script.
- **Inputs:** `EnrichedPlay`, `ActiveThreads[]`, `HighlightVerdict`,
  `GameSummary`, `HalfInningMemory`, `TouchedStorylines`.
- **Output:** the script string for TTSService.
- **Model:** Phase 1 = `gpt-5`; Phase 2 = fine-tuned `gpt-4.1-mini` (swap via
  `SCRIPT_MODEL` env var; no code change).

#### Memory subsystem

Three stores, each with a clear lifecycle:

##### A. `GameSummary` — persists across the whole game

- **Structured event log** (deterministic, append-only). One line per
  noteworthy event (scoring, lead change, pitcher change, HR, K with bases
  loaded, anything `notable`+). Routine plays excluded.
- **Prose recap** (LLM-generated, refreshed at every half-inning end).
  ~3 sentences. Regenerated from the structured log to avoid compounding
  drift.
- **Mid-game start bootstrap:** for replay-as-live demos that start in the
  middle of a game, walk all prior plays through the structured-log builder
  at startup. Then generate the first prose recap. Instant; no audio
  rendered for skipped plays.

##### B. `HalfInningMemory` — resets every half-inning

- Full text of every spoken script in the current half-inning.
- Cap: 12 scripts.
- Reset when `half_inning` or `inning` changes.
- Passed to LLM with directive *"Do not repeat phrasing, jokes, or storylines you've already covered this inning."*

##### C. `TouchedStorylines` — cooldown tracker

- Each fact in the structured event log and each active thread has a stable
  ID (e.g., `event:vladdy_hr_t4`, `thread:pitcher_dealing`).
- After each generated script, a post-pass keyword/substring match against
  fact/thread keywords logs `(id, last_play_n)`.
- Before the next call, prompt-builder annotates each fact/thread with one
  of: `(fresh)`, `(mentioned 1 play ago — DO NOT touch unless new development)`,
  `(mentioned 4 plays ago — okay if natural)`, or `(fully fresh again)`.
- **Default cooldowns:**
  - Long-arc storyline → 5 strict + 5 soft = 10 plays.
  - Discrete event → 3 strict + 4 soft = 7 plays.
  - Highlight stat → 2 strict, then fresh.
- **Why post-pass keyword match instead of LLM self-tagging:** cheap,
  deterministic, debuggable, and avoids the "model lies about what it
  actually said" failure mode.

#### Prompt construction

1. **System message** — broadcaster personas, format rules, the
   HighlightVerdict's vibe directive (resets cleanly each call).
2. **Game-state block (user message)** — built by `pickStateFields(...)`:
   include a field only if (a) it changed since the last spoken call,
   (b) it's new in the last 5 seconds, (c) the HighlightDetector listed it
   in `stats_to_mention`, or (d) it's a permanent field (count, batter,
   pitcher).
3. **GameSummary block (user message)** — the prose recap.
4. **Threads block (user message)** — active threads with cooldown
   annotations. Framed as optional: *"Use any of these if natural; ignore
   them if they don't fit. Storylines marked DO NOT touch are off-limits."*
5. **HalfInningMemory block (user message)** — last spoken scripts this
   inning, prefixed *"You just said:"*.
6. **Stats-to-mention block (user message, only when classification ≠ routine)** — curated stats from the verdict. *"Use 1–3 of these naturally."*
7. **Play sentence (user message)** — short single sentence describing what
   just happened.

Token budget: ~1.5–2k per call; comfortably affordable on `gpt-5`.

#### Failure modes

- LLM timeout → retry once → templated fallback (`"And the pitch — <result_text>."`).
- Malformed `[S1]/[S2]` → validator → retry with stricter prompt → fallback.
- Empty thread list + `routine` classification → still generates, just shorter.

### 6.6 AdLibrary

#### Offline pipeline (`scripts/genAds.js`, `scripts/renderAds.js`)

- `genAds.js` reads `data/ad_products.json` + `data/ad_templates.json`,
  calls `gpt-5` per (product, template) pairing, writes scripts to
  `data/ad_scripts/<id>.txt` for review.
- `renderAds.js` walks approved scripts through the TTSService (using the
  `ad_announcer` voice set) and writes `.wav` files to `ads/<id>.wav`.
- The two-step (script-then-render) is deliberate: read every script
  before paying TTS time.

#### Runtime selector (in GameTicker)

- On `half_inning` flip, picks a `.wav` filename from `ads/` (random,
  with last-5-played avoidance) and POSTs to TTSService's
  `/enqueue_ad` endpoint. The TTSService copies the file into `queue/`
  where the existing HLS segmenter loop picks it up like any other
  generated wav.
- Tracks last 5 ads played to avoid repeats.
- Config: `ADS_PER_BREAK` (default 1).
- ~30 lines. No runtime LLM call. No runtime TTS call.

#### Deferred to a future content session

- Actual fake-product list (the "products my company would purchase").
- Template library (4–6 distinct ad shapes — straight pitch, testimonial,
  jingle, public-service-announcement parody, etc.).
- Voice direction for ad announcer (broadcaster prefixes vs. dedicated
  ad-announcer prefixes).
- Music bed / sound effects.
- Length targets per ad (15s vs 30s).

### 6.7 TTSService + HLSSegmenter (Python, `server.py`)

- **Endpoints:**
  - `POST /generate` — `{ text, voice_set?: 'broadcaster' | 'ad_announcer' }`
    → runs Dia2 (or OpenAI dev fallback), writes wav to `queue/`.
  - `POST /enqueue_ad` — `{ filename }` — copies a pre-rendered wav from
    `ads/` into `queue/` so the segmenter picks it up. Used by AdLibrary
    at half-inning breaks.
  - `POST /statcast` — `{ kind, params }` → thin wrapper over `pybaseball`
    for catch-probability / sprint-speed / season aggregates lookups
    called from Node-side `StatcastClient`.
  - `POST /start_hls`, `GET /hls/<file>`, `GET /`, `GET /health`.
- **Dia2 integration:**
  ```python
  from dia2 import Dia2, GenerationConfig, SamplingConfig
  model = Dia2.from_repo("nari-labs/Dia2-2B", device="cuda", dtype="bfloat16")
  config = GenerationConfig(
      cfg_scale=2.0,
      audio=SamplingConfig(temperature=0.8, top_k=50),
      use_cuda_graph=True,
      prefix_speaker_1="prefixes/broadcaster_s1.wav",
      prefix_speaker_2="prefixes/broadcaster_s2.wav",
  )
  result = model.generate(text, config=config, output_wav=f"queue/{ts}.wav", verbose=True)
  ```
- **Voice prefixes:** `prefixes/broadcaster_{s1,s2}.wav` (play-by-play) and
  `prefixes/ad_{s1,s2}.wav` (ads). Re-encoded once at startup so Whisper
  transcription cost is not paid per request.
- **Dev backend (`TTS_BACKEND=openai`):** strips `[S1]/[S2]`, alternates
  two OpenAI voices, produces wav. Not meant to sound great — just
  validates the pipeline without GPU. Demo always uses Dia2.
- **HLSSegmenter cleanups:** marker file for silence detection (replace
  filename substring match), graceful shutdown, `/health` exposes sequence
  number and queue depth.
- **Removals:** `server2.py`, `server3.py`, `app.py`, `socket.js`. Single
  source of truth.

### 6.8 Phase 2 — Fine-tuning

- **Goal:** less prompt scaffolding, more consistent style. Not "10x
  better."
- **Training data:** Phase 1's runtime `scripts.jsonl` log (Section 7.4) —
  every `(inputs → output)` tuple is a training row.
- **Curation:** ~300–500 examples, hand-flagged `keep`/`reject`/`edit`,
  stratified across all four classifications.
- **Format:** OpenAI fine-tune messages format. The system prompt during
  training is the *simplified* version we want to use at inference.
- **Model choice:** `gpt-4.1-mini` is the current sweet spot; reconfirm at
  training time.
- **Evaluation:**
  1. A/B replay test on a held-out half-inning (internal listening).
  2. Teacher-LLM win-rate on ~50 paired outputs. Need >60% to swap.
- **Swap mechanism:** `SCRIPT_MODEL` env var. No code change.
- **Risk-managed:** if Week 4 doesn't land, Phase 2 is dropped without
  harm. Phase 1 is the demo.
- **What Phase 2 is NOT:** not from-scratch training, not LoRA on
  open-source, not Dia2 fine-tuning. Voice consistency comes from prefix
  conditioning.

---

## 7. Development Log (hard requirement)

We are keeping a running engineering journal of every change made to the
2025 codebase, every architectural decision taken, and every dead-end
explored. The goal is **team-presentation-ready material lifted directly
from the journal**, not crafted after the fact.

This is a hard rule. Every meaningful change requires a journal entry
*before* the implementation work is considered complete.

### 7.1 What gets a journal entry

- Every meaningful code change to a 2025 file (rename, replace, delete,
  major refactor). One-line cleanups don't need an entry.
- Every new module/component introduced.
- Every architectural decision (e.g., "chose `pybaseball` over a JS port
  because…", "kept Node/Python split because…").
- Every dead-end / thing-we-tried-and-it-didn't-work, with what we
  learned.
- Every significant performance, cost, or quality observation worth
  remembering.

### 7.2 Format

Single markdown file: `docs/dev-log.md`. Reverse-chronological. Each entry
follows the same shape:

```markdown
## 2026-05-08 — HighlightDetector landed; thresholds tuned on SDatTOR replay

**What changed**
- New `src/highlightDetector.js` (~120 LOC).
- Wired into pipeline between NarrativeThreadEngine and ScriptGenerator.
- Old prompt's hard-coded "always pass exit velocity" removed from
  `ScriptGenerator`.

**Why**
The 2025 system gave the LLM every stat every play and let it editorialize
intensity. That's exactly why routine plays sounded the same as highlight
plays. Pulling classification + stat selection out into deterministic code
lets us tune knobs without re-prompting.

**What I tried and dropped**
- First pass used a single `score: number` instead of a discrete
  classification. Worked, but made vibe directives weird ("how excited is
  '0.62 excited'?"). Discrete tiers are simpler to map to prompt language.

**Demo / presentation hooks**
- Replay of B5 of SDatTOR shows the system staying calm on a routine
  groundout, then escalating when the next pitch was an exit-velo-112
  double.
- Slide-ready quote: *"The HighlightDetector is the single biggest quality
  lever in the system because it pulls the editorial decision out of the
  language model and into deterministic, debuggable code."*
```

### 7.3 Implementation rules

To make this real and not aspirational:

1. **Journal entry is part of the definition-of-done.** A pull request
   that doesn't touch `docs/dev-log.md` for a meaningful change is
   incomplete. (Self-enforced; no PR review process during the hackathon.)
2. **Write entries while the work is fresh.** If the change took two
   sessions, the entry is written at the end of the second session, not a
   week later when details have faded.
3. **Demo / presentation hooks are mandatory** for any entry that produced
   something audible or visible. One sentence is enough — but it has to be
   there. This is what turns the journal into presentation material.
4. **Dead-ends count.** Every "I tried X but Y happened" is gold for the
   presentation — judges and teammates love the "here's what didn't work"
   slides more than the success-path slides.

### 7.4 Lightweight runtime logs (separate concern)

For Phase 2 fine-tune training data and bad-call post-mortems, the
ScriptGenerator writes one JSONL line per generated script to
`logs/<game_id>_<starting_ts>/scripts.jsonl` containing the full prompt,
the response, the active threads at the time, and the highlight verdict.
This is a single-line addition in ScriptGenerator — not a full
observability platform — and it exists for Phase 2 training, not for the
presentation.

---

## 8. Demo Scenarios (canned runs)

The replay-as-live setup is great for development, but a 9-inning replay is
too long for a 5-minute demo and too unpredictable to script around. We
pre-curate **three scenarios** — each a small, deterministic slice that
targets a specific story we want the demo to tell.

### 8.1 Scenario descriptors

Each scenario is a YAML file at `scenarios/<name>.yaml`:

```yaml
name: go_ahead_homer
title: "Go-Ahead Home Run"
description: |
  Late-and-close, runner on, trailing team takes the lead with one swing.
  Demos the HighlightDetector firing holy_shit and the system sustaining
  an explosive call.

source:
  game_json: data/games/<TBD>.json      # user-provided when we curate scenarios
  start_play: 142                        # play index (or timestamp string)
  stop_after_play: 145                   # 3 plays of context + HR + reaction
  speed: 1.0                             # real-time

bootstrap:
  game_summary: |
    Bottom 8, Padres trail 4-3. Cease has been dealing all night.
    Tatis up, Bogaerts on second after a leadoff double.
  pre_active_threads:
    - late_and_close
    - risp_jam
    - pitcher_dealing
  pre_touched_storylines: []

demo:
  expect_classification: holy_shit
  what_to_listen_for: "Sustained call, S2 disbelief, exit velocity surfaced naturally"
  expected_runtime_seconds: 45
```

The descriptor lets us:

- Skip mid-game bootstrap of the GameSummary — it's prefilled.
- Pre-seed the NarrativeThreadEngine with active threads so the very
  first call sounds like a real broadcast already in progress, not a cold
  start.
- Stop the run cleanly without walking the rest of the game.
- Document, in version-controlled YAML, exactly what the demo is supposed
  to show — useful for the dev log and for handing the demo off to a
  teammate.

### 8.2 Phase 1 scenarios

| Scenario | Story it tells | Runtime |
|---|---|---|
| `standard_game` | Routine play-by-play across 4–6 plays in a mid-inning, mid-game stretch. Mix of routine and notable plays. Shows the system staying calm, weaving threads naturally, *not* re-reading the scoreboard every pitch. The "does it sound like a real broadcast?" answer. | ~90s |
| `go_ahead_homer` | Late-and-close go-ahead HR. Shows HighlightDetector firing `holy_shit`, sustained explosive call, exit velocity / WP swing surfaced naturally, S2 reacting with weight. The "does it know when to lose its mind?" answer. | ~45s |
| `inning_break_into_ads` | Final out of a half-inning, pre-generated ad kicks in via AdLibrary, broadcast picks back up at top of next half-inning with a refreshed GameSummary recap. The "does it have real broadcast structure?" answer. | ~75s |

Each Phase-1 scenario lives in `scenarios/`, version-controlled, with
the YAML *and* a sibling `<name>.notes.md` capturing why this slice was
picked, what we expect to hear, and demo-day talking points.

**Source games are user-provided when we reach the curation step
(Week 3).** When that step is hit, the user will identify three night-before
games containing the desired moments (a routine stretch with mixed plays,
a go-ahead HR, a clean inning-end) and supply the GUMBO JSONs. The
implementation builds the scenario plumbing first against the existing
2025 sample JSONs as smoke tests, then swaps in the curated games once
they're delivered.

### 8.3 Demo-day operations

A small wrapper at `scripts/demo.sh` exposes the three scenarios as
one-keystroke commands:

```bash
./scripts/demo.sh standard
./scripts/demo.sh homer
./scripts/demo.sh ads
```

Each command:

1. Wipes the HLS queue and pads `playlist.m3u8` with silence so the
   browser starts from a clean state.
2. Starts the relevant scenario via `node src/gameTicker.js --scenario <name>`.
3. Tails the console summary so the operator can see classifications/threads
   on screen during the demo.
4. Exits cleanly when the scenario's `stop_after_play` is reached.

Demo day reduces to: open the HLS player URL, run one of three commands,
point at the speakers, and talk.

### 8.4 Why this is a first-class concept, not a hack

- **Demo predictability.** A live or full-game replay can do anything;
  scenarios always demo what we want to demo.
- **Tuning harness.** Each scenario doubles as a regression test for
  the HighlightDetector thresholds and the cooldown defaults — re-run the
  same scenario, listen, tweak, re-run. (This is how Week 3 tuning
  actually happens.)
- **Hand-off ready.** A teammate can run the demo without knowing the
  internals.
- **Dev log gold.** Each scenario's `<name>.notes.md` is exactly the kind
  of presentation material the dev-log rule is meant to produce.

---

## 9. Environment & deployment

### 9.1 Dev (local)

- Node + Python on the developer's machine.
- `TTS_BACKEND=openai` — TTS via OpenAI `gpt-4o-mini-tts` stand-in.
- `SCRIPT_MODEL=gpt-5`.
- `pybaseball` reachable via TTSService's `/statcast` endpoint (same `uv`
  env as Dia2).
- Runtime `scripts.jsonl` writes to `./logs/<game_id>_<ts>/`.
- Dev log `docs/dev-log.md` updated as work happens.

### 9.2 Demo (RunPod)

- CUDA 12.8+ image, single GPU (≥24GB VRAM is comfortable; ≥12GB is the
  floor).
- `uv sync` in startup hook to install Dia2 + deps.
- Voice prefix files baked into the image at known paths.
- `TTS_BACKEND=dia2`, `SCRIPT_MODEL=gpt-5` (or fine-tune ID if Phase 2
  shipped).
- Node services run on the same box for simplicity (no cross-machine
  latency in the demo).
- Logs written to `./logs/` and (optionally) tarred + downloaded after the
  demo for the presentation extractor.

### 9.3 Secrets

- `OPENAI_API_KEY` — required.
- `MLB_STATS_*` — public API, no key needed.
- `pybaseball` — Baseball Savant scraping; no key.
- All secrets via `.env` files (already gitignored).

---

## 10. Risks & open questions

| Risk | Mitigation |
|---|---|
| Dia2 streaming server is "upcoming" — only the Python API is GA today. | Use the Python API; we already accept ~2s TTS latency per call. Don't bank on the streaming server arriving. |
| Voice prefix sourcing (ToS-clean and good-sounding) is a real research task. | Allocate ~half a day in Week 1. Friend-recordings are the fallback if licensed libraries don't have what we want. |
| Statcast/`pybaseball` could be slow or rate-limited. | Heavy caching. Per-game season-stats fetch happens once at startup. Catch-probability + sprint-speed only fetched on balls in play. |
| Highlight thresholds picked by intuition could miss. | Replay-test against a known game; tune thresholds before demo. The replay-as-live setup is exactly the right harness. |
| Phase 2 fine-tune underperforms or doesn't ship. | Phase 2 is scope-droppable. Phase 1 is the demo. |
| Repetition of `GameSummary` references across calls. | TouchedStorylines cooldown system + post-pass keyword match. Default cooldowns tunable. |
| First-time Dia2 startup is slow (download weights + Whisper transcribe prefixes). | Bake into RunPod startup so the demo is hot. |

### Deferred (intentional)

- Ad content design (products, templates, voice direction, music bed).
  Future content session.
- Source games for the three Phase-1 demo scenarios (Section 8).
  User-provided in Week 3.
- Crowd noise / atmospheric audio. Stretch goal, not in plan.
- Phase 3 storylines (battery been together all year, manager hot seat,
  rubber game of the series). Next year.
- Refactor of Node/Python split into one language. Not blocking anything.

---

## 11. Appendix — file structure (illustrative)

```
mlb-voice/
├── docs/
│   ├── dev-log.md                           ← engineering journal (hard rule)
│   └── superpowers/specs/2026-05-01-mlb-voice-2026-design.md  ← this file
├── data/
│   ├── ad_products.json                     ← deferred
│   ├── ad_templates.json                    ← deferred
│   └── ad_scripts/                          ← scripts under review
├── ads/                                     ← rendered ad wavs
├── prefixes/
│   ├── broadcaster_s1.wav
│   ├── broadcaster_s2.wav
│   ├── ad_s1.wav
│   └── ad_s2.wav
├── src/
│   ├── gameTicker.js
│   ├── gameState/
│   │   ├── index.js
│   │   ├── gumboNormalizer.js
│   │   ├── statcastClient.js
│   │   ├── winProbability.js
│   │   └── leverage.js
│   ├── threads/
│   │   ├── engine.js
│   │   └── registry.js
│   ├── highlightDetector.js
│   ├── memory/
│   │   ├── gameSummary.js
│   │   ├── halfInningMemory.js
│   │   ├── touchedStorylines.js
│   │   └── cooldowns.js
│   ├── scriptGenerator.js
│   ├── adLibrary.js
│   └── logger.js
├── scenarios/
│   ├── standard_game.yaml
│   ├── standard_game.notes.md
│   ├── go_ahead_homer.yaml
│   ├── go_ahead_homer.notes.md
│   ├── inning_break_into_ads.yaml
│   └── inning_break_into_ads.notes.md
├── scripts/
│   ├── genAds.js
│   ├── renderAds.js
│   └── demo.sh                              ← one-keystroke scenario runner
├── server.py                                ← Flask + Dia2 + HLS
├── pyproject.toml                           ← uv-managed Dia2 env
├── hls_player.html
├── package.json
├── .env
└── logs/
    └── <game_id>_<ts>/
        └── scripts.jsonl                    ← Phase 2 training data
```

---

*End of design.*
