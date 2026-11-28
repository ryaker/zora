# ADR-009: Typed actions as a thin declarative layer over the policy chain

- Status: Proposed (design only, no code) — issue #247
- Source: Palantir-style "action types" idea from research (PR #234)

## Context

Today an action is implicit. A tool call is mapped to a string key by
`toolToAction()` (`src/hooks/built-in/irreversibility-scorer.ts`), scored 0–100
from `[actions.scores]`, and compared to the `warn` / `flag` / `auto_deny`
thresholds. `always_flag` in policy.toml names action keys that always need
approval. Reversibility, the systems touched and the expected inputs are not
declared anywhere; they are inferred from the tool name and a hand-tuned score.

## Proposal

A **typed action** is a small declarative record that names one thing an agent
may do, so the existing checks can be driven from one reviewable place:

```toml
[[action]]
name        = "git_push"
tools       = ["bash"]                 # normalised tool names (SEC-24 form)
match       = { command_prefix = "git push" }
inputs      = { remote = "string", force = "bool" }   # validated before the call
reversibility = "irreversible"         # reversible | recoverable | irreversible
touches     = ["network:github.com", "fs:repo"]
```

It **compiles** to checks that already exist; nothing new decides:

| Field | Compiles to |
|---|---|
| `tools` + `match` | the key `toolToAction()` returns |
| `reversibility` | default score in `[actions.scores]` (reversible → low, recoverable → mid, irreversible ≥ flag threshold) |
| `touches` | `allowed_domains` / path rules in `PolicyEngine`, checked as today |
| `inputs` | a PreToolUse validation (fail closed on mismatch) |

## Invariants

1. **Narrow only.** Definitions can lower autonomy (raise a score, add to
   `always_flag`, add an input validation). They can never grant a tool, path,
   domain or lower a threshold. Loading takes the stricter of the typed action
   and policy.toml; a definition that would loosen is rejected at load.
2. **No new decision point.** The chain stays allowedTools → PreToolUse →
   canUseTool. Typed actions only feed `IrreversibilityScorer` and
   `PolicyEngine`; `tests/security/tool-enforcement.test.ts` is unchanged.
3. **Unknown stays strict.** A tool call matching no definition keeps today's
   behaviour (default score, `unknown` action key).
4. **Memory retrieval is out of scope.** Retrieval is never gated (#230).

## Open questions and recommendations

- **Where definitions live.** Recommend `~/.zora/actions.toml`, loaded beside
  policy.toml and covered by `IntegrityGuardian` baselines. Not inside
  policy.toml: a policy.toml edit is protected, and actions.toml can only narrow,
  so it needs less ceremony. A project-level file (`ProjectPolicy`) may only
  raise scores further.
- **Staleness.** Add a `reviewed = "YYYY-MM"` field; `zora-agent doctor` warns
  when it is older than 6 months or a tool name no longer exists in
  `src/security/tool-names.ts`.
- **Reversibility vs autonomy.** Map class to existing thresholds rather than a
  new axis: reversible < warn, recoverable ≥ warn, irreversible ≥ flag
  (approval required via the ApprovalQueue); only a human-set score ≥ `auto_deny`
  denies outright.
- **Relation to #233.** Per-job scoped grants (#233) approve a job once; typed
  actions give those grants a vocabulary ("this job may `git_push` to
  `origin`"). Build #233 first; typed actions are optional sugar on top.

## Alternatives considered

- Keep score-only (status quo): zero cost, but reversibility and touched systems
  stay implicit and unreviewable.
- Full action-framework with its own executor: a second enforcement path, which
  the one-registration-path rule forbids.

## Decision requested

Reviewer sign-off on direction. If accepted, implementation is a follow-up
`agent:todo`: loader + narrowing check + scorer wiring + doctor lint.
