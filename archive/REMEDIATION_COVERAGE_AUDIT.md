# Remediation Plan vs Gap Analysis: Coverage Audit

**Date**: 2026-02-14
**Purpose**: Ensure no gap from GAPS_ANALYSIS.md is dropped by REMEDIATION_PLAN.md

---

## How We Got Here

Two separate Claude Code sessions analyzed the Zora codebase. Both produced gap analyses that were merged into a single GAPS_ANALYSIS.md:

| Session | What It Produced | Depth |
|---------|-----------------|-------|
| **Session A** (thorough) | 46 coded gaps (ORCH-01→DOC-05) with specific files, severity scores, dependency chains, acceptance criteria, quick reference matrix | Deep - individual actionable items |
| **Session B** (less thorough) | High-level findings (ARCH-1.x, SEC-2.x, TD-3.x) AND the WSJF-scored REMEDIATION_PLAN.md | Broad categories, less specific |

**The problem**: Only Session B produced a remediation plan. That plan was written against Session B's own high-level findings. Session A's 46 coded gaps were merged into GAPS_ANALYSIS.md but **never had remediation work items created for them**.

This is why entire categories (OPS, LOG) and most of ORCH, ERR, TEST are missing from the remediation plan - Session B never identified them at that granularity. The thorough work was done but never turned into a plan.

---

## Coverage Summary

| Metric | Count |
|--------|-------|
| Total unique gaps identified | 52 |
| Covered by remediation plan (Session B's findings) | 18 (35%) |
| Partially covered / implicitly bundled | 11 (21%) |
| **NOT covered - Session A's findings with no plan** | **23 (44%)** |

**Session B's remediation plan covers its own findings well. Session A's 46 coded gaps are where the ball gets dropped.**

Biggest coverage holes (all from Session A's thorough analysis):
1. **7 of 11 ORCH gaps** not in any phase (including S1-critical ORCH-10 - the foundation)
2. **All 4 LOG gaps** completely missing
3. **All 5 OPS gaps** completely missing
4. **5 of 7 TEST gaps** not covered
5. **2 of 6 Security gaps** (SEC-2.5, SEC-2.6) not covered
6. **4 of 6 ERR gaps** not covered

---

## Detailed Gap-by-Gap Coverage Map

### SECURITY GAPS (from Sections 2.1-2.6)

| Gap ID | Title | Severity | Remediation Item | Status |
|--------|-------|----------|-----------------|--------|
| SEC-2.1 | Command Injection - Gemini Provider | CRITICAL | P0.1 | COVERED |
| SEC-2.2 | Path Traversal - Policy Engine | CRITICAL | P0.2 | COVERED |
| SEC-2.3 | Error Information Disclosure | HIGH | P0.3 | COVERED |
| SEC-2.4 | Missing Input Validation | HIGH | P0.4 | COVERED |
| SEC-2.5 | Weak Cryptographic Practices | MEDIUM | **NONE** | **MISSING** |
| SEC-2.6 | Insecure Authentication Storage | MEDIUM | **NONE** | **MISSING** |

**Risk**: SEC-2.5 involves **hardcoded encryption keys** and **predictable IVs** (`Math.random()` for IV generation). If source code leaks, all encrypted data is compromised. SEC-2.6 involves **plaintext credential storage**. Neither is addressed in any phase, including the Phase 6 Security Audit verification checklist.

**Action**: Add to Phase 0 as P0.5 and P0.6, or at minimum add to Phase 6 verification checklist.

---

### ARCHITECTURE GAPS (from Sections 1.1-1.6)

| Gap ID | Title | Severity | Remediation Item | Status |
|--------|-------|----------|-----------------|--------|
| ARCH-1.1 | Orchestrator Coupling | CRITICAL | P1.2 | COVERED |
| ARCH-1.2 | PolicyEngine God Object | HIGH | P1.1 | COVERED |
| ARCH-1.3 | Unbounded Resource Growth | HIGH | P2.1 | COVERED |
| ARCH-1.4 | Dead Integration Code | HIGH | P1.3 (partial) | PARTIAL |
| ARCH-1.5 | Scalability Bottlenecks | HIGH | P2.2 | COVERED |
| ARCH-1.6 | Missing Integration Abstractions | MEDIUM | **NONE** | **MISSING** |

**Risk**: ARCH-1.6 = no unified ProviderAdapter pattern. Adding new providers requires rewriting consumers. Partially addressed by P3.3 but the abstraction layer itself is never created.

**Action**: Fold into P1.2 or P3.3 as explicit ProviderAdapter interface work.

---

### ORCHESTRATION GAPS (ORCH-01 through ORCH-11)

| Gap ID | Title | Severity | Remediation Item | Status |
|--------|-------|----------|-----------------|--------|
| ORCH-01 | FailoverController Never Invoked | S1 | P1.3 CircuitBreaker (different!) | **MISSING** |
| ORCH-02 | RetryQueue Consumer Missing | S1 | P1.3 RetryQueue wiring | COVERED |
| ORCH-03 | Router Not Integrated into ExecutionLoop | S2 | **NONE** | **MISSING** |
| ORCH-04 | AuthMonitor Never Scheduled | S2 | P1.3 AuthMonitor wiring | COVERED |
| ORCH-05 | Router Uses Naive Classification | S3 | **NONE** | **MISSING** |
| ORCH-06 | SessionManager Events Never Persisted | S1 | **NONE** | **MISSING** |
| ORCH-07 | MemoryManager Context Not Injected | S2 | **NONE** | **MISSING** |
| ORCH-08 | SteeringManager Never Polled During Execution | S2 | P1.3 SteeringEngine wiring | COVERED |
| ORCH-09 | HeartbeatSystem & RoutineManager Never Started | S2 | **NONE** | **MISSING** |
| ORCH-10 | No Main Orchestrator Bootstrapping | S1 | **NONE** | **MISSING** |
| ORCH-11 | Round-Robin Mode Actually Random | S4 | **NONE** | **MISSING** |

**Critical Finding**: ORCH-10 (Main Orchestrator Bootstrapping) is the **#1 foundation gap** - the root of the dependency tree. The gap analysis states it must be completed first because 6+ other ORCH gaps depend on it. The remediation plan has NO work item for it. P1.2 (Decouple Orchestrator) is about dependency injection, NOT about creating the boot sequence.

**ORCH-01 vs P1.3 CircuitBreaker**: P1.3 adds CircuitBreaker activation, but ORCH-01 is specifically about the **FailoverController** (routes to backup providers). CircuitBreaker prevents cascading failures. These are complementary, not the same.

**ORCH-06**: Session events not persisted = ALL session events lost on restart. S1 (Critical), blocking, no remediation item.

**Action**:
- Add ORCH-10 as the FIRST item in Phase 1 (before P1.1) - it's the foundation
- Add ORCH-01, ORCH-03, ORCH-06, ORCH-07, ORCH-09 to P1.3's explicit work items
- Add ORCH-05 to Phase 3 or 5
- Add ORCH-11 as a quick win (trivial fix)

---

### TYPE SAFETY GAPS (TYPE-01 through TYPE-08)

| Gap ID | Title | Severity | Remediation Item | Status |
|--------|-------|----------|-----------------|--------|
| TYPE-01 | 36 `as any` Assertions in Providers | S3 | P3.1 | COVERED |
| TYPE-02 | `err: unknown` Not Properly Narrowed | S3 | P3.2 (implicit) | PARTIAL |
| TYPE-03 | TaskContext History Type Is `any[]` | S3 | P3.1 (implicit) | PARTIAL |
| TYPE-04 | ProviderConfig Missing Type Hierarchy | S3 | P3.1 (implicit) | PARTIAL |
| TYPE-05 | Silent JSON.parse() Errors | S2 | P3.2 (implicit) | PARTIAL |
| TYPE-06 | No Type Definitions for Event Payloads | S3 | P3.1 (implicit) | PARTIAL |
| TYPE-07 | LLMProvider Union Types Underutilized | S3 | P3.1 (implicit) | PARTIAL |
| TYPE-08 | Missing Return Type Annotations | S4 | **NONE** | **MISSING** |

**Risk**: P3.1 says "Audit all 28 `as any` locations" broadly, but TYPE-03 (TaskContext history), TYPE-06 (Event payloads), TYPE-07 (Union types) each require distinct approaches. Bundling under "eliminate `as any`" risks missing gaps that aren't about `as any` at all.

**TYPE-05 (Silent JSON.parse)** is S2 (High) - not about `as any`, it's about missing try/catch. Should be in P3.2 but isn't listed.

**Action**: Add individual checklist items within P3.1 for TYPE-02 through TYPE-08. Each has distinct acceptance criteria in the gap analysis.

---

### ERROR HANDLING GAPS (ERR-01 through ERR-06)

| Gap ID | Title | Severity | Remediation Item | Status |
|--------|-------|----------|-----------------|--------|
| ERR-01 | AuditLogger Silent Write Failures | S1 | P3.2 (mentioned) | COVERED |
| ERR-02 | GeminiProvider Silent JSON Parse | S1 | P3.3 (mentioned) | COVERED |
| ERR-03 | FlagManager Silently Skips Corrupted Files | S2 | **NONE** | **MISSING** |
| ERR-04 | Fragile Error Classification via String Matching | S2 | **NONE** | **MISSING** |
| ERR-05 | No Timeout on Event Streams | S2 | **NONE** | **MISSING** |
| ERR-06 | Command Parsing Regex Incomplete | S3 | **NONE** | **MISSING** |

**Risk**: ERR-03 = corrupted flag files silently ignored, system runs with wrong flags. ERR-05 = hanging event consumers block indefinitely. Both S2 and trivial fixes.

**Action**: Add ERR-03 and ERR-05 to P3.2. Add ERR-04 and ERR-06 to P3.2 or P5.1.

---

### TESTING GAPS (TEST-01 through TEST-07)

| Gap ID | Title | Severity | Remediation Item | Status |
|--------|-------|----------|-----------------|--------|
| TEST-01 | No Integration Tests for Orchestration | S2 | P4.1 | COVERED |
| TEST-02 | No Failover/Retry Scenario Tests | S2 | P4.1 (partial) | PARTIAL |
| TEST-03 | CLI Commands Lack Functional Tests | S2 | **NONE** | **MISSING** |
| TEST-04 | Dashboard Endpoints Untested | S2 | **NONE** | **MISSING** |
| TEST-05 | Provider Tool Parsing Never Validated | S2 | **NONE** | **MISSING** |
| TEST-06 | GeminiProvider checkAuth() Tests Missing | S2 | **NONE** | **MISSING** |
| TEST-07 | TelegramGateway User Allowlist Logic Untested | S2 | **NONE** | **MISSING** |

**Risk**: 5 of 7 test gaps unaddressed. P4.1 creates generic integration tests but ignores specific targets: CLI (TEST-03), dashboard API (TEST-04), provider parsing (TEST-05), auth (TEST-06), security allowlist (TEST-07).

**Action**: Expand P4.1 to include TEST-03 through TEST-07 as explicit targets.

---

### OPERATIONAL GAPS (OPS-01 through OPS-05)

| Gap ID | Title | Severity | Remediation Item | Status |
|--------|-------|----------|-----------------|--------|
| OPS-01 | CLI Daemon Commands Are Stubs | S2 | **NONE** | **MISSING** |
| OPS-02 | Dashboard GET /api/jobs Returns Empty | S2 | **NONE** | **MISSING** |
| OPS-03 | No Frontend Build Output | S2 | **NONE** | **MISSING** |
| OPS-04 | GeminiProvider Unbounded Buffer | S2 | P2.1 (implicit) | PARTIAL |
| OPS-05 | No Structured Logging | S2 | **NONE** | **MISSING** |

**Critical Finding**: ALL 5 OPS gaps missing/partial. These are the **operational tooling** gaps - without them, the system cannot be deployed, monitored, or managed.

- **OPS-01**: CLI `daemon start/stop/status` = literal stubs. Cannot start the system.
- **OPS-02**: Dashboard shows no job data. Cannot monitor tasks.
- **OPS-03**: No built frontend. Dashboard has no UI.
- **OPS-05**: All logging via console.log. Cannot debug production.

The gap analysis puts OPS-01, OPS-02, OPS-03 in **P1 (Integration Layer)** priority, yet the remediation plan has ZERO operational phase.

**Action**: Create operational tooling phase with CLI, Dashboard, Frontend, Structured Logging items.

---

### LOGGING & OBSERVABILITY GAPS (LOG-01 through LOG-04)

| Gap ID | Title | Severity | Remediation Item | Status |
|--------|-------|----------|-----------------|--------|
| LOG-01 | Console.log Used Throughout | S3 | **NONE** | **MISSING** |
| LOG-02 | Silent Errors in Async Operations | S2 | **NONE** | **MISSING** |
| LOG-03 | No Health Check Instrumentation | S2 | **NONE** | **MISSING** |
| LOG-04 | Event Stream Lacks Source Attribution | S3 | **NONE** | **MISSING** |

**Critical Finding**: ALL 4 LOG gaps completely absent. LOG-02 (Silent Async Errors) is S2 - async operations fail with no trace. LOG-03 (No Health Checks) = no way to verify the system is running.

**Action**: Add observability items (structured logging, health checks, async error capture, event attribution).

---

### DOCUMENTATION GAPS (DOC-01 through DOC-05)

| Gap ID | Title | Severity | Remediation Item | Status |
|--------|-------|----------|-----------------|--------|
| DOC-01 | Sparse Inline Explanations in Complex Modules | S3 | P5.2 (bundled) | PARTIAL |
| DOC-02 | No Architecture Decision Records (ADRs) | S3 | P5.2 (bundled) | PARTIAL |
| DOC-03 | Provider Implementation Guide Missing | S3 | P5.2 (bundled) | PARTIAL |
| DOC-04 | Configuration Reference Incomplete | S3 | P5.2 (bundled) | PARTIAL |
| DOC-05 | No Troubleshooting Guide | S3 | P5.2 (bundled) | PARTIAL |

**Risk**: P5.2 describes DIFFERENT deliverables (system overview, deployment guide) than the gap analysis identifies (ADRs, provider guide, config reference, troubleshooting). Only DOC-01 roughly maps.

**Action**: Replace P5.2's work items with DOC-01 through DOC-05 by ID.

---

## Gaps That WILL Be Dropped (Session A findings with no remediation plan)

These are all from Session A's thorough analysis. Ordered by severity and blocking impact:

| Priority | Gap ID | Title | Severity | Complexity | Blocks |
|----------|--------|-------|----------|------------|--------|
| **CRITICAL** | ORCH-10 | No Main Orchestrator Bootstrapping | S1 | M | All ORCH wiring |
| **CRITICAL** | ORCH-06 | SessionManager Events Never Persisted | S1 | S | Data persistence |
| HIGH | ORCH-01 | FailoverController Never Invoked | S1 | M | Provider resilience |
| HIGH | ORCH-03 | Router Not Integrated | S2 | M | Task routing |
| HIGH | ORCH-07 | MemoryManager Context Not Injected | S2 | S | Context awareness |
| HIGH | ORCH-09 | HeartbeatSystem & RoutineManager Never Started | S2 | S | Liveness monitoring |
| HIGH | OPS-01 | CLI Daemon Commands Are Stubs | S2 | M | Deployment, OPS-02, OPS-03, TEST-03 |
| HIGH | OPS-02 | Dashboard GET /api/jobs Returns Empty | S2 | S | Monitoring |
| HIGH | OPS-03 | No Frontend Build Output | S2 | S | Dashboard UI |
| HIGH | OPS-05 | No Structured Logging | S2 | M | Debugging |
| HIGH | LOG-02 | Silent Errors in Async Operations | S2 | S | Error visibility |
| HIGH | LOG-03 | No Health Check Instrumentation | S2 | S | Monitoring |
| HIGH | ERR-03 | FlagManager Silently Skips Corrupted Files | S2 | S | Config reliability |
| HIGH | ERR-05 | No Timeout on Event Streams | S2 | S | Hang prevention |
| HIGH | TEST-03 | CLI Commands Lack Functional Tests | S2 | M | CLI reliability |
| HIGH | TEST-04 | Dashboard Endpoints Untested | S2 | M | API reliability |
| HIGH | TEST-05 | Provider Tool Parsing Never Validated | S2 | S | Provider reliability |
| MEDIUM | SEC-2.5 | Weak Cryptographic Practices | MEDIUM | S | Encryption integrity |
| MEDIUM | SEC-2.6 | Insecure Authentication Storage | MEDIUM | S | Credential safety |
| MEDIUM | ORCH-05 | Router Uses Naive Classification | S3 | M | Routing quality |
| MEDIUM | ERR-04 | Fragile Error Classification | S2 | S | Error handling |
| MEDIUM | ERR-06 | Command Parsing Regex Incomplete | S3 | S | CLI parsing |
| LOW | ORCH-11 | Round-Robin Mode Actually Random | S4 | XS | Load balancing |
| LOW | TEST-06 | GeminiProvider checkAuth() Tests | S2 | S | Auth testing |
| LOW | TEST-07 | TelegramGateway User Allowlist Tests | S2 | S | Security testing |
| LOW | TYPE-08 | Missing Return Type Annotations | S4 | S | Type clarity |
| LOW | LOG-01 | Console.log Used Throughout | S3 | M | Log quality |
| LOW | LOG-04 | Event Stream Lacks Source Attribution | S3 | XS | Debuggability |
| LOW | ARCH-1.6 | Missing Integration Abstractions | MEDIUM | M | Provider extensibility |

**Complexity**: XS = one-liner/trivial, S = single file/focused change, M = multi-file/needs design

---

## At Risk (Implicitly bundled - may be skipped without explicit checklist)

| Gap ID | Title | Bundled Into | Risk |
|--------|-------|-------------|------|
| TYPE-02 | `err: unknown` Not Properly Narrowed | P3.2 | No specific work item |
| TYPE-03 | TaskContext History Type Is `any[]` | P3.1 | Not about `as any` |
| TYPE-04 | ProviderConfig Missing Type Hierarchy | P3.1 | Different remediation |
| TYPE-05 | Silent JSON.parse() Errors | P3.2 | S2 gap buried in S3 bundle |
| TYPE-06 | No Type Definitions for Event Payloads | P3.1 | Requires separate work |
| TYPE-07 | LLMProvider Union Types Underutilized | P3.1 | Different remediation |
| OPS-04 | GeminiProvider Unbounded Buffer | P2.1 | Not explicitly listed |
| DOC-01-05 | All Documentation Gaps | P5.2 | Different deliverables listed |
| ORCH-01 | FailoverController Never Invoked | P1.3 | CircuitBreaker != FailoverController |

---

## Remediation Addendum: Plan for Session A's Unplanned Gaps

Session B's remediation plan (REMEDIATION_PLAN.md) is fine for what it covers. These amendments add the missing remediation for Session A's 46 coded gaps that were never planned.

### Amendment 1: Add Security Hardening to Phase 0

**P0.5: Fix Weak Cryptographic Practices (SEC-2.5)**
- Replace hardcoded encryption key with env variable / key management
- Replace `Math.random()` IV with `crypto.randomBytes()`
- Add key rotation mechanism
- Add HMAC for authenticated encryption

**P0.6: Secure Credential Storage (SEC-2.6)**
- Hash stored API keys with bcrypt/argon2
- Add file permission hardening (0600)
- Add credential access audit trail

### Amendment 2: Add Orchestrator Bootstrap as Phase 1 FIRST item

**P1.0: Implement Main Orchestrator Bootstrapping (ORCH-10)**
- This is the FOUNDATION - must come before P1.1/P1.2/P1.3
- Create `boot()` method that initializes all subsystems in correct order
- Wire dependency graph (what starts first, what depends on what)
- **All other ORCH gaps depend on this**

### Amendment 3: Expand P1.3 Work Items

P1.3 currently lists 3 subsystems to wire. Add the other 7:

| Add to P1.3 | Gap |
|-------------|-----|
| FailoverController wiring | ORCH-01 |
| Router integration into ExecutionLoop | ORCH-03 |
| SessionManager event persistence | ORCH-06 |
| MemoryManager context injection | ORCH-07 |
| HeartbeatSystem/RoutineManager startup | ORCH-09 |
| Round-robin fix (trivial) | ORCH-11 |

### Amendment 4: Create Operational Tooling Phase

The remediation plan has NO phase for operational work. Insert:

**Phase 2.5: OPERATIONAL TOOLING**

| Item | Gap(s) |
|------|--------|
| Implement CLI daemon commands | OPS-01 |
| Wire dashboard /api/jobs endpoint | OPS-02 |
| Add frontend build pipeline | OPS-03 |
| Implement structured logging | OPS-05, LOG-01 |
| Add health check instrumentation | LOG-03 |
| Fix silent async errors | LOG-02 |
| Add event stream source attribution | LOG-04 |

### Amendment 5: Expand P3.2 Error Handling

| Add to P3.2 | Gap |
|-------------|-----|
| FlagManager corrupted file handling | ERR-03 |
| Replace string-based error classification | ERR-04 |
| Event stream timeout | ERR-05 |
| Command parsing regex | ERR-06 |

### Amendment 6: Expand P4.1 Test Coverage

| Add to P4.1/P4.2 | Gap |
|-------------------|-----|
| CLI functional tests | TEST-03 |
| Dashboard endpoint tests | TEST-04 |
| Provider tool parsing tests | TEST-05 |
| GeminiProvider checkAuth tests | TEST-06 |
| TelegramGateway allowlist tests | TEST-07 |

### Amendment 7: Add TYPE-specific Checklists to P3.1

Within P3.1, add individual checkboxes so nothing gets lost in the bundle:

- [ ] TYPE-01: Replace all 36 `as any` assertions
- [ ] TYPE-02: Narrow `err: unknown` in all catch blocks
- [ ] TYPE-03: Define TaskContext history types
- [ ] TYPE-04: Create ProviderConfig type hierarchy
- [ ] TYPE-05: Add try/catch to all JSON.parse() calls
- [ ] TYPE-06: Define event payload type definitions
- [ ] TYPE-07: Implement LLMProvider discriminated unions
- [ ] TYPE-08: Add return type annotations to public functions

### Amendment 8: Replace P5.2 Documentation with Specific Gaps

Replace generic documentation plan with gap-specific items:

- [ ] DOC-01: Add inline explanations to complex modules
- [ ] DOC-02: Create Architecture Decision Records
- [ ] DOC-03: Write Provider Implementation Guide
- [ ] DOC-04: Complete Configuration Reference
- [ ] DOC-05: Write Troubleshooting Guide

---

## Dependency Chain (Corrected)

```
ORCH-10 (Bootstrap) ← FOUNDATION - MUST BE FIRST
  ├── ORCH-01 (FailoverController)
  ├── ORCH-02 (RetryQueue)
  ├── ORCH-03 (Router)
  ├── ORCH-04 (AuthMonitor)
  ├── ORCH-06 (Session Events)
  ├── ORCH-07 (MemoryManager)
  ├── ORCH-08 (SteeringManager)
  └── ORCH-09 (Heartbeat/Routine)

SEC-2.1, SEC-2.2, SEC-2.5, SEC-2.6 ← SECURITY FIRST (parallel)
  └── All other phases

OPS-01 (CLI Daemon) ← BLOCKS DEPLOYMENT
  ├── OPS-02 (Dashboard API)
  ├── OPS-03 (Frontend Build)
  └── TEST-03 (CLI Tests)

LOG-02, LOG-03 ← BLOCKS PRODUCTION MONITORING
  └── Phase 6 verification
```

### Parallelization Opportunities for AI Agent Sessions

These groups are independent and can be worked simultaneously:

**Stream A (Orchestration)**: ORCH-10 → ORCH-01/02/03/04/06/07/08/09 → ORCH-05/11
**Stream B (Security)**: SEC-2.5, SEC-2.6 (parallel with Stream A)
**Stream C (Ops/Logging)**: OPS-01 → OPS-02/03 + OPS-05/LOG-01/02/03/04 (after Phase 1)
**Stream D (Error/Type)**: ERR-03/04/05/06 + TYPE-02-08 (after Phase 1)
**Stream E (Tests)**: TEST-03/04/05/06/07 (after Streams A+C deliver testable code)
**Stream F (Docs)**: DOC-01-05 (anytime, no dependencies)

---

## Pre-Implementation Verification Checklist

Before starting any phase, verify:

- [ ] Has ORCH-10 been added as Phase 1's first item?
- [ ] Are SEC-2.5 and SEC-2.6 in Phase 0?
- [ ] Does P1.3 now list all 11 ORCH gaps (not just 3)?
- [ ] Is there a Phase for OPS gaps (CLI, Dashboard, Frontend)?
- [ ] Is there a Phase for LOG gaps (Structured Logging, Health Checks)?
- [ ] Does P3.2 list ERR-03 through ERR-06 explicitly?
- [ ] Does P4.1 list TEST-03 through TEST-07 explicitly?
- [ ] Does P3.1 have individual checkboxes for TYPE-01 through TYPE-08?
- [ ] Does P5.2 reference DOC-01 through DOC-05 by ID?
- [ ] Is ORCH-11 (trivial fix) scheduled somewhere?
- [ ] Does Phase 6 Security Audit verify SEC-2.5 and SEC-2.6?
