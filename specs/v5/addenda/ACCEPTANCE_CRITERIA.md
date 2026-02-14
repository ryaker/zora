# Zora v0.5 - Acceptance Criteria (Addendum)

This document turns the v0.5 journeys and success criteria into explicit, testable acceptance checks. It is intentionally concrete and test‑first.

## Global Acceptance Gates

1. **No prompt stalls** within policy
   - Given a task within policy, Zora must complete without blocking on human approval.

2. **Policy violation feedback**
   - Given an out‑of‑policy tool call, the system returns a structured error to the model and logs the violation.

3. **Audit log integrity**
   - All tool calls and errors are recorded in an append‑only audit log.

4. **Critical file protection**
   - Attempts to modify `SOUL.md`, `MEMORY.md`, `policy.toml`, `config.toml` via tools are denied.

5. **Provider failover**
   - When the primary provider is quota‑exhausted or auth‑failed, a healthy backup provider continues the job.

## Journey 1: First Run (Trust Establishment)

- `zora-agent init` creates workspace at `~/.zora/` with:
  - `config.toml`, `policy.toml`, `SOUL.md`, memory directories
- Integrity baselines are computed and stored.
- Default policy limits access to `~/Projects` and `~/.zora` only.
- `zora-agent doctor` reports Claude status and Gemini status (if configured).

## Journey 2: Long Task With Failover

- Given a multi‑step task with web fetches, the agent begins with rank‑1 provider.
- Inject a simulated quota error after N tool calls.
- The job continues on the next available provider within 60 seconds.
- The final artifact is produced and written to the requested path.

## Journey 3: Scheduled Routine

- Given a routine TOML, Zora schedules and triggers at the expected time.
- Output is written to the configured workspace path.
- Notifications fire on completion (if enabled).

## Journey 4: Code Refactor With Tests

- Given a code refactor request, Zora:
  - Reads repo files
  - Modifies code
  - Runs test command(s)
  - Iterates until tests pass or max retries hit
- Failover (if injected) preserves task state and continues.

## Journey 5: Auth Degradation

- On auth failure for provider A:
  - A checkpoint is created
  - Provider is marked unhealthy
  - Job continues on provider B
  - User receives notification

## Journey 6: Irreversible Actions

- On an irreversible action (e.g., `git push`):
  - The action is always flagged
  - Execution proceeds or is paused based on policy settings

## Performance Targets

- Failover time: < 60s from error to resumed output
- Agent uptime: 24h run without crash
- Memory load: ability to start with 10k memory items
