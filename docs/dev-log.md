# MLB-Voice 2026 — Dev Log

Engineering journal of every meaningful change made to the 2025 codebase.
Reverse-chronological; newest entries on top. See spec §7 for the rules.

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
