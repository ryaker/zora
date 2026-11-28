# Zora review standards

How pull requests in ryaker/zora are reviewed and who may merge them. It applies to every
reviewer: Claude (the hourly PR check and `/code-review`), zora-reviewer, and Richard.
`CLAUDE.md` says what the code must be; this file says how a change gets judged and landed.

Rules here come from feedback that repeated on real PRs. Add a rule when the same comment
comes up on two PRs; delete a rule when it stops earning its place. A change to this file is
human-only (see below).

## Verdict format

All agents push and comment as Richard's GitHub account, so GitHub refuses formal
Approve / Request changes reviews. Post the verdict as a PR comment whose first word is the
verdict:

- `APPROVED:` the PR may merge once CI is green and it touches no human-only area.
- `CHANGES REQUESTED:` followed by numbered findings, each with a `file:line` citation.

Label each finding with one severity, matching the Claude Code Review markers:

- **Important**: a bug, a security regression, a broken invariant from `CLAUDE.md`, or a
  claim in the PR description that the code does not back up. Blocks merge.
- **Nit**: worth fixing, does not block. Report at most five per review.
- **Pre-existing**: a real bug the PR did not introduce. File an issue, do not block.

A review with no findings still says what was checked (which tests, which paths read), not
just "LGTM".

## What Important means here

Block the merge for any of these:

1. **The security chain is weakened.** `permissionMode` other than `'default'`,
   `bypassPermissions` anywhere in `src/`, enforcement moved back out of the `PreToolUse`
   bridge, a hook that fails open, a second tool-registration path, or a `customTools` SDK
   option. `grep -rn "bypassPermissions" src/` must stay empty.
2. **A security test is weakened** to make a change pass: `tests/security/**`, especially
   `tool-enforcement.test.ts`, or `scripts/security-audit.sh`. Skipped, `.only`, loosened
   assertions and deleted cases all count.
3. **A flag or config value is silently ignored.** If an option cannot take effect (for
   example `--primary ollama` with Ollama not running), the code must say so, not fall back
   quietly. (Repeated on #252.)
4. **A provider capability is assumed, not checked.** `OllamaProvider` sends no tools, so an
   Ollama primary is chat-only. Code or docs that assume tool use on a provider must show
   where that provider passes tools.
5. **The PR description says something the diff does not do,** or repeats a stale
   status ("tokens need provisioning" on #240 when they were in OneCLI). Descriptions are
   read by every later agent; a wrong one propagates.
6. **No test for a behavior change or bug fix.** A bug fix needs a test that fails without
   the fix.

## Always check

- `npm run lint` and `npm run test:unit` pass on the PR head (CI runs both, plus
  `scripts/security-audit.sh` and the E2E scenarios).
- For a change to runtime behavior (CLI, daemon, providers, channels, orchestrator), the
  author or reviewer ran it, following `.claude/skills/verify/SKILL.md`, and says what was run.
- New code comments explain *why* and cite a gap or issue ID, matching the existing style.
- Conventional commit title with the gap or issue ID, e.g. `fix(security): … (SEC-21)`.
- The PR is rebased on current `main` with no conflicts before it is approved.

## Do not report

- Formatting and style that `tsc` accepts and nothing else enforces.
- `package-lock.json` diffs that match a `package.json` change.
- `docs/reviews/`, `docs/research/` and `docs/archive/` content (historical record).

## Who may merge

A PR merges when the review verdict is `APPROVED:`, CI is green on the head commit, no
review comment is still waiting on the author, and the PR touches no human-only area.
Claude and zora-reviewer may squash-merge such a PR without waiting for Richard
(Richard, 2026-11-28: "I prefer you merge when it's ready to merge and not need me").
When in doubt, leave it unmerged with a comment saying what is unresolved.

## Human-only areas

A PR that touches any of these needs Richard's merge, whatever its review says. Label it
`needs-richard`, explain in plain words what changes and why, and do not merge it.
The same list is in `.claude/approvals.yml` in machine-readable form; keep the two in step.

**Auth and credentials** (decided by Richard, 2026-11-28)
- `src/security/secrets-manager.ts`, `src/security/capability-tokens.ts`
- `src/hooks/built-in/secret-redact.ts`
- `src/cli/secret-commands.ts`
- `src/config/env-resolver.ts`, `src/config/dashboard-token.ts`
- `src/dashboard/auth-middleware.ts`
- `src/orchestrator/auth-monitor.ts`
- `src/channels/webhook-signatures.ts`, `src/channels/channel-identity-registry.ts`
- Any change that adds or changes a real credential value, anywhere. Writing *about*
  credentials in docs is not a credential change.

**The quarantine screening step** (decided by Richard, 2026-11-28)
- `src/channels/quarantine-processor.ts`
- `src/security/patterns.ts` (the injection patterns quarantine and prompt defense share)
- Tests that cover them: `tests/**/quarantine*`

**Budget and spend rules** (decided by Richard, 2026-11-28)
- `src/dashboard/cost-tracker.ts`, `src/hooks/built-in/rate-limit.ts`
- The action and token budget in `src/security/policy-engine.ts` (the `budget` section and
  `BudgetPolicy` in `src/types.ts`)
- `scripts/agents/usage-check.sh`
- The budget table in `ops/spend.md` and the "Budget thresholds" section of
  `docs/agents/WORKFLOW.md`. The reviewer's daily usage rows in `ops/spend.md` are routine.

**Already protected before this file** (`docs/agents/WORKFLOW.md`, hard rule 4)
- `.github/**`, every `policy.toml` and `src/templates/security-policy.toml.template`
- Any `src/security/` change that loosens security. Changes that only take permissions away
  go through normal review.

**The rules themselves**
- `REVIEW.md`, everything under `.claude/` (the approvals policy, skills, agent definitions
  and `settings.json` permissions), and `docs/agents/WORKFLOW.md`, `reviewer.md` and
  `architect.md`, which hold the merge and `needs-richard` rules. An agent must not be able
  to rewrite its own gate. This narrows WORKFLOW.md's "docs-only PRs never get
  `needs-richard`" for these files only.

## Escalation

- Same disagreement twice in a row with nothing new: Zora Referee, per
  `docs/agents/WORKFLOW.md`. Its ruling is advisory and cannot lift a human-only gate.
- `needs-richard` is for the human-only areas above, money, and Richard's accounts. It comes
  with a plain-words explanation and a proposed answer, never a bare PR number.
