# MLB rAIdio — Friday 2026-05-29 Presentation

Outline for a 18–25 slide deck. Take into PowerPoint / Google Slides / Keynote
and flesh out each bullet into talking points. Tone: mixed audience —
engineers and non-engineers. Explain the jargon on first mention; assume
nothing.

---

## Slide 1: Title

- **MLB rAIdio** — a live AI-generated MLB radio broadcast
- Two-announcer booth (play-by-play + color) over a streaming HLS audio feed
- Built on a fully modular per-play pipeline: game state → narrative threads → memory → highlight classification → script → voice → stream
- Presenter: *[TODO: confirm with user]*
- Date: 2026-05-29

## Slide 2: What is this, really?

- You open a web page. Click play.
- A baseball game is happening right now somewhere (or being replayed as if it were live)
- Within seconds you're hearing two distinct announcers calling it
- Count, outs, runners on base — all updating live on screen
- No human in the booth. The whole broadcast is generated play-by-play, end to end
- *[TODO: confirm with user — open with "what it is" or open with "the problem"?]*

## Slide 3: Why bother?

- "AI announcer" is easy to demo as a parlor trick. Hard to make it feel like a *broadcast*
- The 2025 prototype could speak. It couldn't *call a game*
- Two specific failure modes we set out to fix in 2026:
  1. Sounded like a scoreboard reader — re-stated inning/outs/score every pitch
  2. Routine plays and walk-off home runs got the same flat energy
- The 2026 build is the answer to both

## Slide 4: The 2025 starting point

- Single-file `game.js` walking MLB's GUMBO play-by-play feed
- One `server.py` doing TTS (Dia 1.6B on a CUDA RunPod box) + HLS segmenting
- Voice was working. Pipeline was a brittle monolith
- Quote from the design doc: *"It worked, but two things kept it from feeling like a real broadcast"* (the scoreboard-reader problem and the flat-energy problem)
- Foundation was sound enough to demo. Not sound enough to extend

## Slide 5: The 2026 goals

- **Better play-by-play flow** — smart state injection, short-term memory, narrative threads (running storylines)
- **Stats-juiced commentary on big plays** — deterministic highlight classifier picks 1–3 stats and sets a "vibe"
- **Silly between-half-inning ads** — pre-rendered library of absurd fake-product radio spots
- **Voice upgrade** — originally targeted Dia2 with prefix-conditioned voices; eventually pivoted to ElevenLabs (more on that later)
- Two phases planned: Phase 1 = the whole working system, Phase 2 = optional fine-tune cherry on top

## Slide 6: The pipeline shape

- For every single play, this runs:
  - **GameTicker** — polls MLB Stats API, walks timestamps, emits GUMBO snapshots
  - **GameStateService** — normalizes GUMBO into one canonical `EnrichedPlay` (count, runners, score, pitch data, win probability, leverage index, what-just-changed flags)
  - **NarrativeThreadEngine** — checks 12 storyline predicates (pitcher dealing? late and close? streak at the plate?)
  - **HighlightDetector** — rules-based tier: `routine` / `notable` / `highlight` / `holy_shit`
  - **ScriptGenerator** — builds the LLM prompt, generates the `[S1]`/`[S2]` script
  - **TTSService** — turns the script into audio, drops it into the HLS stream
- One canonical shape (`EnrichedPlay`) flows between all of them. Raw GUMBO never leaves the first stage

## Slide 7: Two design choices that mattered

- **Rules-based HighlightDetector, not LLM-based**
  - Cheap. Deterministic. Unit-testable. Tunable without re-prompting
  - Pulls the editorial decision (how excited should we be?) out of the language model and into code we can debug
- **Smart state injection** (`pickStateFields`)
  - The LLM only sees inning/outs/score when they *changed*, not every pitch
  - Always sees count + batter + pitcher
  - Single biggest fix for the "scoreboard reader" problem from 2025

## Slide 8: What "narrative threads" means

- Plain language: storylines a broadcaster would naturally track
- 12 of them in the system right now, each a small predicate over the last 30 plays:
  - `pitcher_dealing` — 4+ Ks in last 6 batters, or 8 straight balls with no hard contact
  - `pitcher_struggling` — 2+ walks or 3+ hard-hit balls in last 5 batters
  - `late_and_close` — inning 7+, run differential ≤ 2
  - `risp_jam` — runners in scoring position, ≤1 out, leverage > 1.5
  - `streak_at_plate` — batter already has 2+ hits this game
  - `extended_inning`, `comeback_brewing`, `same_score_drought`, `pitcher_pitch_count`, `home_run_recent`, `rare_event`, `leverage_spike`
- Active threads get passed to the LLM as optional hints — *"use any of these if natural; ignore them if they don't fit"*
- Adding a new thread = appending an object to a registry file. No training, no system changes

## Slide 9: What "highlight tiers" means

- Every play classified into one of four buckets by deterministic rules:
  - `routine` — strike, ball, easy grounder. Default
  - `notable` — XBH, K with runners in scoring position, exit velocity ≥ 100
  - `highlight` — home run, K with bases loaded, low catch-probability defensive play, double play
  - `holy_shit` — HR with big win-probability swing, walk-off, exit velo ≥ 115, leverage ≥ 4.0 hit
- Each tier maps to a "vibe directive" baked into the LLM system prompt:
  - calm / energetic / big_moment / explosive
- Plus 1–3 curated stats the script generator can surface naturally (exit velocity, catch probability, win-prob swing)

## Slide 10: Memory subsystem — three stores, three lifecycles

- **GameSummary** — persists the whole game
  - Append-only structured log of notable+ plays
  - ~3-sentence LLM prose recap regenerated at every half-inning boundary
  - Regenerated from the deterministic log so it can't drift
- **HalfInningMemory** — resets every half-inning
  - The actual text of every script spoken this inning
  - Passed to the LLM with *"do not repeat phrasing or storylines you've already covered this inning"*
- **TouchedStorylines** — cooldown tracker
  - Post-pass keyword match against generated scripts (cheap, deterministic, debuggable)
  - Threads / events / stats get cooldown labels: `strict` / `soft` / `fresh`
  - Why post-pass match instead of asking the LLM to self-tag? Avoids the "model lies about what it just said" failure mode

## Slide 11: Building it — 30 tasks across three weeks

- Numbered plan in `docs/superpowers/plans/2026-05-03-mlb-voice-2026.md`
- Phase 1 = Tasks 1–30 (three weeks, the whole demo)
- Phase 2 = Tasks 31–35 (fine-tune sketch, explicitly scope-droppable)
- Every meaningful change required a journal entry in `docs/dev-log.md`
- Dev log was written *while the work was fresh*, not reconstructed after — so it includes the "what I tried and dropped" stories. Most of this deck came out of it

## Slide 12: Build cluster — Foundation (Tasks 1–7)

- Project scaffolding, directory layout, `.gitignore`
- Test frameworks: vitest (Node), pytest (Python via `uv`)
- Structured `Logger` (stage / info / error, runId-tagged so the whole pipeline is one `grep`)
- Rewrote `server.py` from scratch as a single file with pluggable TTS backends (stub / openai / dia2 — elevenlabs added later)
- End-to-end smoke test: existing 2025 prompt → new server → HLS → audible in browser
- Deleted dead 2025 files (`server2.py`, `server3.py`, `app.py`, `socket.js`) — single source of truth

## Slide 13: Build cluster — Game state + Statcast (Tasks 8–11)

- `EnrichedPlay` — the single shape every downstream component consumes
- `GumboNormalizer` — pure function, MLB GUMBO → `EnrichedPlay`
- `WinProbability` + `LeverageIndex` — Phase-1 simplified math (sigmoid-ish lead ramp, late-inning amplifier). Good enough for vibe detection, swappable later
- `StatcastClient` — HTTP shim into a `pybaseball` wrapper on the Python side, with 24-hour in-process cache
- `GameStateService` — the composer that wires it all together and tracks prior snapshot / prior WP so we can compute "what changed" and "WP swing from this play"

## Slide 14: Build cluster — Threads + Memory (Tasks 12–17)

- `GameTicker` extracted from inline 2025 loop into an injectable class with a speed multiplier (compressed replay for dev)
- `NarrativeThreadEngine` + the 12-thread registry from Slide 8
- All three memory components (`GameSummary`, `HalfInningMemory`, `TouchedStorylines`)
- All TDD: tests first, implement to green, commit. ~70 vitest tests across the codebase by end of week 2

## Slide 15: Build cluster — Script generator + pipeline wiring (Tasks 18–21)

- `pickStateFields` — the smart-state-injection helper from Slide 7
- `ScriptGenerator` — assembles the full prompt (system + state + summary + threads + memory + stats + play sentence), calls the LLM, validates `[S1]`/`[S2]` formatting, retries once, falls back to a templated line on failure (the broadcast never goes silent)
- `RuntimeLog` — every script + prompt + threads + verdict logged to JSONL per game (for Phase 2 fine-tune data and bad-call post-mortems)
- `src/pipeline.js` — wires it all together. `gameScripting.js` shrunk from a single-file monolith to a ~25-line entry point

## Slide 16: Build cluster — Highlights + Ads (Tasks 22–26)

- `HighlightDetector` shipped with thresholds from the design doc; tiers as described on Slide 9
- Ads pipeline is fully off the play pipeline: pre-generated and pre-rendered
  - `genAds.js` — gpt-5 writes scripts from `(product × template)` pairs
  - `renderAds.js` — walks scripts through TTS, drops `.wav` files in `ads/`
  - `AdLibrary` — runtime selector at half-inning boundaries, avoids the last 5 played for variety
- Story worth telling: **the ad rewrite**
  - First-pass templates pushed gpt-5 into "parody of parody" mode — forced alliteration, generic exhortations, wordplay clusters
  - Threw it all out and rewrote in deadpan-absurd register (Tim Robinson / *I Think You Should Leave* tone)
  - New products: `the_calmer` (a fist-sized rubber device that does nothing), `dad_spray` (smells like "a man who works on cars"), `beef_plaque` (commemorative wall plaque made of beef)
  - Templates: `confession`, `demo_booth`, `satisfied_customer`. Anti-cheese rules in system prompts (no alliteration, no exclamation points, no "wherever fine X are sold" cliches)
  - First batch on the new register: 9/9 landed in tone. Worth playing during the demo

## Slide 17: Build cluster — Scenarios + demo wrapper (Tasks 27–30)

- Three pre-curated YAML scenarios: `standard_game`, `go_ahead_homer`, `inning_break_into_ads`
- Each scenario specifies a source game, start play, stop boundary, pre-active threads, expected classification
- `scripts/demo.sh` (and `demo.ps1` for Windows) — one-keystroke wrapper:
  - Wipes the HLS queue clean
  - Boots the TTS server
  - Polls `/health` until ready
  - Runs the scenario
- Why this matters: demo predictability. A 9-inning live replay can do anything; scenarios always demo what we want to demo
- Doubles as a regression harness — re-run same scenario, listen, tune HighlightDetector thresholds, re-run

## Slide 18: Pivot this week — Dia2 → ElevenLabs (2026-05-24)

- Dia2 was beautiful but slow: ~25–35 seconds per script on a CUDA box
- HLS segmenter spent most of its time playing silence between calls — killed demo cadence
- Switched broadcaster TTS to ElevenLabs `eleven_flash_v2_5`
- **Smoke run: 2.24 seconds round-trip for a 2-line script** (vs 25–35s on Dia2)
- Now runs end-to-end on a laptop. No GPU box required to demo
- Preserved the `[S1]`/`[S2]` two-voice format. S1 = play-by-play, S2 = color
- Default voices: **"Jerry B. - Classic Radio DJ & Energetic"** (S1) and **"Marty B"** (S2) — voice names are env-var overridable
- Dia2 / OpenAI / stub backends are still registered and selectable via `TTS_BACKEND=...` — the pivot didn't burn the bridge

## Slide 19: Pivot this week — SSE live game state (2026-05-24)

- The frontend now shows count pips, base diamond, batter/pitcher names that update live
- Pipeline POSTs a compact state dict to `/state` immediately after every `gameState.enrich(gumbo)` — separate from the audio post
- Server holds the last snapshot under a threading Condition, bumps a version counter, notifies waiters
- `/events` is a `text/event-stream` SSE endpoint; frontend connects via `EventSource('/events')`
- Why this matters for the demo: visual state **leads** the audio by a few seconds (audio is still queueing through HLS). The page feels alive and in-sync with the broadcast model, not lagging behind it
- Heartbeat lines every ~15s so reverse proxies don't kill idle connections

## Slide 20: Pivot this week — Per-line audio streaming (2026-05-24)

- ElevenLabs returns line-by-line. Old path concatenated all lines into one WAV before queueing
- New path: each line drops into the HLS queue **as soon as that line's API call returns**
- Smoke run: 3-line broadcaster script took 3.08s total wall time, but **line 1 audio landed in the queue at ~1s**
- vs old path where nothing reached the queue until 3s+
- Net effect: HLS segmenter and player start ~2s earlier per script. Bigger win on longer "big moment" scripts
- Per-line failure is non-fatal too — if line 3 of 5 fails, the broadcast plays 1–2 and 4–5 with a cut, instead of dropping the whole script
- **Worth featuring as engineering judgment, not just a feature**: the dev log records dropping the 120ms inter-line silence pad, because the HLS segmenter's 2s loop interval already introduces natural gaps — extra padding would compound

## Slide 21: A couple of "what I tried and dropped" stories

- **Ad rewrite** (Slide 16) — threw out the first round of templates because gpt-5 was writing parody-of-parody. The willingness to throw work away matters
- **Per-line emit ordering** — first sketch wrote line 0 to a `.part` file and lines 1+ directly to `queue/`. Broke playback order because lines 1+ sorted ahead of `.part`. Fix: skip the rename entirely and write all lines with consistent `play-<ts>-NN.wav` naming. Filename sort = playback order
- **`priorHalfInning` reuse** — the plan introduced a parallel `lastHalfInningKey` variable to detect half-inning transitions for ad triggering. Realized `priorHalfInning` already carried the same information (it's what feeds the summary refresh). Reused it. Cleaner
- **Dropping Dia2 on Mac** — spent time trying to verify the Dia2 prefix code path on a Mac. Discovered upstream packaging bug (subpackages missing from the wheel) plus the official "CUDA-only" framing. Correct move was to stop, accept Dia2 lives on RunPod, move on

## Slide 22: What's left

- **Two open polish items** (`docs/demo-polish.md`):
  - Verify SSE updates feel right in the browser end-to-end
  - Verify per-line emit feels snappier in actual listening
  - Both user-blocked: need ears on a real stream
- **Task 30 tuning pass** — listen to all three scenarios, tweak HighlightDetector thresholds if any classification feels clearly off
- **Phase 2 fine-tune** — sketched in the plan, explicitly scope-droppable. Phase 1 is the demo
- *[TODO: confirm with user — is anything else in flight before Friday?]*

## Slide 23: Demo plan

- Live on Friday: pick one scenario (probably `go_ahead_homer` for the wow factor — late-and-close, runner on, swing for the lead)
- Open the player URL, hit play
- Talk over the broadcast briefly to point out:
  - The count + diamond updating live (SSE)
  - The script stops re-reading the scoreboard between pitches
  - The energy escalates from routine plays into the big swing
  - The "Jerry B." / "Marty B" two-voice dynamic
- If time: trigger the `inning_break_into_ads` scenario so the audience hears one of the deadpan-absurd ads
- *[TODO: confirm with user — is one scenario the demo, or do you want to run all three?]*

## Slide 24: What I'd build next

- *[TODO: pick from these or replace with your own]*
- Real-game live mode (not replay-as-live) — already supported by `GameTicker`; just needs a live game selector in the UI
- Crowd noise / atmospheric mixing (logged as a stretch goal in the design doc)
- Phase-3 storylines: "battery been together all year", "manager hot seat", "rubber game of the series"
- Phase 2 fine-tune — curate ~300–500 examples from `scripts.jsonl`, fine-tune `gpt-4.1-mini`, A/B against Phase 1
- Game-aware ads (ads that reference what's happening in the game)

## Slide 25: Q&A / closing

- The code: `feature/2026-hack` branch
- Engineering journal: `docs/dev-log.md` — every meaningful change, every dead end
- Thanks
- Questions

---

*End of outline. ~25 slides as written. Cut Slides 12–17 down to a single "build phases" overview slide if you need to tighten to ~18. Slides 18–20 (the three pivots this week) are the freshest material and should stay.*
