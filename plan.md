# Observational Memory for Zora — Implementation Plan

## Design Summary

Add a **rolling context compression system** to Zora that maintains three tiers of conversation history with **background compression** so the agent never blocks or loses context.

```
┌─────────────────────────────────────────────────────────┐
│ System Prompt (stable, cacheable)                       │
│  ├── SOUL.md identity                                   │
│  ├── Cross-session tier (key facts from prior sessions) │
│  └── Session tier (compressed older messages)           │
├─────────────────────────────────────────────────────────┤
│ Working tier (last N raw messages — full fidelity)      │
└─────────────────────────────────────────────────────────┘
```

| Tier | Contents | Token Budget | Grain | Compression |
|------|----------|-------------|-------|-------------|
| **Working** | Most recent messages, raw | ~30k tokens | Full fidelity | None |
| **Session** | Older messages from this session | ~10k tokens | Paragraph summaries | Observer (background) |
| **Cross-session** | Prior sessions + long-term memory | ~5k tokens | Key facts & decisions | Reflector (background) |

### Key Principle: Background-Only Compression

Compression **never** blocks the active conversation. The agent never pauses. Compression happens asynchronously:

1. A `ContextCompressor` watches accumulated token count
2. When working tier exceeds threshold, it queues the oldest chunk for compression
3. A background worker (cheap/fast model like Gemini Flash) compresses that chunk
4. The compressed block replaces the raw messages before the next API call
5. The agent picks up updated tiers transparently

### Append-Only for Cache Hits

Session-tier observations are **append-only** (new observations added at the end, never rewritten). This keeps the prompt prefix stable across turns, maximizing Anthropic's prompt cache hit rate.

---

## Architecture

### New Components

```
src/memory/
  context-compressor.ts     # Core: tier management, threshold monitoring, async queue
  observer-worker.ts        # Background: compress raw messages → session observations
  reflector-worker.ts       # Background: condense session tier → cross-session items
  token-estimator.ts        # Utility: fast token count estimation (char-based, no tiktoken)
  observation-store.ts      # Persistence: read/write observation blocks per session
```

### Integration Points

```
src/orchestrator/orchestrator.ts   # Wire ContextCompressor into submitTask pipeline
src/types.ts                       # Extend MemoryConfig with compression fields
src/config/defaults.ts             # Add default thresholds
src/memory/memory-manager.ts       # Add cross-session rollup method
```

### Data Flow

```
ExecutionLoop.run()
  │
  ├── onMessage callback fires for each AgentEvent
  │     └── ContextCompressor.ingest(event)
  │           ├── Appends to working tier (raw)
  │           ├── Estimates token count
  │           └── If threshold exceeded:
  │                 └── Queues oldest chunk for ObserverWorker (async)
  │
  ├── Before next API call:
  │     └── ContextCompressor.buildContext() → { systemPrompt, messages }
  │           ├── Cross-session tier (from MemoryManager)
  │           ├── Session tier (compressed observations, append-only)
  │           └── Working tier (recent raw messages)
  │
  └── On session end:
        └── ReflectorWorker.reflect(sessionObservations)
              └── Extracts key facts → MemoryManager.structuredMemory.createItem()
```

---

## WSJF-Scored Work Items

Scoring uses the same 4-factor model as Zora's gap tracker:
- **UV** = Usability Value (1-10)
- **WI** = Wiring Impact (1-10)
- **SR** = Security Risk (1-10)
- **TC** = Time Criticality (blocks other items) (1-10)
- **JS** = Job Size (1-10, higher = bigger)
- **WSJF** = (UV + WI + TC + SR) / JS

| ID | Item | UV | WI | SR | TC | JS | WSJF | Deps |
|----|------|----|----|----|----|----|----|------|
| OM-01 | Token estimator utility | 2 | 3 | 1 | 10 | 2 | **8.0** | — |
| OM-02 | Observation store (persistence) | 3 | 5 | 2 | 9 | 3 | **6.3** | — |
| OM-03 | ContextCompressor core (tier mgmt + thresholds) | 8 | 8 | 1 | 8 | 5 | **5.0** | OM-01, OM-02 |
| OM-04 | ObserverWorker (background compression) | 9 | 7 | 1 | 7 | 5 | **4.8** | OM-01, OM-02 |
| OM-05 | ReflectorWorker (session → cross-session rollup) | 6 | 6 | 1 | 3 | 4 | **4.0** | OM-04 |
| OM-06 | Type extensions (MemoryConfig, defaults) | 3 | 4 | 1 | 9 | 2 | **8.5** | — |
| OM-07 | Orchestrator integration (wire into submitTask) | 9 | 9 | 1 | 5 | 4 | **6.0** | OM-03, OM-04, OM-06 |
| OM-08 | Daily note consolidation enhancement | 4 | 3 | 1 | 1 | 3 | **3.0** | OM-05 |
| OM-09 | Unit tests for all new components | 5 | 2 | 1 | 2 | 4 | **2.5** | OM-03, OM-04 |
| OM-10 | Integration test (end-to-end compression flow) | 5 | 3 | 1 | 1 | 4 | **2.5** | OM-07 |

### Execution Order (by WSJF, respecting deps)

```
Phase 1 (parallel, no deps):     OM-06, OM-01, OM-02
Phase 2 (parallel, after Ph1):   OM-03, OM-04
Phase 3 (after Ph2):             OM-07
Phase 4 (parallel, after Ph2-3): OM-05, OM-09
Phase 5 (after all):             OM-08, OM-10
```

---

## Agent Team Topology

Using Team Topologies (Skelton & Pais) to organize agent responsibilities:

### Stream-Aligned Team: "Compressor Core"
> Owns the end-to-end value stream — from raw messages to compressed tiers.

| Agent | Owns | Model | Rationale |
|-------|------|-------|-----------|
| **compressor-agent** | OM-03, OM-07 | Sonnet | Core integration work — wiring tiers into orchestrator. Same complexity class as ORCH-07. |

**Interaction mode:** Collaborates closely with Platform team (consumes token estimator + observation store).

### Complicated Subsystem Team: "Observer/Reflector"
> Owns the LLM-driven compression subsystem — prompt engineering, compression quality, async execution.

| Agent | Owns | Model | Rationale |
|-------|------|-------|-----------|
| **observer-agent** | OM-04, OM-05 | Sonnet | Prompt design for compression quality. Observer and Reflector share patterns — one agent handles both. |

**Interaction mode:** Provides compression capability to stream-aligned team. The subsystem boundary is clean: `compress(messages) → observations` and `reflect(observations) → memoryItems`.

### Platform Team: "Memory Platform"
> Owns shared infrastructure — token estimation, persistence, type definitions.

| Agent | Owns | Model | Rationale |
|-------|------|-------|-----------|
| **platform-agent** | OM-01, OM-02, OM-06 | Haiku | Mechanical work: utility functions, file I/O, type extensions. Well-defined, repetitive patterns. |

**Interaction mode:** Provides self-service capabilities consumed by all other teams. Ships first (Phase 1) to unblock everyone.

### Enabling Team: "Quality Gate"
> Helps stream-aligned team succeed — tests, integration verification.

| Agent | Owns | Model | Rationale |
|-------|------|-------|-----------|
| **quality-agent** | OM-08, OM-09, OM-10 | Haiku | Test writing and consolidation enhancement. Pattern-based, follows existing test conventions. |

**Interaction mode:** Works alongside other teams once their components exist. Runs last (Phase 4-5).

### Team Topology Diagram

```
                    ┌──────────────────────┐
                    │   Platform Team      │
                    │   (Haiku)            │
                    │                      │
                    │  OM-01 token-est     │
                    │  OM-02 obs-store     │
                    │  OM-06 types/config  │
                    └──────────┬───────────┘
                               │ provides
                    ┌──────────┴───────────┐
          ┌─────────┤  Stream-Aligned Team │──────────┐
          │         │  (Sonnet)            │          │
          │         │                      │          │
          │         │  OM-03 compressor    │          │
          │         │  OM-07 orchestrator  │          │
          │         └──────────────────────┘          │
          │ consumes                         consumes │
  ┌───────┴──────────────┐          ┌─────────────────┴──┐
  │ Complicated Subsystem│          │   Enabling Team     │
  │ (Sonnet)             │          │   (Haiku)           │
  │                      │          │                     │
  │ OM-04 observer       │          │  OM-08 daily-notes  │
  │ OM-05 reflector      │          │  OM-09 unit tests   │
  │                      │          │  OM-10 integ tests  │
  └──────────────────────┘          └─────────────────────┘
```

---

## Detailed Implementation Specs

### OM-01: Token Estimator (`src/memory/token-estimator.ts`)

Fast, dependency-free token estimation. No tiktoken, no WASM — just char-based heuristics.

```typescript
export function estimateTokens(text: string): number;
export function estimateTokensForMessages(messages: AgentEvent[]): number;
export function estimateTokensForEvent(event: AgentEvent): number;
```

**Algorithm:** `tokens ≈ chars / 3.5` for English text (conservative estimate). Tool results use `chars / 3.0` (more structured content). This is intentionally approximate — we'd rather compress slightly early than slightly late.

**Why not tiktoken:** Zero dependencies, sub-millisecond execution, runs on every message. Precision doesn't matter — thresholds are soft.

---

### OM-02: Observation Store (`src/memory/observation-store.ts`)

Persists compressed observation blocks per session so context survives restarts.

```typescript
export interface ObservationBlock {
  id: string;                    // obs_{timestamp}_{random}
  sessionId: string;
  createdAt: string;             // ISO 8601
  tier: 'session' | 'cross-session';
  observations: string;          // The compressed text
  sourceMessageRange: [number, number]; // Which message indices were compressed
  estimatedTokens: number;
}

export class ObservationStore {
  constructor(baseDir: string);   // ~/.zora/memory/observations/

  async append(block: ObservationBlock): Promise<void>;
  async loadSession(sessionId: string): Promise<ObservationBlock[]>;
  async loadCrossSession(limit?: number): Promise<ObservationBlock[]>;
  async prune(sessionId: string, keepLast?: number): Promise<number>;
}
```

**Storage:** `~/.zora/memory/observations/{sessionId}.jsonl` — append-only JSONL (same pattern as SessionManager). Cross-session observations in `cross-session.jsonl`.

---

### OM-03: ContextCompressor (`src/memory/context-compressor.ts`)

The core coordinator. Manages the three tiers, monitors thresholds, triggers background compression.

```typescript
export interface CompressionConfig {
  workingTierMaxTokens: number;      // Default 30_000
  sessionTierMaxTokens: number;      // Default 10_000
  crossSessionTierMaxTokens: number; // Default 5_000
  compressionChunkSize: number;      // Messages per compression batch (default 20)
  compressionModel?: string;         // Provider to use for compression (default: cheapest available)
}

export class ContextCompressor {
  constructor(
    config: CompressionConfig,
    observationStore: ObservationStore,
    compressFn: (messages: string[], instructions: string) => Promise<string>,
  );

  /** Ingest a new event from the execution stream. */
  ingest(event: AgentEvent): void;

  /** Build the current context for the next API call. Non-blocking. */
  buildContext(): {
    sessionObservations: string;    // Compressed session tier
    crossSessionContext: string;    // Compressed cross-session tier
    workingMessages: AgentEvent[];  // Recent raw messages
    stats: {
      workingTokens: number;
      sessionTokens: number;
      crossSessionTokens: number;
      compressionsPending: number;
    };
  };

  /** Check if background compression is needed and trigger it. */
  async tick(): Promise<void>;

  /** Flush: wait for all pending compressions to complete. Call on session end. */
  async flush(): Promise<void>;
}
```

**Threshold behavior:**
1. `ingest()` appends event to working tier and updates token estimate
2. `tick()` is called periodically (or before each API call)
3. If working tier exceeds `workingTierMaxTokens`, the oldest `compressionChunkSize` messages are dequeued and sent to the ObserverWorker
4. The worker runs in the background (Promise, not awaited)
5. When the worker completes, the compressed block is appended to session tier
6. `buildContext()` always returns the latest available state (never blocks on pending compressions)
7. If session tier exceeds its threshold, a Reflector pass is queued (lower priority)

**Pre-computation (async buffering, inspired by Mastra):**
As messages accumulate toward the threshold, start pre-computing observations in the background. When the threshold actually hits, the observation is already ready — zero latency. If messages arrive faster than the observer can process, a `blockAfter` safety threshold forces a synchronous compression as a last resort (configurable, default: 2x working tier max).

---

### OM-04: ObserverWorker (`src/memory/observer-worker.ts`)

Background agent that compresses raw messages into dated observations.

```typescript
export class ObserverWorker {
  constructor(
    compressFn: (prompt: string) => Promise<string>,
  );

  async compress(
    messages: AgentEvent[],
    existingObservations: string,
    sessionId: string,
  ): Promise<ObservationBlock>;
}
```

**Observer prompt (key design):**

```
You are a conversation observer. Compress the following messages into concise,
dated observations. Preserve:
- Decisions made and their reasoning
- Key facts learned or stated
- Tool results that inform future actions
- Errors encountered and how they were resolved
- User preferences expressed

Format each observation as:
[YYYY-MM-DD HH:MM] <priority> <observation>

Priority levels:
  CRITICAL — Decisions, errors, blockers that affect future actions
  IMPORTANT — Key facts, preferences, tool outcomes
  NOTE — Background context, minor details

Rules:
- Be concise. Target 3-6x compression ratio.
- Preserve exact names, paths, IDs, and values (never paraphrase these).
- Group related observations by topic.
- If a tool result is very large, summarize the outcome, not the raw output.
- Reference previous observations to avoid repetition.

Existing observations (for context, do NOT repeat):
{existingObservations}

Messages to compress:
{messages}
```

**Priority tags:** We use text tags (CRITICAL/IMPORTANT/NOTE) instead of Mastra's emojis because they're more grep-friendly, easier to filter programmatically, and won't confuse models that handle emoji inconsistently.

**Three-date model (adapted from Mastra):** Each observation records:
- Observation timestamp (when it was compressed)
- Referenced timestamp (when the original event occurred)
- Relative time (for the model's benefit: "2 minutes ago", "earlier today")

---

### OM-05: ReflectorWorker (`src/memory/reflector-worker.ts`)

Condenses session-tier observations into cross-session memory items.

```typescript
export class ReflectorWorker {
  constructor(
    compressFn: (prompt: string) => Promise<string>,
    memoryManager: MemoryManager,
  );

  /** Reflect on session observations and extract persistent memory items. */
  async reflect(
    sessionObservations: string,
    sessionId: string,
  ): Promise<{ itemsCreated: number; observationsCondensed: string }>;
}
```

**When it runs:**
1. When session tier exceeds `sessionTierMaxTokens` (mid-session garbage collection)
2. On session end (final rollup)
3. During daily note consolidation (OM-08 enhancement)

**Reflector prompt:**

```
You are a memory reflector. Review these session observations and:

1. Extract persistent facts worth remembering across sessions.
   Output as JSON array: [{ "summary": "...", "type": "knowledge|behavior|event|skill", "tags": [...] }]

2. Condense the remaining observations: merge related entries,
   drop anything no longer relevant, keep critical items verbatim.
   Output the condensed observations in the same dated format.

Observations:
{observations}
```

The extracted facts feed directly into `MemoryManager.structuredMemory.createItem()` — bridging session observations into Zora's existing Tier 3 memory system.

---

### OM-06: Type & Config Extensions

**`src/types.ts`** — Extend `MemoryConfig`:

```typescript
export interface MemoryConfig {
  // ... existing fields ...

  /** Context compression configuration */
  compression: {
    enabled: boolean;                    // Default true
    working_tier_max_tokens: number;     // Default 30_000
    session_tier_max_tokens: number;     // Default 10_000
    cross_session_tier_max_tokens: number; // Default 5_000
    chunk_size: number;                  // Messages per compression batch (default 20)
    model?: string;                      // Provider for compression (default: cheapest)
    async_buffer: boolean;               // Pre-compute observations (default true)
    block_after_tokens?: number;         // Force sync compression threshold (default 2x working)
  };
}
```

**`src/config/defaults.ts`** — Add defaults:

```typescript
export const DEFAULT_MEMORY: MemoryConfig = {
  // ... existing ...
  compression: {
    enabled: true,
    working_tier_max_tokens: 30_000,
    session_tier_max_tokens: 10_000,
    cross_session_tier_max_tokens: 5_000,
    chunk_size: 20,
    async_buffer: true,
  },
};
```

---

### OM-07: Orchestrator Integration

Wire `ContextCompressor` into the existing `submitTask` pipeline.

**Changes to `src/orchestrator/orchestrator.ts`:**

1. Instantiate `ContextCompressor` during `boot()` (after MemoryManager)
2. In `submitTask()`:
   - Load cross-session context from ContextCompressor (replaces raw `loadContext()` for session-aware tasks)
   - Pass session-tier observations in `systemPrompt` (append-only block)
   - Pass working-tier messages as `history`
3. In `_executeWithProvider()`:
   - Feed each `AgentEvent` to `ContextCompressor.ingest()`
   - Call `ContextCompressor.tick()` periodically (every N events or on a timer)
4. On task completion:
   - Call `ContextCompressor.flush()` (wait for pending compressions)
   - Trigger ReflectorWorker if session is ending

**Changes to `src/orchestrator/execution-loop.ts`:**

Add an `onEvent` hook that the orchestrator uses to feed events into the compressor. The execution loop itself stays clean — it doesn't know about compression.

---

### OM-08: Daily Note Consolidation Enhancement

Enhance `MemoryManager.consolidateDailyNotes()` to run a Reflector pass before archiving.

**Current behavior:** Move old daily notes to `archive/`, append summary header to MEMORY.md.

**New behavior:** Before archiving, pass old daily note content through `ReflectorWorker.reflect()` to extract structured memory items. Then archive the raw files as before.

This bridges the gap between Tier 2 (daily notes) and Tier 3 (structured items) that currently has no automated path.

---

### OM-09: Unit Tests

Tests for each new component, following existing patterns in `tests/unit/`:

- `token-estimator.test.ts` — Accuracy against known token counts (within 20%)
- `observation-store.test.ts` — CRUD, append-only invariant, restart recovery
- `context-compressor.test.ts` — Threshold triggering, tier management, non-blocking behavior
- `observer-worker.test.ts` — Compression prompt output, priority tagging, date model
- `reflector-worker.test.ts` — Memory item extraction, condensation

All use mocked `compressFn` (no real LLM calls in unit tests).

---

### OM-10: Integration Test

End-to-end test simulating a long conversation:

1. Feed 100+ messages into ContextCompressor
2. Verify working tier stays within budget
3. Verify session observations are produced in background
4. Verify cross-session items are created on session end
5. Verify context survives simulated restart (read from observation store)
6. Verify the agent's context window contains all three tiers

---

## What This Does NOT Change

- **Existing memory tools** (`memory_search`, `memory_save`, `memory_forget`) — unchanged. Agent still has explicit memory control.
- **MEMORY.md** (Tier 1) — unchanged. Still curated, still integrity-checked.
- **Daily notes** (Tier 2) — unchanged day-to-day. Only consolidation is enhanced (OM-08).
- **Structured items** (Tier 3) — unchanged schema. ReflectorWorker just creates items through the existing API.
- **ExecutionLoop** — minimal changes. Compression is orchestrator-level concern.
- **Provider interface** — zero changes. Compression is transparent to providers.

## Risk Mitigations

| Risk | Mitigation |
|------|-----------|
| Compression loses critical info | Observer prompt preserves exact names/paths/IDs; CRITICAL priority items are kept verbatim |
| Background worker falls behind | `blockAfter` safety threshold forces sync compression; configurable |
| Compression model unavailable | Graceful degradation: working tier grows unbounded (same as today), log warning |
| Token estimation inaccurate | Conservative ratio (chars/3.5); thresholds are soft; 20% error is acceptable |
| Storage bloat from observations | `ObservationStore.prune()` on session end; configurable retention |
