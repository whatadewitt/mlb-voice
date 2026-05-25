# Demo Polish Backlog

Post–Phase-1 polish items. Small, scoped, demo-quality fixes. Plan tasks
live in `superpowers/plans/2026-05-03-mlb-voice-2026.md`; engineering
journal lives in `dev-log.md`. This file is the lightweight in-between.

Newest items on top. Strike out (`~~text~~`) when done; leave the entry
in place for a release or two so we can see what's recently shipped.

---

## Open

- [ ] **Tune SSE_DELAY to match player buffer.** Default is 7s; if UI
  still leads or lags audio, set `$env:SSE_DELAY="N"` (PowerShell) or
  `SSE_DELAY=N` (bash) before `npm run demo` until count/diamond matches
  what the announcers are saying. Set to 0 for the old immediate-publish
  behavior (useful when debugging the pipeline).

- [ ] **Pitch-by-pitch broadcast mode (`PER_PITCH=1`).** Default OFF —
  the runner walks `playEvents` and emits a short broadcaster call for
  each individual pitch inside the at-bat (ball one, strike two looking,
  foul...) before firing the PA-level result call via `onGumbo`. New
  per-pitch prompt lives in `src/scriptGenerator/perPitch.js` and is
  [S1]-led with [S2] optional. The terminating "In play" pitch event is
  intentionally filtered — its call belongs to the PA result.
  - Toggle: `$env:PER_PITCH="1"` (PowerShell) or `PER_PITCH=1` (bash).
  - Pacing knob: `PER_PITCH_SLEEP_MS=N` (default 1200ms between pitches).
  - Resolved 2026-05-25: walks / strikeouts / HBP now skip their
    resolving pitch in the per-pitch path (keyed on
    `result.eventType` + last-pitch detection in `buildPitchInput`).
    The PA-level call carries the "Stephenson walks" / "strikes out
    swinging" line on its own.

- [ ] **Verify per-line elevenlabs emit feels snappier.** Code shipped
  2026-05-24. With a multi-line broadcast script, line 1 audio should
  start playing ~2s earlier than the previous concat-then-emit path.
  Also listen for any awkward back-to-back line transitions — the 120ms
  inter-line silence pad was dropped on the broadcaster path; if it
  feels too cramped, easy to add back as a tiny silence WAV between
  lines.

## Recently shipped

- [x] ~~**SSE: push live ball/strike/outs/runners to the frontend.**~~
  Shipped 2026-05-24 on `11labs-migration` branch. `/state` + `/events`
  in `server.py`; pipeline POSTs after each `enrich`; `web/app.js`
  consumes via `EventSource`. See dev-log entry for details.
