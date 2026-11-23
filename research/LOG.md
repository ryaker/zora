# Research log (append-only)

<!-- Entry format:
## YYYY-MM-DD — <project> <version>
- Source: <link>
- Change: <one line>
- Relevance: adopt | watch | ignore — <why>
- Proposal (if adopt): <one paragraph>
- Critique (reviewer): <one paragraph>
- Decision issue: #NNN
-->

## 2026-11-18 — Baseline (seeded by Grok Bot during setup)
- NanoClaw v2026.11.0-rc.1 installed on the M2 Air (pinned tag).
- OneCLI gateway 1.45.0 on the Air; M4's OneCLI is 1.42.0 (too old for NanoClaw rc's per-agent grants).
- OpenClaw v2026.11.5; OpenBot 1.0 (Nov 10); DeepSeek Harness in developer preview.

## 2026-11-18 — NVIDIA Auto Ontology v1.3.0 (evaluation, issue #185)
- Source: https://github.com/NVIDIA/auto-ontology (README, docs/architecture.md, docs/mcp.md read Nov 18, 2026). Nimble MCP was unavailable (401); only the GitHub contents API was used, 0 Nimble requests.
- Change: New Apache-2.0 semantic layer for text-to-SQL agents. Compiles an ontology from relational metadata; answers via retrieve → run_sql → submit and returns SQL + steps. `check_answerable` (MCP) grades question coverage without writing SQL: (1) a REASONING LLM extracts the entities the question names; (2) pgvector finds candidate attributes/terms and an LLM judges which are relevant (`CandidateRetrievalAgent`); (3) a deterministic step grades coverage as the share of entities with a candidate within the distance threshold. Only step 3 is deterministic; Zora's adaptation below would drop the two LLM steps. Chat does not call it; the agent calls it first and decides whether to ask.
- Relevance: **watch** the product, **adopt** two patterns. Not a drop-in: target is SQL warehouses and it needs a multi-service stack (FastAPI x2, Next.js, Postgres+pgvector, MCP server on port 3003) plus 4 model roles. That conflicts with Zora's local, locked-by-default TS daemon. Confirmed the initial fit assessment, with the corrections below.
- Fit against current Zora code (verified in source):
  1. Advisory low-relevance signal (not an answerability gate): `MemoryManager.recallMemory()` (src/memory/memory-manager.ts) already returns `scores` (BM25 + salience) per item, so a threshold on those scores plus graph hits could serve as a relevance heuristic. It is not entity-level coverage: `recallMemory()` does not report which question entities a result covers (a revenue-only hit can score well for a revenue-and-headcount question), so it cannot prove the question is answerable. A low score may prompt a clarifying question; a high score must not be read as coverage; neither affects policy authorization. No new dependency or LLM call is required for a first version (deterministic, as in Auto Ontology's grading step). Estimate: S (~1 PR, ~150 LOC + tests) for the relevance heuristic only; true entity-level coverage (extract entities, match each against recall results) is separate work, roughly M; LLM extraction is one option, not a requirement. Risk: a bad threshold gives false "I don't know" answers; ship behind a config flag, default off.
  2. Provenance on recall: `memory_search` (src/tools/memory-tools.ts) already returns item IDs. The new work is recording the authorized sources actually retrieved, separately from the citations an answer makes, and accepting citations only from that retrieval set. Estimate: S. Pairs naturally with #1.
  3. Certified + versioned decisions: `DecisionRecord` (src/memory/graph/graph-types.ts) has summary/rationale/ts and a SUPERSEDES edge, but no `certified` flag or scope. Adding fields touches the graph schema and worker protocol. Estimate: M. Corrected from the issue: also needs a way for Richard to certify (CLI command), and that approval path must not be reachable from model/channel input (CaMeL quarantine).
  4. Central PM routing (#144 WI-6, docs/CENTRAL_ZORA_PM_PLAN.md): the plan routes by `@project` prefix or LLM classification. A term map plus coverage check could replace the LLM fallback, but #144 is Phase 3 and has no code yet. Estimate: fold into #144's decision issue; do not file separately.
- Proposal: adopt patterns 1+2 as one change (advisory low-relevance signal plus citation validation against the authorized retrieval set, flag-gated, deterministic scoring only; test cases, cost bounds and operator-only certification controls go in the ADRs), and pattern 3 as a separate change. Pattern 4 is deferred into #144. Do not adopt the product or its optional MCP integration unless Richard points Zora at a SQL dataset.
- Critique (reviewer): pending. Requested on the PR. Decision issues will be opened after the critique (max 2 this week).
- Decision issue: not yet opened.

## 2026-11-18 — OpenBot (CopilotKit) v1.1.0 (evaluation, issue #191)
- Source: https://github.com/CopilotKit/OpenBot (releases v1.0.0 2026-11-09 … v1.1.0 2026-11-17; docs/approvals.md, routines.md, automatic-learning.md, coworkers.md). The issue says 1.0 shipped Nov 10; the tag is Nov 9, and v1.1.0 is current. Read via the GitHub API (Nimble MCP returns 401). 0 Nimble requests. Not read: source code, Intelligence (separately licensed, closed).
- What it is: MIT-licensed, self-hostable "AI coworker" workspace (desktop app, Kubernetes/Helm, Postgres with row-level-security roles). Built-in Bots plus remote agents over AG-UI, MCP tools, Slack/Teams/mobile frontends. Team-oriented and enterprise-shaped; Zora is single-user and local-first, so the deployment stack is out of scope.
- Where it is ahead of Zora (policy/UX, not security posture):
  1. Approval kinds are recognized from action metadata (tool name, button label, page address) and, for payments and credentials, words in the action and its page; the docs say prose inside a document or draft the Bot handles does not trigger a kind. That separates document prose from action metadata, but it is not name-only and the docs make no prompt-injection resistance guarantee, so we do not claim one. Kinds: pay, credential change, delete, send, share, publish. Zora's `IrreversibilityScorer` already uses normalized tool names for its baseline; the open question is classification coverage only.
  2. Approval grants are bound: "this conversation" = same Bot + tool + place + account, cannot reach another conversation or tool; "strictest matching rule wins"; every grant is labeled in the audit row. Zora's `ApprovalQueue` has `allow-30m` / `allow-session` (src/core/approval-queue.ts) behind a risk-score ceiling, but the blanket is a time window or boolean, not keyed to tool/target.
  3. Credential changes on a website are handed to the human ("I did it myself" / "Don't do it"); no approval can make the agent type a credential.
  4. Learned skills are proposals with SKILL.md, rationale and source conversations; Approve/Reject; in team mode nothing auto-publishes. Relevant to the SkillSynthesizer work (#174).
  5. Routines/goals/check-ins unified as one list with four columns: What / Starts / Does (acts vs only tells) / Until (done-when). A routine tied to a goal dies with it. Minor UX idea for Zora routines.
- Where it is weaker than Zora (do not copy): kinds of action are *open by default* (members may "Always allow here"); no policy file consulted before every call (rules are DB rows); Automatic Learning defaults on; closed, separately licensed Intelligence service holds memory/learning. Zora's fail-closed, locked-by-default model is stricter.
- Ranked shortlist (effort / risk):
  1. Scope-bound grants: key both `allow-session` and `allow-30m` to trusted session, requester, tool and target identity, keep the score ceiling, and let current policy and mandatory human approval always win (M; narrows an existing feature, touches src/core not src/security). Authorization semantics are Richard's call, so this goes to a decision issue with `needs-richard`, not straight to implementation.
  2. Classification-coverage audit of `IrreversibilityScorer`: which kinds (pay, credential, share, publish) lack a baseline mapping. Read-only audit first; must not weaken the separate safety checks (S).
  3. Human-only credential-change handoff as a policy kind (M; touches policy.toml semantics, so `needs-richard`).
  4. Proposed-skill review card with provenance, as a gate for #174 (S once #174 exists).
  5. Routine `Does`/`Until` fields (S; watch, low priority).
- Verdict: **watch** the product, **adopt** shortlist items 1 and 2 as follow-ups after critique; 1 and 3 need Richard.
- Critique (reviewer): pending. Requested on the PR.
- Decision issue: none yet (this week's cap of 2 decision issues is reserved for #185).

## 2026-11-18 — Lean pass #1 (issue #204)
- Baseline (main @ 91927c6): 185 tracked src files, ~40.5k src lines, 163 test files, 16 runtime + 12 dev dependencies. Not measured in this sandbox (no representative host): bundle size, startup time, idle memory, suite wall time. Those need a run on the M2 Air; left for the next pass.
- Dependency check: every runtime dependency is imported from src/bin/scripts, except `pino-pretty`, which is loaded by `require.resolve` in src/utils/logger.ts (dev-time pretty logging, optional fallback to JSON); nothing is unused.
- `dashboard_token` from #174: **still open, not fixed here.** `DashboardServer` accepts a `dashboardToken` option and falls back to `ZORA_DASHBOARD_TOKEN`, but nothing in src/cli/daemon.ts passes a configured value to it (docs still describe a `dashboardToken` config setting), so a config-file token is ignored. Either wire it or remove the documented setting; tracked under #174.
- Cut: SkillSynthesizer wasted one LLM call on every long (>=8 tool calls or turns) session when no TTY and no enabled ApprovalQueue exist (daemon default), because `_confirmWithUser()` then always fails closed. It now returns before the call. Before: 1 discarded call per long daemon session. After: 0. Outcomes unchanged (no skill saved). Covered by two new tests. Known remaining waste, left open under #174: with an *enabled* ApprovalQueue that has no registered sender, `request()` cannot reach a human, so the call is still discarded; fixing that needs a queue readiness check and touches approval behavior, so it is not done here.
- Next candidates: measure bundle/startup/idle memory on the host; look for unused exports across src (a tool such as knip would need a package approval).

## 2026-11-23 — Weekly round: WATCHLIST release sweep
- Source: GitHub releases API for each WATCHLIST repo (release bodies read for NanoClaw v2026.11.0, OpenClaw v2026.11.7, OneCLI v2.20.0, Claude Agent SDK v0.3.330, OpenCode v2.4.0). 0 Nimble requests (MCP still returns 401). `meetopenbot/openbot` returned no releases; OpenAI Agents SDK has only 0.22.0 / 0.22.0-alpha.3 since Nov 12.
- Change summary:
  - **NanoClaw v2026.11.0** (stable, Nov 20): OneCLI 1.45 per-agent key grants; webhook server binds 127.0.0.1 by default; Node security-release floor; agent images on Claude Code 2.1.321 / SDK 0.3.321 with Haiku 5.5; templates for agent creation; Cursor provider. Relevance: **adopt (ops, not code)** — the Air runs rc.1; move to stable via `/update-nanoclaw` after checking the BREAKING list (OneCLI DB password, Node version). Needs Richard (infra/secrets), not an `agent:todo`.
  - **Claude Agent SDK v0.3.330** (Zora pins `^0.3.232`): new `settings_not_in_effect` informational message when settings fail validation; `query()` now throws on an unparseable JSON-string `settings`; SDK MCP result lost/swapped on reconnect fixed. Relevance: **adopt** — bump the dependency and run tests/security/tool-enforcement.test.ts; check that Zora's `settings` usage does not pass a JSON string, and surface `settings_not_in_effect` in the audit log (a silently ignored settings file is a policy-visibility concern). Not verified: whether Zora passes `settings` at all; implementer must grep first.
  - **OpenClaw v2026.11.7**: conversation recovery across restarts, slash commands in ordinary prose no longer execute, warn before retrying a tool action whose reply was lost, steering preserved through long tools, subagent results stay attached to their turn. Relevance: **watch** — compare against Zora's RetryQueue and channel command parsing in source before proposing anything.
  - **OpenCode v2.4.x** (reviewer runtime): automations (cron / MCP-event triggers), Copilot no longer reads `GITHUB_TOKEN`, MCP protocol negotiation. Relevance: **watch** — if the reviewer runtime auto-updates, confirm `"automations": false` unless wanted.
  - **OneCLI v2.20.0** (CLI/app, Nov 9): UI features only. **ignore**. Gateway version is tracked via NanoClaw's update guide.
  - **CopilotKit OpenBot v1.2.0-rc.1–3** and **DeepSeek Harness v0.2.3-alpha.x**: prereleases. **watch**; revisit on stable.
  - **NVIDIA Auto Ontology**: only README/doc commits since the Nov 18 evaluation. **ignore**.
- Proposal: (1) one S-size `agent:todo`: bump `@anthropic-ai/claude-agent-sdk` to 0.3.330 with the checks above. (2) Richard-facing note: upgrade NanoClaw to v2026.11.0 stable. No decision issues this week.
- Critique (reviewer): pending.
- Decision issue: none.
