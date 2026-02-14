# APPENDIX B: Dependency DAG & Critical Path Analysis

## Purpose

This appendix shows how gaps depend on one another and identifies the critical path to production. Use this to:
- Understand which gaps must be fixed first
- Identify parallelization opportunities
- Plan sprint work with dependencies in mind
- Minimize wall-clock time to production

---

## B1. Critical Dependency Tree

```
FOUNDATION LAYER (Must fix first - 3h)
│
└─── ORCH-10: Main Orchestrator Bootstrap [3h]
     │ (Instantiates all subsystems)
     │
     ├─── ORCH-01: FailoverController Integration [2h]
     │    ├─ Needs: orchestrator.boot() creates FailoverController
     │    ├─ Unblocks: Graceful failover for transient errors
     │    └─ Related: ERR-04 (Error classification) [optional enhancement]
     │
     ├─── ORCH-02: RetryQueue Consumer [2h]
     │    ├─ Needs: Orchestrator starts consumer loop
     │    ├─ Unblocks: Automatic task retry
     │    └─ Related: ORCH-01 (Provider selection for retry)
     │
     ├─── ORCH-03: Router Integration [2h]
     │    ├─ Needs: ExecutionLoop calls router for task distribution
     │    ├─ Unblocks: Task routing, multi-task parallelization
     │    └─ Depends: ORCH-10 (Router instantiation)
     │
     ├─── ORCH-06: SessionManager Event Persistence [1h]
     │    ├─ Needs: ExecutionLoop emits, persistence service consumes
     │    ├─ Unblocks: Audit trail, crash recovery
     │    └─ Related: ERR-01 (AuditLogger silent failures)
     │
     ├─── ORCH-07: MemoryManager Context Injection [1h]
     │    ├─ Needs: ExecutionLoop initializes memory context
     │    ├─ Unblocks: Agent memory persistence during execution
     │    └─ Depends: ORCH-10 (MemoryManager instantiation)
     │
     ├─── ORCH-04: AuthMonitor Scheduling [1h]
     │    ├─ Needs: Orchestrator schedules monitor polling
     │    ├─ Unblocks: Auth token refresh/validation
     │    └─ Depends: ORCH-10 (Orchestrator boot)
     │
     ├─── ORCH-09: Heartbeat & Routine Manager [1h]
     │    ├─ Needs: Orchestrator starts both systems
     │    ├─ Unblocks: Periodic health checks, scheduled tasks
     │    └─ Related: ERR-05 (Event stream timeout)
     │
     └─── Critical Error Handling (Enable all of above)
          ├─ ERR-01: AuditLogger Silent Failures [1h]
          ├─ ERR-02: GeminiProvider JSON Parse Failures [1h]
          └─ ERR-04: Error Classification [2h]

OPERATIONAL LAYER (Depends on ORCH-10 - 6h)
│
├─── OPS-01: CLI Daemon Commands [3h]
│    ├─ Needs: ORCH-10 (Orchestrator running)
│    ├─ Unblocks: OPS-02, OPS-03, TEST-01
│    └─ Related: TEST-01 (Integration tests require daemon)
│
├─── OPS-02: Dashboard API /jobs Endpoint [2h]
│    ├─ Needs: ORCH-10 (Orchestrator for job data)
│    ├─ Unblocks: Operational visibility
│    └─ Depends: OPS-01 (Daemon commands)
│
└─── OPS-03: Frontend Build [1h]
     ├─ Needs: Build configuration
     └─ Depends: OPS-02 (API to display)

TESTING LAYER (Depends on OPS-01 - 7h)
│
├─── TEST-01: Integration Tests for Orchestration [4h]
│    ├─ Needs: ORCH-10, OPS-01, full orchestration layer
│    ├─ Unblocks: TEST-02, TEST-03, production readiness
│    └─ Tests: End-to-end flow, multi-provider scenarios
│
├─── TEST-02: Failover/Retry Scenario Tests [3h]
│    ├─ Needs: TEST-01, ORCH-01, ORCH-02
│    └─ Tests: Transient error recovery
│
└─── Additional Tests (TEST-03 through TEST-07)
     └─ Dependencies: Mostly independent or depend on TEST-01
```

---

## B2. Dependency Blocking Relationships

### Direct Blocking (Gap X must complete before Gap Y can start)

| Gap X | Gap Y | Reason | Type |
|-------|-------|--------|------|
| ORCH-10 | ORCH-01 | FailoverController needs orchestrator instantiation | Hard |
| ORCH-10 | ORCH-02 | RetryQueueConsumer needs orchestrator instantiation | Hard |
| ORCH-10 | ORCH-03 | Router needs orchestrator instantiation | Hard |
| ORCH-10 | ORCH-04 | AuthMonitor needs orchestrator scheduling | Hard |
| ORCH-10 | ORCH-07 | MemoryManager needs context from orchestrator | Hard |
| ORCH-10 | ORCH-09 | Heartbeat/Routine systems need orchestrator startup | Hard |
| ORCH-01 | ORCH-02 | Retry consumer uses failover for provider selection | Soft |
| OPS-01 | OPS-02 | Dashboard API depends on daemon running | Hard |
| OPS-01 | TEST-01 | Integration tests need daemon running | Hard |
| TEST-01 | TEST-02 | Failover tests depend on integration test setup | Soft |
| ORCH-04 | ORCH-09 | Both scheduled by orchestrator (can parallelize) | Independent |

---

## B3. Execution Paths to Production

### Path P0: Critical Path (16 hours wall-clock)

**Minimum viable orchestration - absolute prerequisites for production:**

```
Phase 1: Foundation Setup [6h wall-clock with parallelization]
├─ ORCH-10 Bootstrap [3h] ──┐
├─ ERR-01, ERR-02 [2h]      ├─ Sequential (critical path)
└─ ORCH-06 Persistence [1h] ┘

Phase 2: Core Orchestration [4h wall-clock with 3-4 agents]
├─ Agent A: ORCH-01 + ERR-04 [2h] ──┐
├─ Agent B: ORCH-02 [2h]            ├─ Parallel (independent tasks)
├─ Agent C: ORCH-03 [2h]            │
└─ Agent D: ORCH-07 [1h] ───────────┘

Phase 3: Operational Proof [6h wall-clock with 3 agents]
├─ Agent A: OPS-01 Daemon [3h] ──┐
├─ Agent B: OPS-03 Frontend [1h] ├─ Parallel (independent)
└─ Agent C: Quick TEST-01 [4h] ───┘

Total Effort: 16 hours sequential ≈ 6h + 4h + 6h = 16h with parallelization
Total Time: ~10 hours wall-clock (3 agents optimal)
```

**Result:** Orchestration layer operational, orchestrated tasks run, failover/retry functional

---

### Path P1: Full Integration (14 hours added)

**Complete operational tooling and comprehensive testing:**

```
Path P0 Output + 14 hours:
├─ Complete Test Suite [7h]
│  ├─ TEST-01: Full integration tests [4h]
│  ├─ TEST-02: Failover scenarios [3h]
│  └─ TEST-03-07: Additional coverage [6h]
│
├─ Complete CLI Operations [3h]
│  ├─ All daemon commands fully tested
│  └─ Dashboard fully operational
│
└─ Error Handling Polish [2h]
   ├─ ERR-03, ERR-05 (error stream handling)
   └─ Silent error surfacing

Total Effort: 30 hours ≈ 16h P0 + 14h P1
Wall-clock: ~14 hours with 3-4 agents
```

**Result:** Production-ready system with operational visibility and comprehensive test coverage

---

### Path P2: Technical Debt (24 hours added)

**Type safety, observability, and documentation excellence:**

```
Path P0 + P1 Output + 24 hours:
├─ Type Safety Refactoring [12h]
│  ├─ TYPE-01: Remove 36 `as any` assertions [3h]
│  ├─ TYPE-02: Properly narrow `unknown` errors [2h]
│  ├─ TYPE-03: Fix TaskContext history type [4h]
│  ├─ TYPE-04: Provider config hierarchy [2h]
│  ├─ TYPE-06, TYPE-07: Event payloads [3h]
│  └─ TYPE-08: Return type annotations [1h]
│
├─ Observability Improvements [8h]
│  ├─ LOG-01: Replace console.log with structured logging [3h]
│  ├─ LOG-02: Handle async errors properly [2h]
│  ├─ LOG-03: Health check instrumentation [2h]
│  └─ LOG-04: Event source attribution [1h]
│
├─ Documentation [6h]
│  ├─ DOC-01: Inline explanations [2h]
│  ├─ DOC-02: Architecture Decision Records [3h]
│  ├─ DOC-03: Provider implementation guide [2h]
│  ├─ DOC-04: Configuration reference [1h]
│  └─ DOC-05: Troubleshooting guide [2h]
│
└─ Enhanced Error Handling [2h]
   ├─ ERR-03, ERR-06: Regex/parsing robustness
   └─ OPS-04: Gemini buffer bounds

Total Effort: 54 hours sequential ≈ 16 P0 + 14 P1 + 24 P2
Wall-clock: ~16 hours with 4 concurrent agents on different categories
```

**Result:** Production-grade system with type safety, comprehensive observability, and excellent documentation

---

## B4. Critical Path (Minimum Viable)

```
DAY 1: FOUNDATION (Hours 0-6, wall-clock)
├─ 00:00-03:00 → ORCH-10 Bootstrap (core orchestrator)
└─ 03:00-06:00 → Parallel quick wins:
   ├─ ORCH-06 + ERR-01 (Session persistence)
   ├─ ORCH-04 (AuthMonitor scheduling)
   ├─ ORCH-09 + ERR-05 (Service startup)
   ├─ ERR-02 (GeminiProvider JSON)
   └─ ERR-03 (FlagManager logging)

DAY 2: CORE ORCHESTRATION (Hours 6-10, wall-clock)
├─ 06:00-08:00 → Parallel:
│  ├─ Agent A: ORCH-01 + ERR-04 (Failover)
│  ├─ Agent B: ORCH-02 (Retry)
│  └─ Agent C: ORCH-03 + ORCH-07 (Router + Memory)
│
└─ 08:00-10:00 → ORCH-08 (Steering Manager polling)

DAY 3: OPERATIONAL READINESS (Hours 10-14, wall-clock)
├─ 10:00-13:00 → Parallel:
│  ├─ Agent A: OPS-01 (CLI daemon)
│  ├─ Agent B: OPS-02 (Dashboard API)
│  └─ Agent C: Basic TEST-01 (Integration tests)
│
└─ 13:00-14:00 → OPS-03 (Frontend build) + validation

PRODUCTION READY: ~14 hours wall-clock
```

---

## B5. Parallelization Strategy

### Optimal Team Size: 3-4 Agents

**Why 3-4?** Most critical path steps require 1-2 sequential phases, then offer 3-4 parallel opportunities

**Allocation for 3-agent team:**

| Phase | Agent A | Agent B | Agent C |
|-------|---------|---------|---------|
| P0-1 | ORCH-10 | ORCH-06+ERR-01 | ORCH-04 |
| P0-2 | ORCH-01+ERR-04 | ORCH-02 | ORCH-03+ORCH-07 |
| P0-3 | OPS-01 | TEST-01 | OPS-03 |
| P1-1 | Extended TEST-01 | TEST-02 | TEST-03-07 |

**Result:** ~14 hours wall-clock vs 54 hours sequential

---

