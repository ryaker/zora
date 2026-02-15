# Zora Memory System — WSJF Implementation Plan

> **Date:** 2026-02-14
> **Spec:** `specs/MEMORY_SYSTEM_SPEC.md`
> **Issue:** #109
> **Existing code:** `src/memory/` (MemoryManager, StructuredMemory, SalienceScorer, CategoryOrganizer, ExtractionPipeline)
> **Existing tests:** 48+ tests across 5 test files

---

## Inventory: What Exists vs. What's Needed

| Component | Exists | Gap |
|-----------|--------|-----|
| MemoryManager (3-tier loading) | Yes | Context injection not wired into execution loop |
| StructuredMemory (CRUD + atomic writes) | Yes | Search is naive `includes()`, not BM25+ |
| SalienceScorer | Yes | Half-life 7→14 days, additive→multiplicative scoring |
| CategoryOrganizer | Yes | Works, needs minor tuning |
| ExtractionPipeline | Yes | Works, needs validation gates added |
| MiniSearch integration | **No** | Core upgrade: BM25+ replaces naive search |
| Agent tools (memory_save/search/forget) | **No** | Must expose to LLM via tool definitions |
| Context injection middleware | **No** | ORCH-07: auto-inject into execution loop |
| Validation pipeline | **No** | Length, transient, dedup, contradiction, rate limit |
| MCP memory bridge | **No** | Auto-detect + adapter pattern |
| CLI: edit/export/import/stats | **No** | Partial CLI exists (search/forget/categories) |
| Performance benchmarks | **No** | Need latency tests at 100/1K/10K items |
| E2E memory persistence test | **No** | Save in session A → recall in session B |

---

## WSJF-Scored Work Items

Scoring: BV (Business Value 1-5) × TC (Time Criticality 1-5) × RR (Risk Reduction 1-5) ÷ Size (1-5)

| ID | Work Item | BV | TC | RR | Size | WSJF | Deps | Stream |
|----|-----------|----|----|-----|------|------|------|--------|
| MEM-01 | **MiniSearch integration** — Replace naive `includes()` search with BM25+ in StructuredMemory. Add `minisearch` dep. Build/rebuild index from JSON files. Persist index to `index/minisearch.json`. | 5 | 5 | 4 | 2 | **7.0** | — | core |
| MEM-02 | **Salience scorer upgrade** — Change half-life 7→14 days. Change additive→multiplicative composition. Add configurable parameters. | 4 | 4 | 3 | 1 | **11.0** | — | core |
| MEM-03 | **Validation pipeline** — Add to StructuredMemory.createItem(): min length (15 chars), transient rejection, Jaccard dedup (>0.7), contradiction detection, rate limit (10/session). | 5 | 4 | 5 | 2 | **7.0** | — | core |
| MEM-04 | **Agent tool definitions** — Create `memory_save`, `memory_search`, `memory_forget` tool definitions in src/tools/. Wire into tool registry. Include in system prompt tool list. | 5 | 5 | 3 | 2 | **6.5** | MEM-01 | core |
| MEM-05 | **Context injection middleware** — Create ContextInjectionMiddleware in execution loop. Auto-call MemoryManager.loadContext() before provider.execute(). Closes ORCH-07. | 5 | 5 | 5 | 2 | **7.5** | — | orchestration |
| MEM-06 | **CLI expansion** — Add `zora memory edit` (opens MEMORY.md in $EDITOR), `export` (JSON dump), `import` (JSON load), `stats` (counts by type/category/age), `list` (recent items with content). | 3 | 2 | 1 | 2 | **3.0** | — | cli |
| MEM-07 | **MCP memory bridge: detection** — On boot, scan available MCP tools for memory patterns (Mem0, OpenMemory, KMS, claude-mem, generic). Create MemoryMCPAdapter interface. | 4 | 3 | 3 | 3 | **3.3** | MEM-01 | mcp |
| MEM-08 | **MCP memory bridge: read/write** — Implement write-through (built-in + MCP) and read-through with cache miss fallback. Session start sync. | 3 | 2 | 3 | 3 | **2.7** | MEM-07 | mcp |
| MEM-09 | **Extraction integration** — Wire ExtractionPipeline into job completion flow. Add reflection prompt. Trigger on session end. | 4 | 3 | 2 | 2 | **4.5** | MEM-04, MEM-05 | orchestration |
| MEM-10 | **Tests: MiniSearch + salience** — Unit tests for BM25+ search quality (precision/recall on test corpus). Salience scoring accuracy tests. Index serialization round-trip tests. | 5 | 4 | 5 | 2 | **7.0** | MEM-01, MEM-02 | tests |
| MEM-11 | **Tests: validation pipeline** — Each gate tested independently. Edge cases (exact threshold, empty input, Unicode). Rate limit tests. | 4 | 3 | 5 | 1 | **12.0** | MEM-03 | tests |
| MEM-12 | **Tests: agent tools** — Tool definition schema tests. Mock provider receives memory tools. Tool calls produce correct StructuredMemory mutations. | 4 | 3 | 4 | 2 | **5.5** | MEM-04 | tests |
| MEM-13 | **Tests: context injection** — Execution loop injects memory before provider call. Routine/retry tasks get context. Empty memory doesn't break. | 5 | 4 | 5 | 2 | **7.0** | MEM-05 | tests |
| MEM-14 | **Tests: E2E persistence** — Save memory in session A → rebuild index → search in session B → find it. Daily notes persist. MEMORY.md read-only enforcement. | 5 | 3 | 5 | 2 | **6.5** | MEM-01, MEM-05 | tests |
| MEM-15 | **Tests: performance benchmarks** — Search latency at 100/1K/10K items. Index build time. Salience computation overhead. Must pass: <10ms search at 1K items. | 3 | 2 | 3 | 2 | **4.0** | MEM-01 | tests |
| MEM-16 | **Tests: MCP bridge** — Mock MCP adapter. Write-through test. Cache miss fallback. Auto-detection of tool patterns. | 3 | 2 | 4 | 2 | **4.5** | MEM-07, MEM-08 | tests |
| MEM-17 | **Docs: memory config reference** — Add `[memory]` section to docs/configuration.md. Document all config options with defaults. | 2 | 2 | 1 | 1 | **5.0** | MEM-01 | docs |
| MEM-18 | **Docs: advanced MCP memory** — Create docs/advanced/memory-mcp-integration.md. Document how to add Mem0, OpenMemory, KMS. Show detection patterns. | 2 | 1 | 1 | 2 | **2.0** | MEM-07 | docs |

---

## Priority Order (by WSJF)

| Rank | ID | WSJF | Item |
|------|----|------|------|
| 1 | MEM-11 | 12.0 | Tests: validation pipeline |
| 2 | MEM-02 | 11.0 | Salience scorer upgrade |
| 3 | MEM-05 | 7.5 | Context injection middleware (ORCH-07) |
| 4 | MEM-01 | 7.0 | MiniSearch integration |
| 5 | MEM-03 | 7.0 | Validation pipeline |
| 6 | MEM-10 | 7.0 | Tests: MiniSearch + salience |
| 7 | MEM-13 | 7.0 | Tests: context injection |
| 8 | MEM-04 | 6.5 | Agent tool definitions |
| 9 | MEM-14 | 6.5 | Tests: E2E persistence |
| 10 | MEM-12 | 5.5 | Tests: agent tools |
| 11 | MEM-17 | 5.0 | Docs: memory config reference |
| 12 | MEM-09 | 4.5 | Extraction integration |
| 13 | MEM-16 | 4.5 | Tests: MCP bridge |
| 14 | MEM-15 | 4.0 | Tests: performance benchmarks |
| 15 | MEM-07 | 3.3 | MCP bridge: detection |
| 16 | MEM-06 | 3.0 | CLI expansion |
| 17 | MEM-08 | 2.7 | MCP bridge: read/write |
| 18 | MEM-18 | 2.0 | Docs: advanced MCP memory |

---

## Dependency Graph

```
MEM-02 (salience upgrade)  ──────────────────────┐
                                                   │
MEM-01 (MiniSearch) ──┬── MEM-04 (agent tools) ──┤── MEM-09 (extraction)
                      │                            │
                      ├── MEM-10 (tests: search)  │
                      │                            │
                      ├── MEM-15 (perf bench)     │
                      │                            │
                      └── MEM-07 (MCP detect) ────┴── MEM-08 (MCP r/w)
                                                        │
                                                        └── MEM-16 (tests: MCP)

MEM-03 (validation) ──── MEM-11 (tests: validation)

MEM-05 (context inject) ── MEM-13 (tests: context)
                            │
                            └── MEM-09 (extraction)

MEM-14 (E2E tests) ← MEM-01 + MEM-05

MEM-06 (CLI) ── no deps
MEM-17 (docs: config) ← MEM-01
MEM-18 (docs: MCP) ← MEM-07
```

---

## Agent Team Plan

### 4 Parallel Streams

| Stream | Agent | Worktree Branch | Work Items | Est |
|--------|-------|-----------------|------------|-----|
| **Core** | memory-core-agent | `feat/memory-core` | MEM-01, MEM-02, MEM-03, MEM-04 | 3-4h |
| **Orchestration** | memory-orch-agent | `feat/memory-orchestration` | MEM-05, MEM-09 | 2h |
| **Tests** | memory-test-agent | `feat/memory-tests` | MEM-10, MEM-11, MEM-12, MEM-13, MEM-14, MEM-15 | 3-4h |
| **Docs + CLI** | memory-docs-agent | `feat/memory-docs` | MEM-06, MEM-17, MEM-18 | 1-2h |

### Execution Order

```
Phase 1 (parallel):
  memory-core-agent:  MEM-02 → MEM-01 → MEM-03 → MEM-04
  memory-orch-agent:  MEM-05 (no deps, can start immediately)
  memory-docs-agent:  MEM-06 (no deps, can start immediately)

Phase 2 (after Phase 1):
  memory-orch-agent:  MEM-09 (needs MEM-04 + MEM-05)
  memory-test-agent:  MEM-11 → MEM-10 → MEM-13 → MEM-12 → MEM-14 → MEM-15
  memory-docs-agent:  MEM-17 → MEM-18

Phase 3 (stretch, after core is solid):
  memory-core-agent:  MEM-07 → MEM-08
  memory-test-agent:  MEM-16
```

### Merge Strategy

1. Core merges first (MiniSearch + salience + validation + tools)
2. Orchestration merges second (context injection + extraction)
3. Tests merge third (validates everything)
4. Docs + CLI merge last (no conflicts)

### Overlap Risk

| File | Touched By | Conflict Risk |
|------|-----------|---------------|
| `src/memory/structured-memory.ts` | Core (MiniSearch) + Tests | Low — Core adds, Tests read |
| `src/memory/salience-scorer.ts` | Core (upgrade) + Tests | Low — Core changes, Tests validate |
| `src/memory/memory-manager.ts` | Core + Orch | **Medium** — both modify. Orch adds loadContext wiring, Core adds MiniSearch. Resolve at merge. |
| `src/orchestrator/execution-loop.ts` | Orch only | None |
| `src/types.ts` | Core (tool types) + Orch | Low — different sections |

---

## Success Criteria

Before merging any PR, ALL of these must pass:

- [ ] `npm test` — all existing 698+ tests still pass
- [ ] New tests cover every work item
- [ ] `zora memory search "test query"` returns BM25+-scored results in <10ms
- [ ] Agent can call `memory_save` and `memory_search` during task execution
- [ ] Memory persists across daemon restarts
- [ ] MEMORY.md is read-only to agent tools (enforced)
- [ ] Search quality: "what framework" finds "Zora uses pino for logging" (semantic gap handled by fuzzy/prefix)
- [ ] Performance: 1K items → search <10ms, index build <100ms
