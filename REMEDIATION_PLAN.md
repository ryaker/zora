# Zora Remediation Roadmap: WSJF-Prioritized Plan

## WSJF Methodology

Each item scored on:
- **Value**: System impact and capability improvement (1-10)
- **Time-Criticality**: Urgency to resolve before it cascades (1-10)
- **Risk-Reduction**: Security/stability improvement (1-10)
- **Effort**: Relative implementation complexity (1-10)

**WSJF Score = (Value + Time-Criticality + Risk-Reduction) / Effort**

Higher scores = higher priority for immediate action

---

## PHASE 0: SECURITY LOCKDOWN (Weeks 1-2)

All CRITICAL security issues must be resolved before any other work. These block production use.

### P0.1: Fix Command Injection - Gemini Provider (CRITICAL SECURITY)
**WSJF Score: (8 + 10 + 10) / 2 = 14.0**
- **Value**: 8 (prevents RCE)
- **Time-Criticality**: 10 (RCE is critical)
- **Risk-Reduction**: 10 (eliminates RCE attack vector)
- **Effort**: 2 (straightforward fix)

**Work**:
1. Identify all subprocess calls in GeminiProvider.ts:150
2. Replace string concatenation with argument array: `spawn(cmd, [arg1, arg2], {shell: false})`
3. Add input validation for model IDs and prompts (allowlist format)
4. Add unit tests for command injection attempts
5. Test with malicious payloads: `; rm -rf /`, `$(evil)`, `` `evil` ``

**Dependencies**: None
**Acceptance Criteria**:
- No string concatenation for command building
- All subprocess calls use array form without `shell: true`
- Unit tests verify injection attempts are escaped
- Code review sign-off on security changes

---

### P0.2: Fix Path Traversal - Policy Engine (CRITICAL SECURITY)
**WSJF Score: (8 + 10 + 10) / 2 = 14.0**
- **Value**: 8 (prevents arbitrary file read)
- **Time-Criticality**: 10 (can read sensitive files)
- **Risk-Reduction**: 10 (eliminates directory traversal)
- **Effort**: 2 (straightforward fix)

**Work**:
1. Add path validation in PolicyEngine.ts:200
2. Canonicalize user-provided paths: `path.resolve(path.normalize(userPath))`
3. Verify canonical path starts with policy directory: `if (!canonical.startsWith(policyDir))`
4. Return error if path escapes policy directory
5. Add unit tests for path traversal attempts: `../../../etc/passwd`, `//etc/passwd`, etc.

**Dependencies**: None
**Acceptance Criteria**:
- All policy paths validated before file access
- Path traversal attempts rejected with clear error
- Unit tests verify containment for various attack patterns
- Code review sign-off

---

### P0.3: Sanitize Error Messages (HIGH SECURITY)
**WSJF Score: (7 + 9 + 9) / 2 = 12.5**
- **Value**: 7 (reduces reconnaissance surface)
- **Time-Criticality**: 9 (attacker aids in progress)
- **Risk-Reduction**: 9 (prevents information disclosure)
- **Effort**: 2 (middleware fix)

**Work**:
1. Create ErrorSanitizer middleware in `src/api/ErrorSanitizer.ts`
2. Intercept all error responses (catch handlers, middleware)
3. Map internal errors to user-safe messages:
   - Full stack trace → "An error occurred. Reference ID: UUID"
   - Database errors → "Data access error"
   - File path errors → Generic "File operation failed"
4. Log full error details server-side only (structured logging with ID)
5. Add unit tests for error message stripping

**Dependencies**: None
**Acceptance Criteria**:
- No stack traces in API responses
- No file paths, database queries, or internal details exposed
- Reference IDs allow server log correlation
- All error cases covered (thrown errors, promises, async)

---

### P0.4: Add Input Validation Layer (HIGH SECURITY)
**WSJF Score: (7 + 8 + 8) / 3 = 7.7**
- **Value**: 7 (prevents injection/type confusion)
- **Time-Criticality**: 8 (reduces attack surface)
- **Risk-Reduction**: 8 (validates all inputs)
- **Effort**: 3 (needs schema definitions)

**Work**:
1. Add schema validation library (zod preferred for TypeScript)
2. Define schemas for all API inputs:
   - TaskRequest: `{task: string, maxTokens: positive int, timeout: positive int, ...}`
   - PolicyRequest: `{policy: object, mode: enum('enforce'|'dry-run')}`
   - SessionRequest: `{userId: uuid, config: object}`
3. Create validation middleware that validates before handlers
4. Add detailed error messages for validation failures
5. Add unit tests for each schema (happy path + edge cases)

**Dependencies**: None
**Acceptance Criteria**:
- All API endpoints validated against schemas
- Invalid requests rejected with 400 + descriptive error
- Type coercion applied (strings to numbers)
- Unit tests cover schema validation

---

## PHASE 1: ARCHITECTURAL STABILITY (Weeks 3-4)

After security is locked down, fix architectural issues that prevent development velocity.

### P1.1: Decouple PolicyEngine Responsibilities (HIGH ARCHITECTURE)
**WSJF Score: (9 + 7 + 6) / 4 = 5.5**
- **Value**: 9 (enables independent policy subsystems)
- **Time-Criticality**: 7 (blocks new policy features)
- **Risk-Reduction**: 6 (reduces change risk)
- **Effort**: 4 (requires refactoring)

**Work**:
1. Extract 8 responsibilities into separate modules:
   - `AccessControl.ts`: Permission checking (~150 lines)
   - `PolicyParser.ts`: Parsing & validation (~200 lines)
   - `QuotaEnforcer.ts`: Resource quota (~180 lines)
   - `AuditManager.ts`: Audit logging (~120 lines)
   - `RateLimiter.ts`: Rate limiting (~140 lines)
   - `ContextEvaluator.ts`: Context evaluation (~80 lines)
   - `PolicyErrorHandler.ts`: Error handling (~57 lines)
   - `PolicyOrchestrator.ts`: Coordinates above modules
2. Define clean interfaces between modules
3. Create factory functions for policy building
4. Update callers to use PolicyOrchestrator facade
5. Add integration tests between modules

**Dependencies**: P0.1, P0.2, P0.3, P0.4 (security foundation)
**Acceptance Criteria**:
- Each module has single responsibility
- No circular dependencies
- Public interfaces are minimal and stable
- Tests pass for each module independently
- No performance regression

---

### P1.2: Eliminate Orchestrator Coupling (HIGH ARCHITECTURE)
**WSJF Score: (9 + 8 + 7) / 5 = 4.8**
- **Value**: 9 (enables subsystem independence)
- **Time-Criticality**: 8 (blocks scaling)
- **Risk-Reduction**: 7 (reduces failure domains)
- **Effort**: 5 (pervasive changes)

**Work**:
1. Identify all Orchestrator dependencies (13 subsystems)
2. Create abstract interfaces for each dependency (e.g., `ITaskScheduler`, `IResourceManager`)
3. Inject dependencies into subsystem constructors instead of reaching to Orchestrator
4. Create factory for building dependency graph
5. Update subsystems to use injected dependencies
6. Add integration tests with mock dependencies
7. Remove Orchestrator references from subsystem code

**Dependencies**: P1.1 (PolicyEngine refactored first as test case)
**Acceptance Criteria**:
- All 13 subsystems have injected dependencies
- No subsystem imports Orchestrator class
- Mock tests pass for each subsystem
- Integration tests verify interaction patterns
- No performance regression

---

### P1.3: Wire Unused Subsystems Into Active Flows (HIGH ARCHITECTURE)
**WSJF Score: (8 + 7 + 8) / 3 = 7.7**
- **Value**: 8 (enables built optimizations)
- **Time-Criticality**: 7 (blocks performance improvements)
- **Risk-Reduction**: 8 (enables monitoring/resilience)
- **Effort**: 3 (integration work)

**Work**:
1. RetryQueue wiring:
   - Update TaskExecutor to catch failures
   - Call RetryQueue.enqueue() on retriable errors
   - Execute queued tasks on retry triggers
   - Add tests for retry scenarios

2. SteeringEngine wiring:
   - Update TaskScheduler to call SteeringEngine.selectProvider()
   - Pass load metrics to steering
   - Honor steering decisions for provider selection
   - Add load balancing tests

3. AuthMonitor wiring:
   - Hook AuthMonitor into auth flow (LoginHandler, TokenValidator)
   - Monitor auth failures and suspicious patterns
   - Add tests for auth monitoring

4. CircuitBreaker activation:
   - Update provider routing to check circuit state
   - Trip circuit on repeated failures
   - Implement exponential backoff recovery
   - Add tests for circuit breaker behavior

5. RateLimitBuffer activation:
   - Update QuotaEnforcer to use RateLimitBuffer
   - Implement backpressure (queue tasks when at limit)
   - Add buffer drain metrics
   - Add tests for buffering behavior

6. CacheManager activation:
   - Update ContextManager to use CacheManager
   - Implement cache invalidation strategy
   - Measure cache hit rates
   - Add tests for cache behavior

**Dependencies**: P1.1, P1.2 (architectural cleanup)
**Acceptance Criteria**:
- RetryQueue is invoked on provider failures
- SteeringEngine actively selects providers
- AuthMonitor logs all auth events
- CircuitBreaker prevents cascading failures
- RateLimitBuffer prevents quota overages
- CacheManager reduces I/O by 80%+
- Integration tests verify all wiring
- No duplicate functionality remains

---

## PHASE 2: RESOURCE MANAGEMENT (Week 5)

Enable production deployment by managing unbounded resource growth.

### P2.1: Implement Resource Limits and Retention (HIGH ARCHITECTURE)
**WSJF Score: (9 + 8 + 7) / 3 = 8.0**
- **Value**: 9 (prevents exhaustion attacks)
- **Time-Criticality**: 8 (impacts uptime)
- **Risk-Reduction**: 7 (improves stability)
- **Effort**: 3 (configuration + enforcement)

**Work**:
1. Define retention policies:
   - Session history: Keep last 1000 entries, delete older than 30 days
   - Audit logs: Keep last 100K events, delete older than 90 days
   - Context memory: Keep last 10 versions, delete older than 7 days
   - Temporary files: Clean up on session termination

2. Implement SessionManager cleanup:
   - Add retention policy to SessionManager
   - Delete old history entries on session operations
   - Signal cleanup on session termination
   - Add tests for cleanup behavior

3. Implement AuditLogger rotation:
   - Add log rotation (daily or size-based)
   - Compress old logs
   - Enforce retention period
   - Add tests for rotation

4. Implement ContextManager versioning:
   - Keep only last N context versions
   - Implement atomic version switching
   - Add cleanup on version rotation
   - Add tests for version management

5. Implement file cleanup:
   - Temporary files deleted on session end
   - Failed task artifacts cleaned
   - Add verification that cleanup happened

**Dependencies**: P1.1, P1.2 (after decoupling)
**Acceptance Criteria**:
- Memory usage remains bounded during long sessions
- Audit logs don't exceed disk quota
- Retention policies enforced consistently
- Cleanup tested and verified
- No data loss during cleanup

---

### P2.2: Fix I/O Bottlenecks (MEDIUM ARCHITECTURE)
**WSJF Score: (8 + 7 + 6) / 3 = 7.0**
- **Value**: 8 (improves throughput)
- **Time-Criticality**: 7 (limits scale)
- **Risk-Reduction**: 6 (improves reliability)
- **Effort**: 3 (refactoring)

**Work**:
1. Make SessionStore async:
   - Convert `fs.writeFileSync()` to `fs.promises.writeFile()`
   - Update SessionManager to await writes
   - Add error handling for write failures
   - Add tests for async persistence

2. Cache policy evaluation:
   - Store parsed policies in memory cache
   - Invalidate cache on policy updates
   - Measure cache hit rate (target 95%+)
   - Add tests for caching

3. Batch audit log writes:
   - Buffer audit entries (max 100 or 5-second timeout)
   - Write buffer to disk asynchronously
   - Handle write failures gracefully
   - Add tests for batching

4. Implement context caching:
   - Don't reload context on every task
   - Detect context changes and reload incrementally
   - Use CacheManager for caching
   - Add tests for cache invalidation

**Dependencies**: P1.1, P1.2, P1.3 (after wiring CacheManager)
**Acceptance Criteria**:
- No synchronous I/O in hot paths
- Policy parsing cache hit rate 95%+
- Audit log batching reduces write frequency 10x
- Context reloading is incremental
- Latency tests pass (no regression)

---

## PHASE 3: TYPE SAFETY & RELIABILITY (Week 6)

Eliminate type safety issues to prevent runtime errors.

### P3.1: Eliminate `as any` Type Assertions (HIGH TECHNICAL DEBT)
**WSJF Score: (8 + 6 + 7) / 3 = 7.0**
- **Value**: 8 (prevents runtime errors)
- **Time-Criticality**: 6 (not blocking now)
- **Risk-Reduction**: 7 (catches errors at compile time)
- **Effort**: 3 (type work)

**Work**:
1. Audit all 28 `as any` locations (see GAPS_ANALYSIS.md)
2. For each, create proper types:
   - TaskExecutor: Define strict Task, Result types
   - PolicyEngine: Define strict Policy, Rule, Context types
   - ContextManager: Define Context types with type-safe property access
   - Providers: Define Provider interface with strict return types

3. Replace type assertions with proper types:
   - Before: `(policy as any).rules`
   - After: `const policy: IPolicy = ...; policy.rules`

4. Use discriminated unions for variant types:
   - Error types: `type Result = {type: 'success', value: T} | {type: 'error', error: Error}`
   - Provider responses: `type Response = {status: 'success', data: T} | {status: 'error', error: string}`

5. Add type guards for dynamic properties:
   ```typescript
   function hasProperty<K extends PropertyKey>(obj: unknown, prop: K): obj is Record<K, unknown> {
     return typeof obj === 'object' && obj !== null && prop in obj
   }
   ```

6. Update tests to match new types

**Dependencies**: P0.1-P0.4 (security foundation)
**Acceptance Criteria**:
- Zero `as any` assertions remaining
- All types are narrow and non-null
- Refactoring changes caught by type checker
- Tests compile and pass
- No runtime type errors in integration tests

---

### P3.2: Improve Error Handling (HIGH TECHNICAL DEBT)
**WSJF Score: (8 + 7 + 8) / 3 = 7.7**
- **Value**: 8 (prevents silent failures)
- **Time-Criticality**: 7 (affects debugging)
- **Risk-Reduction**: 8 (catches errors)
- **Effort**: 3 (error structure)

**Work**:
1. Create custom error classes:
   ```typescript
   class PolicyError extends Error { code: string; context: object }
   class ProviderError extends Error { code: string; retryable: boolean }
   class ValidationError extends Error { code: string; field: string }
   ```

2. Update error locations in critical paths:
   - TaskExecutor: Wrap provider calls in try/catch, convert to ProviderError
   - ContextManager: Catch load errors, convert to ContextError
   - AuditLogger: Catch write errors, don't silently fail
   - PolicyEngine: Parse errors convert to PolicyError

3. Add error handling tests:
   - Provider failure → task fails with ProviderError
   - Context load failure → task retried
   - Audit write failure → logged as warning (continues)
   - Policy parse failure → returns PolicyError with details

**Dependencies**: P1.1, P1.3 (structured error handling)
**Acceptance Criteria**:
- All errors are typed (not generic Error)
- Errors include context and codes for routing
- Error handlers distinguish error types
- Errors are logged with full context
- Error recovery tests pass

---

### P3.3: Add Provider Error Handling (MEDIUM TECHNICAL DEBT)
**WSJF Score: (7 + 6 + 7) / 2 = 10.0**
- **Value**: 7 (prevents cascading failures)
- **Time-Criticality**: 6 (affects reliability)
- **Risk-Reduction**: 7 (improves stability)
- **Effort**: 2 (consistent patterns)

**Work**:
1. Create ProviderErrorHandler interface
2. Implement consistent error handling in each provider:
   - GeminiProvider: Handle subprocess errors, timeout errors, API errors
   - ClaudeProvider: Handle API errors, auth errors, rate limit errors
   - LocalProvider: Handle file I/O errors, timeout errors

3. Each provider should return Result type:
   ```typescript
   type ProviderResult =
     | {status: 'success', data: string}
     | {status: 'error', code: string, message: string, retryable: boolean}
   ```

4. TaskExecutor uses result to decide: retry/fail/fallback

**Dependencies**: P3.1, P3.2 (types and errors)
**Acceptance Criteria**:
- Providers return typed results
- Errors include retryable flag
- TaskExecutor handles retryable errors
- All provider error cases tested

---

## PHASE 4: TEST COVERAGE (Week 7)

Build safety net for future changes.

### P4.1: Add Integration Tests (MEDIUM TECHNICAL DEBT)
**WSJF Score: (7 + 5 + 6) / 3 = 6.0**
- **Value**: 7 (enables safe refactoring)
- **Time-Criticality**: 5 (not blocking)
- **Risk-Reduction**: 6 (catches regressions)
- **Effort**: 3 (test writing)

**Work**:
1. Create integration test suite in `tests/integration/`:
   - Task execution (success, failure, timeout cases)
   - Provider selection and fallback
   - Policy evaluation with different contexts
   - Concurrent task execution
   - Resource limit enforcement
   - Audit logging accuracy

2. Test error scenarios:
   - Provider failure → retry → fallback
   - Policy denied → task fails
   - Resource limit exceeded → queued/rejected
   - Invalid context → error

3. Test edge cases:
   - Empty input
   - Very large input
   - Concurrent identical requests
   - Rapid session creation/deletion

**Dependencies**: P1.1-P1.3, P3.1-P3.3 (stable architecture)
**Acceptance Criteria**:
- 20+ integration test cases
- All success paths covered
- All error paths covered
- Tests run in < 30 seconds
- CI/CD runs tests on every commit

---

### P4.2: Add E2E Tests (LOW TECHNICAL DEBT)
**WSJF Score: (6 + 4 + 5) / 3 = 5.0**
- **Value**: 6 (verifies user scenarios)
- **Time-Criticality**: 4 (nice to have)
- **Risk-Reduction**: 5 (catches integration bugs)
- **Effort**: 3 (orchestration)

**Work**:
1. Create E2E test suite that exercises full system:
   - Create session → execute task → get result
   - Multiple concurrent tasks
   - Provider fallback scenarios
   - Long-running session stability

2. Run against deployed system (staging environment)

**Dependencies**: P4.1 (after integration tests)
**Acceptance Criteria**:
- 5+ E2E test scenarios
- Tests verify real behavior
- Tests run in < 2 minutes
- Can run against staging/production

---

## PHASE 5: CODE QUALITY (Week 8)

Reduce long-term maintenance burden.

### P5.1: Eliminate Code Duplication (LOW TECHNICAL DEBT)
**WSJF Score: (6 + 3 + 4) / 3 = 4.3**
- **Value**: 6 (reduces maintenance)
- **Time-Criticality**: 3 (not urgent)
- **Risk-Reduction**: 4 (consistency)
- **Effort**: 3 (refactoring)

**Work**:
1. Identify duplication patterns:
   - Error handling (TaskExecutor vs PolicyEngine vs Providers)
   - Logging (custom logging vs centralized)
   - Validation (API handlers vs middleware)
   - Resource cleanup (SessionManager vs ContextManager)

2. Create shared abstractions:
   - ErrorHandler utility
   - StructuredLogger utility
   - InputValidator utility
   - ResourceCleaner utility

3. Update subsystems to use shared code

4. Verify no behavior change

**Dependencies**: P3.1-P3.3 (types and errors stable)
**Acceptance Criteria**:
- No duplicate error handling patterns
- All logging through StructuredLogger
- All validation through InputValidator
- Tests pass without behavior change

---

### P5.2: Add Documentation (LOW TECHNICAL DEBT)
**WSJF Score: (5 + 3 + 3) / 2 = 5.5**
- **Value**: 5 (improves onboarding)
- **Time-Criticality**: 3 (nice to have)
- **Risk-Reduction**: 3 (clarifies intent)
- **Effort**: 2 (writing)

**Work**:
1. Create architecture documentation:
   - System overview diagram
   - Subsystem responsibilities
   - Data flow diagrams
   - Deployment architecture

2. Create API documentation (JSDoc comments for all public functions)

3. Create deployment guide:
   - Prerequisites
   - Installation steps
   - Configuration options
   - Troubleshooting

4. Create subsystem READMEs for major modules

**Dependencies**: None (can do in parallel)
**Acceptance Criteria**:
- Architecture doc covers all 8 major subsystems
- API doc covers all public functions
- Deployment guide is step-by-step
- New developers can understand system from docs

---

## PHASE 6: PRODUCTION READINESS (Week 9)

Verify system is production-ready.

### P6.1: Security Audit (CRITICAL)
**WSJF Score: (9 + 9 + 10) / 2 = 14.0**
- **Value**: 9 (prevents breaches)
- **Time-Criticality**: 9 (must complete before production)
- **Risk-Reduction**: 10 (comprehensive audit)
- **Effort**: 2 (verification)

**Work**:
1. Verify all P0 fixes are complete:
   - Command injection fixed ✓
   - Path traversal fixed ✓
   - Error message sanitization ✓
   - Input validation ✓

2. Perform manual security testing:
   - Attempt command injection
   - Attempt path traversal
   - Attempt type confusion
   - Attempt DoS through large inputs
   - Attempt to leak error information

3. Run SAST tools:
   - npm audit (vulnerability scanning)
   - SonarQube (static analysis)
   - Snyk (dependency vulnerabilities)

4. Document security audit results

**Dependencies**: All prior phases (comprehensive check)
**Acceptance Criteria**:
- Manual security tests all fail (attacks blocked)
- No critical/high vulnerabilities in SAST results
- All known vulnerabilities remediated
- Security audit sign-off

---

### P6.2: Load Testing (MEDIUM)
**WSJF Score: (7 + 6 + 5) / 3 = 6.0**
- **Value**: 7 (verifies scalability)
- **Time-Criticality**: 6 (before launch)
- **Risk-Reduction**: 5 (catches bottlenecks)
- **Effort**: 3 (test setup)

**Work**:
1. Create load test scenarios:
   - 100 concurrent tasks
   - 1000 task execution/hour
   - Large context (100MB)
   - Long-running sessions (24+ hours)

2. Monitor during load test:
   - Memory usage (should be bounded)
   - CPU usage
   - Disk I/O
   - Task latency (p50, p95, p99)
   - Provider error rate

3. Identify and fix bottlenecks

**Dependencies**: P2.1, P2.2 (resource limits and I/O optimization)
**Acceptance Criteria**:
- 100 concurrent tasks without memory leak
- Latency p99 < 5 seconds
- No provider error rate > 5%
- Load test results documented

---

## Remediation Priority Summary

### By WSJF Score (Highest First)
1. **P0.1** Command Injection (14.0) - WEEK 1
2. **P0.2** Path Traversal (14.0) - WEEK 1
3. **P6.1** Security Audit (14.0) - WEEK 9
4. **P0.3** Error Sanitization (12.5) - WEEK 1
5. **P1.1** Decouple PolicyEngine (5.5) - WEEK 3
6. **P0.4** Input Validation (7.7) - WEEK 1
7. **P2.1** Resource Limits (8.0) - WEEK 5
8. **P1.3** Wire Unused Subsystems (7.7) - WEEK 4
9. **P3.2** Error Handling (7.7) - WEEK 6
10. **P2.2** I/O Bottlenecks (7.0) - WEEK 5
11. **P3.1** Eliminate `as any` (7.0) - WEEK 6
12. **P3.3** Provider Error Handling (10.0) - WEEK 6
13. **P1.2** Decouple Orchestrator (4.8) - WEEK 4
14. **P5.1** Eliminate Duplication (4.3) - WEEK 8
15. **P5.2** Documentation (5.5) - WEEK 8
16. **P4.1** Integration Tests (6.0) - WEEK 7
17. **P6.2** Load Testing (6.0) - WEEK 9
18. **P4.2** E2E Tests (5.0) - WEEK 7

---

## Phase Timeline

```
Week 1: PHASE 0 (Security)
  - P0.1: Command Injection
  - P0.2: Path Traversal
  - P0.3: Error Sanitization
  - P0.4: Input Validation

Week 2: Continue Phase 0 + Start Phase 1
  - Finish Phase 0 verification
  - Start P1.1: Decouple PolicyEngine

Week 3: PHASE 1 (Architecture)
  - P1.1: Decouple PolicyEngine (cont)
  - Start P1.2: Decouple Orchestrator

Week 4: Continue Phase 1
  - P1.2: Decouple Orchestrator (cont)
  - P1.3: Wire Unused Subsystems

Week 5: PHASE 2 (Resources)
  - P2.1: Resource Limits
  - P2.2: I/O Bottlenecks

Week 6: PHASE 3 (Types & Reliability)
  - P3.1: Eliminate `as any`
  - P3.2: Error Handling
  - P3.3: Provider Error Handling

Week 7: PHASE 4 (Tests)
  - P4.1: Integration Tests
  - P4.2: E2E Tests

Week 8: PHASE 5 (Quality)
  - P5.1: Eliminate Duplication
  - P5.2: Documentation

Week 9: PHASE 6 (Production)
  - P6.1: Security Audit
  - P6.2: Load Testing
  - Final verification
```

---

## Success Criteria - Production Ready

✅ All CRITICAL security issues fixed and verified
✅ Architecture decoupled (subsystems testable independently)
✅ Resource growth bounded (memory, disk usage)
✅ Type safety improved (no `as any` assertions)
✅ Error handling comprehensive (typed errors with context)
✅ Test coverage > 70%
✅ Load tests pass (100 concurrent tasks, 24h stability)
✅ Security audit completed
✅ Documentation complete
✅ No high/critical vulnerabilities in SAST results

---

## Notes

- **Security Phase (Week 1)** is blocking - nothing else starts until complete
- **Architectural Phase (Weeks 2-4)** enables velocity - unblocks all future development
- **Resource/Reliability Phases (Weeks 5-6)** enable scale
- **Testing/Quality Phases (Weeks 7-8)** enable safe change
- **Production Phase (Week 9)** is verification

Each phase depends on prior phases being complete. Within phases, some work can be parallelized:
- P0.1 and P0.2 can run in parallel (different subsystems)
- P1.1, P1.2 sequential (Orchestrator depends on PolicyEngine refactor)
- P4.1 and P5.2 can run in parallel (tests and documentation)

---

## Question: Who Implements What?

This roadmap assumes:
- **Senior Engineer** leads phases 0, 1, 2 (architecture/security decisions)
- **Full team** implements phases 0, 1, 2 (high visibility, knowledge sharing)
- **Distributed implementation** for phases 3-5 (less critical, can be parallelized)
- **QA/Security** leads phases 4, 6 (tests, audit)

Expected crew: 2-3 engineers can complete this in 9 weeks with full focus.
Single engineer can complete in ~12-15 weeks with part-time work.
