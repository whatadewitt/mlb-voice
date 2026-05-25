# Overnight brief — 2026-05-25 (branch: `11labs-migration`)

Four broadcast-tuning fixes shipped overnight. All four are pushed to
`origin/11labs-migration` as four discrete commits. Full vitest suite is
**93/93** (up from 74/74 at start). No real LLM or TTS calls were made
(see Cost summary).

## What changed

| # | Commit                                      | What it does                                                                                                                    | Key files                                                                                  |
| - | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| 1 | `febde82` batter intro on new at-bat        | Pipeline tracks `lastBatterId` and passes `is_new_batter` + `batter_line` to ScriptGenerator. Prompt asks for a brief intro when the at-bat just turned over. | `src/pipeline.js`, `src/scriptGenerator/index.js` (+ test)                                  |
| 2 | `dd0ea8a` color analyst optional on routine | Routine balls/strikes no longer require [S2]. New `TIER_DIRECTIVE` block keyed on `highlight.classification` is appended to the system prompt per call.        | `src/scriptGenerator/index.js` (+ tests)                                                    |
| 3 | `07b3520` round numeric stats               | Two-layer: prompt rule forbids decimals and the word "point"; `roundStats()` regex-scrubs decimals from `stats_to_mention` before the prompt is built.         | `src/scriptGenerator/index.js` (+ test)                                                     |
| 4 | `9f87e51` PER_PITCH mode                    | New `pipeline.onPitchEvent(...)` + `src/scriptGenerator/perPitch.js`. Runner walks `playEvents` when `PER_PITCH=1`. Default OFF.                              | `src/pipeline.js`, `src/scenarios/run.js`, `src/scriptGenerator/perPitch.js` (+ tests)      |

`docs/dev-log.md` has a full per-fix entry for each (top of file, newest
first). `docs/demo-polish.md` documents the `PER_PITCH=1` feature flag.

## Verify in the morning

You'll want to do an audible pass — the tests cover prompt structure and
filter behavior, but only your ears can tell whether the booth sounds
right.

### Golden path (PA-level mode, like existing demos)

```powershell
$env:UI_ONLY=$null   # make sure we're hitting real LLM + TTS
npm run demo
```

**Fix 1 — batter intros.** When a new batter steps in, the call should
open with a brief intro:
- "Tatis, 1-for-2 on the night, steps in..."
- "Trevino, 0-for-1, looking to get on..."
For repeat pitches in the same at-bat (the 2nd, 3rd, 4th pitch to the
same batter), the call should jump straight in with no intro — same as
today.

**Fix 2 — quieter color guy on routine.** On routine balls/strikes:
- [S1] should usually carry the whole call alone, ending with an empty
  `[S2]` tag.
- [S2] is _allowed_ to chime in if there's something genuinely worth
  saying, but should mostly stay quiet.

On notable / highlight / holy-shit plays (XBH, HRs, doubles, K with
RISP, etc.): both voices should be present, alternating, as before.

**Fix 3 — no robot decimals.** Listen for:
- ✅ "around 96 miles per hour", "in the mid-90s", "just shy of 400 feet"
- ❌ "65 point 8 miles per hour", "1 point 85 leverage", "0 point 24 swing"

A useful play to load: any HR (high exit velo) or a high-leverage hit
late-and-close — that's where the stats block actually engages.

### Pitch-by-pitch mode (Fix 4, opt-in)

```powershell
$env:PER_PITCH="1"
npm run demo
```

Optional pacing knob: `$env:PER_PITCH_SLEEP_MS="1200"` (default).

Listen for:
- Each individual pitch gets called as it happens: "Ball one, low",
  "Strike two, looking", "Foul, into the seats."
- The PA still wraps with the existing result call: "And De La Cruz
  singles to left, runner to third."
- On walks and strikeouts: the resolving pitch is now silent (its call
  is folded into the PA result line — "Stephenson walks" instead of
  "Ball four" + "Stephenson walks").

A/B comparison: run with `$env:PER_PITCH=$null` then again with `="1"`
on the same scenario YAML to feel the cadence difference.

### Scenarios

- `npm run demo` → `standard_game.yaml` (default smoke fixture, plays 5–9 of CHC@CIN).
- `npm run demo:homer` → `go_ahead_homer.yaml` (placeholder HR scenario).
- `npm run demo:ads` → `inning_break_into_ads.yaml` (placeholder ad-flow scenario).

`UI_ONLY=1` still works on all of them and is the cheapest way to
re-verify the SSE state pushes haven't regressed.

## Open questions for you

1. ~~**Walks and strikeouts in PER_PITCH mode duplicate.**~~ **Fixed
   2026-05-25** in a followup commit. `buildPitchInput` now detects
   non-contact PA resolutions (walk / intent_walk / strikeout /
   strikeout_double_play / strikeout_triple_play / hit_by_pitch) and
   skips the last `isPitch=true` event in that play, handing the call
   off to the PA-level result. Smoke-confirmed against the Stephenson
   walk in the standard scenario (per-pitch count went from 10 → 9).
   5 new tests; full suite 98/98.

2. **Tier rule strictness.** Fix 2 makes [S2] OPTIONAL on routine
   pitches but leaves it to the model's judgment. The model may still
   chime in too often. If after a listen it's still busy, I can tighten
   the rule from "OPTIONAL, usually stays quiet" to "SILENT unless the
   pitch is the third strike of a strikeout or a swinging miss in a
   2-strike count" — a concrete hard rule rather than a soft preference.
   Tell me what you hear.

3. **Per-pitch prompt voice direction.** The current per-pitch prompt
   aims for 1–3 seconds of audio per pitch. If the calls feel too clipped
   or too verbose on the first listen, the easy knobs are: word count
   (now "6–15 words"), [S2] threshold ("swinging miss / foul into stands
   / borderline" — could be relaxed or tightened), or whether to ever
   mention the count ("Resulting count: 1-1" is in the input — could
   instruct the model to skip naming it unless it's a full count).

4. **Should batter intros (Fix 1) fire in PER_PITCH mode too?** Right
   now they do — the `is_new_batter` signal threads through `onGumbo`,
   which fires as the PA wrap-up. But the *natural* place for an intro
   in PER_PITCH mode is *before the first pitch of the new PA*. Today
   the intro lands at the end of the PA, attached to the result call.
   It still reads, but if you want intros at the start, the right hook
   is to add a `pipeline.onNewBatter(gumbo)` call from `scenarios/run.js`
   before walking pitches. Not done — wanted your call on whether
   intros-at-start or intros-at-end is the desired feel.

## Cost summary

- **Real LLM calls made: 0.**
- **Real TTS calls made: 0.**

All verification was done with the stubbed vitest LLM + `UI_ONLY=1` for
the runner smoke tests. The prompt + filter logic is fully covered by
unit tests; the audible polish pass is yours.

## What I did NOT change (per constraints)

- The SSE state shape is unchanged — `web/app.js` consumers still see
  the same keys. PER_PITCH adds intermediate state pushes but the
  payload shape is identical to the existing per-PA push.
- No new dependencies (npm or pip).
- Recently-shipped features were left alone: per-line emit, SSE_DELAY,
  UI_ONLY, progressive game state, team meta.

## Test inventory delta

| Suite                                 | Before | After |
| ------------------------------------- | ------ | ----- |
| `src/scriptGenerator/index.test.js`   | 6      | 11    |
| `src/scriptGenerator/perPitch.test.js`| (new)  | 14    |
| `src/pipeline.test.js`                | (new)  | 5     |
| All other suites                      | 68     | 68    |
| **Total**                             | **74** | **98**|
