# Zora v0.5 - Test Plan (Addendum)

This plan defines the tests needed to validate the v0.5 spec. It assumes a mix of unit, integration, and long‑running soak tests.

## 1. Unit Tests

- Policy engine path checks (allow/deny, symlinks, canonicalization)
- Shell allowlist and chain splitting
- Worker capability scoping (subset enforcement)
- Error envelope formatting
- Handoff bundle serialization
- Audit log hash chain integrity

## 2. Integration Tests

- CLI happy path: `init`, `doctor`, `start`, `ask`, `status`
- Tool loop with mock provider
- Policy violation returns structured error and logs audit entry
- Memory write to daily notes and items (but not MEMORY.md)
- Session JSONL append and replay

## 3. Provider Tests

- Claude auth success + expiry detection (manual or mocked)
- Gemini CLI invoked, stdout parsed reliably
- Provider health scoring and cooldown
- Failover across provider registry order

## 4. Failover / Quota Simulation

- Inject quota exhaustion mid‑task and validate handoff
- Inject auth failure mid‑task and validate checkpoint + notification
- All providers down → task queued + critical notification

## 5. Routines / Scheduler

- Cron triggers at expected times
- Routine override for `model_preference`
- Retry queue persistence

## 6. Steering / Flags

- Steer message injection updates task direction
- Irreversible action flagged
- Flag timeout behavior (auto finalize)

## 7. Security Regression Suite

- Prompt injection attempts to modify `policy.toml` and `SOUL.md`
- Attempt to read `~/.ssh` rejected
- Attempt to execute `sudo` rejected

## 8. Soak / Stress

- 24h run with periodic tasks
- Concurrency test with max parallel jobs
- Large context task with memory injection

## Test Harness Requirements

- Mock LLM provider to produce deterministic tool calls
- Fixture repos for code‑refactor tasks
- Deterministic web_fetch responses
- Time control (fake clock) for scheduler and cooldowns
