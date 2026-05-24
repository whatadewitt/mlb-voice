# Demo Polish Backlog

Post–Phase-1 polish items. Small, scoped, demo-quality fixes. Plan tasks
live in `superpowers/plans/2026-05-03-mlb-voice-2026.md`; engineering
journal lives in `dev-log.md`. This file is the lightweight in-between.

Newest items on top. Strike out (`~~text~~`) when done; leave the entry
in place for a release or two so we can see what's recently shipped.

---

## Open

- [ ] **SSE: push live ball/strike/outs/runners to the frontend.**
  - Backend: add `/events` SSE endpoint in `server.py` that streams
    JSON whenever the pipeline observes a state change.
    `text/event-stream` content type; one `data: {...}\n\n` frame per
    update; heartbeat every ~15s so reverse proxies don't kill the
    connection.
  - Pipeline hook: in `src/pipeline.js`, after each `enriched` snapshot,
    POST `{ balls, strikes, outs, runners }` to a server endpoint that
    fans out to SSE subscribers (or have the server poll a shared
    in-memory state — whichever's cleaner). Source of truth is the
    enriched play returned by `gameState.enrich(gumbo)`.
  - Frontend: in `web/app.js`, open an `EventSource('/events')` on page
    load; on each message, update the elements tagged
    `data-sse-balls` / `data-sse-strikes` / `data-sse-outs` /
    `data-sse-runners` in `web/index.html`. Markup hooks already exist
    (placeholder values rendered today).
  - Reference: matching `# TODO(SSE)` comment block in `server.py`
    near `/health`, and `<!-- TODO(SSE) -->` wrapper in
    `web/index.html` around the count/diamond block.
