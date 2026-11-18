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
  1. Answerability gate: `MemoryManager.recallMemory()` (src/memory/memory-manager.ts) already returns `scores` (BM25 + salience) per item, so a threshold on those scores plus graph hits could serve as a relevance heuristic. It is not entity-level coverage: `recallMemory()` does not report which question entities a result covers (a revenue-only hit can score well for a revenue-and-headcount question), so it cannot prove the question is answerable. No new dependency or LLM call is required for a first version (deterministic, as in Auto Ontology's grading step). Estimate: S (~1 PR, ~150 LOC + tests) for the relevance heuristic only; true entity-level coverage (extract entities, match each against recall results) is extra work, roughly M, and would reintroduce an LLM extraction step. Risk: a bad threshold gives false "I don't know" answers; ship behind a config flag, default off.
  2. Provenance on recall: `recallMemory()` already yields item ids; the work is surfacing them in the context assembly and the answer/audit record. Estimate: S. Pairs naturally with #1.
  3. Certified + versioned decisions: `DecisionRecord` (src/memory/graph/graph-types.ts) has summary/rationale/ts and a SUPERSEDES edge, but no `certified` flag or scope. Adding fields touches the graph schema and worker protocol. Estimate: M. Corrected from the issue: also needs a way for Richard to certify (CLI command), and that approval path must not be reachable from model/channel input (CaMeL quarantine).
  4. Central PM routing (#144 WI-6, docs/CENTRAL_ZORA_PM_PLAN.md): the plan routes by `@project` prefix or LLM classification. A term map plus coverage check could replace the LLM fallback, but #144 is Phase 3 and has no code yet. Estimate: fold into #144's decision issue; do not file separately.
- Proposal: adopt patterns 1+2 as one change (answerability gate with provenance, flag-gated, deterministic scoring only), and pattern 3 as a separate change. Pattern 4 is deferred into #144. Do not adopt the product or its optional MCP integration unless Richard points Zora at a SQL dataset.
- Critique (reviewer): pending. Requested on the PR. Decision issues will be opened after the critique (max 2 this week).
- Decision issue: not yet opened.
