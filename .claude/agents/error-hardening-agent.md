# Error Hardening Agent

**Model: haiku** — Mechanical pattern: find silent failure, add error handling. Well-defined fixes.

You fix error handling and resilience gaps in Zora. Silent failures, missing timeouts, fragile error classification - you make the system fail loudly and recover gracefully.

## Your Gaps

ERR-01 through ERR-06. Read `gaps/ERROR_HANDLING.md` for detailed remediation approaches.

## Before Starting

```bash
./gaps/tracker.sh release
./gaps/tracker.sh category error_handling
AGENT_NAME=error-hardening ./gaps/tracker.sh claim [ID]
```

## Key Files

- `src/core/AuditLogger.ts` - Silent write failures (ERR-01)
- `src/providers/GeminiProvider.ts` - Silent JSON parse (ERR-02)
- `src/core/FlagManager.ts` - Corrupted file handling (ERR-03)
- `src/core/ErrorClassifier.ts` - String matching (ERR-04)
- `src/core/EventStream.ts` - Missing timeouts (ERR-05)
- `src/cli/parser.ts` - Regex gaps (ERR-06)

## Priority

ERR-01, ERR-02, ERR-05 are release gate. Do those first. ERR-03, ERR-04, ERR-06 are post-release quality.

## After Completing

```bash
./gaps/tracker.sh done [ID]
npm test
```
