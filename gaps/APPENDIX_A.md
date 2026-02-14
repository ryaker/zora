# APPENDIX A: File Impact Index

## Purpose

This appendix provides a reverse lookup showing which gaps affect which files. Use this to:
- Identify "hot spot" files that are affected by multiple gaps
- Understand the blast radius of fixing a specific gap
- Find refactoring leverage points where fixing one gap solves multiple problems
- Prioritize files for refactoring based on gap concentration

---

## A1. Hot Spot Files (5+ Gaps)

These files are affected by 5 or more gaps and represent high-value refactoring targets. Fixing these files will resolve multiple gaps simultaneously.

### execution-loop.ts (10 gaps) - CRITICAL HOTSPOT

**File:** `/home/user/zora/src/orchestration/execution-loop.ts`

**Impact:** 10 gaps (3 S1 Critical, 3 S2 High, 4 S3 Medium)

**Gaps affecting this file:**
- ORCH-01 (S1): FailoverController Never Invoked
- ORCH-02 (S1): RetryQueue Consumer Missing
- ORCH-03 (S2): Router Not Integrated
- ORCH-06 (S1): SessionManager Events Never Persisted
- ORCH-07 (S2): MemoryManager Context Not Injected
- ORCH-08 (S2): SteeringManager Never Polled
- LOG-01 (S3): Console.log Used Throughout
- LOG-02 (S2): Silent Errors in Async Operations
- LOG-04 (S3): Event Stream Lacks Source Attribution
- DOC-01 (S3): Sparse Inline Explanations

**Refactoring Strategy:**
- This is the core execution engine; fixing it unblocks most orchestration gaps
- Integrate all componentcontroller invocations (FailoverController, Router, SessionManager, etc.)
- Add comprehensive error handling and logging throughout
- Add inline documentation explaining complex state transitions

**Estimated Cascade Impact:** Fixing this file resolves ~21% of all gaps directly

---

### orchestrator.ts (5 gaps) - MAJOR HOTSPOT

**File:** `/home/user/zora/src/orchestration/orchestrator.ts`

**Impact:** 5 gaps (2 S1 Critical, 2 S2 High, 1 S2 High)

**Gaps affecting this file:**
- ORCH-02 (S1): RetryQueue Consumer Missing
- ORCH-04 (S2): AuthMonitor Never Scheduled
- ORCH-06 (S1): SessionManager Events Never Persisted
- ORCH-09 (S2): HeartbeatSystem & RoutineManager Never Started
- ORCH-10 (S1): No Main Orchestrator Bootstrapping

**Refactoring Strategy:**
- Implement comprehensive bootstrap() method that initializes all subsystems
- This file is the "bootstrap dependency" - all orchestration gaps ultimately depend on it

**Estimated Cascade Impact:** Fixing this file unblocks all other orchestration gaps

---

### router.ts (4 gaps)

**File:** `/home/user/zora/src/orchestration/router.ts`

**Impact:** 4 gaps (1 S2 High, 1 S3 Medium, 1 S4 Low, 1 S3 Medium)

**Gaps affecting this file:**
- ORCH-03 (S2): Router Not Integrated
- ORCH-05 (S3): Router Uses Naive Classification
- ORCH-11 (S4): Round-Robin Mode Actually Random
- DOC-01 (S3): Sparse Inline Explanations

---

### providers/*.ts (Multiple provider files)

**Files:** `/home/user/zora/src/providers/{claude,gemini,ollama}-provider.ts`

**Impact:** Multiple gaps across 3-4 files:
- TYPE-01 (S3): 36 `as any` Assertions (3 files)
- TYPE-05 (S2): Silent JSON.parse() Errors (3 files)
- LOG-01 (S3): Console.log Used Throughout (affects providers)
- LOG-02 (S2): Silent Errors in Async Operations (10 files including providers)

**Refactoring Strategy:**
- Remove type escape hatches (`as any`)
- Add proper error handling for JSON parsing
- Implement structured logging instead of console.log

---

## A2. Critical Infrastructure Files (S1/S2 Only)

These files are affected only by critical or high-severity gaps. Fixing these should be prioritized.

| File | Gaps | Severity | Primary Issues |
|------|------|----------|-----------------|
| `/home/user/zora/src/orchestration/execution-loop.ts` | ORCH-01, ORCH-02, ORCH-03, ORCH-06, ORCH-07, ORCH-08, LOG-02 | 3×S1, 4×S2 | Component integration, error handling |
| `/home/user/zora/src/orchestration/orchestrator.ts` | ORCH-02, ORCH-04, ORCH-06, ORCH-09, ORCH-10 | 3×S1, 2×S2 | Bootstrap flow |
| `/home/user/zora/src/orchestration/failover-controller.ts` | ORCH-01 | S1 | Never invoked |
| `/home/user/zora/src/orchestration/retry-queue.ts` | ORCH-02 | S1 | Consumer missing |
| `/home/user/zora/src/orchestration/session-manager.ts` | ORCH-06 | S1 | Event persistence |
| `/home/user/zora/src/orchestration/auth-monitor.ts` | ORCH-04, LOG-03 | S2, S2 | Scheduling, instrumentation |
| `/home/user/zora/src/providers/gemini-provider.ts` | ERR-02, TYPE-05 | S1, S2 | Silent failures |
| `/home/user/zora/src/security/audit-logger.ts` | ERR-01 | S1 | Silent write failures |
| `/home/user/zora/src/cli/daemon.ts` | OPS-01 | S2 | Daemon commands are stubs |
| `/home/user/zora/src/dashboard/server.ts` | OPS-02, OPS-03 | S2, S2 | API endpoints, frontend build |

---

## A3. Impact by Category

### Orchestration (11 gaps)

**Most affected files:**
1. execution-loop.ts (8 orch gaps)
2. orchestrator.ts (5 orch gaps)
3. router.ts (3 orch gaps)

**Total cascade:** Fixing orchestration layer resolves all 11 gaps

### Type Safety (8 gaps)

**Most affected files:**
1. TYPE-02: 8 files affected (err: unknown narrowing)
2. TYPE-01: 3 provider files
3. TYPE-08: 20 files (missing return types) - distributed

**Challenge:** These gaps are spread across many files; best addressed with:
- Lint configuration updates (enforce return types)
- Coordinated refactoring pass across codebase

### Error Handling (6 gaps)

**Most affected files:**
1. gemini-provider.ts (ERR-02)
2. audit-logger.ts (ERR-01)
3. Distributed across orchestration/providers (ERR-03, ERR-04, ERR-05, ERR-06)

### Testing (7 gaps)

**Note:** Test gaps affect directories that don't exist yet. Impact is on:
- `/tests/integration/` (new)
- `/tests/providers/` (new)
- `/tests/cli/` (new)

### Operational (5 gaps)

**Most affected files:**
1. cli/daemon.ts (OPS-01)
2. dashboard/server.ts (OPS-02)
3. dashboard/frontend/ (OPS-03)

### Logging & Observability (4 gaps)

**Most affected files:**
1. Distributed console.log: 15+ files (LOG-01)
2. Silent async errors: 10 files (LOG-02)
3. event.ts and providers/*.ts (LOG-04)

### Documentation (5 gaps)

**Impact:** All documentation gaps are new files; no existing files affected.

---

## A4. Refactoring Leverage Points

### Foundation Fixes (Unblock Everything)

These files, when fixed, cascade to resolve multiple other gaps:

**Priority 1: orchestrator.ts → ORCH-10**
- Fixing this single file unblocks: ORCH-02, ORCH-04, ORCH-06, ORCH-09
- Estimated cascading impact: 5 gaps resolved
- Effort: 3h → Cascade value: 5 gaps / 3h = 1.67 gaps/hour

**Priority 2: execution-loop.ts**
- Fixing this file resolves: ORCH-01, ORCH-03, ORCH-07, ORCH-08, plus LOG-01, LOG-02, LOG-04 if logging refactored
- Estimated cascading impact: 8+ gaps resolved
- Effort: 6h (including all component integration) → Cascade value: 1.33 gaps/hour

### Provider Fixes (Resolve Multiple Type & Error Gaps)

**Priority 3: providers/*.ts (coordinated refactoring)**
- Resolves: TYPE-01 (3 files), TYPE-05 (3 files), ERR-02, LOG-01, LOG-02
- Estimated cascading impact: 7 gaps resolved
- Effort: 8h (coordinated across 3 providers) → Cascade value: 0.875 gaps/hour

### Testing Infrastructure (Enable All Test Gaps)

**Priority 4: Create test directory structure**
- Resolves: TEST-01, TEST-02, TEST-03, TEST-04, TEST-05, TEST-06, TEST-07
- Estimated cascading impact: 7 gaps resolved
- Effort: 12h (complex integration tests) → Cascade value: 0.58 gaps/hour

---

## A5. Risk Assessment by File

### HIGH RISK (>5 gaps)

Files with many gaps require careful refactoring:
- **execution-loop.ts**: 10 gaps - Tight coordination required; risk of breaking existing functionality

### MEDIUM RISK (3-5 gaps)

- **orchestrator.ts**: 5 gaps
- **router.ts**: 4 gaps
- **provider files**: 3-4 gaps each

### LOW RISK (1-2 gaps)

All other files with gaps can be addressed in isolation or as part of category refactoring.

---

