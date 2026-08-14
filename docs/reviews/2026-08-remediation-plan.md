# Zora Remediation Plan — August 2026

Companion to `2026-08-code-review.md`. This is the execution plan: WSJF-scored
backlog, dependency DAG, parallel agent workstreams, and the two new
architectural directions (SDK 0.3.x adoption, SparrowDB graph memory).

Scores use the repo's existing formula from `gaps/wsjf-scores.json`:

```
WSJF = (usability_value + wiring_impact + security_risk + time_criticality) / job_size
```

---

## 0. Version reality check

The review's SDK findings were verified against **0.2.141**, which is what
`^0.2.76` resolves to on a fresh `npm install` today. But two facts sharpen the
picture:

| | Version | Note |
|---|---|---|
| `package.json` range | `^0.2.76` | |
| `package-lock.json` pin | **0.2.76** | what CI and reproducible installs actually get |
| Fresh install (caret) | 0.2.141 | what a user without the lockfile gets |
| **Latest on npm** | **0.3.232** | outside the caret range — never picked up |

So the codebase is running a version from the 0.2 line while the SDK has moved a
minor version ahead, and the caret pin means it will *never* upgrade on its own.

**The upgrade is lower-risk than the version jump suggests.** I diffed the
`Options` type between 0.2.76 and 0.3.232:

- **50 → 64 options, with zero removals.** Nothing Zora passes today has been
  deleted or renamed.
- 14 additive options, several of which are directly useful (below).

This means the 0.3.232 upgrade is a dependency bump plus opt-in adoption, not a
migration. It should be done *first*, because three of the highest-value fixes
are cleaner on 0.3.x.

### What 0.3.x gives Zora that 0.2.76 does not

| New capability | Replaces / enables |
|---|---|
| `sessionStore` + `sessionStoreFlush` (pluggable session persistence) | Zora's hand-rolled `SessionManager` JSONL + `BufferedSessionWriter` can become an SDK-native store — one source of truth instead of two parallel transcripts |
| Session API: `listSessions`, `getSessionInfo`, `getSessionMessages`, `forkSession`, `deleteSession`, `renameSession`, `tagSession`, `importSessionToStore` | Finding #5 (history replay) and finding #11 (`listSessions` reading every file) both dissolve |
| `getSubagentMessages`, `listSubagents`, `forwardSubagentText` | Real observability into delegated work — Zora's `delegate_to_subagent` is currently a black box |
| `taskBudget` | Native, model-aware version of Zora's `ErrorBudget`; the model paces itself instead of being cut off |
| `skills` | Native skill loading alongside Zora's own skill system |
| `includeHookEvents` | Hook decisions become visible in the event stream — needed to make hook denials auditable |
| `planModeInstructions`, `toolAliases`, `title`, `managedSettings`, `loadTimeoutMs` | Smaller quality-of-life wins |
| `AgentDefinition` with `async` / `asyncTimeout` / `background` / per-agent `model`, `effort`, `skills`, `memory`, `tools` | **Native async background subagents** — the parallelization primitive, without Zora building its own |
| Full hook set: `PreToolUse`, `PostToolUse`, `PreCompact`, `PostCompact`, `SessionStart`, `SessionEnd`, `Stop`, `SubagentStop`, `UserPromptSubmit`, `Notification` | `PreToolUse` is the real enforcement point (finding #2); `PreCompact` is NanoClaw's routing-context trick |

---

## 1. Security in the path — the design

The review found three independent reasons no policy check reaches a real tool
call. The fix is not three patches; it's one coherent enforcement chain with
defense in depth. Target state:

```
model wants tool
   ↓
[1] allowedTools / disallowedTools      ← static allowlist, set from policy at boot
   ↓
[2] PreToolUse hook  (SDK-native)       ← ShellSafety, SensitiveFileGuard, SecretRedact,
   ↓                                       RateLimit, IrreversibilityScorer.
                                           Deny here actually blocks. Runs ahead of canUseTool.
[3] canUseTool       (permissionMode:'default')
   ↓                                    ← PolicyEngine, capability tokens, channel
                                           CapabilitySet, ApprovalQueue escalation
[4] tool executes
   ↓
[5] PostToolUse hook                    ← LeakDetector, audit log, NegativeCache,
                                           ErrorPatternDetector
```

Four properties this buys that don't exist today:

1. **Every layer is pre-execution except [5].** Today the only pre-execution
   layer is [3], and it is disabled.
2. **`permissionMode` is `'default'` everywhere.** `bypassPermissions` is removed
   from the codebase entirely — not made configurable. If someone genuinely wants
   it, they can set `allowDangerouslySkipPermissions` themselves and own it.
3. **Hook denials are real denials.** `ToolHookRunner` keeps its interface but is
   invoked *from* the `PreToolUse` bridge rather than from stream observation, so
   `SensitiveFileGuardHook`'s "non-bypassable" comment becomes true.
4. **One tool-registration path.** Both `ExecutionLoop` and `ClaudeProvider` build
   their MCP server through the same `buildZoraMcpServer()`, so a tool can never
   again exist in one path and not the other.

Non-negotiable acceptance test, in `tests/security/`, running against a real
`query()` with a stub tool: a `Bash` call matching a `denied_commands` rule must
produce a denial, and the command must not execute. If that test doesn't exist,
the work isn't done.

---

## 2. SparrowDB graph memory

`sparrowdb@0.1.21` is on npm — native N-API bindings, **zero dependencies**,
7 MB unpacked, prebuilt for `linux-x64-gnu` and `darwin-arm64` (exactly Zora's CI
matrix). It installs clean and needs no build toolchain.

### API surface (from `index.d.ts`)

```ts
const db = SparrowDB.open('/path/to/graph.db');   // SWMR: many readers, one writer
const r  = db.execute('MATCH (n:Person) RETURN n.name');  // sync, auto-commit
db.checkpoint();   // fold delta log into CSR base files
db.optimize();     // checkpoint + sort adjacency lists
```

### Two constraints that shape the design

1. **`execute()` is synchronous native code.** In a long-running daemon that
   blocks the event loop. Graph work must be either (a) small and bounded, or
   (b) moved to a `worker_thread`. Recommendation: a `GraphMemoryWorker` on a
   worker thread with a message-passing façade, mirroring how `ReflectorWorker`
   is already structured. Bulk writes batch and `checkpoint()` on the worker.
2. **`ReadTx.execute()` and `WriteTx.execute()` throw — not yet implemented**
   (tracked as SPA-100 / SPA-99 upstream). So transactions are unavailable; all
   access goes through `SparrowDB.execute()` in implicit auto-commit. Design for
   idempotent writes and don't assume multi-statement atomicity.

Also worth carrying forward from the sparrowdb skill's known parser gaps:
`CREATE … RETURN` is unsupported (use CREATE then MATCH), one `CREATE` per
statement, and edge creation must `MATCH` both endpoints first. The adapter
should encapsulate those so callers never hit them.

### Where the graph earns its place

Zora's memory today is: JSON file per item + MiniSearch BM25 + flat categories +
daily notes. BM25 answers *"what did I write about X"*. It cannot answer
relational questions, which is where a long-running personal agent actually lives:

- *"What else touches the project this task belongs to?"* — entity → project →
  sibling tasks
- *"Which decisions supersede this one?"* — `SUPERSEDES` chains
- *"Who is this person, and what have we discussed with them?"* — person →
  interactions → commitments
- *"What broke last time we tried this approach?"* — task → failure → resolution,
  which is the durable form of what `NegativeCache` currently keeps as a flat hash

Proposed layering — **additive, not a replacement**:

| Tier | Store | Answers |
|---|---|---|
| Lexical | MiniSearch BM25 (existing) | "find text like this" |
| Structural | **SparrowDB** (new) | "what relates to this, and how" |
| Narrative | Daily notes + MEMORY.md (existing) | "what happened recently" |

Minimal ontology to start — resist modeling everything:

```
(:Entity {name, kind})        person | project | tool | concept
(:Task   {jobId, summary, outcome, ts})
(:Decision {summary, rationale, ts})
(:Failure {tool, signature, hint, ts})

(:Task)-[:MENTIONS]->(:Entity)
(:Task)-[:PRODUCED]->(:Decision)
(:Task)-[:HIT]->(:Failure)
(:Decision)-[:SUPERSEDES]->(:Decision)
(:Entity)-[:RELATES_TO {kind}]->(:Entity)
```

Write path: the existing `ExtractionPipeline` already produces structured items
post-task — extend it to also emit edges. Read path: a new `graph_recall` tool
alongside `memory_search`, so the model chooses lexical vs relational retrieval.

**Do not** put the graph on the critical path of task start until it has proven
itself. Ship it as an enrichment tier that can be disabled by config, measure
whether `graph_recall` actually gets called and whether it improves outcomes,
then promote it.

### On SQLite generally

Beyond the graph: NanoClaw's SQLite-as-transport pattern (paired inbound/outbound
DBs, one writer per file) is a good answer to Zora's JSONL + in-memory buffer
approach, *if* Zora ever moves to process/container isolation. Until then it's
solving a problem Zora doesn't have — everything is in one process. Sequence it
after the isolation spike, not before.

---

## 3. WSJF backlog

Raw WSJF, highest first. `JS` = job size (days-ish).

| ID | Title | Usab | Wire | Sec | Time | JS | **WSJF** |
|---|---|---|---|---|---|---|---|
| **SEC-20** | `permissionMode` → `'default'`; delete `bypassPermissions` | 6 | 9 | 10 | 9 | 1 | **34.0** |
| **ERR-20** | `AbortController` for stream timeout + cancellation | 7 | 5 | 3 | 6 | 1 | **21.0** |
| **SEC-22** | Gemini prompt via stdin, not argv | 5 | 2 | 8 | 4 | 1 | **19.0** |
| **PROV-10** | Provider `cwd` from `agent.workspace` | 7 | 4 | 5 | 3 | 1 | **19.0** |
| **SDK-04** | Model defaults → Claude 5 family; expose `effort` | 6 | 3 | 1 | 6 | 1 | **16.0** |
| **SDK-01** | Zora tools via `createSdkMcpServer` (shared builder) | 10 | 10 | 3 | 8 | 2 | **15.5** |
| **SEC-21** | `ToolHookRunner` → SDK `PreToolUse` bridge | 5 | 8 | 10 | 7 | 2 | **15.0** |
| **DOC-10** | Rewrite `CLAUDE.md` against v0.12.0 reality | 4 | 5 | 1 | 5 | 1 | **15.0** |
| **SDK-02** | Upgrade SDK 0.2.76 → 0.3.232 | 4 | 8 | 5 | 9 | 2 | **13.0** |
| **PERF-04** | `.unref()` all 5 background timers; drop `skipChannels` | 3 | 4 | 1 | 3 | 1 | **11.0** |
| **PERF-01** | `Map` for `tool_result` → `tool_call` lookup (O(n²) → O(1)) | 2 | 1 | 1 | 4 | 1 | **8.0** |
| **MEM-31** | Adopt SDK `sessionStore`; retire parallel JSONL | 4 | 7 | 2 | 6 | 3 | **6.3** |
| **SDK-03** | Session resume via `resume` / `forkSession` | 5 | 6 | 2 | 5 | 3 | **6.0** |
| **PERF-03** | Cache SOUL.md; drop sync read per task | 2 | 1 | 1 | 2 | 1 | **6.0** |
| **PERF-05** | Demand-driven retry scheduling | 2 | 1 | 1 | 2 | 1 | **6.0** |
| **PERF-06** | Build custom tools once at boot | 1 | 1 | 1 | 2 | 1 | **5.0** |
| **PERF-02** | Session index; stop full-file `listSessions` | 4 | 1 | 1 | 3 | 2 | **4.5** |
| **MEM-30** | SparrowDB graph memory tier | 7 | 6 | 2 | 5 | 5 | **4.0** |
| **REF-01** | Split `orchestrator.ts` into 5 modules | 2 | 6 | 2 | 8 | 5 | **3.6** |

Two deliberate overrides of raw WSJF order:

- **SDK-02 moves to the front of its wave** despite scoring 13.0, because SDK-01,
  SEC-21, SDK-03, and MEM-31 are all cleaner on 0.3.x. Doing it after would mean
  writing code twice.
- **REF-01 goes last** despite unblocking future work, because splitting
  `orchestrator.ts` while five other streams are editing it guarantees merge
  pain. It is the one item that must not run in parallel with anything.

---

## 4. Dependency DAG and parallel waves

```
Wave 1 (parallel, 3 agents)
├── A: SDK-02 ──▶ SDK-01 ──▶ SEC-20 ──▶ SEC-21     [provider + enforcement]
│                        └──▶ SDK-04, PROV-10, SEC-22, ERR-20
├── B: PERF-02, PERF-01, PERF-03, PERF-04, PERF-05, PERF-06   [efficiency]
└── C: MEM-30 spike + adapter                       [graph memory]

Wave 2 (parallel, 2 agents — needs Wave 1 A merged)
├── D: SDK-03, MEM-31                               [session resume + store]
└── E: DOC-10 + security test suite hardening

Wave 3 (solo — needs everything merged)
└── F: REF-01 orchestrator split
```

### File ownership (conflict avoidance)

Each agent runs in its own git worktree and owns a disjoint file set. This is the
whole reason the waves are cut this way.

| Agent | Owns | Must not touch |
|---|---|---|
| **A** provider-sdk | `package.json`, `src/providers/**`, `src/orchestrator/execution-loop.ts`, `src/hooks/sdk-hook-bridge.ts` (new), `src/tools/zora-mcp-server.ts` (new), `src/cli/index.ts`, `src/cli/daemon.ts`, `src/orchestrator/orchestrator.ts` | `src/memory/**`, `src/dashboard/**` |
| **B** perf | `src/orchestrator/session-manager.ts`, `src/dashboard/server.ts`, `src/memory/structured-memory.ts` | `src/orchestrator/orchestrator.ts`, `src/providers/**` |
| **C** graph-memory | `src/memory/graph/**` (new), `src/tools/graph-tools.ts` (new) | everything else; `package.json` dep added by coordinator |
| **D** sessions | `src/orchestrator/session-manager.ts`, `src/providers/claude-provider.ts` | — (runs after A and B merge) |
| **E** docs+tests | `CLAUDE.md`, `docs/**`, `tests/security/**` | all `src/` |

`orchestrator.ts` is assigned to exactly one agent per wave. That constraint is
load-bearing — it is the file that makes parallel work expensive today, and it is
why REF-01 exists.

### Parallelization inside the product, not just the build

Separately from how *we* build this: the SDK's `AgentDefinition` now supports
`async` / `background` subagents with per-agent `model`, `effort`, `tools`, and
`memory`. Zora currently hand-rolls delegation via `delegate_to_subagent` (which
recursively calls `submitTask`) and `spawn_zora_agent` (which shells out to child
instances). Both predate the native primitive.

Post-Wave-2, `delegate_to_subagent` should become a thin wrapper over SDK
subagents: fan-out gets real concurrency, per-subagent tool restriction becomes
declarative (a research subagent gets `Read`/`Grep`/`WebSearch` and nothing
else), and `getSubagentMessages` / `listSubagents` give the dashboard a live view
of delegated work. Filed as a follow-on, not in this plan's scope.

---

## 5. Definition of done

Wave 1 is done when:

- `npm run lint` (tsc --noEmit) and `npm run test:unit` pass.
- `tests/security/tool-enforcement.test.ts` proves a denied command does not
  execute through a real `query()` call.
- A test asserts every `TaskContext.customTools` entry appears in the SDK options
  as an `mcpServers['zora-tools']` tool.
- `grep -rn "bypassPermissions" src/` returns nothing.
- `package-lock.json` pins 0.3.232.
- Benchmarks in `tests/benchmarks/` show the `tool_result` lookup and
  `listSessions` improvements, so the efficiency claims are measured rather than
  asserted.

Graph memory (MEM-30) is done when `graph_recall` answers a two-hop question
that `memory_search` provably cannot, with the worker thread keeping event-loop
block time under 5 ms per call.
