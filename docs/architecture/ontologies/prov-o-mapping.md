# W3C PROV-O Mapping for Zora AuditLogger
## Provenance Ontology Alignment

**Document ID:** ONT-PROVO-001  
**Version:** 1.0  
**Date:** 2026-02-25  
**Status:** Approved  

Reference: W3C PROV-O Ontology Recommendation
Source: https://www.w3.org/TR/prov-o/

---

## 1. Overview

Zora AuditLogger (src/security/audit-logger.ts) produces a hash-chained JSONL audit log where every entry conforms to the AuditEntry interface (src/security/security-types.ts). This document maps AuditEntry fields to W3C PROV-O classes and properties to enable standard provenance queries and SIEM integrations.

---

## 2. Core PROV-O Concepts

PROV-O defines three core classes:
- **prov:Entity** --- A thing with provenance (a file, a result, a policy decision)
- **prov:Activity** --- Something that occurred over time (a task, a tool call, a policy check)
- **prov:Agent** --- Something that bears responsibility (the LLM, the user, the PolicyEngine)

---

## 3. AuditEntry to PROV-O Mapping

### 3.1 AuditEntry Interface (src/security/security-types.ts)

    interface AuditEntry {
      entryId: string;        // unique entry identifier
      timestamp: string;      // ISO 8601 timestamp
      eventType: AuditEntryEventType; // classification
      jobId: string;          // task/job identifier
      sessionId: string;      // session identifier
      data: Record<string, unknown>; // event payload
      previousHash: string;   // SHA-256 of previous entry
      hash: string;           // SHA-256 of this entry
    }

### 3.2 PROV-O Property Mappings

| AuditEntry Field | PROV-O Class / Property | Mapping Notes |
|---|---|---|
| entryId | prov:identifier | Unique identifier for the provenance record |
| timestamp | prov:startedAtTime (for activities) | ISO 8601 timestamp of event occurrence |
| eventType | rdfs:type (subtype of prov:Activity) | See event type taxonomy below |
| jobId | prov:wasAssociatedWith (links to task prov:Activity) | Groups all entries for a single task execution |
| sessionId | prov:wasAttributedTo (prov:Agent: the session) | Identifies the agent session that generated this entry |
| data | prov:value (serialized payload) | Event-specific payload: tool name, args, policy reason, etc. |
| previousHash | prov:wasDerivedFrom | Previous entry in hash chain; establishes temporal ordering |
| hash | prov:wasGeneratedBy (with SHA-256 algorithm) | Cryptographic proof of entry integrity |

---

## 4. Event Type to PROV-O Activity Mapping

| AuditEntryEventType | PROV-O Activity Subclass | PROV-O Properties |
|---|---|---|
| task.start | prov:Activity (task start) | prov:startedAtTime = timestamp, prov:wasAssociatedWith = sessionId |
| task.end | prov:Activity (task end) | prov:endedAtTime = timestamp, prov:generated = session file (prov:Entity) |
| tool.call | prov:Activity (tool invocation) | prov:used = tool (prov:Entity), prov:wasStartedBy = task activity |
| tool.result | prov:Entity (tool output) | prov:wasGeneratedBy = tool.call activity, prov:value = result |
| policy.allow | prov:Activity (policy decision) | prov:wasAssociatedWith = PolicyEngine (prov:Agent), result = allow |
| policy.deny | prov:Activity (policy decision) | prov:wasAssociatedWith = PolicyEngine (prov:Agent), result = deny + reason |
| memory.extract | prov:Activity (memory extraction) | prov:generated = MemoryItem entities |
| failover | prov:Activity (provider transition) | prov:used = previous provider, prov:wasAssociatedWith = FailoverController |
| steer | prov:Activity (steering injection) | prov:wasAttributedTo = user/operator (prov:Agent) |

---

## 5. PROV-O Agent Identification

| Zora Component | PROV-O Agent | Identifier Pattern |
|---|---|---|
| PolicyEngine | prov:SoftwareAgent | zora:agent/policy-engine |
| ClaudeProvider | prov:SoftwareAgent | zora:agent/claude-provider |
| GeminiProvider | prov:SoftwareAgent | zora:agent/gemini-provider |
| OllamaProvider | prov:SoftwareAgent | zora:agent/ollama-provider |
| End User | prov:Person | zora:agent/user/{sessionId} |
| Telegram Steering User | prov:Person | zora:agent/user/telegram/{telegram_user_id} |
| RoutineManager | prov:SoftwareAgent | zora:agent/routine-manager |

---

## 6. Hash Chain as PROV-O Derivation Chain

The SHA-256 hash chain in AuditLogger implements PROV-O prov:wasDerivedFrom at the entry level:

    GENESIS_HASH ("genesis") <-- established at src/security/audit-logger.ts
       |
       | prov:wasDerivedFrom
       v
    Entry[0].hash = SHA256(GENESIS_HASH + entry[0].content)
       |
       | prov:wasDerivedFrom  (previousHash = Entry[0].hash)
       v
    Entry[1].hash = SHA256(Entry[0].hash + entry[1].content)
       |
       ... (chain continues)
       v
    Entry[N].hash

Chain integrity is verified via AuditLogger.verifyChain() (src/security/audit-logger.ts) which recomputes each hash and compares against the stored value.

---

## 7. Sample PROV-O Representation (Turtle)

    @prefix prov: <http://www.w3.org/ns/prov#> .
    @prefix zora: <https://github.com/ryaker/zora#> .
    @prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
    @prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .

    # AuditEntry for task.start event
    zora:entry/entry_001_xxxxxxxx a prov:Activity ;
        rdfs:label "task.start" ;
        prov:startedAtTime "2026-02-25T10:00:00Z"^^xsd:dateTime ;
        prov:wasAssociatedWith zora:agent/claude-provider ;
        zora:jobId "job_abc123" ;
        zora:previousHash "genesis" ;
        zora:hash "a1b2c3..." .

    # AuditEntry for tool.call event
    zora:entry/entry_002_yyyyyyyy a prov:Activity ;
        rdfs:label "tool.call" ;
        prov:startedAtTime "2026-02-25T10:00:05Z"^^xsd:dateTime ;
        prov:wasStartedBy zora:entry/entry_001_xxxxxxxx ;
        prov:used zora:tool/read_file ;
        prov:wasAssociatedWith zora:agent/policy-engine ;
        zora:previousHash "a1b2c3..." ;
        zora:hash "d4e5f6..." .

    # PolicyEngine as SoftwareAgent
    zora:agent/policy-engine a prov:SoftwareAgent ;
        rdfs:label "Zora PolicyEngine" ;
        prov:actedOnBehalfOf zora:agent/user/session_xyz .

---

## 8. SIEM Export Recommendations

The AuditLogger JSONL format maps naturally to:
- **Splunk**: Use JSON sourcetype; index on timestamp, jobId, eventType
- **Elastic (ECS)**: Map timestamp -> @timestamp, eventType -> event.action, sessionId -> user.id, hash -> file.hash.sha256
- **OpenSearch**: Use filebeat JSONL ingestion; apply ILM policy for log rotation
- **AWS CloudTrail format**: Map to eventType -> eventName, sessionId -> userIdentity.sessionContext.sessionIssuer.userName

For chain verification in SIEM, export the previousHash and hash fields and verify the chain server-side using the same SHA-256 algorithm as AuditLogger._hashEntry() (src/security/audit-logger.ts).

---

## References

- W3C PROV-O: https://www.w3.org/TR/prov-o/
- PROV-DM: https://www.w3.org/TR/prov-dm/
- AuditLogger implementation: src/security/audit-logger.ts
- AuditEntry type: src/security/security-types.ts
- ADR-008: Audit Chain Integrity Design (docs/adr/ADR-008-audit-chain-integrity.md)
