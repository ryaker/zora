> **NOTE (2026-02-14):** Many gaps described in this document have been resolved.
> The authoritative status is in `gaps/wsjf-scores.json` — run `./gaps/tracker.sh stream`
> to see current state. Code descriptions below may reference old/stub implementations
> that have since been replaced with working code.

## 9. TESTING GAPS (7 gaps)

### Root Cause Analysis

**Problem:** The Zora framework has 927 tests across 51 files, providing good unit test coverage. However, critical integration testing gaps prevent confidence in multi-provider failover, retry mechanisms, and operational workflows. Integration tests are minimal (only 3 files in `/tests/integration/`), and no tests validate the orchestration layer where components interact. Additionally, provider tool parsing, CLI commands, dashboard endpoints, and security-critical features lack functional validation, creating blind spots for production-critical functionality.

**Risk Profile:**
- **Orchestration (S2):** No e2e tests that boot Orchestrator + submit tasks + verify routing; integration issues only discovered in production
- **Failover/Retry (S2):** Failover logic never validated; bugs hide until production; no tests exercise FailoverController.handleFailure() or RetryQueue retries
- **Tool Parsing (S2):** Regex patterns for XML/JSON tool calls written speculatively; tool parsing fails on real output; users can't invoke tools
- **CLI & Dashboard (S2):** Commands and endpoints exist untested; changes break silently; users hit regressions
- **Security (S2):** TelegramGateway allowlist logic untested; unauthorized users could steer tasks

---

#### TEST-01: No Integration Tests for Orchestration

**Severity:** S2 (High)
**Effort:** 4h
**Blocking:** Yes
**Category:** INTEGRATION TESTING
**Files Affected:** `/tests/integration/` (need new file)
**Impact Level:** 5/5

**Description:**

The Orchestrator is the central component that boots the entire system, submits tasks to providers, routes through failover logic, persists to storage, and manages sessions. However, there is no end-to-end integration test that validates this critical workflow. Currently only unit tests validate individual Orchestrator methods in isolation.

**Recommended Solution:**
Create comprehensive integration test suite in `/tests/integration/orchestrator.test.ts` with test cases validating:
- Orchestrator bootstrap with all dependencies (SessionManager → Router → FailoverController → AuthMonitor)
- Task submission end-to-end (task → routing → provider → completion)
- Event emission (submit, route, execute, complete events)
- Session persistence and recovery across restart
- Failover integration (primary failure → secondary provider)
- Provider routing validation (correct provider selected by capability)

**Success Criteria:**
- `/tests/integration/orchestrator.test.ts` created with 10+ test cases
- All critical Orchestrator workflows have integration tests
- Tests validate component interactions
- Tests verify task lifecycle (submit → route → execute → complete)
- Integration test suite passes in CI/CD with < 10s duration
- Code coverage for Orchestrator integration paths > 80%

---

#### TEST-02: No Failover/Retry Scenario Tests

**Severity:** S2 (High)
**Effort:** 3h
**Blocking:** Medium
**Category:** FAILOVER TESTING
**Files Affected:** `/tests/integration/failover.test.ts` (new)
**Impact Level:** 5/5

**Description:**

The FailoverController and RetryQueue implement critical logic that routes tasks to alternate providers when primary fails, with exponential backoff retries. However, this critical logic has zero test coverage validating it works in realistic scenarios with actual provider failures, retry timing, and state persistence.

**Recommended Solution:**
Create `/tests/integration/failover.test.ts` with test cases validating:
- Failover triggered when primary provider fails
- Retry executed with exponential backoff (verify timing: 1s, 2s, 4s, 8s)
- Task abandoned after max retries exceeded
- Concurrent task failures trigger failover independently
- Retry state persists across orchestrator restart
- Provider selection respects previous failures
- Error classification determines retry eligibility

**Success Criteria:**
- `/tests/integration/failover.test.ts` with 6+ test cases
- Tests validate failover triggered on provider errors
- Tests validate retry queue processing with exponential backoff timing
- Tests verify max retries enforced and retry state persisted
- Integration test suite passes in CI/CD
- Test coverage for FailoverController.handleFailure() > 85%

---

#### TEST-03: CLI Commands Lack Functional Tests

**Severity:** S2 (High)
**Effort:** 3h
**Blocking:** No
**Category:** FUNCTIONAL TESTING
**Files Affected:** `/tests/cli/` (new directory)
**Impact Level:** 4/5

**Description:**

The Zora CLI implements critical commands: `start`, `stop`, `status`, `memory`, `steer`, `skill`, and `audit`. Currently, only registration is tested (command exists, has help text). Command behavior is completely untested—changes break silently without warning.

**Recommended Solution:**
Create `/tests/cli/` directory with command tests validating:
- `start` command: port validation, server startup verification
- `stop` command: graceful shutdown, cleanup validation
- `status` command: format and content validation
- `memory` command: memory output and limits
- `steer` command: flag application and persistence
- `skill` command: enable/disable verification
- `audit` command: log query and output validation
- Error handling: invalid flags, missing args, help display

**Success Criteria:**
- `/tests/cli/` directory with tests for all 8 commands
- Each command has 3+ test cases covering happy path, edge cases, errors
- Tests validate command output format and content
- Tests verify command effects persist (restarts, state changes)
- All CLI tests pass in CI/CD
- Test coverage for CLI commands > 85%

---

#### TEST-04: Dashboard Endpoints Untested

**Severity:** S2 (High)
**Effort:** 3h
**Blocking:** No
**Category:** API TESTING
**Files Affected:** `/tests/api/` (new directory)
**Impact Level:** 4/5

**Description:**

The Dashboard Server exposes REST API endpoints for querying orchestrator state, but these critical endpoints lack tests. API is used by dashboard UI to fetch job status, health information, metrics, and operational data. Without tests, API changes can break dashboard functionality silently.

**Recommended Solution:**
Create `/tests/api/` directory with endpoint tests validating:
- Health check endpoint (format, accuracy, component status)
- Jobs endpoint (list, pagination, filtering, field validation)
- Auth login endpoint (valid/invalid creds, token format)
- Metrics endpoint (structure, values)
- Sessions endpoint (data accuracy, access control)
- Auth middleware (token validation, expiry, 401/403 responses)
- Error handling (404, 500, malformed requests)

**Success Criteria:**
- `/tests/api/` directory with tests for all endpoints
- Each endpoint has 3+ test cases covering happy path, edge cases, errors, auth
- Tests validate response structure and HTTP status codes
- Tests verify authentication middleware works
- All API tests pass in CI/CD
- Test coverage for Dashboard endpoints > 85%

---

#### TEST-05: Provider Tool Parsing Never Validated Against Real Output

**Severity:** S2 (High)
**Effort:** 2h
**Blocking:** Medium
**Category:** PROVIDER VALIDATION
**Files Affected:** `/tests/providers/tool-parsing.test.ts` (new)
**Impact Level:** 5/5

**Description:**

Providers implement regex patterns to parse tool calls from provider output (XML, JSON formats). These patterns were written speculatively without validation against real provider responses. When real tool output arrives, parsing fails silently and users can't invoke tools.

**Recommended Solution:**
- Collect real provider output and create fixtures in `/tests/fixtures/`:
  - Real Gemini XML tool call format
  - Real Claude tool use format
  - Real OpenAI function call format
  - Malformed/edge case responses
- Create `/tests/providers/tool-parsing.test.ts` with test cases validating:
  - Parsing real Gemini/Claude/OpenAI tool call formats
  - Multiple tool calls in single response
  - Tool args with special characters and escaping
  - Malformed tool calls (invalid JSON, missing args)
  - Text content mixed with tool calls
  - Provider-specific format variations

**Success Criteria:**
- Real provider output collected from Gemini, Claude, OpenAI APIs
- `/tests/fixtures/` with 10+ real provider responses
- `/tests/providers/tool-parsing.test.ts` with 15+ test cases
- All parsing regex patterns validated against real output
- Tests cover special characters, escaping, malformed responses
- Test coverage for tool parsing > 90%

---

#### TEST-06: GeminiProvider `checkAuth()` Tests Missing

**Severity:** S2 (High)
**Effort:** 1h
**Blocking:** No
**Category:** PROVIDER VALIDATION
**Files Affected:** `/tests/providers/gemini-auth.test.ts` (new)
**Impact Level:** 3/5

**Description:**

The GeminiProvider implements `checkAuth()` to validate that the Gemini CLI is properly authenticated. However, authentication tests are missing. Only binary existence is tested, not actual authentication state. Invalid tokens go undetected until task execution fails.

**Recommended Solution:**
Create `/tests/providers/gemini-auth.test.ts` with test cases validating:
- Valid authentication check returns true
- Invalid token returns false
- Binary not found returns false
- Network errors handled gracefully
- Timeout after 5 seconds
- Retry on transient failures
- Error classification (auth vs network vs binary issues)

**Success Criteria:**
- `/tests/providers/gemini-auth.test.ts` created with 7+ test cases
- Tests validate successful authentication, invalid tokens, network errors
- Tests validate error classification
- All auth tests pass in CI/CD
- Test coverage for GeminiProvider.checkAuth() > 85%

---

#### TEST-07: TelegramGateway User Allowlist Logic Untested

**Severity:** S2 (High)
**Effort:** 2h
**Blocking:** No
**Category:** SECURITY TESTING
**Files Affected:** `/tests/gateways/telegram-allowlist.test.ts` (new)
**Impact Level:** 4/5

**Description:**

The TelegramGateway implements security-critical allowlist logic: only allow specified users to steer tasks. This allowlist logic has zero test coverage. Unauthorized users could potentially steer tasks if the allowlist is not enforced correctly.

**Recommended Solution:**
Create `/tests/gateways/telegram-allowlist.test.ts` with test cases validating:
- Allowed user can steer tasks
- Denied user cannot steer tasks
- User allowlist validation returns correct true/false
- Allowlist loaded from config file
- Empty allowlist handled gracefully
- Malformed allowlist handled safely
- User ID matching is case-sensitive
- Multiple concurrent steering attempts from mixed users
- Allowlist can be updated at runtime
- Audit logging of steering attempts (allowed and denied)

**Success Criteria:**
- `/tests/gateways/telegram-allowlist.test.ts` created with 12+ test cases
- Tests validate allowed users accepted and denied users blocked
- Tests verify allowlist loading and configuration
- Tests validate concurrent access control and audit logging
- All allowlist tests pass in CI/CD
- Test coverage for TelegramGateway access control > 90%

---

### Summary Table: Testing Gaps

| Gap ID | Issue | Severity | Effort | Blocking | Priority |
|--------|-------|----------|--------|----------|----------|
| **TEST-01** | No Integration Tests for Orchestration | S2 | 4h | Yes | P1 |
| **TEST-02** | No Failover/Retry Scenario Tests | S2 | 3h | Medium | P1 |
| **TEST-03** | CLI Commands Lack Functional Tests | S2 | 3h | No | P2 |
| **TEST-04** | Dashboard Endpoints Untested | S2 | 3h | No | P2 |
| **TEST-05** | Provider Tool Parsing Never Validated | S2 | 2h | Medium | P1 |
| **TEST-06** | GeminiProvider `checkAuth()` Tests Missing | S2 | 1h | No | P2 |
| **TEST-07** | TelegramGateway User Allowlist Logic Untested | S2 | 2h | No | P2 |

**Total Effort:** 18 hours
**Critical Path (P1):** 9 hours (TEST-01, TEST-02, TEST-05)
**Production Blockers:** 2 gaps (TEST-01, TEST-02)

---

