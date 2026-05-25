# Demo Polish Backlog

Post–Phase-1 polish items. Small, scoped, demo-quality fixes. Plan tasks
live in `superpowers/plans/2026-05-03-mlb-voice-2026.md`; engineering
journal lives in `dev-log.md`. This file is the lightweight in-between.

Newest items on top. Strike out (`~~text~~`) when done; leave the entry
in place for a release or two so we can see what's recently shipped.

---

## Open

- [x] ~~**SSE: push live ball/strike/outs/runners to the frontend.**~~
  Shipped 2026-05-24 on `11labs-migration` branch. `/state` + `/events`
  in `server.py`; pipeline POSTs after each `enrich`; `web/app.js`
  consumes via `EventSource`. See dev-log entry for details.
