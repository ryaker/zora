# Developing a New Zora Provider

How to add a new LLM provider to Zora's multi-provider orchestration system.

---

## Overview

Zora's provider system is a ranked registry of LLM backends. The router selects the best available provider for each task based on capabilities, rank, cost, and health. Adding a new provider means implementing the `LLMProvider` interface and registering it in config.

### Architecture

```
config.toml                    Router
  [[providers]]           ┌──────────────┐
  name = "my-provider"    │ selectProvider│
  type = "my-type"        │   (task)      │
  rank = 3           ───► │              │ ───► LLMProvider.execute(task)
  capabilities = [...]    │ rank + caps   │         │
                          │ + health      │         ▼
                          └──────────────┘    AsyncGenerator<AgentEvent>
```

**Key contracts:**
- Providers are stateless across tasks (no shared mutable state between jobs)
- `execute()` returns an `AsyncGenerator<AgentEvent>` for streaming
- Auth and quota checks are cached internally, refreshed by the orchestrator
- Abort support is required for clean cancellation

---

## Step 1: Understand the Interface

The provider contract lives in `src/types.ts`:

```typescript
export interface LLMProvider {
  readonly name: string;
  readonly rank: number;
  readonly capabilities: ProviderCapability[];
  readonly costTier: CostTier;

  isAvailable(): Promise<boolean>;
  checkAuth(): Promise<AuthStatus>;
  getQuotaStatus(): Promise<QuotaStatus>;
  execute(task: TaskContext): AsyncGenerator<AgentEvent>;
  abort(jobId: string): Promise<void>;
}
```

### Required types

```typescript
// What the provider can do — used for task routing
type ProviderCapability =
  | 'reasoning' | 'coding' | 'creative' | 'structured-data'
  | 'large-context' | 'search' | 'fast'
  | (string & {});  // extensible

// Cost classification — affects routing in optimize_cost mode
type CostTier = 'free' | 'included' | 'metered' | 'premium';

// Auth state — checked by orchestrator heartbeat
interface AuthStatus {
  valid: boolean;
  expiresAt: Date | null;
  canAutoRefresh: boolean;
  requiresInteraction: boolean;
}

// Quota state — triggers failover when exhausted
interface QuotaStatus {
  isExhausted: boolean;
  remainingRequests: number | null;
  cooldownUntil: Date | null;
  healthScore: number;  // 0.0 to 1.0
}
```

### The execution contract

`execute()` must yield `AgentEvent` objects:

```typescript
interface AgentEvent {
  type: AgentEventType;
  timestamp: Date;
  content: unknown;
}

type AgentEventType =
  | 'thinking'     // internal reasoning (shown to user if verbose)
  | 'tool_call'    // provider wants to call a tool
  | 'tool_result'  // result of a tool call
  | 'text'         // text output
  | 'error'        // something went wrong
  | 'done'         // task complete
  | 'steering';    // human steering input
```

### The task context

Your provider receives everything it needs via `TaskContext`:

```typescript
interface TaskContext {
  jobId: string;                          // unique job identifier
  task: string;                           // the user's prompt
  requiredCapabilities: ProviderCapability[];
  complexity: TaskComplexity;             // 'simple' | 'moderate' | 'complex'
  resourceType: TaskResourceType;         // 'reasoning' | 'coding' | 'data' | etc.
  systemPrompt: string;                   // system prompt from config + SOUL.md
  memoryContext: string[];                // loaded memory items
  history: AgentEvent[];                  // prior events (for restarts/handoffs)
  modelPreference?: string;              // explicit model override
  maxTurns?: number;
  timeout?: number;
}
```

---

## Step 2: Choose Your Integration Pattern

Zora has two proven patterns. Pick the one that matches your backend.

### Pattern A: SDK/Library Integration

For providers with a native Node.js SDK (Anthropic, OpenAI, Google AI).

**Example:** `ClaudeProvider` in `src/providers/claude-provider.ts`

```typescript
// Key characteristics:
// - Imports SDK directly
// - SDK handles streaming, tool calls, retries
// - Events are mapped from SDK types to AgentEvent
// - Dependency injection for testing (queryFn)

export class MyProvider implements LLMProvider {
  private readonly _sdk: MySDK;

  constructor(options: MyProviderOptions) {
    if (options.sdkInstance) {
      this._sdk = options.sdkInstance;  // test injection
    } else {
      this._sdk = new MySDK({ apiKey: process.env.MY_API_KEY });
    }
  }

  async *execute(task: TaskContext): AsyncGenerator<AgentEvent> {
    const stream = this._sdk.chat.stream({
      model: this._config.model,
      messages: [{ role: 'user', content: this._buildPrompt(task) }],
    });

    for await (const chunk of stream) {
      yield this._mapToAgentEvent(chunk);
    }

    yield { type: 'done', timestamp: new Date(), content: { text: 'Complete' } };
  }
}
```

### Pattern B: CLI Subprocess Wrapper

For providers accessed via a CLI tool (Gemini CLI, Ollama, local models).

**Example:** `GeminiProvider` in `src/providers/gemini-provider.ts`

```typescript
// Key characteristics:
// - Spawns CLI as child process
// - Parses stdout line-by-line
// - Handles stderr for error detection
// - Kill process for abort

import { spawn } from 'node:child_process';

export class MyCliProvider implements LLMProvider {
  async *execute(task: TaskContext): AsyncGenerator<AgentEvent> {
    const child = spawn(this._cliPath, ['chat', '--prompt', prompt]);
    this._activeProcesses.set(task.jobId, child);

    for await (const line of this._streamToLines(child.stdout!)) {
      yield { type: 'text', timestamp: new Date(), content: { text: line } };
    }

    // Check exit code
    const { code } = await exitPromise;
    if (code !== 0) {
      yield { type: 'error', timestamp: new Date(), content: { message: stderr } };
    } else {
      yield { type: 'done', timestamp: new Date(), content: { text: 'Complete' } };
    }
  }

  async abort(jobId: string): Promise<void> {
    this._activeProcesses.get(jobId)?.kill();
  }
}
```

---

## Step 3: Create the Provider File

Create `src/providers/my-provider.ts`:

```typescript
import type {
  LLMProvider,
  AuthStatus,
  QuotaStatus,
  AgentEvent,
  AgentEventType,
  TaskContext,
  ProviderCapability,
  CostTier,
  ProviderConfig,
} from '../types.js';

export interface MyProviderOptions {
  config: ProviderConfig;
  // Add provider-specific options here
}

export class MyProvider implements LLMProvider {
  readonly name: string;
  readonly rank: number;
  readonly capabilities: ProviderCapability[];
  readonly costTier: CostTier;

  private readonly _config: ProviderConfig;
  private _lastAuthStatus: AuthStatus | null = null;
  private _lastQuotaStatus: QuotaStatus | null = null;
  private readonly _activeJobs: Map<string, AbortController> = new Map();

  constructor(options: MyProviderOptions) {
    const { config } = options;
    this.name = config.name;
    this.rank = config.rank;
    this.capabilities = config.capabilities;
    this.costTier = config.cost_tier;
    this._config = config;
  }

  async isAvailable(): Promise<boolean> {
    if (!this._config.enabled) return false;
    if (this._lastAuthStatus && !this._lastAuthStatus.valid) return false;
    if (this._lastQuotaStatus?.isExhausted) return false;
    return true;
  }

  async checkAuth(): Promise<AuthStatus> {
    // TODO: Implement actual auth check for your provider
    return {
      valid: true,
      expiresAt: null,
      canAutoRefresh: true,
      requiresInteraction: false,
    };
  }

  async getQuotaStatus(): Promise<QuotaStatus> {
    // TODO: Implement actual quota check for your provider
    return {
      isExhausted: false,
      remainingRequests: null,
      cooldownUntil: null,
      healthScore: 1.0,
    };
  }

  async *execute(task: TaskContext): AsyncGenerator<AgentEvent> {
    const abort = new AbortController();
    this._activeJobs.set(task.jobId, abort);

    try {
      // TODO: Implement your provider's execution logic
      // 1. Build prompt from task context
      // 2. Call your backend (SDK or CLI)
      // 3. Stream events as AgentEvent objects
      // 4. Handle errors and update auth/quota status

      yield {
        type: 'done' as AgentEventType,
        timestamp: new Date(),
        content: { text: 'Task completed' },
      };
    } catch (err: unknown) {
      yield {
        type: 'error' as AgentEventType,
        timestamp: new Date(),
        content: { message: err instanceof Error ? err.message : String(err) },
      };
    } finally {
      this._activeJobs.delete(task.jobId);
    }
  }

  async abort(jobId: string): Promise<void> {
    const controller = this._activeJobs.get(jobId);
    if (controller) {
      controller.abort();
      this._activeJobs.delete(jobId);
    }
  }
}
```

---

## Step 4: Register in the Barrel Export

Add your provider to `src/providers/index.ts`:

```typescript
export {
  MyProvider,
  type MyProviderOptions,
} from './my-provider.js';
```

---

## Step 5: Add Config Support

Your provider needs a `type` string in `config.toml`. The type maps to your provider class.

### Config entry format

```toml
[[providers]]
name = "my-backend"
type = "my-type"          # This is the key identifier
rank = 3
capabilities = ["coding", "fast"]
cost_tier = "free"
enabled = true

# Provider-specific fields (all optional in the type system)
api_key_env = "MY_API_KEY"       # for API-key providers
cli_path = "/usr/local/bin/my-cli" # for CLI-based providers
endpoint = "http://localhost:11434"  # for self-hosted providers
model = "my-model-name"
max_turns = 100
max_concurrent_jobs = 2
```

### ProviderConfig fields

These are already in `src/types.ts`:

| Field | Type | Purpose |
|-------|------|---------|
| `name` | string | Unique provider ID |
| `type` | string | Integration type (your key) |
| `rank` | number | Priority (lower = higher) |
| `capabilities` | string[] | What tasks this provider handles |
| `cost_tier` | string | free, included, metered, premium |
| `enabled` | boolean | Active or disabled |
| `auth_method` | string? | How auth works |
| `model` | string? | Default model name |
| `max_turns` | number? | Turn limit per task |
| `max_concurrent_jobs` | number? | Parallelism limit |
| `cli_path` | string? | Path to CLI binary |
| `api_key_env` | string? | Env var name for API key |
| `endpoint` | string? | Base URL for API |

---

## Step 6: Write Tests

Create `tests/unit/providers/my-provider.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { MyProvider } from '../../../src/providers/my-provider.js';
import type { ProviderConfig, TaskContext } from '../../../src/types.js';

const makeConfig = (overrides?: Partial<ProviderConfig>): ProviderConfig => ({
  name: 'test-provider',
  type: 'my-type',
  rank: 1,
  capabilities: ['coding'],
  cost_tier: 'free',
  enabled: true,
  ...overrides,
});

const makeTask = (overrides?: Partial<TaskContext>): TaskContext => ({
  jobId: 'test-job-1',
  task: 'Write hello world',
  requiredCapabilities: ['coding'],
  complexity: 'simple',
  resourceType: 'coding',
  systemPrompt: 'You are helpful.',
  memoryContext: [],
  history: [],
  ...overrides,
});

describe('MyProvider', () => {
  it('implements LLMProvider interface', () => {
    const provider = new MyProvider({ config: makeConfig() });
    expect(provider.name).toBe('test-provider');
    expect(provider.rank).toBe(1);
    expect(provider.capabilities).toContain('coding');
  });

  it('reports unavailable when disabled', async () => {
    const provider = new MyProvider({ config: makeConfig({ enabled: false }) });
    expect(await provider.isAvailable()).toBe(false);
  });

  it('returns optimistic auth by default', async () => {
    const provider = new MyProvider({ config: makeConfig() });
    const auth = await provider.checkAuth();
    expect(auth.valid).toBe(true);
  });

  it('returns healthy quota by default', async () => {
    const provider = new MyProvider({ config: makeConfig() });
    const quota = await provider.getQuotaStatus();
    expect(quota.isExhausted).toBe(false);
    expect(quota.healthScore).toBe(1.0);
  });

  it('yields done event on successful execution', async () => {
    const provider = new MyProvider({ config: makeConfig() });
    const events = [];
    for await (const event of provider.execute(makeTask())) {
      events.push(event);
    }
    expect(events.some(e => e.type === 'done')).toBe(true);
  });

  it('supports abort', async () => {
    const provider = new MyProvider({ config: makeConfig() });
    // Should not throw
    await provider.abort('nonexistent-job');
  });
});
```

### What to test

| Test category | What to verify |
|--------------|----------------|
| **Construction** | Config fields map to readonly properties |
| **Availability** | Disabled provider returns `false` |
| **Auth** | Returns valid status by default, invalid after auth failure |
| **Quota** | Returns healthy by default, exhausted after quota error |
| **Execution** | Yields correct event types in order |
| **Event mapping** | Backend responses map to correct `AgentEvent` types |
| **Error handling** | Network errors, timeouts, malformed responses |
| **Abort** | Active job is cancelled, no-op for unknown jobId |
| **Auth errors** | Detected from error messages, status updated |
| **Quota errors** | Detected from error messages, cooldown set |

---

## Step 7: Handle Failover

When your provider fails, the orchestrator needs enough information to hand off to the next provider. Your provider participates by:

1. **Updating auth status** when auth errors occur
2. **Updating quota status** when rate limits hit
3. **Yielding structured error events** so the failover controller can decide what to do

```typescript
// In your execute() method, catch and classify errors:
catch (err: unknown) {
  const message = err instanceof Error ? err.message : String(err);

  if (this._isAuthError(message)) {
    this._lastAuthStatus = {
      valid: false,
      expiresAt: null,
      canAutoRefresh: false,
      requiresInteraction: true,
    };
  }

  if (this._isQuotaError(message)) {
    this._lastQuotaStatus = {
      isExhausted: true,
      remainingRequests: 0,
      cooldownUntil: new Date(Date.now() + 60_000),
      healthScore: 0,
    };
  }

  yield {
    type: 'error',
    timestamp: new Date(),
    content: {
      message,
      isAuthError: this._isAuthError(message),
      isQuotaError: this._isQuotaError(message),
    },
  };
}
```

The orchestrator reads `isAuthError` and `isQuotaError` to trigger the failover flow, which packages context into a `HandoffBundle` and routes to the next-ranked provider.

---

## Checklist

Before merging a new provider:

- [ ] Implements all 5 `LLMProvider` methods
- [ ] Constructor reads from `ProviderConfig`
- [ ] `execute()` yields proper `AgentEvent` sequence (thinking -> text -> tool_call/tool_result -> done)
- [ ] `execute()` yields `error` event on failure (never throws uncaught)
- [ ] `abort()` cancels active work
- [ ] Auth errors update `_lastAuthStatus`
- [ ] Quota errors update `_lastQuotaStatus`
- [ ] Exported from `src/providers/index.ts`
- [ ] Config type string documented
- [ ] Unit tests cover all categories above
- [ ] `npm run lint` passes
- [ ] `npm run test:unit` passes

---

## Reference: Existing Providers

| Provider | File | Pattern | Backend |
|----------|------|---------|---------|
| `ClaudeProvider` | `src/providers/claude-provider.ts` | SDK (dependency-injected) | `@anthropic-ai/claude-agent-sdk` |
| `GeminiProvider` | `src/providers/gemini-provider.ts` | CLI subprocess | `gemini` CLI |

Read these files for production-tested patterns before building yours.
