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

# APPENDIX E: Test Coverage Roadmap

## Purpose

This appendix provides detailed test scenarios for each of the 7 TEST-* gaps. For each gap, we define:
- **Test scenarios:** Concrete, executable test cases
- **Fixtures:** Mock objects and test data setup
- **Exit criteria:** Conditions for marking a gap resolved
- **Effort:** Time to implement all scenarios

---

## TEST-01: Orchestration E2E Integration Tests

**Severity:** S2 | **Effort:** 4h | **Blocking:** Y

### Overview

No integration tests exist for the main orchestration flow. Users could boot the Orchestrator, submit tasks, and have them mysteriously fail without any test warning. E2E tests verify that all components wire together and the main flow works end-to-end.

### Scenario 1: Boot Orchestrator → Submit Task → Verify Routing to Correct Provider

**Test:** `orchestrator.boot() → submitTask(simple_task) → verify Ollama called`

```typescript
describe('Orchestrator E2E', () => {
  let orchestrator: Orchestrator;
  let mockOllama: jest.Mocked<LLMProvider>;
  let mockClaude: jest.Mocked<LLMProvider>;

  beforeEach(async () => {
    mockOllama = createMockProvider('ollama');
    mockClaude = createMockProvider('claude');

    const config = {
      providers: {
        ollama: { type: 'ollama', endpoint: 'http://localhost:11434' },
        claude: { type: 'claude', apiKey: 'sk-...' },
      },
      executionMode: 'classification',
    };

    orchestrator = new Orchestrator(config);
    orchestrator.router.setMockProviders([mockOllama, mockClaude]);

    await orchestrator.boot();
  });

  afterEach(async () => {
    await orchestrator.shutdown();
  });

  it('should boot without errors', async () => {
    // Orchestrator is already booted in beforeEach
    // If boot() threw, we wouldn't reach here
    expect(orchestrator).toBeDefined();
  });

  it('should route simple task to Ollama and receive result', async () => {
    const task: Task = {
      id: 'task-1',
      prompt: 'What is 2 + 2?', // Simple task
      description: 'simple_arithmetic',
    };

    const mockResult: TaskResult = {
      taskId: 'task-1',
      output: '4',
      tokensUsed: 15,
      provider: 'ollama',
    };

    mockOllama.execute.mockResolvedValue(mockResult);

    const result = await orchestrator.submitTask(task);

    expect(result.output).toBe('4');
    expect(mockOllama.execute).toHaveBeenCalledWith(task);
    expect(mockClaude.execute).not.toHaveBeenCalled();
  });

  it('should route complex task to Claude and receive result', async () => {
    const task: Task = {
      id: 'task-2',
      prompt: 'Design a microservices architecture for real-time analytics',
      description: 'complex_design',
    };

    const mockResult: TaskResult = {
      taskId: 'task-2',
      output: 'Architecture: ...',
      tokensUsed: 2500,
      provider: 'claude',
    };

    mockClaude.execute.mockResolvedValue(mockResult);

    const result = await orchestrator.submitTask(task);

    expect(result.output).toContain('Architecture');
    expect(mockClaude.execute).toHaveBeenCalledWith(task);
    expect(mockOllama.execute).not.toHaveBeenCalled();
  });
});
```

**Exit Criteria:**
- [ ] Boot completes without errors
- [ ] Simple task routed to Ollama and completes
- [ ] Complex task routed to Claude and completes
- [ ] Routing decision is correct based on task characteristics

---

### Scenario 2: Router Classification Accuracy

**Test:** `verify task type → provider capability match`

```typescript
describe('Router Classification', () => {
  let router: Router;

  beforeEach(() => {
    router = new Router({
      providers: [
        { type: 'claude', capabilities: ['complex_reasoning', 'code_generation'] },
        { type: 'ollama', capabilities: ['simple_qa', 'summarization'] },
        { type: 'gemini', capabilities: ['multi_language', 'vision'] },
      ],
      mode: 'classification',
    });
  });

  it('should select Ollama for simple QA tasks', () => {
    const task: Task = {
      id: '1',
      prompt: 'What is Python?',
      description: 'simple_qa',
      tokenCount: 50,
    };

    const provider = router.selectProvider(task);
    expect(provider.type).toBe('ollama');
  });

  it('should select Claude for code generation', () => {
    const task: Task = {
      id: '2',
      prompt: 'Write a function to compute fibonacci numbers',
      description: 'code_generation',
      tokenCount: 200,
    };

    const provider = router.selectProvider(task);
    expect(provider.type).toBe('claude');
  });

  it('should select Gemini for multi-language tasks', () => {
    const task: Task = {
      id: '3',
      prompt: 'Translate "hello" to Japanese and Spanish',
      description: 'multi_language',
      tokenCount: 80,
    };

    const provider = router.selectProvider(task);
    expect(provider.type).toBe('gemini');
  });

  it('should prefer user hint over classification', () => {
    const task: Task = {
      id: '4',
      prompt: 'What is 2 + 2?',
      description: 'simple_arithmetic',
      tokenCount: 40,
      preferredProvider: 'claude', // User hint
    };

    const provider = router.selectProvider(task);
    expect(provider.type).toBe('claude'); // Honors hint despite simplicity
  });

  it('should handle multi-factor classification correctly', () => {
    const testCases = [
      {
        prompt: 'Analyze this code: `for x in range(10): print(x)`',
        desc: 'code_analysis',
        tokens: 150,
        expected: 'claude', // Analysis > coding, so Claude
      },
      {
        prompt: 'Print "hello"',
        desc: 'trivial_code',
        tokens: 20,
        expected: 'ollama', // Too simple, even for code
      },
      {
        prompt: 'Summarize this 5000-word article',
        desc: 'summarization',
        tokens: 2000,
        expected: 'claude', // Large token count requires Claude
      },
    ];

    for (const tc of testCases) {
      const provider = router.selectProvider({
        id: '1',
        prompt: tc.prompt,
        description: tc.desc,
        tokenCount: tc.tokens,
      });
      expect(provider.type).toBe(tc.expected);
    }
  });
});
```

**Exit Criteria:**
- [ ] Simple QA tasks route to Ollama
- [ ] Complex tasks route to Claude
- [ ] Multi-language tasks route to Gemini
- [ ] User hints are honored when specified
- [ ] Multi-factor classification is accurate for edge cases

---

### Scenario 3: Session Persistence (Task History Saved to JSONL)

**Test:** `execute task → verify event appended to session file`

```typescript
describe('Session Persistence', () => {
  let orchestrator: Orchestrator;
  let sessionFile: string;

  beforeEach(async () => {
    sessionFile = '/tmp/test-session.jsonl';
    if (fs.existsSync(sessionFile)) fs.unlinkSync(sessionFile);

    orchestrator = new Orchestrator({
      sessionStoragePath: sessionFile,
    });
    await orchestrator.boot();
  });

  it('should persist task_started event to JSONL', async () => {
    const task: Task = { id: 'task-1', prompt: 'Hello' };

    const promise = orchestrator.submitTask(task);

    // Give time for event to be persisted
    await new Promise(r => setTimeout(r, 100));

    const lines = fs.readFileSync(sessionFile, 'utf-8').split('\n').filter(l => l);
    const events = lines.map(l => JSON.parse(l));

    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'task_started',
        taskId: 'task-1',
      })
    );
  });

  it('should persist task_completed event with result', async () => {
    const task: Task = { id: 'task-2', prompt: 'What is 2+2?' };

    const result = await orchestrator.submitTask(task);

    const lines = fs.readFileSync(sessionFile, 'utf-8').split('\n').filter(l => l);
    const events = lines.map(l => JSON.parse(l));

    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'task_completed',
        taskId: 'task-2',
        result: expect.objectContaining({
          output: expect.any(String),
        }),
      })
    );
  });

  it('should persist provider_switched event on failover', async () => {
    // Setup mock to fail then succeed
    mockOllama.execute.mockRejectedValueOnce(new Error('Rate limited'));
    mockClaude.execute.mockResolvedValueOnce({ output: 'Success' });

    const task: Task = { id: 'task-3', prompt: 'Test' };
    await orchestrator.submitTask(task);

    const lines = fs.readFileSync(sessionFile, 'utf-8').split('\n').filter(l => l);
    const events = lines.map(l => JSON.parse(l));

    const switchEvent = events.find(e => e.type === 'provider_switched');
    expect(switchEvent).toBeDefined();
    expect(switchEvent.from).toBe('ollama');
    expect(switchEvent.to).toBe('claude');
    expect(switchEvent.reason).toContain('Rate limited');
  });

  it('should maintain event order and timestamps', async () => {
    const tasks = [
      { id: 'task-a', prompt: 'A' },
      { id: 'task-b', prompt: 'B' },
      { id: 'task-c', prompt: 'C' },
    ];

    for (const task of tasks) {
      await orchestrator.submitTask(task);
    }

    const lines = fs.readFileSync(sessionFile, 'utf-8').split('\n').filter(l => l);
    const events = lines.map(l => JSON.parse(l));

    // Timestamps should be non-decreasing
    for (let i = 1; i < events.length; i++) {
      expect(events[i].timestamp).toBeGreaterThanOrEqual(events[i - 1].timestamp);
    }
  });
});
```

**Exit Criteria:**
- [ ] task_started event persisted immediately after submission
- [ ] task_completed event includes result
- [ ] provider_switched event logged with reason
- [ ] All events in JSONL format, one per line
- [ ] Event ordering is preserved with timestamps

---

### Test Fixtures

```typescript
// Mock provider factory
function createMockProvider(type: 'claude' | 'ollama' | 'gemini'): jest.Mocked<LLMProvider> {
  return {
    type,
    execute: jest.fn(),
    checkAuth: jest.fn().mockResolvedValue(true),
    close: jest.fn(),
  };
}

// Test task generator
function createTestTask(overrides?: Partial<Task>): Task {
  return {
    id: `task-${Date.now()}`,
    prompt: 'Test prompt',
    ...overrides,
  };
}

// Session file cleanup helper
afterEach(() => {
  if (fs.existsSync('/tmp/test-session.jsonl')) {
    fs.unlinkSync('/tmp/test-session.jsonl');
  }
});
```

---

## TEST-02: Failover & Retry Scenarios

**Severity:** S2 | **Effort:** 3h | **Blocking:** N

### Scenario 1: Provider Quota Exceeded → Failover to Backup

**Test:** `execute with Claude → 429 rate limit → failover to Ollama → retry succeeds`

```typescript
describe('Failover on Quota Exceeded', () => {
  let orchestrator: Orchestrator;
  let mockClaude: jest.Mocked<LLMProvider>;
  let mockOllama: jest.Mocked<LLMProvider>;

  beforeEach(async () => {
    mockClaude = createMockProvider('claude');
    mockOllama = createMockProvider('ollama');

    orchestrator = new Orchestrator({
      providers: [mockClaude, mockOllama],
      failoverMode: 'automatic',
    });
    await orchestrator.boot();
  });

  it('should failover immediately when 429 received', async () => {
    const task: Task = { id: 'task-1', prompt: 'Test' };

    // Claude returns rate limit
    mockClaude.execute.mockRejectedValueOnce(
      new Error('HTTP 429: Rate limited')
    );

    // Ollama succeeds
    mockOllama.execute.mockResolvedValueOnce({
      output: 'Success via Ollama',
      provider: 'ollama',
    });

    const startTime = Date.now();
    const result = await orchestrator.submitTask(task);
    const elapsed = Date.now() - startTime;

    expect(result.output).toContain('Success via Ollama');
    expect(result.provider).toBe('ollama');
    expect(elapsed).toBeLessThan(1000); // Failover should be fast (<1s)
  });

  it('should log failover attempt with provider and reason', async () => {
    const task: Task = { id: 'task-2', prompt: 'Test' };

    const logSpy = jest.spyOn(logger, 'warn');

    mockClaude.execute.mockRejectedValueOnce(
      new Error('HTTP 429: Rate limited')
    );
    mockOllama.execute.mockResolvedValueOnce({ output: 'OK' });

    await orchestrator.submitTask(task);

    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('Failing over'),
      expect.objectContaining({
        from: 'claude',
        to: 'ollama',
        reason: 'Rate limited',
      })
    );
  });
});
```

**Exit Criteria:**
- [ ] Failover triggered within 1 second of receiving 429
- [ ] Alternative provider attempted immediately
- [ ] Failover logged with from/to/reason
- [ ] Task succeeds on backup provider

---

### Scenario 2: Task Fails → Enqueue to Retry Queue → Re-Submit on Schedule

**Test:** `execute task → failure → enqueue → wait 5s → verify re-submitted`

```typescript
describe('Automatic Retry', () => {
  let orchestrator: Orchestrator;
  let retryQueue: RetryQueue;

  beforeEach(async () => {
    orchestrator = new Orchestrator({
      retryPolicy: {
        enabled: true,
        maxAttempts: 3,
        backoffMs: 1000,
      },
    });
    retryQueue = orchestrator.getRetryQueue();
    await orchestrator.boot();
  });

  it('should enqueue task on failure and retry after backoff', async () => {
    const task: Task = {
      id: 'task-retry',
      prompt: 'Test',
      description: 'unreliable_operation',
    };

    // First attempt fails
    let attemptCount = 0;
    mockProvider.execute.mockImplementation(async () => {
      attemptCount++;
      if (attemptCount === 1) {
        throw new Error('Transient failure');
      }
      return { output: 'Success on retry' };
    });

    // Submit - will fail
    const resultPromise = orchestrator.submitTask(task);

    // Wait for it to fail and be enqueued
    await new Promise(r => setTimeout(r, 100));

    const readyTasks = retryQueue.getReadyTasks();
    expect(readyTasks).toContainEqual(
      expect.objectContaining({
        taskId: 'task-retry',
        attempt: 1,
      })
    );

    // Wait for retry backoff
    await new Promise(r => setTimeout(r, 1500));

    // Verify retry was consumed and task succeeded
    const result = await resultPromise;
    expect(result.output).toContain('Success on retry');
    expect(attemptCount).toBe(2);
  });
});
```

**Exit Criteria:**
- [ ] Task enqueued after first failure
- [ ] Task re-submitted after backoff period
- [ ] Attempt counter incremented
- [ ] Task succeeds on second attempt

---

### Scenario 3: Failed Handoff Bundle Contains Execution Context

**Test:** `task fails → verify retry bundle includes context, history, metadata`

```typescript
describe('Retry Context Preservation', () => {
  it('should preserve execution context in retry bundle', async () => {
    const task: Task = {
      id: 'task-context',
      prompt: 'Analyze this data',
      context: {
        conversationId: 'conv-123',
        previousMessages: ['msg-1', 'msg-2'],
        userPreferences: { language: 'en', verbose: true },
      },
    };

    mockProvider.execute.mockRejectedValueOnce(new Error('Failed'));

    await orchestrator.submitTask(task);
    await new Promise(r => setTimeout(r, 100));

    const readyTasks = retryQueue.getReadyTasks();
    const retryTask = readyTasks[0];

    expect(retryTask.context).toEqual(task.context);
    expect(retryTask.previousMessages).toEqual(task.context.previousMessages);
    expect(retryTask.metadata).toEqual({
      originalTaskId: 'task-context',
      attempt: 1,
      failureReason: 'Failed',
      failureTime: expect.any(Number),
    });
  });
});
```

**Exit Criteria:**
- [ ] Retry bundle includes original context
- [ ] Conversation history preserved
- [ ] User preferences maintained
- [ ] Metadata includes attempt count and failure reason

---

## TEST-03: CLI Commands Functional Tests

**Severity:** S2 | **Effort:** 3h | **Blocking:** N

### Test Each Command: start, stop, status, memory, steer, skill, audit

```typescript
describe('CLI Commands', () => {
  let orchestrator: Orchestrator;
  let cliProcess: ChildProcess;

  beforeEach(async () => {
    orchestrator = new Orchestrator(testConfig);
    await orchestrator.boot();
  });

  describe('start command', () => {
    it('should start daemon and bind to port', async () => {
      cliProcess = spawn('node', ['dist/cli.js', 'start', '--port', '9999']);

      await new Promise(r => setTimeout(r, 2000)); // Wait for startup

      const response = await fetch('http://localhost:9999/health');
      expect(response.status).toBe(200);

      cliProcess.kill();
    });
  });

  describe('stop command', () => {
    it('should gracefully shutdown daemon', async () => {
      cliProcess = spawn('node', ['dist/cli.js', 'start', '--port', '9999']);
      await new Promise(r => setTimeout(r, 1000));

      const stop = spawn('node', ['dist/cli.js', 'stop', '--port', '9999']);
      await new Promise(r => stop.on('close', r));

      // Verify daemon stopped
      const response = await fetch('http://localhost:9999/health').catch(() => null);
      expect(response).toBeNull();
    });
  });

  describe('status command', () => {
    it('should report daemon status', async () => {
      const status = spawn('node', ['dist/cli.js', 'status']);

      let output = '';
      status.stdout.on('data', (d) => output += d);

      await new Promise(r => status.on('close', r));

      expect(output).toContain('Status:');
      expect(output).toMatch(/running|stopped/i);
    });
  });

  describe('memory command', () => {
    it('should report memory usage', async () => {
      const memory = spawn('node', ['dist/cli.js', 'memory']);

      let output = '';
      memory.stdout.on('data', (d) => output += d);

      await new Promise(r => memory.on('close', r));

      expect(output).toContain('Memory');
      expect(output).toMatch(/\d+\s*(KB|MB|GB)/);
    });
  });
});
```

**Exit Criteria:**
- [ ] Each command parses arguments correctly
- [ ] Commands execute without errors
- [ ] Commands return expected output/status
- [ ] Error handling for invalid arguments

---

## TEST-04: Dashboard API Endpoints

**Severity:** S2 | **Effort:** 3h | **Blocking:** N

### Test /api/jobs, /api/health, auth middleware

```typescript
describe('Dashboard API', () => {
  let server: Server;
  let orchestrator: Orchestrator;

  beforeEach(async () => {
    orchestrator = new Orchestrator(testConfig);
    await orchestrator.boot();

    server = startDashboardServer(orchestrator, { port: 9000 });
  });

  describe('GET /api/health', () => {
    it('should return system health', async () => {
      const response = await fetch('http://localhost:9000/api/health');
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toEqual({
        status: 'healthy',
        timestamp: expect.any(Number),
        uptime: expect.any(Number),
      });
    });
  });

  describe('GET /api/jobs', () => {
    it('should return empty list when no jobs submitted', async () => {
      const response = await fetch('http://localhost:9000/api/jobs');
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.jobs).toEqual([]);
    });

    it('should return submitted jobs with status', async () => {
      const task: Task = { id: 'job-1', prompt: 'Test' };
      await orchestrator.submitTask(task);

      const response = await fetch('http://localhost:9000/api/jobs');
      const data = await response.json();

      expect(data.jobs).toContainEqual(
        expect.objectContaining({
          id: 'job-1',
          status: expect.stringMatching(/completed|running/),
        })
      );
    });
  });

  describe('Auth Middleware', () => {
    it('should reject requests without token', async () => {
      const response = await fetch('http://localhost:9000/api/jobs');
      expect(response.status).toBe(401);
    });

    it('should accept requests with valid token', async () => {
      const response = await fetch('http://localhost:9000/api/jobs', {
        headers: { Authorization: 'Bearer valid-token' },
      });
      expect(response.status).toBe(200);
    });
  });
});
```

**Exit Criteria:**
- [ ] /api/health returns health status
- [ ] /api/jobs returns job list with status
- [ ] Auth middleware enforces token validation
- [ ] Error responses have correct status codes

---

## TEST-05: Provider Tool Parsing

**Severity:** S2 | **Effort:** 2h | **Blocking:** N

### Collect Real Output & Test Regex Patterns

```typescript
describe('Provider Tool Parsing', () => {
  describe('Gemini CLI Tool Parsing', () => {
    it('should parse tool calls from real Gemini CLI output', () => {
      const realOutput = `
        [TOOL CALL]
        tool_name: "search"
        arguments: {"query": "what is AI", "limit": 5}
        [/TOOL CALL]
      `;

      const toolCalls = parseGeminiToolCalls(realOutput);

      expect(toolCalls).toHaveLength(1);
      expect(toolCalls[0]).toEqual({
        name: 'search',
        arguments: { query: 'what is AI', limit: 5 },
      });
    });

    it('should handle multiple tool calls in one response', () => {
      const realOutput = `
        [TOOL CALL]
        tool_name: "search"
        arguments: {"query": "data"}
        [/TOOL CALL]

        [TOOL CALL]
        tool_name: "fetch"
        arguments: {"url": "https://example.com"}
        [/TOOL CALL]
      `;

      const toolCalls = parseGeminiToolCalls(realOutput);
      expect(toolCalls).toHaveLength(2);
    });

    it('should validate extracted tool calls against schema', () => {
      const toolCalls = parseGeminiToolCalls(realOutput);

      for (const call of toolCalls) {
        expect(() => {
          toolCallSchema.parse(call);
        }).not.toThrow();
      }
    });
  });
});
```

**Exit Criteria:**
- [ ] Real Gemini CLI output parsed correctly
- [ ] Regex patterns extract all tool calls
- [ ] Tool calls validate against schema
- [ ] Edge cases handled (malformed JSON, missing fields)

---

## TEST-06: GeminiProvider Auth

**Severity:** S2 | **Effort:** 1h | **Blocking:** N

### Mock spawn() & Verify checkAuth()

```typescript
describe('GeminiProvider Auth', () => {
  let provider: GeminiProvider;
  let spawnSpy: jest.Mocked<typeof spawn>;

  beforeEach(() => {
    provider = new GeminiProvider({ endpoint: 'gemini' });
    spawnSpy = jest.spyOn(require('child_process'), 'spawn');
  });

  it('should detect valid authentication', async () => {
    spawnSpy.mockReturnValue({
      on: jest.fn((event, cb) => {
        if (event === 'close') cb(0); // Exit code 0 = auth OK
      }),
    });

    const isAuth = await provider.checkAuth();
    expect(isAuth).toBe(true);
  });

  it('should detect invalid/missing authentication', async () => {
    spawnSpy.mockReturnValue({
      on: jest.fn((event, cb) => {
        if (event === 'close') cb(1); // Exit code 1 = auth failed
      }),
    });

    const isAuth = await provider.checkAuth();
    expect(isAuth).toBe(false);
  });

  it('should cache auth result to avoid repeated checks', async () => {
    await provider.checkAuth();
    await provider.checkAuth();

    expect(spawnSpy).toHaveBeenCalledTimes(1); // Called once, result cached
  });
});
```

**Exit Criteria:**
- [ ] checkAuth() detects valid tokens
- [ ] checkAuth() detects invalid tokens
- [ ] Results cached to reduce spawn() calls
- [ ] Error handling for spawn failures

---

## TEST-07: TelegramGateway User Allowlist

**Severity:** S2 | **Effort:** 2h | **Blocking:** N

### Test Allowed Users Accepted, Denied Users Blocked

```typescript
describe('TelegramGateway Allowlist', () => {
  let gateway: TelegramGateway;

  beforeEach(() => {
    gateway = new TelegramGateway({
      botToken: 'test-token',
      allowlist: ['user-1', 'user-2'],
      denylist: ['blocked-user'],
    });
  });

  it('should accept messages from allowed users', async () => {
    const message = {
      userId: 'user-1',
      text: 'Hello',
    };

    const isAllowed = gateway.isUserAllowed(message.userId);
    expect(isAllowed).toBe(true);
  });

  it('should block messages from denied users', async () => {
    const message = {
      userId: 'blocked-user',
      text: 'Hello',
    };

    const isAllowed = gateway.isUserAllowed(message.userId);
    expect(isAllowed).toBe(false);
  });

  it('should block messages from users not in allowlist when strict', () => {
    const gateway = new TelegramGateway({
      botToken: 'test-token',
      allowlist: ['user-1'],
      strictMode: true, // Only allowlist allowed
    });

    expect(gateway.isUserAllowed('user-1')).toBe(true);
    expect(gateway.isUserAllowed('user-3')).toBe(false);
  });

  it('should log security events for denied access', () => {
    const logSpy = jest.spyOn(logger, 'warn');

    gateway.isUserAllowed('blocked-user');

    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('Access denied'),
      expect.objectContaining({
        userId: 'blocked-user',
        reason: 'blocklist',
      })
    );
  });
});
```

**Exit Criteria:**
- [ ] Allowed users accepted
- [ ] Denied users blocked
- [ ] Allowlist/denylist logic correct
- [ ] Security events logged
- [ ] No false positives/negatives

---

### Test Coverage Summary

| Gap ID | Test Scenarios | Fixtures | Exit Criteria | Effort |
|--------|----------------|----------|---------------|--------|
| TEST-01 | 3 (boot, routing, persistence) | Mock providers | All scenarios pass, 100% routing coverage | 4h |
| TEST-02 | 3 (failover, retry, context) | Retry queue, mock provider | <1s failover, retry consumed within 5min | 3h |
| TEST-03 | 7 (CLI commands) | CLI spawn, process mgmt | All commands parse/execute correctly | 3h |
| TEST-04 | 3 (health, jobs, auth) | HTTP server, mock orchestrator | All endpoints return correct schemas | 3h |
| TEST-05 | 3 (tool parsing) | Real Gemini CLI output | Regex patterns match all cases | 2h |
| TEST-06 | 3 (checkAuth coverage) | Mocked spawn() | Auth detection accurate | 1h |
| TEST-07 | 4 (allowlist logic) | Security event logging | Allowlist/deny logic correct | 2h |

**Cumulative Effort:** 21 hours
**Impact:** 100% test coverage for critical paths; production confidence

---


---

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

# APPENDIX C: Severity Definitions & Examples

## Purpose

This appendix explains what distinguishes each severity level and provides concrete examples from the Zora codebase. Use this to:
- Understand why each gap is assigned its severity
- Make judgments about gap prioritization in your own systems
- Calibrate severity assessments for new gaps

---

## C1. S1 - CRITICAL (Blocks Production)

### Definition

**S1 gaps prevent any production use of the system.** The framework cannot start, coordinate operations, or handle basic failure scenarios. Without fixing S1 gaps, the system is inoperable for any real workload.

**Key characteristics:**
- System will not start or crashes immediately
- Core framework functionality completely unavailable
- Data loss or corruption possible
- Users cannot deploy or run framework at all

### Examples from Zora

#### ORCH-10: No Main Orchestrator Bootstrapping

**Why S1?** There is no orchestrator bootstrap. None of the sophisticated components (FailoverController, RetryQueue, Router, SessionManager, AuthMonitor, Heartbeat, Routine Manager) are instantiated or coordinated. The framework has no way to:
- Start services
- Coordinate multiple agents/providers
- Handle failures
- Persist state

**Impact:** Literally nothing works. The entire application fails to initialize.

**User experience:** Framework does not start. Immediate crash.

---

#### ERR-01: AuditLogger Silent Write Failures

**Why S1?** The audit logger silently swallows write errors. When audit logs fail to write (disk full, permission error, corruption), no error is raised. The system appears to work, but the audit trail (required for security compliance and debugging) is lost.

**Production risk:** 
- Security incidents undetected because audit trail is gone
- Compliance violations (HIPAA, SOC 2 require audit logs)
- Cannot investigate production incidents due to missing audit records
- Data loss without operator knowledge

**User experience:** System appears healthy but audit records mysteriously disappear during failures.

---

#### ORCH-02: RetryQueue Consumer Missing

**Why S1?** Failed tasks are enqueued for retry, but nothing consumes the queue. A task fails once and is lost forever. There is no automatic recovery from transient failures.

**Production risk:**
- Single API rate limit = task is lost
- Single token expiry = permanent failure
- Cannot rely on framework for any mission-critical work
- Users must manually restart/resubmit every failure

**User experience:** "I submitted a task, it failed once, and disappeared. No retry, no error, just gone."

---

### S1 Gaps Summary

| Gap ID | Issue | Why Blocking |
|--------|-------|--------------|
| ORCH-10 | No Main Orchestrator Bootstrapping | Framework won't start |
| ORCH-01 | FailoverController Never Invoked | No provider failover; single failure = crash |
| ORCH-02 | RetryQueue Consumer Missing | Tasks lost on any transient error |
| ORCH-06 | SessionManager Events Never Persisted | Session state lost; no crash recovery |
| ERR-01 | AuditLogger Silent Write Failures | Audit trail lost; compliance failure |
| ERR-02 | GeminiProvider Silent JSON Parse Failures | Tool invocations silently disappear |

**Total S1 gaps:** 6 (all blocking, all must be fixed before production)

---

## C2. S2 - HIGH (Prevents Operations)

### Definition

**S2 gaps prevent integrated features from working properly.** The system might start, but critical operational capabilities are missing or broken. Features that depend on these gaps are unavailable or unreliable.

**Key characteristics:**
- Core orchestration works
- But key operational features missing or broken
- Integrated workflows fail
- Operational visibility limited
- Testing/debugging nearly impossible

### Examples from Zora

#### OPS-01: CLI Daemon Commands Are Stubs

**Why S2?** The `zora daemon start` command exists but does nothing (it's a stub). Users cannot run Zora as a background service. The framework must be restarted manually; there's no daemon lifecycle management.

**Operational impact:**
- Cannot deploy as a service (systemd, Docker, k8s)
- Cannot enable restart-on-failure
- Cannot manage multiple instances
- No production deployment path

**User experience:** "I want to run Zora as a background service, but the daemon commands don't work."

**Note:** The orchestration layer might work, but without daemon commands, there's no way to operationalize it.

---

#### TEST-01: No Integration Tests for Orchestration

**Why S2?** There are no end-to-end tests. The system might work in isolation, but there's no way to verify that:
- All orchestration components work together
- Failover actually switches providers
- Tasks retry properly
- Multiple concurrent providers coordinate

Without integration tests, gaps appear after deployment.

**Operational impact:**
- Cannot certify multi-provider scenarios
- Unknown unknowns in production
- Regressions undetected
- Team lacks confidence in deployments

---

#### ERR-05: No Timeout on Event Streams

**Why S2?** Event stream consumers can hang indefinitely waiting for events. If a provider stops responding but doesn't close the connection, the event consumer blocks forever, hanging the entire task execution loop.

**Operational impact:**
- Tasks mysteriously hang (appear to run but never complete)
- Must kill daemon and restart manually
- No graceful degradation
- Operational support nightmare

**User experience:** "My task is stuck. I had to kill and restart the daemon."

---

### S2 Gaps Summary

| Gap ID | Category | Issue | Why High |
|--------|----------|-------|----------|
| ORCH-03 | Orchestration | Router Not Integrated | Tasks not routed; can't parallelize |
| ORCH-04 | Orchestration | AuthMonitor Never Scheduled | Auth tokens not refreshed; random auth failures |
| ORCH-07 | Orchestration | MemoryManager Context Not Injected | Agent memory not persisted |
| ORCH-09 | Orchestration | Heartbeat System Not Started | No health checks; no scheduled routines |
| OPS-01 | Operational | CLI Daemon Commands Are Stubs | No daemon lifecycle |
| OPS-02 | Operational | Dashboard Empty | No operational visibility |
| TEST-01 | Testing | No Integration Tests | Can't verify end-to-end flows |
| ERR-05 | Error Handling | No Event Stream Timeout | Event consumers can hang forever |
| LOG-02 | Observability | Silent Async Errors | Production errors invisible |
| TYPE-05 | Type Safety | Silent JSON.parse() Errors | Tool invocations silently lost |

**Total S2 gaps:** 12 (must be fixed for operational deployment)

---

## C3. S3 - MEDIUM (Degrades Quality)

### Definition

**S3 gaps don't prevent the system from running, but they accumulate technical debt and make the system harder to maintain and debug.**

**Key characteristics:**
- System works, but poorly
- Maintenance burden increases
- Debugging difficult
- Refactoring risky
- Team velocity decreases over time

### Examples from Zora

#### TYPE-01: 36 `as any` Assertions in Providers

**Why S3?** Providers use `as any` to bypass TypeScript type checking. These are 36 places where:
- IDE cannot offer autocomplete
- Typos not caught at compile time
- Refactoring is dangerous (could introduce runtime errors)
- Code reviewers cannot understand intent

**Maintenance impact:**
- Adding new providers: risky without type safety
- Fixing provider bugs: unclear what data is flowing where
- Supporting new LLM features: type mismatches cause runtime errors

**User experience:** None immediately, but developer frustration increases with each change.

**Code smell:**
```typescript
// Unsafe - as any defeats all type checking
const response = (await callAPI(request)) as any;
const toolCall = response.tool_call; // Could be undefined!
```

---

#### LOG-01: Console.log Used Throughout (15+ files)

**Why S3?** The codebase uses `console.log` for diagnostics. This means:
- No structured logging (can't parse/filter logs programmatically)
- No log levels (no way to distinguish errors from debug info)
- No timestamps or context
- Logs mixed with application output
- Cannot be sent to log aggregation systems

**Operational impact:**
- Production debugging nearly impossible
- "Logs disappeared" (never captured or rotated)
- Cannot search/correlate issues
- Support burden high

**DevOps impact:**
```
// Current (no structure)
[Some provider: 2025-02-14 12:34:56]
Task execution failed: timeout

// Desired (structured)
{
  "timestamp": "2025-02-14T12:34:56Z",
  "level": "error",
  "service": "orchestration",
  "message": "Task execution failed",
  "reason": "timeout",
  "task_id": "task-123",
  "provider": "claude"
}
```

---

#### DOC-01: Sparse Inline Explanations

**Why S3?** Complex modules (ExecutionLoop, Router, FailoverController) lack comments explaining the logic. New team members cannot understand:
- Why things are done this way
- What state transitions are possible
- What edge cases are handled

**Team impact:**
- Onboarding takes 2x longer
- Mistakes more likely in modifications
- Tribal knowledge accumulates
- Knowledge walks out the door when people leave

---

### S3 Gaps Summary

**Type Safety (8 gaps):** TypeScript escape hatches accumulate

| Gap ID | Issue | Impact |
|--------|-------|--------|
| TYPE-01 | 36 `as any` assertions | Refactoring risky |
| TYPE-02 | `err: unknown` not narrowed (8 files) | Errors mishandled |
| TYPE-03 | TaskContext.history is `any[]` | History access unsafe |
| TYPE-04 | ProviderConfig flat (no hierarchy) | Config mistakes possible |
| TYPE-06 | No event payload types | Event handling unsafe |
| TYPE-07 | LLMProvider unions underutilized | Provider selection fragile |
| TYPE-08 | Missing return type annotations (20 files) | IDE assistance missing |

**Logging & Observability (3 gaps):** Diagnostic darkness

| Gap ID | Issue | Impact |
|--------|-------|--------|
| LOG-01 | console.log scattered (15 files) | Cannot parse/aggregate logs |
| LOG-03 | No health check instrumentation | Cannot see system health |
| LOG-04 | Event streams lack source attribution | Cannot trace event flow |

**Documentation (5 gaps):** Knowledge debt

| Gap ID | Issue | Impact |
|--------|-------|--------|
| DOC-01 | Sparse inline explanations | Maintenance burden |
| DOC-02 | No Architecture Decision Records | Team onboarding slow |
| DOC-03 | Provider implementation guide missing | Hard to extend |
| DOC-04 | Configuration reference incomplete | Users misconfigure system |
| DOC-05 | No troubleshooting guide | Support burden high |

**Orchestration (1 gap):** Design smell

| Gap ID | Issue | Impact |
|--------|-------|--------|
| ORCH-05 | Router uses naive classification | Task distribution suboptimal |

**Error Handling (1 gap):** Fragile error handling

| Gap ID | Issue | Impact |
|--------|-------|--------|
| ERR-06 | Command parsing regex incomplete | Edge cases in commands |

**Total S3 gaps:** 22 (accumulate technical debt, degrade quality)

---

## C4. S4 - LOW (Minor Issues)

### Definition

**S4 gaps are cosmetic or have negligible impact on functionality or maintainability.** Fixing them is nice-to-have but doesn't block any capability.

**Key characteristics:**
- System works fine despite the gap
- Impact is mostly aesthetic
- Low effort to fix
- Can be batched with other work

### Examples from Zora

#### ORCH-11: Round-Robin Mode Actually Random

**Why S4?** The router has a `round-robin` mode that's supposed to distribute tasks in order across providers. Instead, it randomly selects providers. This means:
- Wrong algorithm name (misleading)
- Actual behavior is fine for load balancing (random works)
- But not what users expect from "round-robin"

**Impact:** Negligible. Users get acceptable load distribution; just not the named algorithm.

**Fix effort:** 30 minutes (change implementation to actually cycle through providers in order)

---

#### TYPE-08: Missing Return Type Annotations (20 files)

**Why S4?** TypeScript functions lack explicit return types. The compiler can infer them, so code works fine. But explicit types help:
- Code readability
- IDE autocomplete
- Catch unintended return value changes during refactoring

**Impact:** Minimal. Functions still work; just harder to read and understand.

**Fix effort:** 1-2 hours (adding type annotations throughout)

---

#### OPS-04: GeminiProvider Unbounded Buffer

**Why S4?** The Gemini provider's buffer can grow without bounds. In extreme scenarios (millions of cached items), memory usage grows. But in normal operation:
- Buffer stays reasonable size
- No production issues observed
- Only matters under very high load

**Impact:** Low. Optimization, not critical.

---

### S4 Gaps Summary

| Gap ID | Category | Issue | Impact |
|--------|----------|-------|--------|
| ORCH-11 | Orchestration | Round-Robin actually random | Misleading; behavior acceptable |
| TYPE-08 | Type Safety | Missing return type annotations | Code readability; IDE assistance |
| OPS-04 | Operational | Unbounded buffer in Gemini | Memory under extreme load |

**Total S4 gaps:** 3 (nice to fix, but not urgent)

---

## C5. Severity Comparison Matrix

```
          | BLOCKS START | BLOCKS OPS | QUALITY DEBT | COSMETIC
----------|--------------|-----------|--------------|----------
S1        |     YES      |    YES    |     SEVERE   |  N/A
S2        |      NO      |    YES    |     MODERATE |  N/A
S3        |      NO      |     NO    |     YES      |  N/A
S4        |      NO      |     NO    |     MINOR    |  YES

TEAM      | Cannot      | Can start | Code is      | Code is
IMPACT    | deploy      | but       | fragile &    | readable &
          |             | can't     | hard to      | acceptable
          |             | operate   | maintain     |

FIX       | Prerequisite| Required  | Recommended  | Optional
PRIORITY  | for prod    | for prod  | for hygiene  | when time
          |             |           |              | permits
```

---

## C6. Decision Tree: Is This S1, S2, S3, or S4?

```
Does the gap prevent the system from starting?
├─ YES → S1 (CRITICAL)
└─ NO → Does the gap prevent production operation?
        ├─ YES (feature/capability missing/broken) → S2 (HIGH)
        └─ NO → Does the gap create technical debt or quality issues?
                ├─ YES (maintenance burden, debugging harder, refactoring risky) → S3 (MEDIUM)
                └─ NO → S4 (LOW - cosmetic only)
```

---

## C7. Reference Quick Lookup

### By Team Priority

**If you have 1 day:** Fix S1 gaps (ORCH-10 is minimum viable start)

**If you have 1 week:** Fix S1 + S2 gaps (achievable with 3-4 agents)

**If you have 2 weeks:** Fix S1 + S2 + high-impact S3 gaps (focus on type safety and observability)

**If you have 1 month:** Fix all gaps except S4 (S4 is nice-to-have polish)

### By Gap Category

| Category | S1 Count | S2 Count | S3 Count | S4 Count |
|----------|----------|----------|----------|----------|
| Orchestration | 3 | 6 | 1 | 1 |
| Error Handling | 2 | 3 | 1 | 0 |
| Type Safety | 0 | 1 | 7 | 1 |
| Testing | 0 | 7 | 0 | 0 |
| Operational | 0 | 5 | 0 | 1 |
| Logging & Observability | 0 | 2 | 2 | 0 |
| Documentation | 0 | 0 | 5 | 0 |
| **TOTAL** | **6** | **12** | **22** | **6** |

