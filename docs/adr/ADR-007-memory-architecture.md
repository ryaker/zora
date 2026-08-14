# ADR-007: Memory Architecture

**Status:** Accepted
**Date:** 2026-02-25
**Authors:** Zora Core Team

## Context

Zora sessions are stateless at the LLM level — each new task starts with an empty context window. Users expect the agent to remember preferences, past decisions, project context, and behavioral patterns across sessions. The memory system must:

1. Persist across process restarts without a database server.
2. Be human-readable and human-editable.
3. Inject relevant context into new tasks without overwhelming the LLM context window.
4. Automatically extract and organize information from conversations.
5. Prioritize relevant items over stale or low-value ones.
6. Protect memory integrity against tampering (a compromised MEMORY.md could change agent behavior).

## Decision

Implement a three-tier memory architecture:

### Tier 1: Long-term Semantic Memory (MEMORY.md)

- **Format**: Markdown file at ~/.zora/memory/MEMORY.md
- **Contents**: High-level summaries, persistent user facts, important decisions, behavioral guidelines.
- **Human-editable**: Users can directly edit MEMORY.md to add, correct, or remove memories.
- **Injection**: Entire file (or compressed summary) is injected into every task context.
- **Integrity**: SHA-256 baseline computed by IntegrityGuardian. Mismatch triggers warning log.
- **Implementation**: MemoryManager._loadLongTermMemory() (src/memory/memory-manager.ts)

### Tier 2: Rolling Context (Daily Notes)

- **Format**: Markdown files at ~/.zora/memory/daily/YYYY-MM-DD.md
- **Contents**: Session summaries, daily events, recent decisions, notable tool outputs.
- **Injection**: Last N days of daily notes (configurable via memory.daily_notes_window in config.toml) are injected into task context.
- **Rotation**: Files accumulate; no automatic deletion. Archival is operator responsibility.
- **Implementation**: MemoryManager._loadDailyNotes() (src/memory/memory-manager.ts)

### Tier 3: Structured Items with Salience Scoring

- **Format**: JSON files at ~/.zora/memory/items/<id>.json, one per MemoryItem.
- **Types**: profile, event, knowledge, behavior, skill, tool (MemoryItemType, src/memory/memory-types.ts).
- **Salience scoring**: SalienceScorer combines access_count, recency decay, relevance to current task, and source trust bonus (src/memory/salience-scorer.ts). Scoring formula: `score = accessWeight * access_count_log + recencyDecay * days_since_access + relevanceScore + sourceTrustBonus`.
- **Category organization**: CategoryOrganizer groups items into named categories with summaries (src/memory/category-organizer.ts). Category summaries are stored in memory/categories/<category>.json.
- **Injection**: Top-K items by salience score are injected into task context.
- **Extraction**: ExtractionPipeline (src/memory/extraction-pipeline.ts) uses an LLM call to extract structured MemoryItems from conversation text, with ValidationPipeline validation (src/memory/validation-pipeline.ts) and deduplication (DEDUP_THRESHOLD: 0.8 cosine similarity).
- **Implementation**: MemoryManager, StructuredMemory, SalienceScorer, CategoryOrganizer (src/memory/)

### Context Assembly

MemoryManager.buildContextFragment() assembles all three tiers into a memoryContext string injected into TaskContext.memoryContext before LLM invocation.

ContextCompressor (src/memory/context-compressor.ts) compresses the assembled context if it exceeds the token budget configured in memory.max_context_tokens.

### Proactive Extraction

After task completion, ObservationStore (src/memory/observation-store.ts) collects conversation messages and tool outputs. ObserverWorker and ReflectorWorker (src/memory/observer-worker.ts, src/memory/reflector-worker.ts) process observations asynchronously: ObserverWorker creates raw ObservationStore entries; ReflectorWorker synthesizes patterns into new MemoryItems via ExtractionPipeline.

## Consequences

**Positive:**
- Human-readable tiers (MEMORY.md, daily notes) enable user oversight and correction.
- Salience scoring prevents context window pollution from stale low-value memories.
- Proactive extraction automates memory growth without user effort.
- Three-tier architecture allows coarse-to-fine context injection depending on task type.
- No database server required; filesystem backup covers memory backup.

**Negative:**
- Extraction depends on an LLM call, which can fail, timeout, or hallucinate malformed MemoryItems. ValidationPipeline and retry logic (MAX_RETRIES: 2) mitigate this.
- Salience scoring is heuristic, not learned. Items from non-representative periods may score poorly. A future improvement is learned scoring via user feedback signals.
- Memory files grow without bound. Archival and pruning tools (future: zora gc --memory) are needed for long-running deployments.
- Concurrent write access to memory items from parallel tasks is not serialized. Race conditions possible when two tasks complete simultaneously. Mitigated by file-level atomic writes (writeAtomic).

## Alternatives Considered

1. **Vector database (Chroma, Pinecone)**: Rejected for violating zero-external-dependencies constraint. Also adds native Python dependency (Chroma). May revisit if semantic search quality is insufficient.
2. **SQLite full-text search**: Rejected due to native binary dependency. Noted for future evaluation.
3. **Single MEMORY.md only**: Rejected because a flat file does not support salience-ranked injection for large memory stores. The three-tier approach allows selective injection.
4. **Cloud memory service (Mem0, Zep)**: Rejected for violating local-first data sovereignty principle. Data must stay on the user machine.
