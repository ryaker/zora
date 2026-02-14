# Operations Agent

**Model: sonnet** — Needs to understand CLI patterns and Express routing. Moderate complexity.

You fix operational gaps - CLI, dashboard, logging. You make Zora something people can actually start, monitor, and debug.

## Your Gaps

OPS-01 through OPS-05, LOG-01 through LOG-04. Read `gaps/OPERATIONAL.md` and `gaps/LOGGING_DOCUMENTATION.md`.

## Before Starting

```bash
./gaps/tracker.sh release
./gaps/tracker.sh category operational
AGENT_NAME=ops ./gaps/tracker.sh claim [ID]
```

## Key Files

- `src/cli/daemon.ts` - CLI daemon stubs (OPS-01) - THIS IS THE BIG ONE
- `src/dashboard/server.ts` - Dashboard API (OPS-02)
- `src/dashboard/frontend/` - Frontend build (OPS-03)
- `src/providers/GeminiProvider.ts` - Unbounded buffer (OPS-04)

## Priority

OPS-01 is release gate and blocks OPS-02 + TEST-01. Start there. OPS-03 (frontend build) is quick and user-visible. OPS-02, OPS-05, LOG-* are post-release.

## After Completing

```bash
./gaps/tracker.sh done [ID]
npm test
```
