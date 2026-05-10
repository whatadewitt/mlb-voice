# MLB-Voice 2026 — Dev Log

Engineering journal of every meaningful change made to the 2025 codebase.
Reverse-chronological; newest entries on top. See spec §7 for the rules.

---

## 2026-05-10 — RuntimeLog: JSONL append writer for Phase 2 training data (Task 20)

Created `src/runtimeLog.js` (`RuntimeLog`) — a minimal append-only writer that logs every generated script to `scripts.jsonl` for Phase 2 fine-tune training. Constructor calls `mkdirSync` with `{ recursive: true }` on the supplied `dir`, then stores the target path. `appendScript(record)` serializes the record with `JSON.stringify` and appends a newline-terminated line via `appendFileSync`. No rotation, no validation, no schema enforcement — intentionally atomic so Task 21 (`pipeline.js`) can call it after every successful `ScriptGenerator` response without risk of data loss on crash. 1 new test added; full suite is now 53/53.

---

## 2026-05-09 — ScriptGenerator: prompt builder, LLM call, retry, fallback (Task 19)

Created `src/scriptGenerator/index.js` (`ScriptGenerator`) — the centerpiece of the 2026 broadcast pipeline. `ScriptGenerator` consumes an `EnrichedPlay`, active narrative threads, a `HighlightVerdict`, `gameSummaryProse`, `halfInningMemoryScripts`, and cooldown lookup functions, then produces a broadcast script string tagged with `[S1]`/`[S2]` speaker markers. Prompt assembly is split into two parts: a system prompt that encodes the vibe directive (`calm` / `energetic` / `big_moment` / `explosive`) plus the booth persona and DO NOT rules; and a user prompt that joins six blocks — state fields (via `pickStateFields`), game summary, active storylines with cooldown labels, half-inning memory, stats block, and the play sentence — filtered to truthy and separated by double newlines. The `stats_to_mention` key is excluded from the state block and emitted in its own stats block instead, so the LLM sees it exactly once, in the right context. Validation (`isWellFormed`) requires both `[S1]` and `[S2]` in the response; on malformed output or exception, the loop retries up to `maxRetries` times (default 1, meaning 2 total attempts). On final failure the class returns a template fallback — `[S1] And the pitch — <result_text>. [S2]` — so the broadcast never goes silent. 3 new tests added; full suite is now 52/52.

---

## 2026-05-09 — pickStateFields: smart state injection helper (Task 18)

Created `src/scriptGenerator/pickStateFields.js` — the first file in the new `src/scriptGenerator/` directory. `pickStateFields(play, { stats_to_mention })` is a pure function that takes a full `EnrichedPlay` and returns a small context object containing only the fields the LLM needs right now. This is the fix for the 2025 "scoreboard reader" problem: the old system injected the full game state on every pitch, causing the model to repeat inning/outs/score on routine pitches instead of focusing on the play and active narrative threads. The new approach is conditional: `count`, `batter`, and `pitcher` are always included; `inning` is included only when `is_state_change.half_inning` or `is_state_change.inning` is true; `outs` only when `is_state_change.outs` is true; `score` only when `is_state_change.score` is true or `derived.late_and_close` is true; `stats_to_mention` only when the caller passes a non-empty array. No helpers, no memoization, single named export. 5 new tests added; full suite is now 49/49.

---

## 2026-05-09 — TouchedStorylines: cooldown tracker for narrative storylines (Task 17)

Created `src/memory/cooldowns.js` and `src/memory/touchedStorylines.js` — the third component of the memory subsystem. `TouchedStorylines` tracks which narrative storylines have been mentioned recently in generated scripts so the script generator can avoid repeating itself. `recordScript(scriptText, {ids})` does a post-pass keyword/substring match against the lowercased script text; any keyword hit flags that storyline as "just touched" (playsAgo = 0) and records its kind. `tick()` increments playsAgo for every tracked storyline. `cooldownFor(id)` returns `"strict"`, `"soft"`, or `"fresh"` via the `cooldownStateFor` helper in `cooldowns.js`. Cooldown defaults: thread 5+5 plays, event 3+4, stat 2+0 (the `[strict, soft]` pair means playsAgo ≤ strict → strict; strict < playsAgo ≤ strict+soft → soft; otherwise fresh). Unknown kinds fall back to `[3, 3]`; null/undefined playsAgo returns fresh. 4 new tests added; full suite is now 44/44.

---

## 2026-05-09 — HalfInningMemory: bounded script buffer, resets per half-inning (Task 16)

Created `src/memory/halfInningMemory.js` (`HalfInningMemory`) — the second component of the memory subsystem. Maintains a bounded FIFO buffer (`scripts[]`, default capacity 12) of the actual play-by-play strings the LLM produced within the current half-inning, so the script generator can avoid repeating itself. `observe({inning, half})` is called on every play: it computes a key `"${inning}-${half}"` and clears the buffer only when the key changes from a non-null prior key (first call sets the key without clearing). `push(script)` appends and evicts the oldest entry when over capacity (push-then-shift). No additional methods — intentionally minimal. 3 new tests added; full suite is now 40/40.

---

## 2026-05-09 — GameSummary: structured event log + LLM prose recap (Task 15)

Created `src/memory/gameSummary.js` (`GameSummary`) — the first component of the memory subsystem (Tasks 15–18). Maintains an append-only `eventLog` of notable plays (classification `notable`, `highlight`, or `holy_shit`; routine plays are silently skipped) formatted as one-line strings with an inning tag, score, and result text (e.g., `T1: H 0-A 1. Tatis homers to right.`). A `proseRecap` string is regenerated via an LLM call only at half-inning boundaries (`refreshIfHalfInningEnded`), driven by the deterministic event log to prevent recap drift from facts. `bootstrap({eventLog, proseRecap})` restores prior state for resume scenarios (Task 18). When `openai` is `null`, the event log still works but no LLM calls are made — safe for offline/test use. `model` defaults to `process.env.SCRIPT_MODEL || "gpt-5"`. 3 new tests added; full suite is now 37/37.

---

## 2026-05-09 — Remaining 8 Phase-1 narrative threads (Task 14)

Replaced `src/threads/registry.js` entirely with the full 12-thread Phase-1 catalogue. Eight new threads appended: `pitcher_struggling` (2+ walks or 3+ hard-hit balls in last 5 vs. pitcher), `pitcher_dealing` (4+ Ks in last 6 or 8 consecutive non-hard-hit balls), `pitcher_pitch_count` (>85 pitches tracked in buffer), `extended_inning` (4+ distinct batters in the current half-inning), `comeback_brewing` (deficit ≤3 with 2+ scoring plays in recent buffer), `same_score_drought` (no score change in 4+ half-innings), `home_run_recent` (HR in current half-inning), and `streak_at_plate` (batter with 2+ hits this game). Helper predicates extracted to top-level constants (`HARD_HIT`, `isHR`, `isHit`, `isWalk`, `isStrikeout`, `lastNVsCurrentPitcher`, `sameHalfInning`, `battersThisHalfInning`, `hitsByBatterThisGame`). 3 new tests added (registry coverage, home_run_recent, streak_at_plate); full suite is now 34/34.

---

## 2026-05-09 — NarrativeThreadEngine + 4 core threads (Task 13)

Created `src/threads/engine.js` (`NarrativeThreadEngine`) and `src/threads/registry.js` with the first 4 thread predicates. The engine maintains a 30-play rolling buffer and evaluates each registered thread predicate against the current play; predicates return `null` (inactive) or `{weight, hint}` (active), and active threads are collected into an array returned from `observe()`. Adding a thread requires only appending an entry to `THREAD_REGISTRY` — no engine changes. First 4 threads: `late_and_close` (reads `derived.late_and_close` pre-computed by the normalizer), `leverage_spike` (fires when `wp_swing_from_prior >= 0.5`), `rare_event` (keyword match on `result_text` for triple/balk/wild pitch/etc.), and `risp_jam` (RISP + outs ≤ 1 + leverage > 1.5). 4 new tests added; full suite is now 29/29.

---

## 2026-05-09 — GameTicker (Task 12)

Created `src/gameTicker.js` (`GameTicker`) — extracted from the root-level `gameScripting.js`. Accepts injected `fetchTimestamps`, `fetchFeed`, and `onPlay` so unit tests can drive it without network calls. The `speed` multiplier supports compressed-replay dev runs (e.g., `speed: 5` plays 5x fast) and `Infinity` to skip sleeps entirely in tests. `stopAfterTimestamp` prepares for scenario mode (Task 31) — the loop breaks after processing that timestamp inclusive. Sleep between ticks uses `Math.max(3, nxt - cur)` to enforce a 3-second minimum and guard against sub-3-second or negative gaps. Pipeline rewiring into the main server is deferred to Task 21. 2 new tests added; full suite is now 25/25.

---

## 2026-05-09 — GameStateService composition (Task 11)

Created `src/gameState/index.js` (`GameStateService`) — the stateful composer that wires together Tasks 8–10 into a single `enrich(gumbo)` call. Holds `priorSnapshot` (passed to `gumboNormalizer.normalize`) and `priorWP` across calls; computes `win_probability` and `leverage_index` via the Task 9 pure functions; resolves `wp_swing_from_prior` as `Math.abs(current - prior)` (0 on the first call); and fires concurrent `statcast.batterSeason` / `pitcherSeason` fetches, attaching results to `batter.season_stats` / `pitcher.season_stats` when non-null. This finishes the Phase 1 Week 2 gameState block — `gameScripting.js` (Task 12+) will hold one instance and call `enrich` per tick. 2 new tests added; full suite is now 23/23.

---

## 2026-05-09 — StatcastClient + /statcast endpoint (Task 10)

Added `src/gameState/statcastClient.js` (`StatcastClient`) — a thin HTTP client that POSTs to the TTS server's `/statcast` endpoint and caches results in-process with a 24h TTL keyed by `kind:params`. Returns `null` (never throws) on any network or server error so callers degrade gracefully. Replaced the 501-returning stub in `server.py` with a real implementation wrapping `pybaseball.batting_stats` / `pitching_stats`; a `_scrub()` helper strips pandas NaNs and numpy scalar types before JSON serialization. Not yet wired into `GameStateService` — that's Task 11. 3 new Node tests, all green; total suite 21/21.

---

## 2026-05-09 — WinProbability and LeverageIndex calculators (Task 9)

Added `src/gameState/winProbability.js` (`winProbability()`) and `src/gameState/leverage.js` (`leverageIndex()`). Both are pure functions; Phase 1 uses simplified math (sigmoid-ish lead ramp via `Math.tanh`, late-inning amplifiers, runner/out adjustments). Good enough for vibe detection — not a sabermetric source of truth. Real WP tables or LI lookup grids can replace the internals in a later task without touching callers. 6 new tests (3 each), all green. Not yet wired into `gumboNormalizer.js` — that happens in Task 11.

---

## 2026-05-09 — EnrichedPlay shape + GumboNormalizer (Task 8)

Added `src/gameState/types.js` (JSDoc-only `EnrichedPlay` typedef) and `src/gameState/gumboNormalizer.js` (`normalize(gumbo, {priorSnapshot})`) — the single canonical shape every downstream component (NarrativeThreadEngine, ScriptGenerator, HighlightDetector, Memory) will consume. `is_state_change` flags (`half_inning`, `inning`, `score`, `outs`) drive smart-state-injection in later tasks; `derived.leverage_index`, `win_probability`, and `fielding` are stubs for Tasks 9–11.

---

## 2026-05-07 — Default TTS backend = Dia2; prefix WAVs now optional

**What changed**
- `TTS_BACKEND` env default flipped from `"stub"` to `"dia2"` (`server.py`); `scripts/smoke_e2e.sh` first-arg default flipped from `"openai"` to `"dia2"`. Zero-exceptions TTS policy: every audible run goes through Dia2 unless you explicitly pass another backend.
- `tts_dia2`: prefix WAVs (`prefixes/<voice_set>_s{1,2}.wav`) are now optional. The function uses them as voice conditioning *if* both files exist *and* both are at least `DIA2_MIN_PREFIX_SECONDS` (2.0s) long — that filters out the 1-second silence stubs from Task 6. When omitted, `torch.manual_seed(DIA2_SEED=0)` is set before `model.generate` so Dia2's two synthesized voices are stable across runs and across `[S1]`/`[S2]` calls.
- `_load_dia2`: device auto-detect (`cuda → mps → cpu`); `use_cuda_graph` is now `torch.cuda.is_available()` rather than hard-coded `True`. Logs `loading Dia2-2B device=… dtype=…` at first cold start so the chosen device is discoverable.
- `pyproject.toml`: tightened the `dia2` optional-extra comment to spell out the upstream packaging bug — `[tool.setuptools] packages = ["dia2"]` ships only top-level `.py` files, dropping `dia2.core` / `dia2.audio` / `dia2.runtime` subpackages from the wheel. Workaround documented inline.

**Why**
The single-voice symptom in our Dia2 smoke tests turned out to be the silent prefix WAVs collapsing both speakers into a default voice — the model treats a 1-second silence as conditioning and generates whatever it would without it, but for both speakers, hence one voice. Making prefixes optional (with a fixed seed for stability) gives us the canonical two-voice [S1]/[S2] behavior immediately and lets us swap in real prefix audio later without code changes.

The default-backend flip enforces the policy at the smoke-test level: anyone running `./scripts/smoke_e2e.sh` with no args gets the Dia2 path, and falling back to OpenAI is now an explicit `./scripts/smoke_e2e.sh openai` — a deliberate flag, not the implicit default.

**What I tried and dropped**
- A local install of `dia2` on Mac to verify the optional-prefix code path. The `pip install` succeeded but the resulting `dia2/__init__.py` failed at import time on `from .core.model import Dia2Model` because the upstream `[tool.setuptools] packages = ["dia2"]` declaration doesn't recurse into subpackages. Confirmed by listing both the installed package contents and the upstream repo's `dia2/` tree via the GitHub API. Combined with the upstream package being explicitly framed as "Dia2 CUDA-only" in its own description, the right answer was to stop trying to run Dia2 on Mac — RunPod is the canonical host.

**Demo / presentation hooks**
- "Two distinct broadcaster voices come for free from Dia2's `[S1]`/`[S2]` handling — we pin them with a fixed seed so the same script renders identically across runs, which is the foundation of A/B comparing model outputs and fine-tune candidates."

---

## 2026-05-07 — Silence drift + stale-segment cleanup

**What changed**
- Replaced the silence-segment ffmpeg input from `silence.wav` (1.0s @ 44.1kHz mono PCM) with `anullsrc=channel_layout=mono:sample_rate=24000` generated inline. Output is now ~1.96s of AAC mpegts in a slot the playlist tags as 2.0s. Sample rate matches the OpenAI TTS output (24kHz), so the player crosses silence↔audio discontinuities without resampling.
- Dropped the unused `SILENCE_WAV` constant. The `silence.wav` file is no longer referenced by `server.py` (left in repo for now).
- Added a startup wipe of `hls/*.ts` and `hls/playlist.m3u8` at the top of `hls_segmenter_loop`, so a fresh server boot starts on a clean slate.

**Why**
Pre-fix, every silence segment was 0.77s of audio in a 2.0s playlist slot — a >1.2s drift per segment. Hadn't visibly bitten the smoke test because the player kept up during the silence-only opening, but it would compound over longer broadcasts and at every silence↔audio discontinuity (ad inserts in Phase 2 will hit this constantly). The mismatched sample rate (44.1kHz silence vs 24kHz OpenAI audio) was a separate latent quality issue at the discontinuity boundary; anullsrc fixes both at once.

The stale-`hls/` cleanup was incidental: we kept tripping over `seg-402_silence.ts`-style files from days-old runs. The segmenter's slide-window cleanup only tracks segments produced by the *current* run, so cross-run leaks were guaranteed.

**Demo / presentation hooks**
- "All silence is generated inline at the broadcast's sample rate — no fixture-file dependency, no drift, clean transitions across the discontinuity."

---

## 2026-05-07 — HLS streaming pipeline fixes

**What changed**
Three interlocking bugs in `server.py` were preventing the 2025 broadcast from playing end-to-end through the new HLS pipeline. Fixed together because each fix exposed the next:

1. **`/generate` write race.** `tts_openai`'s `stream_to_file()` streams bytes into `queue/play-*.wav` over 10–30s while the segmenter polls `queue/` every 2s. The segmenter would pick up a partial wav, segment 1–2s of audio from it, then `os.remove()` the still-being-written file — orphaning the rest of the stream into a deleted inode (POSIX keeps the inode alive for the writer's open handle, so the writes silently went nowhere). Fix: write to `*.wav.part`, atomic-rename to `.wav` only after `run_tts` returns.
2. **Burst exposure at the playlist boundary.** `segment_wav_to_hls` produced ~22 audio segs in one iter; the old loop extended all of them into `segment_files` at once. The sliding window (15) showed the burst's tail and dropped its head in the same playlist update; `MEDIA-SEQUENCE` jumped by ~7, hls.js re-synced to live edge, and the early audio was abandoned. Fix: pre-render into a `pending_audio` FIFO, expose one seg per iter (matching real-time playback).
3. **`MEDIA-SEQUENCE` going backwards.** With paced exposure, `segment_wav_to_hls` still bumped `seq` by 24 while only one of those segs entered `segment_files` per iter. The old `media_seq = max(0, seq - len(window))` made the playlist's media-sequence *decrease* on subsequent pops, which hls.js treats as a different stream and re-syncs. Fix: track `n_exposed` (total segs ever exposed) separately from `seq` (next file id); compute `media_seq` from `n_exposed`.

Also added structured logging (`logs/server.log`) for `/generate` and the segmenter loop, and wrapped the segmenter loop body in `try/except` so an ffmpeg failure no longer silently kills the daemon thread.

**Why**
The smoke test (Task 7) was producing audible output but cutting off mid-sentence ("Welcome back folks" then silence). The cutoff was each of the three bugs in turn, peeled one layer at a time: fixing the race exposed the burst, fixing the burst exposed the media-seq inversion. Together they gate any non-trivial broadcast.

**What I tried and dropped**
- Initial hypothesis was OpenAI TTS truncation. The diagnostic logging refuted it: the wav was being delivered fully (~2 MB, ~40s), but the segmenter was deleting it mid-stream. That's also why the wav header reports `dur=89478.49s` in the logs — OpenAI writes a placeholder `data` chunk size for streaming responses and never backpatches it, so `wave.open` divides the placeholder by the sample rate. ffmpeg is tolerant of the bad header (reads to real EOF); the `wave` module isn't.

**Demo / presentation hooks**
- "Live HLS is full of footguns — producer-side races, consumer-side sliding-window semantics, and the player silently fails-soft on either. We instrumented the pipeline so the next time it breaks, the logs tell you which layer."

---

## 2026-05-05 — End-to-end smoke test passing

**What changed**
- Added `scripts/smoke_e2e.sh` for one-command end-to-end run.
- Verified pipeline: `gameScripting.js` → `game.js` (existing 2025 prompt) → `/generate` → HLS → browser.
- Confirmed laptop path with `TTS_BACKEND=openai` produces audible output.

**RunPod (Dia2) variant**
- Container: `pytorch/pytorch:2.4.0-cuda12.8-cudnn9-devel`.
- Startup: `curl -LsSf https://astral.sh/uv/install.sh | sh && uv sync --extra dev && uv pip install "dia2 @ git+https://github.com/nari-labs/dia2"`.
- Run: `TTS_BACKEND=dia2 uv run python server.py`.
- First call: ~30s download/warmup. Subsequent calls: ~2–3s/segment.

**Demo / presentation hooks**
- Side-by-side audio: 2025 Dia 1.6B clip vs 2026 Dia2-2B clip from the *same* prompt. Voice stability difference is the whole pitch.

---

## 2026-05-03 — Dia2 hardening

**What changed**
- `tts_dia2`: moved the two prefix-file `isfile` checks to run before `_load_dia2()` and before the `from dia2 import` line; split the combined check into two separate checks, each raising `FileNotFoundError` naming only the single missing path.
- `_load_dia2`: added a module-level `_dia2_lock = threading.Lock()` and wrapped the model instantiation in a double-checked lock — outer check before acquiring the lock (fast path), inner check after acquiring it (safe path) — so concurrent first-time `/generate` requests cannot race and double-load the model.

**Why**
Code review surfaced that loading a 10 GB model before validating cheap on-disk prereqs wastes ~30s and burns VRAM only to fail with a file-not-found error. On Flask's `threaded=True` server, two concurrent cold-start requests could both observe `_dia2_model is None`, both call `Dia2.from_repo`, and OOM the GPU.

**Demo / presentation hooks**
- "Failure modes are now boring — no mystery OOMs during the live demo."

---

## 2026-05-03 — Dia2 backend wiring (RunPod-only path)

**What changed**
- Replaced the `tts_dia2` placeholder (`NotImplementedError`) in `server.py` with the real implementation: lazy `_load_dia2()` helper that loads `nari-labs/Dia2-2B` on first call (bfloat16 on CUDA), and a `tts_dia2` function that reads per-`voice_set` prefix WAVs from `prefixes/<voice_set>_s{1,2}.wav` and calls `model.generate` with a `GenerationConfig`.
- Added `_dia2_model` module-level global for model caching (avoid re-loading across requests).
- Updated `__main__` block: when `TTS_BACKEND=dia2`, pre-warms the model at startup before Flask starts accepting traffic.
- Collapsed the verbose multi-line `[project.optional-dependencies] dia2` block in `pyproject.toml` to a single-line form with the pip-install command as a trailing comment.
- Created `prefixes/README.md` documenting the four required prefix files, their purpose, and legal sourcing rules (no real-broadcaster cloning).

**Why**
Task 5 left `tts_dia2` as a stub to keep the server importable while the Dia2 wiring was deferred. Task 6 fills it in so the RunPod deployment can run `TTS_BACKEND=dia2` and get real two-speaker conditioned TTS. The lazy-load pattern keeps local/CI imports clean — `dia2` is never imported unless the backend is actually invoked on a CUDA host.

**What I tried and dropped**
- Attempted `git add prefixes/*.wav` for the four silence-placeholder files: blocked by `.gitignore` (`*.wav` rule covers them). Resolution: leave the placeholders untracked per their stated purpose ("verify code paths only; replace before demo"). The `prefixes/.gitkeep` + `prefixes/README.md` already keep the directory and its intent in git. No `.gitignore` changes were made — that's a plan-level decision.

**Demo / presentation hooks**
- "On RunPod: set `TTS_BACKEND=dia2` and the server pre-warms Dia2-2B at startup, then every `/generate` call produces genuine two-voice conditioned speech — the prefix files give us consistent broadcaster and ad personalities across the whole broadcast."

---

## 2026-05-03 — server.py rewrite with backend selector

**What changed**
- Replaced `server.py` with a full rewrite: single-file Flask app with a pluggable TTS backend selector (`TTS_BACKEND` env var, defaults to `stub`).
- Added `tts_stub` (copies `silence.wav`), `tts_openai` (GPT-4o-mini-tts), and `tts_dia2` (raises `NotImplementedError`, wired in Task 6).
- New endpoints: `/health` (returns backend name, queue depth, HLS thread status), `/enqueue_ad` (copies a pre-rendered WAV from `ads/` into the queue), `/statcast` (501 stub for Task 18).
- HLS segmenter refactored: silence segments now use the `_silence` filename marker (substring check in `update_playlist`) instead of a brittle separate path; graceful shutdown via `_shutdown` threading event.
- Deleted dead 2025 files: `server2.py`, `server3.py`, `app.py`, `socket.js`.

**Why**
The 2025 server was a single tightly-coupled file with Dia2 hard-wired and no way to test HTTP plumbing without a GPU. The backend selector lets CI and local development run end-to-end with `TTS_BACKEND=stub` while the same code paths work with `openai` or `dia2` in production. `/health` and `/enqueue_ad` were missing entirely.

**Demo / presentation hooks**
- "Single source of truth for TTS+HLS: one env var switches the voice engine from silence stub to OpenAI to Dia2, so we can demo the full broadcast pipeline without GPU hardware on stage."

---

## 2026-05-03 — Logger hardening

**What changed**
- `stage(name, { input, output, latency_ms } = {})` — added default `{}` so calling `logger.stage("foo")` without a second argument no longer throws a `TypeError` on destructuring.
- Added `safeStringify(value)` private helper (above the class, not exported) that wraps `JSON.stringify` in a try/catch and returns `"[unserializable]"` on failure. Used in `stage`, `info`, and `error` in place of bare `JSON.stringify`.
- Added 3 new vitest tests (TDD: written and confirmed failing before implementation): `stage()` with omitted arg, `info()` with circular ref, `error()` with circular ref. All 6 tests now pass.

**Why**
Code review flagged that `GameState` and `NarrativeThread` objects will very likely contain back-references once implemented, so a diagnostic `logger.info("state", gameState)` call must not crash the pipeline. The missing default arg on `stage` was a latent bug that would have surfaced the first time a stage logged without optional context.

---

## 2026-05-03 — Logger module

**What changed**
- Created `src/logger.js` exporting a `Logger` class with three methods: `stage`, `info`, and `error`.
- `stage(name, { input, output, latency_ms })` logs a structured one-liner with the stage name, latency, and a compact summary of the output object (up to 3 keys, values truncated at 30 chars).
- `info(event, data)` logs a JSON-serialized key/value line for general lifecycle events.
- `error(event, data)` routes to `console.error` for any failure events.
- Created `src/logger.test.js` with 3 vitest tests (TDD: tests written and confirmed failing before implementation).

**Why**
Every pipeline stage — HighlightDetector, ScriptGenerator, TTS dispatch — needs a consistent way to record timing and output summaries. A single `Logger` instance per run (keyed on `runId`) makes those structured lines trivially greppable in `logs/` and easy to demo during judging ("look at this single-line trace for a full play classification + script generation cycle").

**Demo / presentation hooks**
- "Every pipeline stage emits a one-liner: run ID, stage name, latency in ms, and the key output fields — the whole broadcast flow is a single `grep <runId> logs/*.log`."

---

## 2026-05-03 — Python env via uv

**What changed**
- Replaced the legacy bare `.venv` with a `uv`-managed virtual environment.
- Created `pyproject.toml` declaring all runtime dependencies and a `dev` extra containing `pytest>=8.3`.
- Added smoke test at `tests/python/test_smoke.py`; `uv run pytest` reports `1 passed`.
- `uv.lock` generated and committed, pinning the full dependency closure.
- Dia2 install deferred to Task 6 (RunPod-only; tracked as an empty `dia2` optional-extra with explanatory comments in `pyproject.toml`).

**Why**
The 2025 codebase relied on a manually managed `.venv` with no lockfile, no test runner, and no `pyproject.toml`. Switching to `uv` gives us reproducible installs via `uv.lock`, a standard `pyproject.toml`-based project definition, and a fast pytest invocation via `uv run pytest` — consistent with the Node side's `npm test`.

**What I tried and dropped**
- The pre-existing `.venv` was linked to a non-existent Python interpreter; `uv sync` detected this, removed it, and rebuilt cleanly — no manual intervention needed.

**Demo / presentation hooks**
- "We standardized both the JS and Python sides on lockfile-driven installs (`package-lock.json` + `uv.lock`) so cold-clone setup is a single command on either stack."

---

## 2026-05-03 — Node test framework (vitest)

**What changed**
- Added `vitest` as devDependency.
- Added `npm test` and `npm run test:watch` scripts.
- Created `vitest.config.js` and a smoke test at `tests/smoke.test.js`.

**Why**
The 2025 codebase had no test framework. Phase 1 ships several pure-functional components (calculators, classifiers, thread predicates) that are TDD-friendly; vitest is fast, ESM-native, and matches the project's existing module style.

**Demo / presentation hooks**
- "We added test infrastructure first because we knew the deterministic components — HighlightDetector, threads, memory — would be the spine of the broadcast quality."

---

## 2026-05-03 — Project scaffolding

**What changed**
- Created `src/`, `scripts/`, `scenarios/`, `prefixes/`, `ads/`, `data/games/`, `data/ad_scripts/`, `logs/`.
- Updated `.gitignore` to keep runtime artifacts out of git but preserve directory shells via `.gitkeep`.

**Why**
The 2025 layout had everything at repo root. The 2026 architecture needs clear seams between game-pipeline code (`src/`), demo scenarios (`scenarios/`), pre-rendered audio (`ads/`, `prefixes/`), and runtime logs (`logs/`).

**Demo / presentation hooks**
- Slide-ready visual: directory tree before / after.
