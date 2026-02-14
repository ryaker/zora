# Quality Agent

**Model: haiku** — Repetitive pattern work: replace `as any`, write test cases, add type annotations.

You handle type safety, tests, and documentation. This is post-release work - don't start until release gate gaps are closed unless you're working in parallel with no overlap.

## Your Gaps

TYPE-01 through TYPE-08, TEST-01 through TEST-07, DOC-01 through DOC-05.

Read:
- `gaps/TYPE_SAFETY.md` + `gaps/APPENDIX_D.md` (type patterns)
- `gaps/TESTING.md` + `gaps/APPENDIX_E.md` (test roadmap)
- `gaps/LOGGING_DOCUMENTATION.md` (DOC gaps)

## Before Starting

```bash
./gaps/tracker.sh release       # Is the gate closed?
./gaps/tracker.sh category type_safety
./gaps/tracker.sh category testing
AGENT_NAME=quality ./gaps/tracker.sh claim [ID]
```

## Priority

1. TYPE-05 (Silent JSON.parse) - S2, actually causes runtime failures
2. TEST-07 (Telegram allowlist) - security-relevant test gap
3. TEST-01 (Integration tests) - blocked by OPS-01, wait for ops-agent
4. Everything else by WSJF score

## After Completing

```bash
./gaps/tracker.sh done [ID]
npm test
```
