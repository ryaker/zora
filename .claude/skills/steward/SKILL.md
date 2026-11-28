---
name: steward
description: House rules for looking after open pull requests in ryaker/zora (failing checks, conflicts, review comments, when to stop and escalate).
user-invocable: false
disable-model-invocation: true
---

These rules apply to anyone keeping a Zora PR moving: Claude's `/ship` and `/steward`
watch, PR Steward if it is ever enabled, the hourly Claude PR check, and zora-architect.
They cannot relax `REVIEW.md`, `docs/agents/WORKFLOW.md` or `CLAUDE.md`; where this file
and those disagree, those win.

## Work on

- Failing CI in code the PR touches. Reproduce locally first: `npm run lint`,
  `npm run test:unit`, `bash scripts/security-audit.sh`. Run `npm run lint` and
  `npm run test:unit` before every push.
- Merge conflicts with `main`. Merge `main` into the branch; never rebase a pushed branch
  and never force-push.
- Review findings marked Important, and small, specific review requests.
- A PR description that has gone stale. Fix it in the same pass as the code.

## Leave to the author (or Richard)

- Requests to redesign, change an API, or widen scope. Reply with what you would do, then
  stop.
- Any PR touching a human-only area in `REVIEW.md`. You may fix CI and conflicts on it;
  you may not approve, label `agent:approved`, or merge it.
- A PR that is the subject of an open design disagreement.

## Repository specifics

- CI runs on a self-hosted macOS runner (`ry-local`). Fork PRs never run there; do not try
  to make them.
- A dashboard test failed on #252 while `main` passed, which looked like flakiness. Re-run a failing dashboard test once before
  looking for a cause; if it fails again, treat it as real.
- Regenerate `package-lock.json` with `npm install`; never edit it by hand. The dashboard
  frontend has its own lockfile under `src/dashboard/frontend/`.
- Do not touch `.github/` or any `policy.toml`. Do not add or change a real credential
  value. Do not weaken `tests/security/**` or `scripts/security-audit.sh` to get green.
- Verify runtime changes with `.claude/skills/verify/SKILL.md` before saying a fix works.

## When to stop

- Three pushes for the same failure without fixing it: stop, comment what you tried, and
  hand it to the Zora Referee per `docs/agents/WORKFLOW.md` (CI failing twice for the same
  reason goes to the Referee first, not Richard).
- `agents:paused` on the Agent control issue (#189), or spend at 100% in `ops/spend.md`:
  do nothing.
- Quiet hours 22:00 to 08:00 America/Los_Angeles apply to the NanoClaw agents.

## Commits

Conventional commit title with the issue or gap ID, e.g. `fix(cli): … (#249)`. Each fix
commit says which failure or comment it answers.
