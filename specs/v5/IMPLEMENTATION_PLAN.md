# Zora — WSJF Implementation Plan

> **Version:** 1.2
> **Date:** 2026-02-12
> **Companion to:** ZORA_AGENT_SPEC.md v0.5.0
> **Methodology:** Weighted Shortest Job First (WSJF)
> **Changes in 1.2:** Integrated v0.6 addenda items (Web UI, Telegram, Async Steering) into the prioritization matrix.

---

## WSJF Scoring

Each work item is scored on four dimensions:

| Dimension | Scale | Description |
|-----------|-------|-------------|
| **Business Value** | 1-5 | Does this enable real workflow output? (content pipeline, job search, daily ops) |
| **Time Criticality** | 1-5 | Does delaying this block other work or create risk? |
| **Risk Reduction** | 1-5 | Does this eliminate a failure mode or security gap? |
| **Job Size** | 1-5 | Estimated effort (1 = 30 min, 2 = 1-2h, 3 = 2-4h, 4 = 4-8h, 5 = 8h+) |

**WSJF Score = (Business Value + Time Criticality + Risk Reduction) / Job Size**

Higher score = do first.

---

## Priority-Ordered Work Items

### Tier 1: Foundation (COMPLETED)

| # | Work Item | WSJF | Status |
|---|-----------|------|--------|
| 1 | **Project scaffolding** | 8.0 | ✅ |
| 2 | **Config system** | 5.0 | ✅ |
| 3 | **LLMProvider interface** | 9.0 | ✅ |
| 4 | **Claude Provider** | 4.0 | ✅ |
| 5 | **Core tools** | 5.5 | ✅ |
| 6 | **Capability policy engine** | 6.5 | ✅ |
| 7 | **Execution loop** | 6.0 | ✅ |
| 8 | **JSONL session persistence** | 9.0 | ✅ |
| 9 | **CLI basics** | 5.0 | ✅ |
| 10 | **Critical file protection** | 10.0 | ✅ |
| 11 | **Atomic writes for shared state** | 9.0 | ✅ |

---

### Tier 2: Intelligence & Steering (WSJF ≥ 3.0)

| # | Work Item | BV | TC | RR | Size | WSJF | Est. Hours |
|---|-----------|----|----|-----|------|------|------------|
| 12 | **Gemini Provider** — CLI subprocess wrapper, multi-format output parser | 4 | 4 | 3 | 3 | **3.7** | 3 |
| 13 | **Router** — Task classification heuristic, routing matrix, user override | 4 | 4 | 2 | 2 | **5.0** | 2 |
| 14 | **Failover Controller** — Quota detection, auth failure detection, HandoffBundle | 4 | 3 | 4 | 3 | **3.7** | 3 |
| 15 | **Auth health monitoring** — Heartbeat auth checks, pre-expiry warnings | 3 | 3 | 5 | 2 | **5.5** | 2 |
| 16 | **Async Steering Protocol (v0.6)** — Message schemas, routing contract, source tagging | 4 | 3 | 3 | 2 | **5.0** | 2 |
| 17 | **Routines + cron** — node-cron, TOML definitions, heartbeat system | 5 | 3 | 1 | 2 | **4.5** | 2 |
| 18 | **macOS notifications** — `osascript` for task complete, errors, auth expiry | 4 | 2 | 1 | 1 | **7.0** | 0.5 |
| 19 | **Retry queue** — Exponential backoff for quota-exhausted tasks | 3 | 2 | 3 | 2 | **4.0** | 1.5 |
| 20 | **Content pipeline routine** — MyMoneyCoach weekly blog + social posts | 5 | 3 | 0 | 2 | **4.0** | 2 |
| 21 | **Job search routine** — Daily job scan + cover letter generation | 4 | 2 | 0 | 2 | **3.0** | 2 |

---

### Tier 3: Memory & Remote UI (WSJF 1.0-2.9)

| # | Work Item | BV | TC | RR | Size | WSJF | Est. Hours |
|---|-----------|----|----|-----|------|------|------------|
| 22 | **Memory Tier 1+2** — MEMORY.md loading, daily notes read/write | 4 | 2 | 1 | 2 | **3.5** | 2 |
| 23 | **Web Dashboard (v0.6)** — Local UI, status cards, steering input, flag review | 4 | 2 | 2 | 4 | **2.0** | 6 |
| 24 | **Telegram Gateway (v0.6)** — Long-poll bot, pairing flow, remote steering ingress | 3 | 2 | 2 | 3 | **2.3** | 4 |
| 25 | **Memory Tier 3** — Structured items (JSON), six memory types, source tagging | 3 | 2 | 2 | 2 | **3.5** | 2 |
| 26 | **Salience scoring** — Retrieval ranking (reinforcement + recency decay + relevance) | 3 | 1 | 1 | 2 | **2.5** | 1.5 |
| 27 | **Memory extraction pipeline** — Schema-guided extraction, correction loop | 3 | 1 | 1 | 3 | **1.7** | 3 |
| 28 | **Category auto-organization** — Category assignment, summary generation | 3 | 1 | 1 | 3 | **1.7** | 3 |
| 29 | **Secrets management** — AES-256-GCM, Keychain, JIT decryption | 2 | 2 | 5 | 2 | **4.5** | 2 |
| 30 | **Audit logging** — Hash-chained append-only log, serialized writer queue | 2 | 1 | 4 | 2 | **3.5** | 1.5 |
| 31 | **Integrity Guardian** — SHA-256 baselines, heartbeat checks | 2 | 1 | 5 | 2 | **4.0** | 1.5 |
| 32 | **Prompt injection defense** — Input sanitizer, output validator | 1 | 1 | 4 | 2 | **3.0** | 2 |
| 33 | **Leak detection** — Scan LLM outputs for secret patterns | 1 | 1 | 4 | 1 | **6.0** | 1 |
| 34 | **Worker capability tokens** — Scoped permission subsets per job | 2 | 1 | 3 | 2 | **3.0** | 2 |
| 35 | **`zora memory` CLI** | 3 | 1 | 0 | 1 | **4.0** | 1 |
| 36 | **`zora audit` CLI** | 1 | 1 | 2 | 1 | **4.0** | 0.5 |
| 37 | **`zora config/policy edit` CLI** | 2 | 1 | 2 | 1 | **5.0** | 0.5 |

---

### Tier 4: Teams & Advanced (WSJF < 1.0)

| # | Work Item | BV | TC | RR | Size | WSJF | Est. Hours |
|---|-----------|----|----|-----|------|------|------------|
| 38 | **Cross-agent mailbox infrastructure** | 3 | 1 | 1 | 3 | **1.7** | 3 |
| 39 | **Gemini Bridge** — Background process polling mailbox → CLI | 3 | 1 | 1 | 3 | **1.7** | 3 |
| 40 | **Bridge Watchdog** | 1 | 1 | 3 | 1 | **5.0** | 1 |
| 41 | **Team lifecycle commands** | 2 | 1 | 0 | 2 | **1.5** | 2 |
| 42 | **MCP server support** | 3 | 1 | 0 | 3 | **1.3** | 3 |
| 43 | **WASM sandbox spike** | 2 | 1 | 3 | 3 | **2.0** | 4 |

---

## Session Roadmap

### Session 2: Intelligence & Steering (Current)
**Target:** Items 12-18
**Deliverable:** Dual-provider agent with smart routing, failover, and async steering protocol foundation.

### Session 3: Persistence & Workflows
**Target:** Items 19-21
**Deliverable:** Retry resilience and real MyMoneyCoach content routines.

### Session 4: Memory & Dashboard
**Target:** Items 22-24
**Deliverable:** Hierarchical memory and local web dashboard for monitoring.

---

*Build fast. Ship real output. Open source when it works.*
