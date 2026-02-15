# Advanced: MCP Memory Integration

Zora's built-in memory system works standalone with zero configuration. When you have a memory-capable MCP server configured, Zora auto-detects it and upgrades to **enhanced mode** -- the MCP becomes the primary memory layer while the built-in system acts as a fast local cache.

This guide explains the architecture and how to configure MCP memory servers.

---

## How It Works

### Two Modes

**Standalone mode** (default, no memory MCP detected):
- Built-in memory is the sole layer
- Keyword search via MiniSearch (BM25+)
- Salience scoring for ranking (recency, frequency, relevance, trust)
- Markdown and JSON files as source of truth

**Enhanced mode** (memory MCP detected on boot):
- MCP becomes the **primary** memory layer (richer search, graph relations, semantic understanding)
- Built-in becomes a **fast local cache** (sub-1ms reads for hot memories)
- Writes go to both layers
- Reads try built-in first, fall back to MCP on cache miss

### Auto-Detection

On boot, Zora scans your configured MCP servers for memory-like tool patterns:

| Provider | Search tool pattern | Save tool pattern |
|----------|-------------------|------------------|
| Mem0 / OpenMemory | `mem0_search_memory` | `mem0_add_memory` |
| claude-mem | `claude.mem*search` | `claude.mem*save` |
| KMS | `unified_search` | `unified_store` |
| Generic | `memory*search` | `memory*save` or `memory*store` |

If any MCP server exposes tools matching these patterns, Zora activates enhanced mode automatically. No additional configuration is needed.

---

## Write-Through / Read-Through Caching

### Write path

```
Agent calls memory_save(content)
  -> Write to built-in (MiniSearch + JSON file)        [sync, <1ms]
  -> Write to MCP memory (Mem0/KMS/etc)                [async, fire-and-forget]
```

Both layers receive every write. The built-in write is synchronous (the agent sees confirmation immediately). The MCP write happens in the background so it doesn't block the agent.

### Read path

```
Agent calls memory_search(query)
  -> Search built-in first                              [sync, <5ms]
  -> If results.length < limit:
      -> Search MCP memory for additional results       [async, 50-500ms]
      -> Merge and re-rank by salience
      -> Cache MCP results in built-in for next time
```

Hot memories (recently accessed) are served from the local cache in under 5ms. Cache misses fall through to the MCP for deeper search. Results from the MCP are cached locally so subsequent queries for the same content are fast.

### Session sync

```
On session start:
  -> Pull recent MCP memories not in built-in cache
  -> Index into MiniSearch

On session end:
  -> Push any built-in items not yet in MCP
```

This ensures the local cache stays warm and the MCP has a complete picture.

---

## MCP Provider Adapters

Each detected MCP gets a thin adapter that normalizes its API to Zora's memory interface:

```typescript
interface MemoryMCPAdapter {
  readonly provider: string;
  search(query: string, limit: number): Promise<MemoryItem[]>;
  save(item: MemoryItem): Promise<void>;
  getGraphRelations?(entity: string): Promise<Relation[]>;   // Mem0-specific
  getTimeline?(start: Date, end: Date): Promise<MemoryItem[]>; // claude-mem-specific
}
```

Provider-specific capabilities (graph relations, timeline queries) are exposed when available but never required.

---

## Setup: Mem0 / OpenMemory MCP

Mem0 provides semantic vector search, graph relations via Neo4j, and cross-agent memory sharing.

Add to your `config.toml`:

```toml
[mcp.servers.mem0]
type = "stdio"
command = "npx"
args = ["-y", "@mem0/mcp-server"]
env = { MEM0_API_KEY = "${env:MEM0_API_KEY}" }
```

**Note:** Do not hardcode API keys in `config.toml`. Use environment variable references like `${env:MEM0_API_KEY}` and set `export MEM0_API_KEY=your-api-key` in your shell profile or `.env` file.

Or with a self-hosted Mem0 instance:

```toml
[mcp.servers.mem0]
type = "http"
url = "http://localhost:8080/mcp"
```

**What this enables:** semantic search (vector similarity), graph relations (entity connections via Neo4j), cross-agent memory (shared `user_id`), sub-100ms cached search.

## Setup: claude-mem

claude-mem provides persistent memory for Claude-based agents with timeline awareness.

```toml
[mcp.servers.claude-mem]
type = "stdio"
command = "npx"
args = ["-y", "claude-mem-mcp-server"]
```

**What this enables:** timeline queries (memories by date range), semantic search, session-aware recall.

## Setup: KMS (Knowledge Management System)

KMS provides structured document storage with MongoDB-backed search.

```toml
[mcp.servers.kms]
type = "http"
url = "https://kms.example.com/mcp"
headers = { "Authorization" = "Bearer your-token" }
```

**What this enables:** structured document search (MongoDB), cross-agent memory (shared store), sub-100ms cached search.

## Setup: Generic Memory MCP

Any MCP server with tools matching the pattern `memory*search` and `memory*save` (or `memory*store`) will be auto-detected. No special configuration beyond the standard MCP server entry is needed.

```toml
[mcp.servers.my-memory]
type = "stdio"
command = "node"
args = ["path/to/my-memory-server.js"]
```

---

## Capability Comparison

| Capability | Built-in Only | + Mem0 MCP | + KMS MCP |
|------------|---------------|------------|-----------|
| Keyword search | Yes | Yes | Yes |
| Semantic search | No | Yes (vectors) | Yes (MongoDB) |
| Graph relations | No | Yes (Neo4j) | No |
| Cross-agent memory | No | Yes (shared user_id) | Yes (shared store) |
| Sub-100ms cached search | Yes | Yes (local cache) | Yes (local cache) |
| Offline | Yes | Degraded (cache only) | Degraded (cache only) |

---

## Offline and Degradation

When a memory MCP is configured but unavailable (network down, server offline):

- **Reads** continue from the local cache. Results may be stale but the agent keeps working.
- **Writes** are queued locally. They sync to the MCP when connectivity returns.
- **No crashes or errors.** The system degrades gracefully to standalone mode.

The built-in memory layer is always available because it uses only local files.

---

## Implementation Status

The MCP memory bridge is planned for **Phase 2** of the memory system rollout. The architecture described in this guide is the design target. Current status:

- **Phase 1** (current): Built-in memory with salience scoring, CLI commands, context injection
- **Phase 2** (next): MCP auto-detection, adapter interface, write-through/read-through caching
- **Phase 3**: Session sync, generic adapter, graph relation support

The built-in memory system is fully functional today. MCP integration will add depth without changing any user-facing APIs.
