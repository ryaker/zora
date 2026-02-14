> **NOTE (2026-02-14):** Many gaps described in this document have been resolved.
> The authoritative status is in `gaps/wsjf-scores.json` — run `./gaps/tracker.sh stream`
> to see current state. Code descriptions below may reference old/stub implementations
> that have since been replaced with working code.

## 7. TYPE SAFETY GAPS (8 gaps)

### Root Cause Analysis

**Problem:** The Zora codebase relies heavily on TypeScript escape hatches (`as any`, `catch (err: any)`) to work around type system constraints. This approach sacrifices compile-time safety for short-term development convenience, creating maintenance debt and runtime vulnerability. Event definitions lack structure, provider configurations lack hierarchy, and critical functions lack explicit return types.

**Risk Profile:**
- **Immediate:** Refactoring across modules introduces silent type errors
- **Operational:** Runtime type mismatches cause exceptions in production
- **Maintenance:** IDE autocompletion fails; refactoring tools unreliable
- **Onboarding:** New developers cannot reason about code contracts

---

#### TYPE-01: 36 `as any` Assertions in Providers

**Severity:** S3 (Medium)
**Effort:** 3h
**Blocking:** N
**Files Affected:** 3
**Impact Level:** 2/5

**Description:**

Event content is coerced with `as any` in multiple provider implementations, bypassing type checking entirely. This occurs across Claude, Gemini, and Ollama providers when processing event responses.

**Current State:**
- `claude-provider.ts`: Lines where event content is assigned with `as any` (e.g., event payload casting)
- `gemini-provider.ts`: Response parsing assigns `as any` to avoid type validation
- `ollama-provider.ts`: Event content structures bypass interface definitions

**Problem:**
- No per-type interfaces for different event content shapes
- Callers cannot trust event structure; runtime validation missing
- Type narrowing impossible downstream; all consumers must re-type-assert
- Refactoring event structures risks breaking all three providers silently

**Solution:**
1. Create discriminated union for event payloads:
   ```typescript
   type TextEventPayload = { type: 'text'; content: string };
   type ToolCallEventPayload = { type: 'tool_call'; tool: string; args: Record<string, unknown> };
   type ErrorEventPayload = { type: 'error'; message: string; code: string };
   type EventPayload = TextEventPayload | ToolCallEventPayload | ErrorEventPayload;
   ```

2. Replace `as any` assertions with explicit payload construction:
   ```typescript
   // Before:
   const event = { content: response } as any;

   // After:
   const event: TextEventPayload = { type: 'text', content: response };
   ```

3. Update provider interfaces to use typed payloads

**Verification:**
- TypeScript strict mode reports zero `as any` in provider files
- Event consumers use discriminated union narrowing (e.g., `if (payload.type === 'text')`)
- Providers emit events with explicit type information

---

#### TYPE-02: `err: unknown` Not Properly Narrowed

**Severity:** S3 (Medium)
**Effort:** 2h
**Blocking:** N
**Files Affected:** 8+
**Impact Level:** 2/5

**Description:**

Error handling throughout the codebase catches errors as `unknown` or `any` without proper type narrowing. Eight or more locations use `catch (err: any)` instead of applying `instanceof Error` checks or custom type guards.

**Current State:**
- Catch blocks access `.message`, `.stack` without verifying type
- Non-Error objects (strings, numbers) thrown by third-party code cause crashes
- Error classification logic (e.g., `ERR-04`) cannot safely inspect error details
- Logging may fail when attempting to serialize non-standard error objects

**Problem:**
- `catch (err: any)` defeats error handling safety
- No distinction between typed errors (Error, HttpError, TimeoutError) and arbitrary objects
- Downstream code assumes properties that may not exist
- Type guard helpers not extracted to reusable utilities

**Solution:**
1. Create error type guard helpers:
   ```typescript
   function isError(value: unknown): value is Error {
     return value instanceof Error;
   }

   function isHttpError(value: unknown): value is HttpError {
     return value instanceof HttpError;
   }

   function getErrorMessage(err: unknown): string {
     if (isError(err)) return err.message;
     if (typeof err === 'string') return err;
     return 'Unknown error';
   }
   ```

2. Update all catch blocks:
   ```typescript
   // Before:
   catch (err: any) {
     console.log(err.message); // May crash
   }

   // After:
   catch (err: unknown) {
     if (isError(err)) {
       logger.error({ message: err.message, stack: err.stack });
     } else {
       logger.error({ message: getErrorMessage(err) });
     }
   }
   ```

3. Add `noImplicitAny: true` to tsconfig to enforce explicit types in catch clauses

**Verification:**
- Zero `catch (err: any)` clauses remaining
- All error handling uses type guards before property access
- Tests confirm handling of non-Error thrown values

---

#### TYPE-03: TaskContext History Type Is `any[]`

**Severity:** S3 (Medium)
**Effort:** 4h
**Blocking:** N
**Files Affected:** 2
**Impact Level:** 2/5

**Description:**

The `TaskContext.history` field is typed as `any[]`, preventing type-safe access to historical events. This undermines the event system's ability to provide guarantees about event structure and timing.

**Current State:**
- `TaskContext` interface defines `history?: any[]`
- Code cannot rely on history containing valid `AgentEvent` instances
- No discriminated union narrowing possible on historical events
- Memory/context injection code (ORCH-07) cannot validate history shape

**Problem:**
- Callers must re-validate and re-type events accessed from history
- No compile-time guarantee that history contains Events
- Corrupted or malformed history entries cause runtime failures
- Refactoring event definitions requires manual validation code updates

**Solution:**
1. Define complete event hierarchy with discriminated union:
   ```typescript
   interface BaseAgentEvent {
     id: string;
     timestamp: number;
     source: 'provider' | 'system' | 'user';
     sequence: number;
   }

   interface TextEvent extends BaseAgentEvent {
     type: 'text';
     content: string;
   }

   interface ToolCallEvent extends BaseAgentEvent {
     type: 'tool_call';
     tool: string;
     args: Record<string, unknown>;
   }

   interface ErrorEvent extends BaseAgentEvent {
     type: 'error';
     message: string;
     code: string;
   }

   type AgentEvent = TextEvent | ToolCallEvent | ErrorEvent;
   ```

2. Update TaskContext:
   ```typescript
   interface TaskContext {
     history: AgentEvent[]; // No longer any[]
   }
   ```

3. Replace history access with type-safe narrowing:
   ```typescript
   // Before:
   const lastEvent = context.history[0] as any;
   console.log(lastEvent.content);

   // After:
   const lastEvent = context.history[0];
   if (lastEvent && lastEvent.type === 'text') {
     console.log(lastEvent.content);
   }
   ```

**Verification:**
- `TaskContext.history: AgentEvent[]` (not `any[]`)
- All history access uses discriminated union narrowing
- Type errors reported if accessing `.content` on non-text events

---

#### TYPE-04: ProviderConfig Missing Type Hierarchy

**Severity:** S3 (Medium)
**Effort:** 2h
**Blocking:** N
**Files Affected:** 1
**Impact Level:** 2/5

**Description:**

Provider configuration uses a single flat `ProviderConfig` interface for all providers (Claude, Gemini, Ollama). This prevents type-specific validation and IDE assistance for provider-specific settings.

**Current State:**
- Single `ProviderConfig` with union of all possible fields
- No way to enforce that Claude-specific fields only appear in Claude config
- Type checking cannot catch configuration mistakes (e.g., Ollama-specific field in Claude config)
- Config validation must check fields manually at runtime

**Problem:**
- Configuration polymorphism not reflected in type system
- IDEs cannot offer autocomplete for provider-specific settings
- Typos in config keys not caught at compile time
- Documentation must describe all fields; reader must filter by provider

**Solution:**
1. Create base and provider-specific config types:
   ```typescript
   interface BaseProviderConfig {
     type: 'claude' | 'gemini' | 'ollama';
     maxTokens?: number;
     temperature?: number;
   }

   interface ClaudeProviderConfig extends BaseProviderConfig {
     type: 'claude';
     apiKey: string;
     model: 'claude-3-opus' | 'claude-3-sonnet' | 'claude-3-haiku';
   }

   interface GeminiProviderConfig extends BaseProviderConfig {
     type: 'gemini';
     apiKey: string;
     model: 'gemini-pro' | 'gemini-pro-vision';
   }

   interface OllamaProviderConfig extends BaseProviderConfig {
     type: 'ollama';
     baseUrl: string;
     model: string;
     pullIfMissing?: boolean;
   }

   type ProviderConfig = ClaudeProviderConfig | GeminiProviderConfig | OllamaProviderConfig;
   ```

2. Update provider instantiation for type safety:
   ```typescript
   // Before:
   const config: ProviderConfig = getUserConfig();
   const provider = createProvider(config); // Cannot verify type match

   // After:
   const config: ProviderConfig = getUserConfig();
   if (config.type === 'claude' && config.type in claudeConfig) {
     const provider = createClaudeProvider(config);
   }
   ```

3. Use discriminated union in config loading/validation

**Verification:**
- TypeScript reports error if `claudeConfig.pullIfMissing` used (Ollama-only field)
- IDEs offer provider-specific fields in autocomplete
- Runtime config validation uses type guards

---

#### TYPE-05: Silent `JSON.parse()` Errors in Providers

**Severity:** S2 (High)
**Effort:** 1h
**Blocking:** N (but high-risk)
**Files Affected:** 3
**Impact Level:** 4/5

**Description:**

Multiple providers silently swallow JSON parsing errors, losing tool invocations and other critical structured data. Errors are caught and ignored, preventing both diagnosis and recovery.

**Current State:**
- `gemini-provider.ts` lines 256, 272: `try { JSON.parse() } catch { }`
- `ollama-provider.ts` line 171: Silent JSON error
- Malformed JSON from provider APIs is dropped without logging
- Tool calls silently disappear; user receives no notification

**Problem:**
- Production failures go undetected
- Debugging is nearly impossible; no error record
- Tool invocations lost permanently (cannot retry)
- User sees request succeed but tool never executes

**Solution:**
1. Create error event instead of silencing:
   ```typescript
   // Before:
   try {
     const toolCall = JSON.parse(response);
     // use toolCall
   } catch {
     // Silent failure
   }

   // After:
   let toolCall: unknown;
   try {
     toolCall = JSON.parse(response);
   } catch (err) {
     this.emit('error', {
       type: 'parse_error',
       message: `Failed to parse JSON: ${err instanceof Error ? err.message : String(err)}`,
       rawContent: response,
       source: 'gemini-provider'
     });
     return;
   }

   // Validate structure
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

2. Add validation helpers:
   ```typescript
   function isValidToolCall(value: unknown): value is ToolCall {
     return (
       typeof value === 'object' &&
       value !== null &&
       'tool' in value &&
       'args' in value &&
       typeof (value as any).tool === 'string'
     );
   }
   ```

3. Update error handling to emit events with context

**Verification:**
- Zero `catch { }` blocks in provider files (all errors logged or re-emitted)
- Integration tests confirm error events emitted for malformed JSON
- Audit logs show parse failures with raw content for diagnosis

---

#### TYPE-06: No Type Definitions for Event Payloads

**Severity:** S3 (Medium)
**Effort:** 2h
**Blocking:** N
**Files Affected:** 5
**Impact Level:** 2/5

**Description:**

Event payloads throughout the system are typed as `Record<string, any>`, providing no structure or safety. Consumers cannot rely on content shape; IDE assistance unavailable.

**Current State:**
- Event payload is generic object; no schema enforcement
- Different event types (text, tool call, error) mixed without distinction
- Payload structure documented only in comments or READMEs
- Consumers must implement their own validation logic

**Problem:**
- Runtime errors when payload structure assumed incorrectly
- Refactoring payloads requires finding all consumers manually
- IDE offers no completion; developers must remember field names
- No compile-time guarantee of payload validity

**Solution:**
1. Create payload type definitions (similar to TYPE-01's discriminated union):
   ```typescript
   interface TextPayload {
     type: 'text';
     content: string;
     metadata?: Record<string, unknown>;
   }

   interface ToolCallPayload {
     type: 'tool_call';
     tool: string;
     args: Record<string, unknown>;
     callId: string;
   }

   interface ToolResultPayload {
     type: 'tool_result';
     callId: string;
     result: unknown;
     error?: string;
   }

   interface ErrorPayload {
     type: 'error';
     message: string;
     code: string;
     details?: Record<string, unknown>;
   }

   type EventPayload = TextPayload | ToolCallPayload | ToolResultPayload | ErrorPayload;
   ```

2. Update event emission:
   ```typescript
   // Before:
   this.emit('event', { type: 'text', content: 'hello' } as any);

   // After:
   const payload: TextPayload = { type: 'text', content: 'hello' };
   this.emit('event', payload);
   ```

3. Update consumers to use narrowed types:
   ```typescript
   onEvent(event: { payload: EventPayload }) {
     if (event.payload.type === 'text') {
       console.log(event.payload.content); // TS knows this is string
     }
   }
   ```

**Verification:**
- All event emissions typed against `EventPayload` discriminated union
- IDE offers field suggestions for each payload type
- TypeScript reports error if accessing non-existent fields on specific types

---

#### TYPE-07: LLMProvider Union Types Underutilized

**Severity:** S3 (Medium)
**Effort:** 2h
**Blocking:** N
**Files Affected:** 1
**Impact Level:** 2/5

**Description:**

The `LLMProvider` type forms a union of provider implementations, but this union is not leveraged for exhaustiveness checking or type-safe provider selection. Code treats providers generically instead of using discriminated union patterns.

**Current State:**
- `type LLMProvider = Claude | Gemini | Ollama` defined but not used for narrowing
- Provider selection logic doesn't use type guards
- No compile-time check for handling all provider types
- Factory functions lack exhaustiveness validation

**Problem:**
- Adding new provider type doesn't trigger compile errors in handler code
- Logic gaps only discovered at runtime
- Code cannot safely use provider-specific features (type narrowing fails)
- Refactoring provider interface affects all consumers uncaught

**Solution:**
1. Create discriminated union with provider type field:
   ```typescript
   interface BaseProvider {
     type: 'claude' | 'gemini' | 'ollama';
     invoke(prompt: string): Promise<string>;
   }

   interface ClaudeProvider extends BaseProvider {
     type: 'claude';
     model: string;
   }

   interface GeminiProvider extends BaseProvider {
     type: 'gemini';
     vision?: boolean;
   }

   interface OllamaProvider extends BaseProvider {
     type: 'ollama';
     pullIfMissing: boolean;
   }

   type LLMProvider = ClaudeProvider | GeminiProvider | OllamaProvider;
   ```

2. Use exhaustiveness checking in handlers:
   ```typescript
   // Before:
   function handleProvider(provider: LLMProvider) {
     if (provider.type === 'claude') { /* ... */ }
     // Compiler doesn't verify all types handled
   }

   // After:
   function handleProvider(provider: LLMProvider): void {
     switch (provider.type) {
       case 'claude':
         // Claude-specific logic
         break;
       case 'gemini':
         // Gemini-specific logic
         break;
       case 'ollama':
         // Ollama-specific logic
         break;
       default:
         const exhaustive: never = provider;
         throw new Error(`Unhandled provider: ${exhaustive}`);
     }
   }
   ```

3. Add type guards for safe provider casting:
   ```typescript
   function isClaude(provider: LLMProvider): provider is ClaudeProvider {
     return provider.type === 'claude';
   }

   function isGemini(provider: LLMProvider): provider is GeminiProvider {
     return provider.type === 'gemini';
   }
   ```

**Verification:**
- TypeScript reports "not all code paths return value" if switch case missing
- Provider factory uses exhaustiveness checking
- Type guards used in provider-specific logic paths

---

#### TYPE-08: Missing Return Type Annotations

**Severity:** S4 (Low)
**Effort:** 1h
**Blocking:** N
**Files Affected:** 20
**Impact Level:** 1/5

**Description:**

Approximately 20 functions lack explicit return type annotations. This includes critical functions like `_parseToolCalls()`, `_mapEventPayload()`, and various utility functions. Without annotations, return types are inferred and may change silently during refactoring.

**Current State:**
- Functions use implicit return type inference
- IDE shows inferred types but lacks explicit documentation
- Callers cannot rely on return type stability across versions
- Refactoring may accidentally change return type unnoticed

**Problem:**
- Return type changes silently if implementation modified
- Callers may depend on return type not being `any` or `undefined`
- Code review difficult; return contract unclear
- Type narrowing downstream depends on understanding return type

**Solution:**
1. Add explicit return type annotations to all functions:
   ```typescript
   // Before:
   function _parseToolCalls(response: string) {
     // Implementation...
   }

   // After:
   function _parseToolCalls(response: string): ToolCall[] {
     // Implementation...
   }
   ```

2. Include return type in signature, even if inferred:
   ```typescript
   function extractEventType(event: AgentEvent): string {
     return event.type;
   }

   async function fetchProvider(id: string): Promise<LLMProvider | null> {
     // Implementation...
   }

   function mapErrorToPayload(error: unknown): ErrorPayload {
     // Implementation...
   }
   ```

3. Use `noImplicitAny: true` and `declaration: true` in tsconfig to enforce

**Verification:**
- TypeScript strict mode reports zero implicit any function return types
- `tsc --noImplicitAny` produces no errors
- All exported functions have explicit return types

---

### Summary Table: Type Safety Gaps

| Gap ID | Title | Severity | Effort | Files | Risk |
|--------|-------|----------|--------|-------|------|
| TYPE-01 | 36 `as any` Assertions | S3 | 3h | 3 | Silent type errors on refactor |
| TYPE-02 | `err: unknown` Not Narrowed | S3 | 2h | 8+ | Crashes on non-Error throws |
| TYPE-03 | TaskContext History `any[]` | S3 | 4h | 2 | Event validation gaps |
| TYPE-04 | ProviderConfig Missing Hierarchy | S3 | 2h | 1 | Config validation at runtime only |
| TYPE-05 | Silent JSON.parse() Errors | S2 | 1h | 3 | Tool invocations lost |
| TYPE-06 | No Event Payload Types | S3 | 2h | 5 | Runtime payload errors |
| TYPE-07 | LLMProvider Underutilized Unions | S3 | 2h | 1 | Missing exhaustiveness checks |
| TYPE-08 | Missing Return Annotations | S4 | 1h | 20 | Implicit type changes |

**Cumulative Effort:** 17 hours
**Cumulative Impact:** 22/40 (medium quality degradation)

---

