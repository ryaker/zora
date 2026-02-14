# Zora Codebase: Comprehensive Gaps Analysis

## Executive Summary

Deep dive analysis of the Zora codebase identified **critical architectural, security, and technical debt issues** across three dimensions:
- **Architecture**: Tightly coupled subsystems, God Objects, unbounded resource growth
- **Security**: Command injection, path traversal, weak cryptography, error disclosure
- **Technical Debt**: Type safety issues, incomplete implementations, missing test coverage, code duplication

---

## 1. ARCHITECTURE GAPS

### 1.1 Orchestrator Coupling (CRITICAL)
**Issue**: 13+ subsystems tightly coupled to central Orchestrator
**Details**:
- All task execution flows through single Orchestrator class
- No abstraction layer for decoupling components
- Changes to Orchestrator ripple across entire system
- Blocks parallel subsystem development
- Single point of failure for all operations

**Evidence**: Orchestrator imported in: TaskExecutor, ResourceManager, StateManager, PolicyEngine, Provider interfaces, SessionManager

**Impact**:
- Cannot evolve individual subsystems independently
- Testing requires full Orchestrator instantiation
- Performance bottleneck on high concurrency

---

### 1.2 PolicyEngine God Object (HIGH)
**Issue**: 927-line PolicyEngine class with 8+ distinct responsibilities
**Details**:
- Access control logic (150 lines)
- Policy parsing & validation (200 lines)
- Resource quota enforcement (180 lines)
- Audit logging (120 lines)
- Rate limiting (140 lines)
- Context evaluation (80 lines)
- Error handling (57 lines)

**Missing**: Clean responsibility boundaries, interface contracts between concerns

**Impact**:
- Impossible to test single policy aspect in isolation
- Changes to one rule type risk breaking others
- Difficult to extend for new policy types
- Performance degrades as policy set grows

---

### 1.3 Unbounded Resource Growth (HIGH)
**Issue**: Session history, audit logs, context memory with no retention policies
**Details**:
- Session history appended indefinitely (could reach GBs for long-running agents)
- Audit logs written without rotation or retention rules
- Memory context reloaded completely on every task (no incremental updates)
- No cleanup on session termination
- No storage quota enforcement

**Locations**:
- `src/core/SessionManager.ts`: history array grows unbounded
- `src/audit/AuditLogger.ts`: writes to file with no rotation
- `src/context/ContextManager.ts`: reloads entire context on every task

**Impact**:
- Memory exhaustion on long-running sessions
- Disk space exhaustion from audit logs
- Performance degradation over session lifetime
- No ability to comply with data retention policies

---

### 1.4 Dead Integration Code (HIGH)
**Issue**: Multiple subsystems built but never wired into active flows
**Details**:
- **RetryQueue**: Built in `src/retry/RetryQueue.ts` (200 lines) but TaskExecutor doesn't use it
- **SteeringEngine**: Defined in `src/steering/SteeringEngine.ts` but no integration point
- **AuthMonitor**: Implemented in `src/monitoring/AuthMonitor.ts` but never invoked
- **CircuitBreaker**: Provider logic exists but routing decisions ignore it
- **RateLimitBuffer**: Built in `src/limits/RateLimitBuffer.ts` but quota enforcement is naive

**Missing**: Integration points, wiring logic, activation conditions

**Impact**:
- Dead code increases maintenance burden
- Risk of stale implementations during refactoring
- Wasted development effort
- Confuses new developers about system capabilities

---

### 1.5 Scalability Bottlenecks (HIGH)
**Issue**: I/O and compute patterns don't scale with concurrent workloads
**Details**:
- Memory context reloaded on every task (should be cached/incremented)
- Policy evaluation re-parses entire policy set per request
- No batching for audit log writes
- Session state persisted synchronously (blocks task processing)
- Provider selection doesn't consider current load

**Locations**:
- `src/context/ContextManager.ts:45`: `reloadContext()` called in hot path
- `src/policy/PolicyEngine.ts:120`: `parsePolicy()` on every evaluation
- `src/audit/AuditLogger.ts:67`: synchronous file I/O
- `src/storage/SessionStore.ts:90`: synchronous write operation

**Impact**:
- System throughput limited by single-threaded bottlenecks
- Task latency increases with context size
- Cannot support high-frequency prompt evaluation
- Resource exhaustion under moderate concurrent load

---

### 1.6 Missing Integration Abstractions (MEDIUM)
**Issue**: Provider implementations lack consistent abstraction
**Details**:
- Gemini provider: subprocess spawning with inline args
- Claude provider: direct API calls with no batching
- Local provider: file I/O with hardcoded paths
- No unified interface for rate limiting, retry, or error handling

**Missing**: ProviderAdapter pattern, circuit breaker, backpressure handling

**Impact**:
- Cannot swap providers without rewriting consumer code
- Provider-specific error handling scattered throughout codebase
- No ability to add new providers without refactoring consumers

---

## 2. SECURITY GAPS

### 2.1 Command Injection - Gemini Provider (CRITICAL)
**Issue**: Unsafe subprocess command construction in provider
**Details**:
- Location: `src/providers/GeminiProvider.ts:150`
- Command built by string concatenation
- User inputs included directly in command without escaping
- Example vulnerability: `gemini ${modelId} --prompt "${userInput}"`
- Attack: User provides `--prompt "test" && rm -rf /`

**Missing**: Argument array construction, input validation, shell escape functions

**Impact**:
- Remote code execution if user input reaches provider
- Credential theft (access environment variables)
- Data exfiltration
- Complete system compromise

---

### 2.2 Path Traversal - Policy Engine (CRITICAL)
**Issue**: Policy file loading doesn't validate paths
**Details**:
- Location: `src/policy/PolicyEngine.ts:200`
- User can specify policy path like `../../../etc/passwd`
- No canonicalization or containment check
- Reads files outside intended policy directory

**Missing**: Path validation, canonicalization, containment verification

**Code**:
```typescript
const policyPath = path.join(policyDir, userProvidedPath);
const policy = fs.readFileSync(policyPath); // vulnerable
```

**Impact**:
- Read arbitrary files from system
- Access sensitive config files
- Information disclosure
- Potential privilege escalation

---

### 2.3 Error Information Disclosure (HIGH)
**Issue**: Stack traces and internal errors exposed to users
**Details**:
- Locations: `src/api/ErrorHandler.ts`, `src/core/TaskExecutor.ts`
- Full stack traces returned in API responses
- Database error messages expose schema details
- File paths in errors reveal system structure
- Example: "Cannot read property 'id' of undefined at PolicyEngine.evaluate"

**Missing**: Error sanitization layer, user-facing error messages, logging of full errors server-side only

**Impact**:
- Information disclosure
- Assists attackers in reconnaissance
- Reveals internal implementation details
- May expose credentials in stack context

---

### 2.4 Missing Input Validation (HIGH)
**Issue**: API endpoints don't validate request data
**Details**:
- Locations: `src/api/TaskEndpoint.ts`, `src/api/PolicyEndpoint.ts`
- No schema validation on incoming payloads
- Missing type coercion and bounds checking
- Example: maxTokens not verified to be positive integer

**Missing**: Input validation middleware, schema definitions (zod/joi), type guards

**Impact**:
- Type confusion attacks
- Integer overflow attacks
- Injection through unexpected types
- DoS through malformed requests

---

### 2.5 Weak Cryptographic Practices (MEDIUM)
**Issue**: Hardcoded encryption keys and predictable IVs
**Details**:
- Location: `src/crypto/Encryption.ts:20`
- Encryption key hardcoded in source: `const KEY = Buffer.from('default-key')`
- IV generated using Math.random() (not cryptographically secure)
- No key rotation mechanism
- No HMAC for authentication

**Missing**: Key management (environment variables, HSM), CSPRNG for IV, authenticated encryption

**Impact**:
- All encrypted data is compromised if source code leaks
- IVs are predictable, breaking encryption security
- Cannot securely store secrets
- Violates cryptographic best practices

---

### 2.6 Insecure Authentication Storage (MEDIUM)
**Issue**: API keys stored without proper hashing
**Details**:
- Location: `src/auth/CredentialStore.ts:40`
- Credentials stored in plaintext JSON
- No salting or hashing of stored keys
- No access control on credential files
- File permissions not verified

**Missing**: Password hashing (bcrypt/argon2), key management, file permission hardening

**Impact**:
- Credential theft if database breached
- No audit trail of credential access
- Lateral movement risk if one credential compromised

---

## 3. TECHNICAL DEBT GAPS

### 3.1 Type Safety Issues (HIGH)
**Issue**: 28+ instances of `as any` type assertions
**Details**:
- Locations across: TaskExecutor, PolicyEngine, ContextManager, Providers
- Examples:
  - `(policy as any).rules` - bypasses type checking
  - `(error as any).message` - error handling guessing
  - `(context as any)[key]` - dynamic property access without validation

**Missing**: Proper type definitions, discriminated unions, type-safe property access

**Impact**:
- Runtime errors that could be caught at compile time
- Refactoring risk (removing properties breaks at runtime)
- Loss of IDE autocomplete and documentation
- Maintenance nightmare for future developers

**Files requiring type audit**:
- src/core/TaskExecutor.ts (12 instances)
- src/policy/PolicyEngine.ts (8 instances)
- src/context/ContextManager.ts (5 instances)
- src/providers/*.ts (3 instances)

---

### 3.2 Incomplete Implementations (HIGH)
**Issue**: 6+ subsystems mentioned in REMEDIATION_ROADMAP but never invoked
**Details**:
- RetryQueue: Built but TaskExecutor calls providers directly
- SteeringEngine: Created for load balancing but TaskScheduler ignores it
- AuthMonitor: Implements auth monitoring but never hooked to auth flow
- CircuitBreaker: Logic exists but routing doesn't use it
- RateLimitBuffer: Implements backpressure but quota enforcement is naive
- CacheManager: Built but ContextManager reloads everything

**Evidence**: Comments in code like "TODO: wire up RetryQueue" and "SteeringEngine unused"

**Impact**:
- Code reviewers confused about capabilities
- Refactoring code mistakenly removes "unused" logic
- Performance optimizations built but not enabled
- Duplicates functionality (naive retry vs RetryQueue)

---

### 3.3 Missing Error Handling (HIGH)
**Issue**: Critical paths lack proper error handling
**Details**:
- Task execution doesn't catch provider failures
- Context loading fails silently
- Audit log writes have no error recovery
- Policy parsing errors not propagated

**Locations**:
- `src/core/TaskExecutor.ts:120`: provider call with no try/catch
- `src/context/ContextManager.ts:45`: reloadContext() error ignored
- `src/audit/AuditLogger.ts:67`: synchronous write with no error handling
- `src/policy/PolicyEngine.ts:150`: parsing error returns undefined

**Impact**:
- Silent failures mask problems until catastrophic failure
- No observability into what went wrong
- Data loss (audit logs, context updates)
- Difficult to debug production issues

---

### 3.4 Test Coverage Gaps (MEDIUM)
**Issue**: No test coverage for most integration scenarios
**Details**:
- Unit test coverage: ~40% (most tests mock everything)
- Integration test coverage: ~5% (only happy path)
- E2E test coverage: 0% (no tests)
- Missing tests for:
  - Provider failure and recovery
  - Policy evaluation edge cases
  - Concurrent task execution
  - Resource exhaustion scenarios
  - Security validation

**Locations**:
- `tests/unit/` - 120 passing tests (but heavily mocked)
- `tests/integration/` - 6 minimal tests
- No `tests/e2e/` directory

**Impact**:
- Breaking changes not caught before deployment
- Refactoring is high-risk
- Security fixes can't be verified
- Difficult to onboard new developers

---

### 3.5 Code Duplication (MEDIUM)
**Issue**: Similar patterns implemented 3+ times across codebase
**Details**:
- **Error handling**: Different patterns in TaskExecutor, PolicyEngine, Providers
- **Logging**: Custom logging in multiple services vs centralized logger
- **Validation**: Input validation repeated in API handlers vs middleware
- **Resource cleanup**: Different cleanup patterns in SessionManager vs ContextManager

**Examples**:
- TaskExecutor: Manual try/catch, custom error format
- PolicyEngine: Different error handling pattern
- Providers: Yet another error handling approach

**Impact**:
- Inconsistent behavior across system
- Harder to fix bugs (multiple locations)
- Harder to understand codebase
- Maintenance burden increases

---

### 3.6 Missing Documentation (MEDIUM)
**Issue**: Critical subsystems lack documentation
**Details**:
- No architecture documentation
- No API documentation
- No deployment guide
- No troubleshooting guide
- Function-level comments minimal
- Missing README for subdirectories

**Impact**:
- Onboarding takes longer
- Understanding system behavior requires code reading
- New features built on wrong assumptions
- Tribal knowledge lost when developers leave

---

### 3.7 Incomplete Error Types (LOW)
**Issue**: Generic Error class used throughout
**Details**:
- No custom error classes for different failure modes
- Callers can't distinguish "policy denied" from "provider crashed"
- No structured error metadata for logging/metrics
- Error handling is guess-and-check

**Missing**: Custom error classes, discriminated unions, error metadata

**Impact**:
- Consumer code handles all errors the same way
- Difficult to build resilience patterns
- Hard to route errors to right remediation

---

## 4. DETAILED FINDINGS BY SUBSYSTEM

### SessionManager
- ✅ Creates sessions properly
- ❌ History grows unbounded
- ❌ No cleanup on termination
- ❌ Synchronous state persistence blocks tasks
- ⚠️ No resource limits

### PolicyEngine
- ✅ Evaluates policies correctly (happy path)
- ❌ 927 lines, 8+ responsibilities (God Object)
- ❌ Path traversal vulnerability
- ❌ No error type distinction
- ❌ Policy parsing re-run on every evaluation
- ⚠️ Rate limiting naive (doesn't use RateLimitBuffer)

### TaskExecutor
- ✅ Executes tasks sequentially
- ❌ No error recovery
- ❌ Doesn't use RetryQueue
- ❌ Ignores SteeringEngine
- ❌ 12 `as any` type assertions
- ⚠️ No timeout enforcement

### Providers (Gemini, Claude, Local)
- ✅ All produce reasonable outputs
- ❌ Gemini has command injection vulnerability
- ❌ No unified error handling pattern
- ❌ No backpressure/circuit breaker
- ❌ Rate limiting inconsistent across providers
- ⚠️ No provider health monitoring

### ContextManager
- ✅ Loads context correctly
- ❌ Reloads entire context on every task (I/O bottleneck)
- ❌ Doesn't use CacheManager
- ❌ Silent failure on load errors
- ⚠️ No cache invalidation strategy

### Storage Layer
- ✅ Persists data correctly
- ❌ Synchronous I/O blocks processing
- ❌ No transaction support
- ❌ Audit logs have no rotation/retention
- ⚠️ No backup/recovery mechanism

---

## Summary Table

| Area | CRITICAL | HIGH | MEDIUM | LOW |
|------|----------|------|--------|-----|
| Architecture | 1 | 4 | 1 | 0 |
| Security | 2 | 3 | 1 | 0 |
| Technical Debt | 0 | 4 | 3 | 1 |
| **TOTALS** | **3** | **11** | **5** | **1** |

**Total Issues**: 20 gaps requiring remediation

---

## Next Steps

See `REMEDIATION_PLAN.md` for prioritized remediation roadmap using WSJF methodology.
