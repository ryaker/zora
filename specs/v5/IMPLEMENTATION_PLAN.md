# Zora — WSJF Implementation Plan

> **Version:** 1.3
> **Date:** 2026-02-12
> **Companion to:** ZORA_AGENT_SPEC.md v0.5.0
> **Methodology:** Weighted Shortest Job First (WSJF)
> **Changes in 1.3:** Removed routine definitions (20, 21) from dev plan. Elevated Web Dashboard and Steering Controller.

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

---

## Priority-Ordered Work Items

### Tier 1: Foundation (COMPLETED)
Items 1-11 covering scaffolding, config, providers, tools, and execution loop foundation.

### Tier 2: Intelligence & Interactivity (WSJF ≥ 3.0)

| # | Work Item | BV | TC | RR | Size | WSJF | Est |
|---|-----------|----|----|-----|------|------|-----|
| 12 | **Gemini Provider** | 4 | 4 | 3 | 3 | **3.7** | ✅ |
| 13 | **Router** | 4 | 4 | 2 | 2 | **5.0** | ✅ |
| 14 | **Failover Controller** | 4 | 3 | 4 | 3 | **3.7** | ✅ |
| 15 | **Auth health monitoring** | 3 | 3 | 5 | 2 | **5.5** | ✅ |
| 16 | **Async Steering Protocol** | 4 | 3 | 3 | 2 | **5.0** | ✅ |
| 17 | **Routines + cron** | 5 | 3 | 1 | 2 | **4.5** | ✅ |
| 18 | **macOS notifications** | 4 | 2 | 1 | 1 | **7.0** | ✅ |
| 19 | **Retry Queue** — Persistence for 429/Transient errors | 3 | 3 | 3 | 2 | **4.5** | 1.5h |
| 20 | **Steering Controller** — Active course-correction in loop | 5 | 4 | 2 | 2 | **5.5** | 2h |
| 21 | **Memory Tier 1+2** — `MEMORY.md` + Daily Notes context | 4 | 3 | 1 | 2 | **4.0** | 2h |

---

### Tier 3: Interfaces & Hardening (WSJF 1.0-2.9)

| # | Work Item | BV | TC | RR | Size | WSJF | Est |
|---|-----------|----|----|-----|------|------|-----|
| 22 | **Web Dashboard (v0.6)** — Local UI, Onboarding, Policy UI | 4 | 3 | 3 | 4 | **2.5** | 6h |
| 23 | **Telegram Gateway (v0.6)** — Remote steering bot | 3 | 2 | 2 | 3 | **2.3** | 4h |
| 24 | **Hardening Stack** — Secrets, Audit, Integrity | 2 | 2 | 5 | 3 | **3.0** | 4h |
| 25 | **Memory Tier 3+** — Salience, Extraction, Categories | 3 | 2 | 2 | 4 | **1.7** | 6h |
| 26 | **Worker Sandbox** — Capability tokens + protections | 2 | 1 | 4 | 2 | **2.3** | 2h |
| 27 | **CLI Refinements** — Memory/Audit/Config commands | 3 | 1 | 0 | 2 | **2.0** | 2h |

---

## Session Roadmap

### Session 2: Steering & Resilience (Current)
**Target:** Items 19-20
**Deliverable:** Agent that can survive quota limits and be redirected mid-task.

### Session 3: Memory & Dashboard
**Target:** Items 21-22
**Deliverable:** Knowledge-aware agent with local control UI.

### Session 4: Remote & Hardening
**Target:** Items 23-24
**Deliverable:** Telegram steering and full security stack.

---

*Build fast. Ship real output. Open source when it works.*
