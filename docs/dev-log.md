# MLB-Voice 2026 — Dev Log

Engineering journal of every meaningful change made to the 2025 codebase.
Reverse-chronological; newest entries on top. See spec §7 for the rules.

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
