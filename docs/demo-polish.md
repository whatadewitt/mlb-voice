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
