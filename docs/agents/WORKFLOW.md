# Zora agent workflow (zora-architect + zora-reviewer + zora-referee)

Two NanoClaw agents on the M2 Air improve Zora without Richard relaying messages, with a third
agent (Zora Referee, Hermes Agent on an open model) that breaks technical deadlocks on demand.
GitHub is the source of truth; labels are the state machine; NanoClaw `send_message`
is only a nudge.

| Agent | Provider / pool | Default model | Escalation model | Job |
|---|---|---|---|---|
| `zora-architect` | NanoClaw `claude` (Claude Agent SDK) / Anthropic credits | Claude Sonnet 5.5 | Claude Opus 5.5 (planning, ADRs) | Plans, implements, fixes review comments |
| `zora-reviewer` | NanoClaw `opencode` → OpenAI API / OpenAI credits | gpt-6.2-sol | gpt-6.2-astra (weekly audit) | Reviews PRs, writes tests, adversarial audit |
| Zora Referee | Hermes Agent (separate from NanoClaw) → local Ollama → Ollama Cloud credits | `deepseek-v4.1-flash:cloud` | none | On-demand technical tie-breaker; see [referee.md](referee.md) |

## Label state machine

```
agent:todo → agent:in-progress → agent:needs-review → (agent:changes-requested ↺ until converged)
           → agent:approved → CI green → reviewer squash-merges → progress note on #184
same disagreement twice → Zora Referee → REFEREE RULING: (binding only from the designated Referee identity) → back to the loop
any state → needs-richard   (protected path, product/security call, no convergence after a ruling, CI fails twice for the same reason, budget ≥90%)
```

- `agent:todo` — triaged by Richard or proposed by the architect and approved by Richard.
- The architect claims one issue (`agent:in-progress`), opens a **draft** PR from `agent/<issue>-<slug>`.
- When ready: mark PR ready, label `agent:needs-review`, `send_message` the reviewer.
- Reviewer posts a GitHub review. `agent:changes-requested` or `agent:approved`.
- After CI is green on the self-hosted runner, the reviewer squash-merges the approved PR
  (`gh pr merge N --squash --delete-branch`) and posts a two-line summary on the roadmap issue (#184):
  what changed and what's next. Richard does not review routine PRs.
- `needs-richard` PRs (protected paths, stop conditions) are never merged by an agent; Richard decides.

## Hard rules (both agents)

1. Never push to `main`. Never force-push. Only the reviewer merges, and only an `agent:approved` PR with green CI that is not `needs-richard`.
2. At most 3 open PRs for the architect (the reviewer reviews every PR waiting on each wake); at most 4 implement tasks per day. A PR is exempt from the cap only while it is parked awaiting Richard's decision (`needs-richard` and no agent work pending on it), not merely because the label is present; once Richard unparks it, it counts again. Parked PRs stay unmerged. The daily implement limit and merge rules are unchanged.
3. No fixed review-round cap (Richard, 2026-11-23). Round count is not a stop condition. When the same disagreement
   repeats with no new argument or change, escalate to Zora Referee (see below) instead of `needs-richard`.
4. Changes to `policy.toml`, `.github/`, `src/security/`, or anything touching secrets → `needs-richard`.
5. Before every action, check the pinned **Agent control** issue (#189, canonical even when it has no labels). If it has `agents:paused`, do nothing.
6. Before every action, read `ops/spend.md`. Obey the budget thresholds below. "Not yet measured" there is expected
   (no admin usage keys); treat unmeasured spend as under budget, not a blocker. Provider-side monthly caps enforce spend.
7. Every agent-to-agent message ends with an explicit next owner and a stop condition
   ("your turn, reply once, then wait"). No "always reply" loops.
8. Quiet hours: no work 22:00–08:00 America/Los_Angeles.
9. Never print, request, or store API keys. For the NanoClaw agents, keys live only in the OneCLI vault.

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

## Zora Referee: rulings and escalation

- **Trigger:** the same disagreement repeated twice in a row (no new arguments or changes). Round count alone never triggers it.
- **How:** the architect or reviewer posts one message in `#zora-agents`:
  `<@U0CLG53F8U9> PR #N, round K: architect says …; reviewer says ….` (the Referee only reacts to that mention).
- **Ruling:** the Referee reads the PR, diff, review threads and checks with `gh`, then posts one PR comment starting
  `REFEREE RULING:` with a verdict, a numbered decision per point, and the next owner. The prefix is only a format
  marker. A ruling is **binding** on technical questions only when the comment's GitHub author matches the Referee
  identity Richard has designated (*pending: Richard to confirm*; all GitHub activity currently runs as Ryaker, so
  author metadata cannot yet distinguish the Referee). Until then rulings are **advisory**. The reviewer verifies the
  author before treating a ruling as binding. No ruling can override `agents:paused`, `policy.toml`, protected-path,
  or CI gates.
- **`needs-richard` is reserved for:** protected paths (`policy.toml`, `.github/`, `src/security/`, secrets), real
  product or security-policy judgment calls, a PR that still fails to converge after a ruling, CI failing twice for the
  same reason, and budget ≥90%. If the Referee reports missing GitHub auth, no ruling arrives within 2 wakes, or the ruling's author cannot be verified,
  fall back to `needs-richard`.
- The Referee never pushes, merges, approves, or relabels (other than adding `needs-richard`). Details: [referee.md](referee.md).

## `#zora-agents` Slack (personal Yaker workspace)

- Richard chats with the agents in `#zora-agents` (`C0CLEQGCJU9`). NanoClaw's Slack app (bot `@NanoClaw`) is wired to
  zora-architect, which replies to every human message there (no @mention needed); unknown humans need approval.
- zora-reviewer has an outbound-only destination (it posts, never answers chat). Zora Referee is a separate Slack app
  that answers only when @mentioned by Richard or `@NanoClaw`.
- Proactive posts (1–2 lines each): PR opened (architect), PR merged and `needs-richard` blockers (reviewer), the 08:30 PT
  daily planning summary, and Monday research / Friday audit wrap-ups. Agents stay silent on idle 30-minute polls.
- Bot-to-bot messages: NanoClaw admits other bots' messages only in rooms listed in `SLACK_A2A_ROOMS` (NanoClaw's
  `slack-a2a-rooms` skill), capped at `SLACK_A2A_MAX_HOPS=6` consecutive bot messages until a human speaks. Agents never
  post bare acknowledgements to each other in Slack; decisions live on GitHub.

## Where to follow along

- GitHub Project board: https://github.com/users/ryaker/projects/1 (Todo / In Progress / In Review / Needs Richard / Done).
- Roadmap and merge notes: #184. Agent control: #189. Planning: Discussion #196.

## Research and decisions

See `research/README.md`. Findings → proposal → critique → decision issue (`decision`) that
Richard approves → `agent:todo` work.
