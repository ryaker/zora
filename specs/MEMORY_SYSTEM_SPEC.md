# Zora Memory System — Technical Specification

> **Version:** 0.1.0-draft
> **Date:** 2026-02-14
> **Status:** DRAFT — Pending implementation
> **Author:** Rich Yaker + Claude Opus 4.6
> **References:** Zora Spec §5.4, MemU (NevaMind-AI), OpenClaw memory, claude-mem, FACT (ruvnet), Stanford Generative Agents (Park et al. 2023)

---

## 1. Design Philosophy

**Zora ships with memory that works. No Postgres. No OpenAI embeddings. No ChromaDB. No API keys. Install, run, and it remembers.**

Three principles:

1. **Zero-config by default** — Built-in memory works offline, local-first, no external services. Pure TypeScript, no native dependencies beyond what Zora already has.
2. **MCP-enhanced when available** — If the user has a memory MCP (Mem0, claude-mem, KMS, or any MCP with memory-like tools), Zora auto-detects it and elevates it to first-class memory. The built-in system becomes a fast local cache.
3. **Agent-driven, not automatic** — The agent decides what to remember via tool calls. No noisy auto-extraction that fills memory with junk. Validation gates prevent low-quality memories.

### Competitive Position

| Framework | Memory | Setup Required | Offline | Search |
|-----------|--------|---------------|---------|--------|
| OpenClaw | Markdown file | Copy-paste README | Yes | None (file loading) |
| MemU | 3-layer hierarchy | Python + Postgres + pgvector + OpenAI | No | Vector + LLM |
| claude-mem | Hooks + Chroma + SQLite | Bun + uv + Chroma | No | Hybrid vector + FTS |
| CrewAI | ChromaDB + SQLite | ChromaDB + embedding API | No | Vector (broken on macOS) |
| Letta | Postgres + vector DB | Server + DB + embedding API | No | Vector |
| **Zora** | **MiniSearch + salience + Markdown** | **None** | **Yes** | **BM25+ with salience scoring** |

---

## 2. Architecture Overview

```
┌─────────────────────────────────────────────────┐
│                  MemoryManager                   │
│            (unified interface)                   │
├─────────────────────────────────────────────────┤
│                                                  │
│  ┌──────────────┐    ┌─────────────────────┐    │
│  │  Built-in     │    │  MCP Memory Bridge   │    │
│  │  (always on)  │    │  (auto-detected)     │    │
│  │              │    │                      │    │
│  │  MiniSearch  │◄──►│  Mem0 / claude-mem   │    │
│  │  + Salience  │    │  / KMS / custom MCP  │    │
│  │  + Markdown  │    │                      │    │
│  └──────────────┘    └─────────────────────┘    │
│                                                  │
├─────────────────────────────────────────────────┤
│              Agent Tool Interface                │
│  memory_save  |  memory_search  |  memory_forget │
└─────────────────────────────────────────────────┘
```

### Two Modes

**Standalone mode** (no memory MCP detected):
- Built-in is the sole memory layer
- MiniSearch BM25+ for retrieval
- Salience scoring for ranking
- Markdown files as source of truth

**Enhanced mode** (memory MCP detected):
- MCP becomes the **primary** memory layer (richer search, graph relations, semantic understanding)
- Built-in becomes a **fast local cache** (sub-1ms reads for hot memories)
- Writes go to both (MCP for persistence, built-in for speed)
- Reads try built-in first, fall back to MCP for cache misses
- Zora auto-detects memory MCPs by scanning for tools matching known patterns

---

## 3. Storage Layout

```
~/.zora/memory/
├── MEMORY.md                  # Tier 1: Human-curated facts (read-only to agent)
├── daily/
│   ├── 2026-02-14.md          # Tier 2: Daily session notes
│   ├── 2026-02-13.md
│   └── ...
├── items/
│   ├── mem_abc123.json        # Tier 3: Structured memory items
│   ├── mem_def456.json
│   └── ...
├── categories/
│   ├── coding__my-web-app.json    # Category summary
│   ├── brand__mymoneycoach.json
│   └── ...
└── index/
    ├── minisearch.json        # Serialized MiniSearch index
    └── salience.json          # Pre-computed salience scores
```

### Tier 1: Long-Term Knowledge (`MEMORY.md`)

Human-curated markdown. Loaded into every session's system prompt (first 500 lines). Agent CANNOT modify this file — only humans via `zora memory edit`.

Contents: user preferences, project conventions, brand context, important facts.

```markdown
# Zora Memory

## Preferences
- Prefer TypeScript with strict mode
- Commit messages: conventional commits format
- Always run tests before committing

## Projects
- MyMoneyCoach.ai: StoryBrand framework, PEACE soundbites, Sophia character
- Zora: Agent framework, security-first, local-first

## Tools
- Primary editor: VS Code
- Package manager: pnpm preferred over npm
```

### Tier 2: Daily Notes (`daily/YYYY-MM-DD.md`)

Agent-written session logs. Append-only during sessions. Last 3 days loaded at session start.

```markdown
# 2026-02-14

## Session 1 (14:00-16:30)
- Fixed SSE JSON parsing bug in dashboard server
- Merged PRs #105-#108 (telegram, dashboard, docs, logging)
- Discussed memory system architecture

## Learned
- BM25+ with salience scoring is sufficient for structured fact retrieval
- MiniSearch is the best pure-TS BM25 library (5.6kB, native TS)
```

### Tier 3: Structured Memory Items (`items/`)

Individual JSON files with salience metadata:

```json
{
  "id": "mem_a1b2c3",
  "type": "knowledge",
  "content": "Zora uses pino for structured logging. All console.log calls have been replaced.",
  "source": "session_20260214_1",
  "source_type": "agent_analysis",
  "created_at": "2026-02-14T22:15:00Z",
  "last_accessed": "2026-02-14T22:15:00Z",
  "access_count": 1,
  "tags": ["zora", "logging", "pino"],
  "category": "coding/zora",
  "trust_score": 0.7
}
```

**Memory types** (from MemU's taxonomy, adapted):

| Type | Description | Example |
|------|-------------|---------|
| `profile` | Facts about the user | "Rich prefers Next.js with App Router" |
| `event` | Things that happened | "PR #108 merged structured logging" |
| `knowledge` | Facts about projects/world | "Zora uses pino for logging" |
| `behavior` | How the user likes things done | "Always run tests before committing" |
| `skill` | Procedures that work | "Use git worktrees for parallel agent work" |
| `tool` | Tool-specific notes | "MiniSearch needs b=0.4 for short docs" |

**Source trust levels:**

| Source Type | Trust Score | Description |
|-------------|-------------|-------------|
| `user_instruction` | 1.0 | User explicitly told the agent |
| `agent_analysis` | 0.7 | Agent inferred from its own work |
| `tool_output` | 0.3 | Extracted from web fetch, file contents |

---

## 4. Retrieval Engine

### 4.1 MiniSearch Configuration

```typescript
import MiniSearch from 'minisearch';

const searchIndex = new MiniSearch<MemoryItem>({
  fields: ['content', 'tags', 'category'],
  storeFields: ['id', 'content', 'type', 'source_type', 'created_at',
                 'last_accessed', 'access_count', 'tags', 'category', 'trust_score'],
  searchOptions: {
    boost: { tags: 2.0, category: 1.5, content: 1.0 },
    fuzzy: 0.2,       // Tolerate typos
    prefix: true,      // "log" matches "logging"
    combineWith: 'OR', // Union strategy
  },
  tokenize: (text) => text.toLowerCase().split(/[\s\-_./]+/),
});
```

**Why MiniSearch:**
- Pure TypeScript, 5.6kB gzipped
- BM25+ algorithm (improved over classic BM25)
- Dynamic add/remove/replace documents
- Serializable to JSON (`miniSearch.toJSON()` / `MiniSearch.loadJSON()`)
- Prefix search, fuzzy matching, field boosting
- Uses less memory than Lunr for same collection

### 4.2 Salience Scoring

Based on Stanford Generative Agents (Park et al. 2023):

```typescript
function computeSalience(item: MemoryItem, bm25Score: number): number {
  const recency = recencyDecay(item.last_accessed, HALF_LIFE_DAYS);
  const frequency = frequencyBoost(item.access_count);
  const trust = item.trust_score;

  // Multiplicative composition: relevant + recent + trusted = highest
  return bm25Score * recency * frequency * trust;
}

function recencyDecay(lastAccessed: Date, halfLifeDays: number = 14): number {
  const lambda = Math.LN2 / halfLifeDays;
  const daysOld = (Date.now() - lastAccessed.getTime()) / 86_400_000;
  return Math.exp(-lambda * daysOld);
}

function frequencyBoost(accessCount: number): number {
  // Logarithmic: diminishing returns after ~10 accesses
  return 1.0 + Math.log2(1 + accessCount) * 0.15;
}
```

| Age | Recency Score (14-day half-life) |
|-----|--------------------------------|
| Today | 1.000 |
| 3 days | 0.862 |
| 7 days | 0.707 |
| 14 days | 0.500 |
| 30 days | 0.228 |
| 60 days | 0.052 |

### 4.3 Search Flow

```
Query "what logging framework does zora use?"
  │
  ├─ 1. MiniSearch BM25+ search → ranked results
  │     "Zora uses pino for structured logging" (score: 4.2)
  │     "All console.log calls replaced with pino" (score: 3.1)
  │     "Structured logging with JSON output" (score: 2.8)
  │
  ├─ 2. Apply salience scoring → re-ranked
  │     Item 1: 4.2 × 1.0 (today) × 1.15 (2 accesses) × 0.7 (agent) = 3.38
  │     Item 2: 3.1 × 0.86 (3d old) × 1.0 (1 access) × 0.7 (agent) = 1.87
  │     Item 3: 2.8 × 0.50 (14d old) × 1.0 (1 access) × 1.0 (user) = 1.40
  │
  ├─ 3. Update access counts on returned items
  │
  └─ 4. Return top-K results with scores
```

---

## 5. Agent Tools

Three tools exposed to the agent:

### `memory_save`

```typescript
interface MemorySaveArgs {
  content: string;      // The fact to remember (required)
  type?: MemoryType;    // profile | event | knowledge | behavior | skill | tool
  tags?: string[];      // Categorization tags
  entity?: string;      // Related entity (person, project, tool)
  source_type?: SourceType; // user_instruction | agent_analysis | tool_output
}
```

**Validation gates** (inspired by Martian Engineering's agent-memory):
- Reject content under 15 characters ("too vague")
- Reject transient states ("user is tired", "waiting for response")
- Deduplicate: Jaccard similarity > 0.7 against existing items → reject or update
- Contradiction detection: same entity + same predicate + different value → flag for resolution
- Rate limit: max 10 saves per session (prevent memory flooding)

### `memory_search`

```typescript
interface MemorySearchArgs {
  query: string;        // Natural language query (required)
  limit?: number;       // Max results (default: 5)
  type?: MemoryType;    // Filter by memory type
  entity?: string;      // Filter by entity
  min_score?: number;   // Minimum salience score threshold
}
```

**Progressive disclosure** (inspired by claude-mem):
- Returns compact summaries first (~50-100 tokens per result)
- Agent can request full details for specific IDs if needed
- Reduces token consumption by ~10x vs. loading full items

### `memory_forget`

```typescript
interface MemoryForgetArgs {
  id: string;           // Memory item ID to remove
  reason?: string;      // Why (logged for audit)
}
```

Soft delete — moves to `~/.zora/memory/archive/` instead of hard delete.

---

## 6. MCP Memory Bridge

### 6.1 Auto-Detection

On boot, Zora scans available MCP tools for memory-like capabilities:

```typescript
const MEMORY_MCP_PATTERNS = [
  // Mem0
  { search: 'mem0_search_memory', save: 'mem0_add_memory', provider: 'mem0' },
  // claude-mem
  { search: /claude.mem.*search/, save: /claude.mem.*save/, provider: 'claude-mem' },
  // KMS
  { search: 'unified_search', save: 'unified_store', provider: 'kms' },
  // Generic pattern: any MCP with "memory" + "search" tools
  { search: /memory.*search/, save: /memory.*save|store/, provider: 'generic' },
];
```

### 6.2 Enhanced Mode Behavior

When a memory MCP is detected:

```
WRITE PATH:
  Agent calls memory_save(content)
    → Write to built-in (MiniSearch + JSON file)        [sync, <1ms]
    → Write to MCP memory (Mem0/KMS/etc)                [async, fire-and-forget]

READ PATH:
  Agent calls memory_search(query)
    → Search built-in first                              [sync, <5ms]
    → If results.length < limit:
        → Search MCP memory for additional results       [async, 50-500ms]
        → Merge and re-rank by salience
        → Cache MCP results in built-in for next time

SYNC PATH (background):
  On session start:
    → Pull recent MCP memories not in built-in cache
    → Index into MiniSearch
  On session end:
    → Push any built-in items not yet in MCP
```

### 6.3 MCP Provider Adapters

Each detected MCP gets a thin adapter:

```typescript
interface MemoryMCPAdapter {
  readonly provider: string;
  search(query: string, limit: number): Promise<MemoryItem[]>;
  save(item: MemoryItem): Promise<void>;
  getGraphRelations?(entity: string): Promise<Relation[]>; // Mem0-specific
  getTimeline?(start: Date, end: Date): Promise<MemoryItem[]>; // claude-mem-specific
}
```

### 6.4 What This Enables

| Capability | Built-in Only | + Mem0 MCP | + KMS MCP |
|------------|---------------|------------|-----------|
| Keyword search | Yes | Yes | Yes |
| Semantic search | No | Yes (Mem0 vectors) | Yes (MongoDB) |
| Graph relations | No | Yes (Neo4j) | No |
| Cross-agent memory | No | Yes (shared user_id) | Yes (shared store) |
| Sub-100ms cached search | Yes | Yes (local cache) | Yes (local cache) |
| Offline | Yes | Degraded (cache only) | Degraded (cache only) |

---

## 7. Context Injection

### 7.1 System Prompt Assembly

```
1. Agent identity (SOUL.md or system prompt)
2. Date/time, OS, working directory
3. MEMORY.md — first 500 lines (always loaded)
4. Daily notes — last 3 days, summarized
5. Category summaries — for topics related to current task
6. Top-5 memory items by salience — specific facts for current context
7. Active job context (plan, progress)
8. Conversation history
9. Tool definitions (including memory_save, memory_search, memory_forget)
```

### 7.2 Automatic Context Loading

Before each LLM call in the execution loop:

```typescript
// ContextInjectionMiddleware (closes ORCH-07)
async function injectMemoryContext(task: TaskContext): Promise<TaskContext> {
  const memoryManager = getMemoryManager();

  // Always load MEMORY.md
  const longTermMemory = await memoryManager.loadLongTermMemory();

  // Load recent daily notes
  const dailyNotes = await memoryManager.loadRecentDailyNotes(3);

  // Search for task-relevant memories
  const relevantItems = await memoryManager.search(task.task, { limit: 5 });

  // Assemble context
  task.memoryContext = [
    longTermMemory,
    ...dailyNotes,
    ...relevantItems.map(item => `[${item.type}] ${item.content}`),
  ];

  return task;
}
```

---

## 8. Proactive Memory Extraction

### 8.1 When to Extract

- **On job completion**: Agent gets a prompt to reflect on what was learned
- **On session end**: Final extraction pass before shutdown
- **On user instruction**: "Remember that I prefer..." triggers immediate save

### 8.2 Extraction Prompt

```
Review the conversation above. Extract any facts worth remembering for future sessions.

Rules:
- Only save facts that would be useful in a DIFFERENT session (not just this one)
- Each fact should be a single, specific statement (not a summary of the conversation)
- Include the type: profile, event, knowledge, behavior, skill, or tool
- Do NOT save transient states or opinions
- Do NOT save things already in MEMORY.md

Use the memory_save tool for each fact worth keeping.
```

### 8.3 Validation Pipeline

```
Agent calls memory_save(content, type, tags)
  │
  ├─ Length check: content.length >= 15? ──No──→ Reject ("too vague")
  │
  ├─ Transient check: matches transient patterns? ──Yes──→ Reject
  │   (patterns: "is busy", "is waiting", "just now", "currently")
  │
  ├─ Dedup check: Jaccard similarity > 0.7 with existing? ──Yes──→ Update existing
  │
  ├─ Contradiction check: same entity + predicate? ──Yes──→ Flag, keep newer
  │
  ├─ Rate limit: > 10 saves this session? ──Yes──→ Reject ("slow down")
  │
  └─ Accept → Write to items/ + index in MiniSearch + push to MCP (if available)
```

---

## 9. CLI Commands

```bash
zora memory                  # Show memory stats (item count, categories, size)
zora memory edit             # Open MEMORY.md in $EDITOR
zora memory search "query"   # Search from CLI
zora memory list             # List recent items
zora memory forget <id>      # Soft-delete an item
zora memory export           # Export all items as JSON
zora memory import <file>    # Import from JSON export
zora memory sync             # Force sync with MCP memory (if available)
zora memory stats            # Detailed stats: by type, by category, by age
```

---

## 10. Dependencies

| Package | Size | Purpose | Required |
|---------|------|---------|----------|
| `minisearch` | 5.6kB gzipped | BM25+ full-text search | Yes |
| — | — | — | — |

**That's it.** One dependency. Pure TypeScript. No native modules. No embedding APIs. No database servers.

Optional (auto-detected, not installed by Zora):
- Any memory MCP server the user has configured

---

## 11. Implementation Plan

### Phase 1: Core Memory Manager (closes ORCH-07)
- [ ] `MemoryManager` class with `search()`, `save()`, `forget()`, `loadLongTermMemory()`, `loadRecentDailyNotes()`
- [ ] MiniSearch integration with salience scoring
- [ ] File-based storage (items/, daily/, categories/, index/)
- [ ] Agent tools: `memory_save`, `memory_search`, `memory_forget`
- [ ] Validation pipeline (length, transient, dedup, contradiction, rate limit)
- [ ] Context injection middleware in execution loop
- [ ] MEMORY.md loading in system prompt assembly
- [ ] CLI commands: `zora memory` subcommands

### Phase 2: MCP Memory Bridge
- [ ] Auto-detection of memory MCPs on boot
- [ ] Adapter interface + Mem0 adapter
- [ ] Write-through caching (built-in + MCP)
- [ ] Read-through with cache miss fallback to MCP
- [ ] Session start sync (pull MCP → built-in cache)
- [ ] Generic MCP adapter (pattern-match any memory-like tools)

### Phase 3: Extraction & Daily Notes
- [ ] Proactive extraction on job completion
- [ ] Session end extraction pass
- [ ] Daily notes auto-creation and append
- [ ] Category auto-organization with summaries
- [ ] `memory_search` progressive disclosure (compact → full)

---

## 12. Design Decisions

### Decision 1: BM25+ over vector search as default
**Chosen:** MiniSearch BM25+ with salience scoring.
**Rationale:** Memory items are short structured facts (1-2 sentences). BM25+ handles this well — document length normalization prevents short-doc penalty. Salience scoring (recency + frequency + trust) adds the "intelligence" that raw keyword matching lacks. Vector search requires an embedding model — that's a setup barrier. BM25+ works at zero cost, zero latency, zero config. For collections under ~50K items (years of individual agent use), BM25+ with salience is sufficient.
**Revisit when:** Users report retrieval quality issues at scale, or when a pure-TS embedding model becomes viable (<5MB, <100ms).

### Decision 2: MCP bridge as enhancement, not requirement
**Chosen:** Built-in works standalone. MCP memory detected → auto-elevated to primary.
**Rationale:** We can't guarantee what MCPs users have. But if they DO have Mem0, KMS, claude-mem, or similar, we should use them — they offer semantic search, graph relations, cross-agent memory that built-in can't match. The cache pattern ensures speed (sub-1ms for hot memories) while MCP provides depth.

### Decision 3: Agent-driven extraction over automatic capture
**Chosen:** Agent calls `memory_save` explicitly. Extraction prompts on job completion.
**Rationale:** Automatic capture (like claude-mem's PostToolUse hooks) generates too much noise. The agent knows what's important. Validation gates prevent junk. This matches Letta's approach (agent self-edits memory via tool calls) which is proven with capable models.

### Decision 4: Markdown as source of truth
**Chosen:** Human-readable Markdown files, with JSON index for search.
**Rationale:** Markdown is git-friendly, debuggable, portable. Users can read their agent's memory in any text editor. The MiniSearch index is derived from the files and can be rebuilt at any time. If the index corrupts, the files are still there.

### Decision 5: 14-day recency half-life
**Chosen:** Exponential decay with 14-day half-life.
**Rationale:** Agents work on projects in bursts. A 14-day half-life means: items from this week are highly salient, items from last month are still findable but deprioritized, items from 2+ months ago require explicit search. The 7-day half-life in the original spec was too aggressive — it would penalize weekly routines (e.g., Tuesday blog posts).

---

## 13. Success Criteria

1. `zora memory search "logging"` returns relevant results in <10ms on a collection of 1000 items
2. Agent spontaneously uses `memory_save` during work sessions without being prompted
3. Agent recalls facts from 2+ sessions ago without being reminded
4. Memory works identically whether Mem0 MCP is present or not (just better search quality with it)
5. Zero setup required — `zora-agent init` creates the memory directory structure
6. A user can read `~/.zora/memory/` in a text editor and understand what the agent knows
