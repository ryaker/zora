# Grokbot usage audit and migration inventory (#237) — 2026-11-25

Source: usage numbers Richard posted on #237 (last 7 days; weekly limit 94.5% used, resets Mon Nov 30).
Not seen: per-session token logs. Anything below about *why* a session was expensive is inference.

## 1. Why it was expensive
| Finding | Evidence |
|---|---|
| Chat dominates, routines do not | ~85% chat, ~15% routines. Chief of Staff 36-41%, Life Ops 31-33%, Job Search 14-16%. |
| One-day spike | Tue Nov 24 = 47% of the week; Wed Nov 18 = 29%. |
| Many cheap runs add little | Live deploy QA ~210 runs/wk is ~1%; inbox drain and MSR watch ~1% each. |
| Heavy one-off chat work | e.g. the subscriptions audit (Life Ops, nearly all chat). |

Conclusion: moving routines saves at most ~15%. The lever is making chat-heavy sessions cheaper.
**Open question (needs Richard):** a per-session token export for Nov 24 (read-only) would show whether the
cost was long context re-sent each turn, tool-output volume, or model choice. Until then, "context
discipline" is a hypothesis, not a measured cause.

## 2. Job inventory and Zora mapping, by value
| # | Job | Zora shape | Grant needed | Value / notes |
|---|---|---|---|---|
| 1 | Chat-heavy work (CoS, Life Ops, Job Search) | Zora session on a cheaper default model | none new | Biggest lever. Depends on #236 cost-per-task (bake-off found the 3 Ollama cloud models tied on quality; cost still unmeasured). |
| 2 | Subscriptions audit / finance checks | Skill + read-only Tiller sheet reader | Scoped read grant on the Tiller sheet only (#233) | High; no bank/card/account access, per Richard. Zora has no Sheets integration today (nothing in `src/` reads Google Sheets), so this needs a tool or MCP server first. |
| 3 | Agent live-updates routine (~3%) | Existing routine (`RoutineManager`), with `until` (#229) | Slack post only; adapter is #235 | Small win, low risk; blocked on #235. |
| 4 | Learning Radio, daily practice podcasts | Cron routines | Fetch/write within a job workspace | Medium; ordinary routine, no new account. Needs a content-source decision. |
| 5 | Recurring watchers (deploy QA, MSR watch, inbox drain) | Cron/event routines with `until` | Per job; inbox drain overlaps email | Low saving (~1% each). Move only if convenient. |
| 6 | Email reading | Not planned | New account grant | **Not assumed** (Richard). Separate decision. |

## 3. Proposed order
1. Finish #236 so chat runs on a cheaper default (needs plan limits from Richard to price it).
2. Tiller read-only skill, after #233 lands the scoped grant. Prerequisite: a Sheets read path.
3. #235 Slack adapter, then migrate the live-updates routine.
4. Learning Radio / podcasts as routines.
5. Watchers last.

## 4. Needs Richard (plain words)
- **Token export for Tue Nov 24** (read-only) so we can name the real cause instead of guessing.
- **Email**: no work will start; tell us if you ever want it scoped as a separate read-only grant.
- Nothing here changes policy or spends money; no `needs-richard` label is set.
