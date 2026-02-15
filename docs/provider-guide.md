# Provider Implementation Guide

This guide explains how to implement a custom LLM provider for Zora. All providers implement the `LLMProvider` interface defined in `src/types.ts`.

---

## The LLMProvider Interface

```typescript
interface LLMProvider {
  readonly name: string;
  readonly rank: number;
  readonly capabilities: ProviderCapability[];
  readonly costTier: CostTier;

  isAvailable(): Promise<boolean>;
  checkAuth(): Promise<AuthStatus>;
  getQuotaStatus(): Promise<QuotaStatus>;
  getUsage(): ProviderUsage;
  execute(task: TaskContext): AsyncGenerator<AgentEvent>;
  abort(jobId: string): Promise<void>;
}
```

### Readonly Properties

| Property | Type | Description |
|----------|------|-------------|
| `name` | `string` | Unique identifier for this provider instance. Must match the `name` field in `config.toml`. |
| `rank` | `number` | Priority for routing. Lower rank = preferred when multiple providers match a task. |
| `capabilities` | `ProviderCapability[]` | Tags describing what this provider can do: `"reasoning"`, `"coding"`, `"creative"`, `"structured-data"`, `"large-context"`, `"search"`, `"fast"`, or any custom string. |
| `costTier` | `CostTier` | Cost classification: `"free"`, `"included"`, `"metered"`, or `"premium"`. Used by the `optimize_cost` routing mode. |

---

## Methods

### `isAvailable(): Promise<boolean>`

Returns whether this provider is currently ready to accept tasks.

The orchestrator calls this during routing to filter out providers that are down, disabled, or have exhausted auth/quota. A provider should return `false` if:

- It is disabled in config.
- Its last auth check returned `valid: false`.
- Its quota is exhausted.
- It cannot reach its backend service.

```typescript
async isAvailable(): Promise<boolean> {
  if (!this.config.enabled) return false;
  if (this.lastAuthStatus && !this.lastAuthStatus.valid) return false;
  if (this.lastQuotaStatus?.isExhausted) return false;
  return true;
}
```

### `checkAuth(): Promise<AuthStatus>`

Probes the authentication state of the provider's backend. Called periodically by the AuthMonitor (every 5 minutes by default).

**Return type:**

```typescript
interface AuthStatus {
  valid: boolean;           // Is the current auth token/session valid?
  expiresAt: Date | null;   // When does it expire? null = unknown/never.
  canAutoRefresh: boolean;  // Can the provider refresh auth without user action?
  requiresInteraction: boolean; // Does the user need to manually re-authenticate?
}
```

**Guidelines:**
- Return an optimistic status (`valid: true`) on first call if you haven't checked yet. Auth errors during `execute()` will update the status.
- Set `requiresInteraction: true` if the user needs to manually log in (e.g., browser OAuth flow).
- Set `canAutoRefresh: true` if the provider can silently refresh tokens.

### `getQuotaStatus(): Promise<QuotaStatus>`

Returns the current rate-limit and quota state.

**Return type:**

```typescript
interface QuotaStatus {
  isExhausted: boolean;         // Are we out of quota?
  remainingRequests: number | null; // Requests remaining. null = unknown.
  cooldownUntil: Date | null;   // When can we retry? null = no cooldown.
  healthScore: number;          // 0-1 health indicator. 1 = fully healthy.
}
```

### `getUsage(): ProviderUsage`

Returns cumulative usage statistics. Called synchronously (not async) for dashboard display.

**Return type:**

```typescript
interface ProviderUsage {
  totalCostUsd: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  requestCount: number;
  lastRequestAt: Date | null;
}
```

### `execute(task: TaskContext): AsyncGenerator<AgentEvent>`

The core method. Executes a task and yields events as an async generator.

This is where your provider communicates with its LLM backend, streams responses, and converts them into Zora's event format. The orchestrator consumes this generator, persisting events and checking for steering messages between yields.

**The `TaskContext` parameter:**

```typescript
interface TaskContext {
  jobId: string;                       // Unique job identifier
  task: string;                        // The user's prompt
  requiredCapabilities: ProviderCapability[];
  complexity: TaskComplexity;          // 'simple' | 'moderate' | 'complex'
  resourceType: TaskResourceType;      // 'reasoning' | 'coding' | 'data' | ...
  systemPrompt: string;               // System prompt (includes SOUL.md + memory)
  memoryContext: string[];             // Memory items for context injection
  history: AgentEvent[];               // Previous events (for restarts/handoffs)
  modelPreference?: string;            // Override model selection
  maxCostTier?: CostTier;              // Cost ceiling
  maxTurns?: number;                   // Turn limit
  canUseTool?: Function;               // Policy enforcement callback
}
```

**Event types to yield:**

| Event Type | When | Content Shape |
|------------|------|---------------|
| `thinking` | LLM is reasoning (chain-of-thought) | `{ text: string }` |
| `text` | LLM produced text output | `{ text: string }` |
| `tool_call` | LLM wants to invoke a tool | `{ toolCallId: string, tool: string, arguments: Record<string, unknown> }` |
| `tool_result` | Tool execution completed | `{ toolCallId: string, result: unknown, error?: string }` |
| `error` | Something went wrong | `{ message: string, isAuthError?: boolean, isQuotaError?: boolean }` |
| `done` | Task completed | `{ text: string, duration_ms?: number, num_turns?: number, total_cost_usd?: number }` |

**Key requirements:**
- Always yield at least one `done` or `error` event before the generator returns.
- Set `isAuthError: true` on error events caused by authentication failures so the orchestrator can trigger re-auth.
- Set `isQuotaError: true` on rate-limit or quota errors so the orchestrator can trigger failover.
- Wire the `task.canUseTool` callback into your tool execution path if your provider supports tool use.

**Example:**

```typescript
async *execute(task: TaskContext): AsyncGenerator<AgentEvent> {
  const startTime = Date.now();
  try {
    const response = await this.callMyLLM(task.task, task.systemPrompt);

    yield {
      type: 'text',
      timestamp: new Date(),
      source: this.name,
      content: { text: response.text },
    };

    yield {
      type: 'done',
      timestamp: new Date(),
      source: this.name,
      content: {
        text: response.text,
        duration_ms: Date.now() - startTime,
        total_cost_usd: response.cost,
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    yield {
      type: 'error',
      timestamp: new Date(),
      source: this.name,
      content: {
        message,
        isAuthError: this.isAuthError(message),
        isQuotaError: this.isQuotaError(message),
      },
    };
  }
}
```

### `abort(jobId: string): Promise<void>`

Cancels an in-progress task. The orchestrator calls this when a task needs to be stopped (e.g., user cancellation, timeout, or failover).

Track active queries by `jobId` so you can cancel the correct one:

```typescript
private activeQueries = new Map<string, AbortController>();

async abort(jobId: string): Promise<void> {
  const controller = this.activeQueries.get(jobId);
  if (controller) {
    controller.abort();
    this.activeQueries.delete(jobId);
  }
}
```

---

## Provider Lifecycle

1. **Construction** -- The daemon reads `config.toml` and creates provider instances based on the `type` field. Your provider receives its `ProviderConfig` at construction time.

2. **Boot** -- The orchestrator calls `boot()` which initializes the Router, FailoverController, and AuthMonitor with all provider instances. The AuthMonitor begins periodic `checkAuth()` calls.

3. **Routing** -- When a task arrives, the Router calls `isAvailable()` on each provider, filters by capabilities and cost tier, then selects based on the routing mode.

4. **Execution** -- The orchestrator calls `execute()` on the selected provider. Events flow through the generator, are persisted by the SessionManager, and forwarded to the caller.

5. **Failover** -- If `execute()` yields an error event or throws, the FailoverController may select an alternative provider and re-execute with context handoff.

6. **Shutdown** -- The orchestrator calls `abort()` on any active queries, then stops background timers.

---

## Registration

To register a custom provider, add it to the provider factory in `src/cli/daemon.ts`:

```typescript
import { MyProvider } from '../providers/my-provider.js';

function createProviders(config: ZoraConfig): LLMProvider[] {
  const providers: LLMProvider[] = [];
  for (const pConfig of config.providers) {
    if (!pConfig.enabled) continue;
    switch (pConfig.type) {
      case 'claude-sdk':
        providers.push(new ClaudeProvider({ config: pConfig }));
        break;
      case 'gemini-cli':
        providers.push(new GeminiProvider({ config: pConfig }));
        break;
      case 'ollama':
        providers.push(new OllamaProvider({ config: pConfig }));
        break;
      // Add your provider here:
      case 'my-provider':
        providers.push(new MyProvider({ config: pConfig }));
        break;
    }
  }
  return providers;
}
```

Then configure it in `config.toml`:

```toml
[[providers]]
name = "my-llm"
type = "my-provider"
rank = 4
capabilities = ["reasoning"]
cost_tier = "metered"
enabled = true
model = "my-model-v2"
```

---

## Complete Example

Here is a minimal but complete provider implementation:

```typescript
import type {
  LLMProvider, AuthStatus, QuotaStatus, ProviderUsage,
  AgentEvent, AgentEventType, TaskContext, ProviderCapability,
  CostTier, ProviderConfig,
} from '../types.js';

interface MyProviderOptions {
  config: ProviderConfig;
}

export class MyProvider implements LLMProvider {
  readonly name: string;
  readonly rank: number;
  readonly capabilities: ProviderCapability[];
  readonly costTier: CostTier;

  private readonly config: ProviderConfig;
  private activeQueries = new Map<string, AbortController>();
  private requestCount = 0;
  private totalCost = 0;
  private lastRequestAt: Date | null = null;

  constructor(options: MyProviderOptions) {
    this.name = options.config.name;
    this.rank = options.config.rank;
    this.capabilities = options.config.capabilities;
    this.costTier = options.config.cost_tier;
    this.config = options.config;
  }

  async isAvailable(): Promise<boolean> {
    return this.config.enabled;
  }

  async checkAuth(): Promise<AuthStatus> {
    // Probe your backend's auth status here
    return {
      valid: true,
      expiresAt: null,
      canAutoRefresh: true,
      requiresInteraction: false,
    };
  }

  async getQuotaStatus(): Promise<QuotaStatus> {
    return {
      isExhausted: false,
      remainingRequests: null,
      cooldownUntil: null,
      healthScore: 1.0,
    };
  }

  getUsage(): ProviderUsage {
    return {
      totalCostUsd: this.totalCost,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      requestCount: this.requestCount,
      lastRequestAt: this.lastRequestAt,
    };
  }

  async *execute(task: TaskContext): AsyncGenerator<AgentEvent> {
    const controller = new AbortController();
    this.activeQueries.set(task.jobId, controller);
    const startTime = Date.now();

    try {
      // Call your LLM API here
      const response = await fetch('https://api.my-llm.com/chat', {
        method: 'POST',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.config.model,
          prompt: task.task,
          system: task.systemPrompt,
        }),
      });

      if (!response.ok) {
        throw new Error(`API error: ${response.status}`);
      }

      const data = await response.json();
      this.requestCount++;
      this.lastRequestAt = new Date();

      yield {
        type: 'text' as AgentEventType,
        timestamp: new Date(),
        source: this.name,
        content: { text: data.text },
      };

      yield {
        type: 'done' as AgentEventType,
        timestamp: new Date(),
        source: this.name,
        content: {
          text: data.text,
          duration_ms: Date.now() - startTime,
          total_cost_usd: data.cost ?? 0,
        },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      yield {
        type: 'error' as AgentEventType,
        timestamp: new Date(),
        source: this.name,
        content: { message },
      };
    } finally {
      this.activeQueries.delete(task.jobId);
    }
  }

  async abort(jobId: string): Promise<void> {
    const controller = this.activeQueries.get(jobId);
    if (controller) {
      controller.abort();
      this.activeQueries.delete(jobId);
    }
  }
}
```

---

## Testing

Providers should be testable without real API calls. Use dependency injection for the backend client:

```typescript
// In your provider constructor, accept an optional client/queryFn
constructor(options: MyProviderOptions) {
  this.client = options.client ?? new RealApiClient();
}
```

In tests, inject a mock:

```typescript
const mockClient = {
  chat: async () => ({ text: 'mock response', cost: 0 }),
};
const provider = new MyProvider({ config, client: mockClient });
```

See `src/providers/claude-provider.ts` for a production example of this pattern (the `queryFn` injection).
