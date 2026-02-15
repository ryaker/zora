# ADR-003: File-Based Storage

**Status:** Accepted
**Date:** 2025-12-01
**Authors:** Zora Core Team

## Context

Zora needs persistent storage for:
- **Sessions** -- Event history for each task execution.
- **Memory** -- Long-term notes, daily notes, categorized items.
- **Audit logs** -- Tamper-evident record of all tool invocations and policy decisions.
- **Retry queue** -- Tasks waiting for retry after provider failure.
- **Routines** -- Scheduled task state.

The storage solution must work on a single developer machine without external dependencies (no database server, no cloud services).

## Decision

Use the local filesystem as the storage backend, organized under `~/.zora/`:

```
~/.zora/
  config.toml
  policy.toml
  daemon.pid
  workspace/
    SOUL.md
  memory/
    MEMORY.md          # Long-term memory
    daily/             # Daily note files (YYYY-MM-DD.md)
    items/             # Individual memory items
    categories/        # Category summaries
  audit/
    audit.jsonl        # Append-only audit log
  sessions/
    <jobId>.jsonl      # Per-session event streams
  retry/
    retry-queue.json   # Pending retry tasks
  routines/
    <name>.json        # Routine state
```

Key design choices:
- **JSONL for event streams** (sessions, audit): Append-only, one JSON object per line. Enables streaming writes without loading the full file.
- **Markdown for memory**: Human-readable and editable. Users can view and modify memory files directly.
- **JSON for structured state** (retry queue, routines): Simple to parse, atomic writes via rename.
- **Hash chains for audit integrity**: Each audit entry includes a SHA-256 hash of the previous entry, creating a tamper-evident chain.

## Consequences

**Positive:**
- Zero external dependencies. No database to install, configure, or maintain.
- Human-readable formats. Users can inspect and edit files directly.
- Simple backup: copy the `~/.zora/` directory.
- Works offline and on any OS with a filesystem.
- Append-only JSONL is naturally crash-safe (partial last line is detectable and recoverable).

**Negative:**
- Not suitable for multi-machine deployments. No replication or remote access.
- File locking is advisory on most systems. Concurrent daemon instances could corrupt data. Mitigated by the `audit_single_writer` config and PID file.
- No query capability. Finding specific events requires scanning files. Acceptable at the scale of a single-user agent.
- JSONL files grow without bound. Users should periodically archive or rotate session files. A future `zora gc` command could automate this.

## Alternatives Considered

1. **SQLite.** Considered for the audit log and sessions. Rejected to avoid the native dependency (better-sqlite3 requires compilation). May revisit if query needs grow.
2. **LevelDB/RocksDB.** Over-engineered for the current scale. Adds native compilation requirements.
3. **Cloud storage (S3, GCS).** Rejected for v1. Zora should work fully offline. Cloud sync can be layered on later.
