# APPENDIX D: Type Safety Patterns

## Purpose

This appendix provides side-by-side comparisons of anti-patterns and solutions for the 8 TYPE-* gaps. Each pattern demonstrates how to eliminate unsafe `any` types, improve type narrowing, and leverage TypeScript's type system for better IDE support, refactoring safety, and catching errors at compile-time rather than runtime.

---

## TYPE-01: `as any` Assertions (36 instances)

### Anti-Pattern: Type Erasure via `as any`

```typescript
// ❌ BAD: Loses all type information
const event = someData as any;
const result = provider.execute(event);
// IDE has no autocomplete for event properties
// Errors discovered only at runtime
// Refactoring is unsafe - renaming properties breaks silently
```

**Problem:** The `as any` assertion disables TypeScript's type checking, making refactoring dangerous and IDE support useless.

### Solution: Discriminated Union Types

```typescript
// ✅ GOOD: Type-safe event handling
type AgentEvent =
  | { type: 'text'; content: TextPayload; timestamp: number }
  | { type: 'tool_call'; content: ToolCallPayload; timestamp: number }
  | { type: 'error'; content: ErrorPayload; timestamp: number };

interface TextPayload {
  text: string;
  confidence: number;
}

interface ToolCallPayload {
  toolName: string;
  args: Record<string, unknown>;
}

interface ErrorPayload {
  message: string;
  code: string;
}

const handleEvent = (event: AgentEvent): void => {
  switch (event.type) {
    case 'text':
      console.log(event.content.text); // IDE knows .text exists
      break;
    case 'tool_call':
      console.log(event.content.toolName); // IDE knows .toolName exists
      break;
    case 'error':
      console.log(event.content.code); // IDE knows .code exists
      break;
  }
};
```

**Benefits:**
- IDE autocomplete works for all event properties
- TypeScript catches property mismatches at compile time
- Refactoring is safe: renaming properties breaks the build
- Documentation is inline via type definitions

**Affected Files:** All provider implementations (`claude.ts`, `gemini.ts`, `ollama.ts`)

**Effort:** 3 hours to refactor 36 instances

---

## TYPE-02: Error Type Narrowing

### Anti-Pattern: Generic Error Catching

```typescript
// ❌ BAD: Can't safely access error properties
try {
  await provider.execute(task);
} catch (err: any) {
  // Is err a Network error? Auth error? Something else?
  logger.error(`Failed: ${err.message}`); // err.message might not exist
}

// Or even worse:
try {
  await provider.execute(task);
} catch (err) {
  // err is still 'unknown' - must cast unsafely
  const message = (err as Error).message; // Dangerous!
}
```

**Problem:** TypeScript 4.0+ returns `unknown` from catch clauses, but developers resort to unsafe type assertions.

### Solution: Type Guard Functions

```typescript
// ✅ GOOD: Type guard function
function isError(e: unknown): e is Error {
  return e instanceof Error;
}

function isNetworkError(e: unknown): e is NetworkError {
  return e instanceof NetworkError;
}

interface NetworkError extends Error {
  statusCode: number;
  retryable: boolean;
}

async function executeWithErrorHandling(task: Task): Promise<TaskResult> {
  try {
    return await provider.execute(task);
  } catch (err) {
    if (isNetworkError(err)) {
      logger.warn(`Network error (code ${err.statusCode}), retrying...`);
      return await executeWithErrorHandling(task); // Can safely retry
    }

    if (isError(err)) {
      logger.error(`Execution failed: ${err.message}`);
      throw err;
    }

    // If we reach here, err is something weird (not an Error)
    logger.error(`Unknown error type: ${typeof err}`);
    throw new Error(`Unknown error occurred`);
  }
}
```

**Benefits:**
- Type narrowing with `isError()` eliminates unsafe casts
- IDE knows error properties after type guard passes
- Network errors can be handled separately (with retry logic)
- Compile-time safety for all code paths

**Affected Files:** Error handling in all services (execution-loop.ts, orchestrator.ts, etc.)

**Effort:** 2 hours

---

## TYPE-03: History Type Safety

### Anti-Pattern: Untyped History Array

```typescript
// ❌ BAD: Can't validate history structure
interface TaskContext {
  taskId: string;
  history?: any[]; // Could contain anything!
  metadata: unknown;
}

function processHistory(context: TaskContext): void {
  if (context.history) {
    for (const item of context.history) {
      // What type is item? No IDE support
      // Can't validate item structure at runtime
      console.log(item.text); // Might crash if .text doesn't exist
    }
  }
}
```

**Problem:** Accepting `any[]` means callers can pass garbage; no validation occurs.

### Solution: Strict Typed History

```typescript
// ✅ GOOD: Type-safe history with discriminated unions
type HistoryEntry =
  | { role: 'user'; content: string; timestamp: number }
  | { role: 'assistant'; content: string; tokens: number; model: string; timestamp: number }
  | { role: 'system'; content: string; timestamp: number };

interface TaskContext {
  taskId: string;
  history: HistoryEntry[]; // Must be HistoryEntry[], not any[]
  metadata: TaskMetadata;
}

function processHistory(context: TaskContext): void {
  for (const entry of context.history) {
    // IDE knows all HistoryEntry properties
    console.log(entry.role); // 'user' | 'assistant' | 'system'
    console.log(entry.timestamp); // All entries have timestamp

    if (entry.role === 'assistant') {
      console.log(entry.tokens); // IDE knows this exists only for assistant
    }
  }
}

// Runtime validation function (catches errors before processing)
function validateHistory(history: unknown[]): history is HistoryEntry[] {
  return history.every(entry => {
    if (typeof entry !== 'object' || entry === null) return false;
    const e = entry as Record<string, unknown>;
    return (
      (e.role === 'user' || e.role === 'assistant' || e.role === 'system') &&
      typeof e.content === 'string' &&
      typeof e.timestamp === 'number'
    );
  });
}

// Usage
if (validateHistory(someHistory)) {
  processHistory({ taskId: '1', history: someHistory, metadata: {} });
}
```

**Benefits:**
- IDE autocomplete and refactoring support for history entries
- Runtime validation ensures history integrity
- Type narrowing enables entry-specific logic
- Dashboard can render history reliably

**Affected Files:** Memory manager, session storage, dashboard API

**Effort:** 4 hours

---

## TYPE-04: Provider Config Hierarchy

### Anti-Pattern: Single Untyped Config

```typescript
// ❌ BAD: One config for all providers - no type safety
interface ProviderConfig {
  apiKey?: string;
  endpoint?: string;
  model?: string;
  temperature?: number;
  [key: string]: unknown; // Escape hatch: accept anything
}

const config: ProviderConfig = {
  apiKey: 'sk-...', // Claude key
  endpoint: 'http://localhost:11434', // Ollama endpoint (conflicting!)
  temperature: 0.7,
  customField: 'anything', // No validation
};

// No way to know which fields are valid for which provider
const claude = new ClaudeProvider(config); // Might ignore endpoint
const ollama = new OllamaProvider(config); // Might ignore apiKey
```

**Problem:** Without type hierarchy, providers accept invalid config without errors. Debugging is difficult.

### Solution: Provider-Specific Config Types

```typescript
// ✅ GOOD: Discriminated config union
type ProviderConfig = ClaudeProviderConfig | GeminiProviderConfig | OllamaProviderConfig;

interface BaseProviderConfig {
  timeout?: number;
  retryAttempts?: number;
  retryDelayMs?: number;
}

interface ClaudeProviderConfig extends BaseProviderConfig {
  type: 'claude';
  apiKey: string; // Required
  model: 'claude-3-opus' | 'claude-3-sonnet' | 'claude-3-haiku';
  maxTokens: number;
}

interface GeminiProviderConfig extends BaseProviderConfig {
  type: 'gemini';
  apiKey: string; // Required
  model: 'gemini-pro' | 'gemini-pro-vision';
}

interface OllamaProviderConfig extends BaseProviderConfig {
  type: 'ollama';
  endpoint: string; // Required (not apiKey)
  model: string;
  pullIfMissing?: boolean;
}

// Now type narrowing works
function instantiateProvider(config: ProviderConfig): LLMProvider {
  switch (config.type) {
    case 'claude':
      // config is now ClaudeProviderConfig - all required fields present
      return new ClaudeProvider(config.apiKey, config.model);
    case 'gemini':
      return new GeminiProvider(config.apiKey, config.model);
    case 'ollama':
      return new OllamaProvider(config.endpoint, config.model);
  }
}

// ✅ This compiles - config has correct type
const claudeConfig: ClaudeProviderConfig = {
  type: 'claude',
  apiKey: 'sk-...',
  model: 'claude-3-opus',
  maxTokens: 2048,
};

// ❌ This fails to compile - endpoint is not valid for Claude
const invalidConfig: ClaudeProviderConfig = {
  type: 'claude',
  apiKey: 'sk-...',
  model: 'claude-3-opus',
  endpoint: 'http://localhost', // TypeScript error!
};
```

**Benefits:**
- Each provider has exactly the config it needs
- IDE shows correct fields per provider type
- Missing required fields cause compile errors
- Invalid combinations are impossible

**Affected Files:** Provider implementations, config loader, orchestrator

**Effort:** 2 hours

---

## TYPE-05: JSON Parse Error Handling

### Anti-Pattern: Silent Data Loss

```typescript
// ❌ BAD: Errors silently ignored
try {
  const payload = JSON.parse(responseText);
  return { success: true, data: payload };
} catch {
  // Error silently ignored - returns undefined data
  return { success: false, data: undefined };
}

// Caller has no way to know what went wrong
const result = parseResponse(response);
if (!result.success) {
  // Was it a timeout? Invalid JSON? Connection error?
  // No information available
  logger.error('Parse failed'); // No context
}
```

**Problem:** Errors are caught but not propagated, making debugging impossible.

### Solution: Explicit Error Handling with Observability

```typescript
// ✅ GOOD: Errors are emitted or logged
interface ParseResult<T> {
  success: boolean;
  data?: T;
  error?: ParseError;
}

interface ParseError {
  code: 'INVALID_JSON' | 'UNEXPECTED_FIELD' | 'NETWORK_ERROR';
  message: string;
  context: Record<string, unknown>;
}

function parseResponse<T>(
  responseText: string,
  schema: z.ZodSchema
): ParseResult<T> {
  try {
    const payload = JSON.parse(responseText);
    const validated = schema.parse(payload);
    return { success: true, data: validated };
  } catch (err) {
    if (err instanceof SyntaxError) {
      const parseError: ParseError = {
        code: 'INVALID_JSON',
        message: err.message,
        context: { responseText: responseText.slice(0, 200) },
      };

      // Emit error event for observability
      eventBus.emit('parse_error', parseError);

      return { success: false, error: parseError };
    }

    if (err instanceof z.ZodError) {
      const parseError: ParseError = {
        code: 'UNEXPECTED_FIELD',
        message: 'Validation failed',
        context: { issues: err.issues },
      };

      eventBus.emit('parse_error', parseError);
      return { success: false, error: parseError };
    }

    throw err; // Unexpected error
  }
}

// Usage with better observability
const result = parseResponse<ToolCall>(response, toolCallSchema);
if (!result.success) {
  logger.error('Failed to parse tool call', {
    error: result.error?.code,
    message: result.error?.message,
    context: result.error?.context,
  });
  // Now debugging is possible
}
```

**Benefits:**
- Errors are explicit and propagated
- Error codes enable specific handling (retry for network, fail for invalid JSON)
- Context is available for debugging
- Observable: events can be collected for monitoring

**Affected Files:** GeminiProvider, provider utilities

**Effort:** 1 hour

---

## TYPE-06: Event Payload Types

### Anti-Pattern: Untyped Event Content

```typescript
// ❌ BAD: Event content is Record<string, any>
interface AgentEvent {
  type: string;
  content: Record<string, any>; // Could contain anything
  timestamp: number;
}

// No way to know what fields are valid for each event type
function handleEvent(event: AgentEvent): void {
  if (event.type === 'text_response') {
    const text = event.content.text; // Might be undefined
    const confidence = event.content.confidence; // Might not exist
  }
}
```

**Problem:** Event content is untyped, so callers can't trust its structure.

### Solution: Discriminated Event Union with Payload Types

```typescript
// ✅ GOOD: Type-safe events with payload types
interface TextPayload {
  text: string;
  confidence: number;
}

interface ToolCallPayload {
  toolName: string;
  args: Record<string, unknown>;
  callId: string;
}

interface ErrorPayload {
  message: string;
  code: string;
  retryable: boolean;
}

type AgentEvent =
  | { type: 'text_response'; content: TextPayload; timestamp: number }
  | { type: 'tool_call'; content: ToolCallPayload; timestamp: number }
  | { type: 'error'; content: ErrorPayload; timestamp: number }
  | { type: 'heartbeat'; content: { systemHealth: number }; timestamp: number };

// Type guard for compile-time narrowing
function handleEvent(event: AgentEvent): void {
  switch (event.type) {
    case 'text_response':
      // event.content is now TextPayload
      console.log(event.content.text);
      console.log(event.content.confidence);
      break;

    case 'tool_call':
      // event.content is now ToolCallPayload
      console.log(event.content.toolName);
      console.log(event.content.args);
      break;

    case 'error':
      // event.content is now ErrorPayload
      if (event.content.retryable) {
        retry();
      }
      break;

    case 'heartbeat':
      console.log('System health:', event.content.systemHealth);
      break;
  }
}
```

**Benefits:**
- Event structure is explicit and validated at compile time
- IDE autocomplete works for all event types
- Adding new event types requires updating all handlers (exhaustiveness check)
- Type-safe event handling throughout the system

**Affected Files:** All event handlers, dashboard API, orchestrator

**Effort:** 2 hours

---

## TYPE-07: Union Type Exhaustiveness

### Anti-Pattern: Unchecked Provider Types

```typescript
// ❌ BAD: Switch doesn't handle all provider types
type Provider = 'claude' | 'gemini' | 'ollama';

function executeWithProvider(provider: Provider, task: Task): Promise<Result> {
  switch (provider) {
    case 'claude':
      return claudeExecute(task);
    case 'gemini':
      return geminiExecute(task);
    // Missing: case 'ollama' - if ollama is passed, undefined is returned silently
  }
}

// If a new provider is added later, all these switches need updating
// But TypeScript doesn't warn about missing cases
```

**Problem:** Adding new provider types doesn't cause compile errors in switches, leading to silent bugs.

### Solution: Exhaustiveness Checking with Discriminated Union

```typescript
// ✅ GOOD: Discriminated union with exhaustiveness checking
type LLMProvider =
  | { type: 'claude'; config: ClaudeConfig }
  | { type: 'gemini'; config: GeminiConfig }
  | { type: 'ollama'; config: OllamaConfig };

// Helper for exhaustiveness check
function assertNever(value: never): never {
  throw new Error(`Unhandled value: ${value}`);
}

async function executeWithProvider(provider: LLMProvider, task: Task): Promise<Result> {
  switch (provider.type) {
    case 'claude':
      return claudeExecute(provider.config, task);
    case 'gemini':
      return geminiExecute(provider.config, task);
    case 'ollama':
      return ollamaExecute(provider.config, task);
    default:
      // If a new provider type is added to the union, TypeScript will error here
      // because 'never' doesn't include the new type
      assertNever(provider);
  }
}

// If a new provider is added:
type LLMProvider =
  | { type: 'claude'; config: ClaudeConfig }
  | { type: 'gemini'; config: GeminiConfig }
  | { type: 'ollama'; config: OllamaConfig }
  | { type: 'anthropic_bedrock'; config: BedrockConfig }; // Added

// ❌ Now executeWithProvider() has a compile error - case 'anthropic_bedrock' missing!
// This forces developers to handle all cases
```

**Benefits:**
- Adding new provider types automatically breaks compilation in unhandled switches
- Exhaustiveness checking catches incomplete implementations
- No more silent bugs from missing cases
- Refactoring is safer and more discoverable

**Affected Files:** Router, orchestrator, provider factory

**Effort:** 2 hours

---

## TYPE-08: Return Type Annotations

### Anti-Pattern: Inferred Return Types

```typescript
// ❌ BAD: Return type inferred - makes refactoring risky
function formatErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

// Caller relies on inferred type (string), but there's no contract
const msg = formatErrorMessage(err);
const display = msg.toUpperCase(); // Works fine

// Later, if someone changes the function without realizing it's used elsewhere...
function formatErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return { message: error.message, stack: error.stack }; // Changed to object!
  }
  return String(error);
}

// Now msg.toUpperCase() breaks silently in code that uses this function
```

**Problem:** Without explicit return types, refactoring is unsafe. IDE can't help predict breakage.

### Solution: Explicit Return Type Annotations

```typescript
// ✅ GOOD: Explicit return type as contract
function formatErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

// Caller knows formatErrorMessage() returns string
const msg = formatErrorMessage(err);
const display = msg.toUpperCase(); // TypeScript guarantees this works

// If someone later tries to change the return type:
function formatErrorMessage(error: unknown): { message: string; stack?: string } {
  // ❌ Compile error! Return type changed from string to object
  // All callers get warnings - they must update
  if (error instanceof Error) {
    return { message: error.message, stack: error.stack };
  }
  return { message: String(error) };
}

// More complex example with async
async function loadProviderConfig(configPath: string): Promise<ProviderConfig> {
  const text = await fs.readFile(configPath, 'utf-8');
  const validated = providerConfigSchema.parse(JSON.parse(text));
  return validated;
}

// Caller knows exactly what loadProviderConfig returns
const config: ProviderConfig = await loadProviderConfig('/config/claude.json');
// IDE autocomplete works for config fields
```

**Benefits:**
- Explicit contract between function and callers
- Refactoring breaks compilation when return type changes
- IDE can suggest correct type usage
- Self-documenting code - readers know what to expect
- Better error messages when types don't match

**Affected Files:** All utility functions, helper methods (20+ functions)

**Effort:** 1 hour

---

### Type Safety Summary Table

| Gap ID | Anti-Pattern | Solution | Affected Files | Effort |
|--------|--------------|----------|----------------|--------|
| TYPE-01 | `as any` assertions | Discriminated unions | Providers | 3h |
| TYPE-02 | Generic error catching | Type guard functions | Error handlers | 2h |
| TYPE-03 | `history?: any[]` | Strict `HistoryEntry[]` union | Memory, storage | 4h |
| TYPE-04 | Single `ProviderConfig` | Provider-specific config types | Orchestrator, config | 2h |
| TYPE-05 | Silent `JSON.parse()` errors | Explicit error events/logging | GeminiProvider, utils | 1h |
| TYPE-06 | `Record<string, any>` events | Discriminated event union | All event handlers | 2h |
| TYPE-07 | Incomplete provider switches | Exhaustiveness checking | Router, factory | 2h |
| TYPE-08 | Inferred return types | Explicit annotations | Utilities (20+ functions) | 1h |

**Cumulative Effort:** 17 hours
**Impact:** Compile-time safety; refactoring confidence; IDE support; maintainability

---

