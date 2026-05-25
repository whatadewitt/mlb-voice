# MLB-Voice 2026 — Dev Log

Engineering journal of every meaningful change made to the 2025 codebase.
Reverse-chronological; newest entries on top. See spec §7 for the rules.

---

## 2026-05-25 — Tier-aware color analyst, quieter on routine pitches (branch: 11labs-migration)

The color guy ([S2]) was chiming in on every call, including routine balls and strikes — turns a 6-second ball-one into a 10-second mini-discussion that nobody asked for and that makes the broadcast feel relentlessly busy. Real broadcasts have the color analyst lay out for most pitches and step in on contact, big counts, or notable plays.

The old system prompt forced alternation hard: "Format every line with a speaker tag. Alternate speakers, ALWAYS end with the OPPOSITE empty tag." Softened to "Default to alternating ... see the tier-specific guidance below for exceptions on routine plays," and added a new `TIER_DIRECTIVE` block keyed on `highlight.classification` — for `routine`, [S2] is OPTIONAL and should usually stay quiet, [S1] solo is allowed; for `notable` / `highlight` / `holy_shit`, both voices are required and the original alternation rule reapplies. The tier-specific rule is appended to the system prompt on every call so the LLM sees both the vibe directive and the participation rule together.

Why prompt-only and not a code-side filter that strips [S2] lines after the fact: filtering post-hoc would mangle scripts where the LLM has legitimately built up a back-and-forth on a notable play that briefly opens with a routine pitch in the middle. Letting the model self-regulate from tier context preserves the option for [S2] to chime in even on routine pitches when there's something genuinely worth saying. 2 new tests assert the routine prompt contains "OPTIONAL" and the highlight prompt does not; full suite 78/78.

---

## 2026-05-24 — Batter intros on new at-bat (branch: 11labs-migration)

Booth was jumping straight into the live call on every play, including the first pitch of a new at-bat. Real broadcasts open the at-bat with a brief intro — batter name, today's line — then transition into the live call. Added an `is_new_batter` signal that the script prompt opts into.

`pipeline.js` now tracks `lastBatterId` across `onGumbo` calls (closed over the pipeline instance, same pattern as `priorHalfInning`). On each call we compute `isNewBatter = currentBatterId !== lastBatterId`, then pass both `isNewBatter` and `batterLine` (already computed earlier in the function for the `/state` payload) into `scriptGen.generate(...)`. `lastBatterId` updates before the UI_ONLY early-return so the signal stays coherent if the flag is flipped mid-session.

`ScriptGenerator.buildMessages` now accepts `isNewBatter` and `batterLine` and emits a compact `is_new_batter: true (batter line so far: 0-for-1)` block into the user prompt when set — falling back to "first PA of the day for this batter — no line yet" when `batterLine` is null. The system prompt was updated to keep "no dry setup" as the default but add an explicit EXCEPTION: when `is_new_batter: true`, open with a brief intro using the batter's name and today's line BEFORE the live call. 2 new tests cover the prompt threading in both states; full suite 76/76.

---

## 2026-05-24 — Real team meta in the broadcast card (branch: 11labs-migration)

Demo card was still showing the static placeholder teams (Brooklyn Hawks vs Portland Knights, Veritas Field, 5–3, Top 7th) regardless of which fixture was loaded. Extended the `/state` payload from `pipeline.js` to carry the live game's teams + venue, and the frontend now applies them via the existing SSE channel.

`statePayload.teams.{home,away}` carries `id` (MLBAM team ID, used to build the logo URL), `name` ("Cincinnati Reds"), `short_name` ("Reds"), `location` ("Cincinnati"), `abbreviation` ("CIN"), and `record.{wins,losses}` — all pulled directly from `gumbo.gameData.teams` so the `EnrichedPlay` shape doesn't have to grow. `statePayload.venue` is `gumbo.gameData.venue.name`. The frontend's `applyState` was extended with `applyTeam(side, team)`, `applyScore(score)`, `applyInning(inning, half)`, and `applyVenue(venue)`; each is null-guarded so old-style payloads from prior server versions don't crash.

Team logos use MLB's official spot endpoint: `https://midfield.mlbstatic.com/v1/team/<id>/spots/108` — verified 200 OK with transparent PNG (~1.5–2.6 KB per team). The image is dropped into the existing `.team-logo` badge at 80×80px so the colored ring CSS still frames it. The badge stores the team ID in `dataset.teamId` so we don't re-set `innerHTML` on every SSE message if the same team is still showing.

Score block (away — home) and inning (`Top 9th` via a small `ordinal()` helper) update on every state. Venue replaces the placeholder in the inning strip's second span.

Team colors are deferred — the user pointed at jimniels/teamcolors and we confirmed it has 30 MLB entries keyed by full team name, but the MLB spot logo PNGs are already colored brand marks, so the badge looks right without a colors lookup. If we want the badge ring tinted to the team primary, easy follow-up: bundle `data/mlb_team_colors.json` from teamcolors, look up by `team.name` in pipeline, send `team.colors.primary` in the state payload, and set `--team-color` CSS var on `.team`.

**What I tried and dropped**
First sketch passed the raw `gumbo.gameData.teams.home` straight into the payload, but the `record` block alone is ~14 fields per team — bloats the SSE frame for fields nobody renders. Distilled to the 4 we actually use (id, name, short_name, location, abbreviation, plus wins/losses).

---

## 2026-05-24 — SSE_DELAY for UI/audio alignment (branch: 11labs-migration)

First listen of the SSE-enabled demo showed the count pips and base diamond updating ~7–10s *ahead* of what the announcers were saying. The pipeline POSTs `/state` the instant `gameState.enrich(gumbo)` finishes, but the audio for that play has to travel through queue → ffmpeg → playlist → player buffer before the listener hears it — typically 6–10s of pipe. So the SSE channel races the audio chain and wins by a lot.

Quick fix: `/state` handler no longer publishes immediately. It schedules `_publish_state(body)` via `threading.Timer(SSE_DELAY, ...)` so the SSE notify is deferred by `SSE_DELAY` seconds (env var, default 7). Timers fire in scheduled order so payload sequencing is preserved across rapid POSTs. `SSE_DELAY=0` restores the old immediate-publish path for pipeline debugging. Smoke confirmed both: 1.5s delay produces 1.51s and 1.62s arrival times for two POSTs spaced 100ms apart; SSE_DELAY=0 delivers in <3ms.

This is the "simple knob" version. The "right" version would tie state publication to the segmenter consuming the matching audio file (using the per-line emit filename as a token), which removes the guess from the equation but requires plumbing through `/generate` and the segmenter loop. Deferred; the knob is probably good enough for Friday.

**What I tried and dropped**
First test had the SSE GET *after* the `/state` POST, which exercised the initial-state-on-connect path (`_last_state` was still `{}` because the POST was sitting in its Timer) and made it look like the delay wasn't applied. Switched to connecting SSE first, then POSTing — confirmed the deferred publication works as expected.

---

## 2026-05-24 — Per-line emit for elevenlabs broadcaster (branch: 11labs-migration)

Followup to the elevenlabs switch: `tts_elevenlabs` no longer concatenates every line of a script into one WAV before dropping it in `queue/`. For `voice_set="broadcaster"` it now writes each line as its own WAV (`play-<ts>-00.wav`, `-01.wav`, …) directly into `queue/` as soon as that line's API call returns, then returns the list of paths so the `/generate` handler can respond `{files, lines}` instead of the legacy `{file}`. Filenames sort in playback order because `<ts>` is fixed per `/generate` call and `NN` increments. `voice_set="ad_announcer"` still concatenates into a single file at `out_path` (scripts/renderAds.js copies it into `ads/<id>.wav` and would break on multi-file output), returning `None`. The `/generate` handler distinguishes by checking `isinstance(result, list)`; if so it skips the `tmp_path → out_path` rename (the backend already wrote final names directly) and cleans up any stray `.part` left behind. Per-line failure is now non-fatal — if line 3 of 5 fails, the broadcast plays 1–2 and 4–5 with a cut in the middle, rather than dropping the whole script.

Latency: smoke run of a 3-line broadcaster script took 3.08s of wall time total, but line 1 (2.32s of audio) landed in `queue/` at ~1s — vs the old concat path where nothing reached `queue/` until 3s+. So the HLS segmenter can start segmenting + the player can start buffering ~2s earlier per script. Bigger absolute win on longer "big moment" scripts where the prior wait scaled with total line count.

One thing I deliberately dropped: the 120ms silence pad between lines, on the broadcaster path. Each line lands as its own WAV and the segmenter introduces natural gaps via its 2s loop interval anyway; an extra explicit pad would compound. If the lines run together too tightly in listening, easy to add back as a tiny silence WAV between line N and N+1.

**What I tried and dropped**
First sketch had `tts_elevenlabs` still write to `tmp_path` (line 0) and additionally drop lines 1+ in `queue/` directly. That preserves the legacy rename contract but breaks playback order — lines 1+ land in `queue/` (sorted ahead of `tmp_path` which is still `.part`) and the segmenter picks them up before line 0. Switched to "skip the rename entirely when backend returns a list" so all per-line WAVs have consistent `play-<ts>-NN.wav` naming with naturally correct sort order.

---

## 2026-05-24 — SSE live game state (branch: 11labs-migration)

Wired the SSE polish item from `docs/demo-polish.md`. Pipeline now POSTs a compact state dict (`balls`, `strikes`, `outs`, `runners`, `batter`, `pitcher`, `inning`, `half`, `score`) to `/state` after every `gameState.enrich(gumbo)`, separate from the `/generate` audio post — so the on-screen count/diamond updates the moment a play is observed, not whenever the corresponding audio segment plays out (which can lag by several seconds while WAVs queue up and segment). Server side: `/state` POST holds the last snapshot under a `threading.Condition`, bumps a monotonic `state_version`, and notifies waiters. `/events` is a `text/event-stream` Response whose generator emits the current state on connect (so a late-joining client doesn't sit on placeholders), then `wait_for`s on the condition with a 15s timeout — on wake it ships a `data:` frame, on timeout it ships a `: heartbeat` comment so reverse proxies don't kill the connection. `runners` is sent as a list of occupied base numbers (`[1, 3]`) which matches the existing `data-sse-runners="1,3"` markup convention.

Frontend (`web/app.js`): `EventSource('/events')` on load, `onmessage` parses JSON and calls `applyState()`. The updater rewrites each pip row's children (first N get `pip filled <kind>`, rest get bare `pip`), toggles `.occupied` on `.base.first/second/third` per runner list, and rewrites the at-bat name. Static placeholder values in `index.html` left in place so an unconnected page still looks alive; first SSE message overwrites them. EventSource's built-in reconnect handles transient errors, so `onerror` just logs at debug level — tearing the connection down on every blip would defeat the whole point. No new vitest tests (the pipeline change is a fire-and-forget POST identical in shape to the existing `/generate` POST; a Python integration smoke against `/state` + `/events` was run during development).

**What I tried and dropped**
First test used `urllib.request.urlopen('/events').read(N)` which blocks until N bytes arrive — SSE sends ~70 bytes then waits, so the test hung. Switched to `requests` with `stream=True` + `iter_lines()` which handles chunked streams correctly. Also dropped the original idea of polling shared in-memory state from the SSE generator in favor of a Condition + version counter, since polling wastes a thread per client even when nothing's happening.

---

## 2026-05-24 — ElevenLabs TTS backend (branch: 11labs-migration)

Switched the broadcaster TTS from Dia2 to ElevenLabs. Motivation: Dia2 generation runs ~25–35s per script (CUDA box, prefix-conditioned, the segmenter spends most of its time playing silence between calls), which is fine for offline ad renders but kills demo cadence. ElevenLabs round-trip on `eleven_flash_v2_5` came in at ~2.2s for a 2-line script in the smoke run — fast enough that we can keep the pipeline driving from a laptop with no GPU box on the other end. New backend lives in `server.py::tts_elevenlabs`. The pipeline `[S1]/[S2]` script format is preserved: `_split_script_by_speaker(text)` parses the tags, each line is sent to the right voice (S1 = play-by-play, S2 = color), the returned PCM-24kHz chunks are concatenated with a 120ms gap and written to `queue/play-*.wav`. The existing HLS segmenter is unchanged — it sees the same WAV format it always has. Voice resolution: env vars `ELEVEN_LABS_VOICE_S1` / `ELEVEN_LABS_VOICE_S2` accept either a literal voice_id or a saved voice name; names are resolved via `/v1/voices` and cached per process. Warmup at server start does the lookup once so the first `/generate` doesn't pay it. Defaults: S1 = `"Jerry B. - Classic Radio DJ & Energetic"`, S2 = `"Marty B"`. Default `TTS_BACKEND` flipped from `dia2` to `elevenlabs` on this branch; `demo.sh` and `demo.ps1` updated to match. Dia2/openai/stub backends are still registered and selectable via `TTS_BACKEND=…`. New env vars: `ELEVEN_LABS_API_KEY` (required), `ELEVEN_LABS_MODEL` (default `eleven_flash_v2_5`), `ELEVEN_LABS_VOICE_S1`, `ELEVEN_LABS_VOICE_S2`, optional `ELEVEN_LABS_VOICE_AD_S1` / `ELEVEN_LABS_VOICE_AD_S2`. Existing ads in `ads/` are untouched and still played back via `/enqueue_ad` (rewrite is a stretch goal once the live broadcast voice is dialed in).

**What I tried and dropped**
First pass defaulted the S1 voice to bare `"Jerry B"`. Account actually contains two professional clones — `"Jerry B. - Classic Radio DJ & Energetic"` and `"Jerry B. - Boston Accent Conversational Voice"`. Picked the radio-DJ one for play-by-play; the conversational Boston-accent voice reads more like a barstool color guy, which would step on Marty B's role. Easy to flip via the env var.

---

## 2026-05-23 — AdLibrary: runtime selector + half-inning trigger (Task 26)

Created `src/adLibrary.js` (`AdLibrary`) and wired it into `src/pipeline.js` so an ad fires at every half-inning transition. `pickNext()` lists `ads/*.wav`, filters out the last `recentCap` plays (default 5) for variety, falls back to the full pool when the recent set covers everything, then returns a uniformly random pick (or `null` if the dir is empty/missing). One deviation from the plan: replaced the plan's bare `readdirSync` with a `safeListDir` wrapper that swallows `ENOENT` and returns `[]` — the plan's literal would crash the pipeline on first transition if a user ran without rendering ads first. In pipeline.js, the plan introduced a parallel `lastHalfInningKey` variable to track transitions, but the existing `priorHalfInning` state already carries the same information (it's what `summary.refreshIfHalfInningEnded` consumes), so I reuse it — compute `halfInningEnded` from the prior/current comparison BEFORE the `priorHalfInning = current` update, fire the ad enqueue afterward. `adUrl = voiceUrl.replace("/generate", "/enqueue_ad")` per plan; both the enqueue POST and the script POST share the same try/catch shape so a dead server logs an event but doesn't kill the ticker. 5 new tests (empty dir, missing dir, non-wav filter, recent-history rotation, pool-exhaustion fallback); full suite 71/71.

**What I tried and dropped**
The plan's parallel `lastHalfInningKey` state. Saw it would just shadow `priorHalfInning` (same comparison, off by one tick because both update on the same call), so reused `priorHalfInning` directly. Cleaner.

---

## 2026-05-24 — demo wrapper + placeholder scenario YAMLs (Task 29)

Created two placeholder scenario YAMLs (`go_ahead_homer.yaml` — late-and-close HR; `inning_break_into_ads.yaml` — half-inning ad flow) and the `scripts/demo.sh` one-keystroke wrapper. Both YAMLs point at the existing `SDatTOR.json` fixture with sample start indexes — they're explicit placeholders, marked as such in the description, and will be replaced with user-curated GUMBO clips in Week 3 once we have games that actually contain the scenarios. Added a `scripts/demo.ps1` PowerShell variant alongside `demo.sh` because the project's primary dev environment is Windows; the bash version requires git-bash or WSL, while the .ps1 runs natively. Both wrappers do the same flow: wipe `queue/` + HLS state for a clean start, launch `uv run python server.py` in the background with optional `TTS_BACKEND` override, poll `/health` until ready (max 30s), POST `/start_hls`, run `node src/scenarios/run.js <chosen-yaml>`, then wait on the server until Ctrl-C. The case statement accepts `standard | homer | ads` as short aliases.

**What I tried and dropped**
A pure-Flask "scenarios are loaded via the server" model — would have let the demo wrapper be HTTP-driven, but the runner already builds its own pipeline with its own runDir, so adding a server endpoint duplicates state for no real benefit. Kept the runner as a CLI tool the wrapper invokes directly.

---

## 2026-05-24 — Scenario runner with fixture support (Task 28)

Created `src/scenarios/run.js` (`runScenario(path)`) and `scenarios/standard_game.yaml`. The runner loads a YAML via `loadScenario`, opens an OpenAI client, builds a fresh pipeline against `logs/scenario_<name>_<ts>/`, then iterates plays from a saved GUMBO fixture (`source.game_json_fixture`) — for each play, it deep-clones the GUMBO, swaps `currentPlay` to the play at the target index, and calls `pipeline.onGumbo`, sleeping `3000/speed` ms between calls to give the broadcaster cadence room. Falls back to a clear error if a non-fixture source is requested (real GUMBO-stream sources arrive in Week 3 with user-curated games). One Windows-specific tweak from the plan's literal: replaced the `import.meta.url === \`file://${process.argv[1]}\`` CLI-entry check with `pathToFileURL(process.argv[1]).href` — Windows path separators (`\`) don't match `file://` URL semantics (`/`), so the plan's literal would never fire the CLI branch on this platform. End-to-end smoke against `SDatTOR.json` (regenerated at end-of-game timestamp for the full 86-play log) processed 5 plays cleanly: `HighlightDetector` correctly tiered Spencer Steer's double as `notable` while the surrounding singles/walks/popouts came back `routine`. Logs include a per-play `console.log` so demo runs are watchable. No new vitest tests — the runner is exercised by the actual scenario run.

**What I tried and dropped**
Original `SDatTOR.json` fetched by `fetch_fixture.mjs` at the default timestamp (`20250523_230027`) only contained 9 plays (very early in the game). Re-fetched at `20250524_020000` (just past midnight UTC, well into the game) to get 86 plays — enough for any scenario start_play_index up to ~80. Filename kept as-is per the plan even though the game is actually CHC@CIN (777811); renaming is deferred until user-curated games arrive in Week 3.

---

## 2026-05-24 — Scenario YAML loader (Task 27)

Added `src/scenarioLoader.js` (`loadScenario(path)`) — reads a YAML file from disk, parses it via the `yaml` npm package (v2.9.0), validates the two required top-level keys (`name`, `source`), returns the parsed object as-is. Tiny — 8 lines of impl, no schema enforcement beyond the two existence checks. The scenario file shape (source / bootstrap / demo blocks) is defined by example in the YAMLs themselves; downstream consumers (Task 28 runner) reach into the keys they need. 3 new tests (happy path, missing name, missing source); full suite 74/74.

**What I tried and dropped**
n/a — straight follow-the-plan; no scope creep.

---

## 2026-05-23 — Ad rewrite: deadpan-absurd register (Task 24 redo)

Threw out the first-pass ad assets and restarted both products and templates. The original 1940s-radio-announcer templates pushed gpt-5 into parody-of-parody mode — forced alliteration ("pantry pal with punch"), wordplay clusters ("skewer it, sizzle it, or snack it straight"), generic exhortations with no comedic specificity. New register: deadpan-absurd in the Tim Robinson / I Think You Should Leave / SNL fake-commercial mode. Replaced products with three sketch-bait premises: `the_calmer` (a fist-sized rubber device that does nothing), `dad_spray` (air freshener that smells like "a man who works on cars"), `beef_plaque` (a wall-mounted commemorative plaque made of beef). Replaced templates with three sketch formats: `confession` ([S1] interviews [S2] about their use of the product; [S2] reveals too much, matter-of-factly), `demo_booth` ([S1] salesperson never breaks pitch character while [S2] customer surfaces increasingly unsettling implications), `satisfied_customer` ([S2] testimonial whose sincere enthusiasm reveals progressively sadder life details; [S1] enters only on the final tag line). Each system prompt carries anti-cheese rules — no alliteration, no wordplay/puns, no exclamation points, no "wherever fine X are sold" cliches, no rhyming, mandatory concrete proper noun, 8-12 short lines, natural speech (not announcer voice). First batch on gpt-5: 9/9 land in the right tone, with `confession` and `satisfied_customer` strongest. `demo_booth` ends mid-conversation without a tag — the template didn't require one (intentionally ambiguous), so leaving as-is until we see how it plays in the broadcast. Old `data/ad_scripts/*.txt` artifacts deleted before regen; `.wav` files in `ads/` from the prior render were also cleared (gitignored, regenerated below).

**What I tried and dropped**
The instinct to keep the original `hotdog_can` / `thinking_cap` products as a control group. Decided against it — they were a different premise entirely (literal absurdist objects pitched straight) and would have muddied the tone calibration when the AdLibrary selector picks at random in the broadcast.

---

## 2026-05-23 — AdLibrary: TTS render to ads/*.wav (Task 25)

Created `scripts/renderAds.js` — reads every `data/ad_scripts/*.txt`, POSTs each script to the running TTS server's `/generate` endpoint, and copies the resulting wav from `queue/` to `ads/<id>.wav`. Two practical deviations from the plan's literal: (1) `/generate` returns the queued wav path synchronously in its response body (`{"status":"queued","file":"queue/play-XXX.wav"}`), so the plan's 30-iteration polling loop against `queue/` was replaced with a direct read of `body.file` — saves both wall time and the race window between the HLS segmenter sweeping the wav and the copy landing. (2) The script kicks `/start_hls` itself (idempotent — server returns `"started"` on cold or `"already_running"` on warm), because `/generate` 500s with `"hls not running"` until the HLS thread is up, and forcing the user to remember a manual curl before each render was a footgun. Per-file timing is reported (sec since POST) and the script exits non-zero if any wav failed, so this can be chained into a one-keystroke demo wrapper later (Task 29). First batch ran clean against dia2: 4/4 wavs, 72–101s each (each ad is 7–8 [S1]/[S2] lines, so dia2 generates ~30s of audio per script). Output sizes 1.1–1.6 MB — reasonable for 24kHz mono PCM at that length. `ads/*.wav` already gitignored from a prior task.

**What I tried and dropped**
The plan's `setTimeout`-poll-`readdirSync` loop. Once I read the `/generate` handler and saw it returns the file path synchronously, polling was obviously dead weight — and worse, it gave the HLS segmenter a multi-second window to sweep the wav out from under us between the POST returning and the copy firing.

---

## 2026-05-23 — AdLibrary: offline batch script generator (Task 24)

Created `scripts/genAds.js` + placeholder `data/ad_products.json` (2 products) and `data/ad_templates.json` (2 templates: `old_timey_pitch`, `testimonial`). The script fans out the products × templates cross-product against `SCRIPT_MODEL` (default `gpt-5`), writing one `[S1]/[S2]`-formatted `.txt` per pair to `data/ad_scripts/`. Reused the `modelAcceptsTemperature` guard from `ScriptGenerator` so `temperature: 0.95` is only sent when the model accepts it — gpt-5 and o-series reject non-default temperature, so the original plan would have 400'd against the default model. Each completion runs in its own try/catch and logs a `✓`/`✗` line so a single failure doesn't abort the batch. `.gitignore` updated: `data/ad_scripts/*.txt` ignored (regenerated artifacts), with `!data/ad_products.json` and `!data/ad_templates.json` exceptions so the source data files escape the global `*.json` ignore. First batch run completed cleanly (4/4 scripts, ~400–620 bytes each, all closed with the opposite empty tag as required). Task 25 (TTS render) deferred — held until the Dia2 vs ElevenLabs backend choice is made tonight, since `renderAds.js` POSTs to the chosen TTS endpoint.

**What I tried and dropped**
n/a — placeholder product list per plan; real product copy is a deferred content-session task.

---

## 2026-05-23 — HighlightDetector: rules-based tier classification + pipeline wire-up (Tasks 22, 23)

Created `src/highlightDetector.js` (`HighlightDetector`) and replaced the routine-only stub in `src/pipeline.js`. `classify(play)` runs the `EnrichedPlay` through three tier predicates in descending severity — `holy_shit` (HR with WP swing ≥ 0.20, walk-off, catch probability ≤ 20%, exit velo ≥ 115, or any hit at LI ≥ 4.0), `highlight` (HR, catch probability ≤ 40%, exit velo ≥ 108, WP swing ≥ 0.10, K with bases loaded, double play, error late-and-close), and `notable` (XBH, K with RISP, exit velo ≥ 100, LI ≥ 1.8) — short-circuiting at the first matching tier and falling through to `routine`. Each tier returns its triggered rule names so the script generator (and the runtime log) can see *why* a play was elevated. `curateStats` then pulls 1–3 stats from the play (exit velo, launch angle, distance, catch probability, sprint speed, WP swing, LI) for the `stats_to_mention` block — gated so a routine play contributes none and the WP-swing / LI rows only fire above their notability thresholds. Vibe and suggested length are constant lookups keyed by tier (`calm/energetic/big_moment/explosive`; 8/12/18/25s). In `src/pipeline.js`, the `stubHighlight` closure was deleted and `new HighlightDetector()` is now constructed alongside the other singletons; `verdict = highlightDet.classify(enriched)` replaces the stub call. 8 new tests added; full suite is now 66/66. Audible smoke is user-side.

**What I tried and dropped**
n/a — followed the plan thresholds verbatim; tuning pass is its own task (30).

---

## 2026-05-10 — Pipeline wiring: GameTicker → pipeline → TTS end-to-end (Task 21)

Created `src/pipeline.js` (`buildPipeline`) and replaced the 2025 `gameScripting.js` with the new 2026 entry point. `buildPipeline({ year, runDir, openai, voiceUrl })` instantiates one each of `StatcastClient`, `GameStateService`, `NarrativeThreadEngine`, `GameSummary`, `HalfInningMemory`, `TouchedStorylines`, `ScriptGenerator`, `RuntimeLog`, and `Logger`, then returns an `onGumbo(gumbo)` async function that runs the full per-play sequence: enrich → refresh half-inning summary → observe half-inning → observe threads → stub-classify highlight → generate script → record memory/touched/runtimelog → log stage → POST to the TTS server. The `HighlightDetector` is intentionally stubbed (`classification: "routine"`, `vibe: "calm"`, empty triggers/stats) until Task 23 replaces it. `priorHalfInning` is closed over per pipeline instance so the summary refresh fires at half-inning boundaries; `buildKeywordIds` derives substring keywords from each thread id (underscores → spaces) and the first 30 chars of the thread hint, which `TouchedStorylines.recordScript` uses to mark threads as recently touched. The TTS POST is wrapped in try/catch so a dead voice server logs `voice_post_failed` rather than crashing the ticker. `gameScripting.js` is now ~25 lines: load env, construct OpenAI client, mkdir `logs/<GAME_ID>_<STARTING_TS>`, build the pipeline, hand `onGumbo` to a `GameTicker`, and `run()`. The 2025 `game.js` is left in place — other tooling (scenarios, smoke scripts) may still reference it, and the plan does not ask for its removal in this task. No new tests; integration is verified by smoke run, which is a user-side step. `node --check` clean on both files; full suite still 53/53.

**What I tried and dropped**
n/a — audible smoke is a user-side step (requires CUDA Dia2 box / API keys); JS validated for parse + import correctness only.

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
