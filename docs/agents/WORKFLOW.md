# Zora agent workflow (zora-architect + zora-reviewer)

Two NanoClaw agents on the M2 Air improve Zora without Richard relaying messages.
GitHub is the source of truth; labels are the state machine; NanoClaw `send_message`
is only a nudge.

| Agent | Provider / pool | Default model | Escalation model | Job |
|---|---|---|---|---|
| `zora-architect` | NanoClaw `claude` (Claude Agent SDK) / Anthropic credits | Claude Sonnet 5.5 | Claude Opus 5.5 (planning, ADRs) | Plans, implements, fixes review comments |
| `zora-reviewer` | NanoClaw `opencode` → OpenAI API / OpenAI credits | gpt-6.2-sol | gpt-6.2-astra (weekly audit) | Reviews PRs, writes tests, adversarial audit |

## Label state machine

```
agent:todo → agent:in-progress → agent:needs-review → (agent:changes-requested ↺ ≤3 rounds)
           → agent:approved → CI green → ready-for-richard → Richard merges
any state → needs-richard   (3 review rounds, protected path, CI fails twice for the same reason, budget ≥90%)
```

- `agent:todo` — triaged by Richard or proposed by the architect and approved by Richard.
- The architect claims one issue (`agent:in-progress`), opens a **draft** PR from `agent/<issue>-<slug>`.
- When ready: mark PR ready, label `agent:needs-review`, `send_message` the reviewer.
- Reviewer posts a GitHub review. `agent:changes-requested` or `agent:approved`.
- After CI is green on the self-hosted runner, the reviewer swaps `agent:approved` → `ready-for-richard`.
- Only Richard merges.

## Hard rules (both agents)

1. Never push to `main`. Never force-push. Never merge.
2. At most 2 open agent PRs; at most 4 implement tasks per day.
3. Max 3 review rounds per PR, then `needs-richard` and stop.
4. Changes to `policy.toml`, `.github/`, `src/security/`, or anything touching secrets → `needs-richard`.
5. Before every action, check the pinned **Agent control** issue. If it has `agents:paused`, do nothing.
6. Before every action, read `ops/spend.md`. Obey the budget thresholds below.
7. Every agent-to-agent message ends with an explicit next owner and a stop condition
   ("your turn, reply once, then wait"). No "always reply" loops.
8. Quiet hours: no work 22:00–08:00 America/Los_Angeles.
9. Never print, request, or store API keys. Keys live only in the OneCLI vault.

## Budget thresholds (per pool, per billing cycle)

| Spent of $200 | Action |
|---|---|
| < 50% | Normal plan |
| ≥ 50% | Post a note in the daily `spend-report` issue; check burn rate vs. days left |
| ≥ 75% | Downshift: Opus → Sonnet, astra → sol; poll every 60 min instead of 30; no research rounds |
| ≥ 90% | Review/fix only on already-open PRs; label new work `needs-richard` |
| ≥ 100% or hard cap | Label the control issue `agents:paused` and stop |

Cycles: Anthropic credits refresh on the Claude Ultra billing date (10th);
OpenAI credits refresh on the ChatGPT Pro billing date (5th).

## Research and decisions

See `research/README.md`. Findings → proposal → critique → decision issue (`decision`) that
Richard approves → `agent:todo` work.
