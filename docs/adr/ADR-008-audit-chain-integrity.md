# ADR-008: Audit Chain Integrity Design

**Status:** Accepted
**Date:** 2026-02-25
**Authors:** Zora Core Team

## Context

Zora executes actions on the user machine autonomously. For the system to be trustworthy in enterprise and regulated environments, there must be a tamper-evident record of every action the agent took. This record must be:

1. **Append-only**: New entries can only be added, never modified or deleted during normal operation.
2. **Tamper-evident**: Any modification of a past entry must be detectable by a verifier.
3. **Queryable**: The log must support filtering by jobId, eventType, and time range.
4. **Lightweight**: The log format must not require a database or specialized tool to read.
5. **SIEM-compatible**: Log entries must be parseable by standard log ingestion tools (Splunk, Elastic, etc.).
6. **Crash-safe**: Partial writes from process crashes must not corrupt the log.

## Decision

### Format: JSONL with SHA-256 Hash Chain

Each audit entry is a JSON object serialized as a single line in ~/.zora/audit/audit.jsonl (one entry per line, no trailing comma, newline-delimited). This is the standard JSONL format, readable by jq, Splunk, Elastic, and any log processor.

### Hash Chain Algorithm

Each AuditEntry (src/security/security-types.ts) includes:
- previousHash: the SHA-256 hash of the previous entry (or "genesis" for the first entry)
- hash: SHA-256(previousHash + JSON.stringify(entry_without_hash_fields))

This creates a cryptographic chain where modifying any entry invalidates all subsequent hashes. The chain is verifiable without a trusted third party.

Implementation: AuditLogger._appendEntry() (src/security/audit-logger.ts)

    GENESIS_HASH = "genesis"  (src/security/audit-logger.ts)

    entry.previousHash = this._previousHash
    payload = previousHash + canonical JSON of other fields
    entry.hash = SHA-256(payload)
    this._previousHash = entry.hash

### Serialized Write Queue

AuditLogger._writeQueue (src/security/audit-logger.ts) is a Promise chain that serializes writes. Only one write executes at a time, preventing interleaving of concurrent log() calls that would break the hash chain. This is a single-writer guarantee implemented in-process without file locks.

### Entry ID Format

entryId uses the format entry_{counter}_{hex4} where counter is a monotonic integer and hex4 is 4 random hex bytes. This provides uniqueness without requiring a UUID library.

### Initialization

On first call to log(), AuditLogger reads the existing file to find the last entry and restores _previousHash from its hash field. This allows the chain to survive process restarts. Implementation: AuditLogger._initialize() (src/security/audit-logger.ts).

### Chain Verification

AuditLogger.verifyChain() (src/security/audit-logger.ts) reads the entire log, recomputes each hash, and returns a ChainVerificationResult indicating whether the chain is valid and at which entry it broke (if any). Available via CLI: zora-agent audit verify.

### Filtering

AuditLogger.readEntries(filter) (src/security/audit-logger.ts) reads and filters entries by jobId, eventType, startTime, and endTime. No indexing; linear scan is acceptable at single-user scale.

### AuditEntry Schema

    interface AuditEntry {
      entryId: string;                    // "entry_001_abcd"
      timestamp: string;                  // ISO 8601
      eventType: AuditEntryEventType;     // "task.start" | "tool.call" | etc.
      jobId: string;                      // task identifier
      sessionId: string;                  // session identifier
      data: Record<string, unknown>;      // event payload
      previousHash: string;               // "genesis" or hash of previous entry
      hash: string;                       // SHA-256 of this entry
    }

### AuditEntryEventType Taxonomy

Defined in src/security/security-types.ts:
    task.start | task.end | tool.call | tool.result | policy.allow | policy.deny | memory.extract | failover | steer

## Consequences

**Positive:**
- JSONL is human-readable with any text editor or standard shell tools.
- Hash chain provides tamper evidence without a database or timestamping authority.
- Serialized write queue prevents hash chain corruption from concurrent writes.
- Chain initialization from existing file allows restart-safe operation.
- AuditEntryEventType taxonomy enables precise SIEM alerting rules.

**Negative:**
- Linear scan for readEntries() becomes slow for very large logs (>1M entries). For enterprise deployments with high activity, a separate index or log rotation policy is needed.
- The hash chain is only tamper-evident, not tamper-proof. An attacker with filesystem write access can rewrite the entire log with a consistent new chain. Tamper-proofing requires an external timestamping service (future: RFC 3161 timestamping).
- The serialized write queue creates a performance bottleneck if many events are logged rapidly. BufferedSessionWriter (src/orchestrator/session-manager.ts) batches session events but AuditLogger does not batch --- each audit event waits for the previous write to complete.
- Log rotation is not automated. Operators must archive and rotate audit.jsonl manually. A future zora audit archive command should be added.

## Alternatives Considered

1. **SQLite with WAL mode**: Provides ACID guarantees and indexing. Rejected due to native dependency (better-sqlite3). Noted as future upgrade path if log size becomes problematic.
2. **RFC 3161 external timestamping**: Provides cryptographic proof of time without a trusted party. Deferred for v2 --- requires network call and external service dependency.
3. **Syslog / journald**: Platform-native logging with rotation. Rejected because it is Linux-only, not portable to macOS without extra setup, and does not support the hash chain property.
4. **Simple append without hash chain**: Faster and simpler. Rejected because it does not provide tamper evidence, which is a core requirement for compliance and security audit use cases.

## W3C PROV-O Alignment

See docs/architecture/ontologies/prov-o-mapping.md for the complete mapping of AuditEntry fields to W3C PROV-O classes and properties. This enables exporting the audit log as RDF provenance graphs for compliance systems that consume PROV-O data.
