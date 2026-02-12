/**
 * MockProvider — test fixture implementing LLMProvider interface.
 *
 * Configurable behavior for testing routing, failover, and execution.
 * From TEST_PLAN.md: "Mock LLM provider that returns predictable responses"
 */

import type {
  LLMProvider,
  AuthStatus,
  QuotaStatus,
  AgentEvent,
  TaskContext,
  ProviderCapability,
  CostTier,
} from '../../src/types.js';

export interface MockProviderOptions {
  name?: string;
  rank?: number;
  capabilities?: ProviderCapability[];
  costTier?: CostTier;
  available?: boolean;
  authValid?: boolean;
  authExpiresAt?: Date | null;
  quotaExhausted?: boolean;
  healthScore?: number;
  shouldFail?: boolean;
  failAfterEvents?: number;
  responseText?: string;
  latencyMs?: number;
}

export class MockProvider implements LLMProvider {
  readonly name: string;
  readonly rank: number;
  readonly capabilities: ProviderCapability[];
  readonly costTier: CostTier;

  private _available: boolean;
  private _authValid: boolean;
  private _authExpiresAt: Date | null;
  private _quotaExhausted: boolean;
  private _healthScore: number;
  private _shouldFail: boolean;
  private _failAfterEvents: number;
  private _responseText: string;
  private _latencyMs: number;

  // Tracking for assertions
  public executeCalls: TaskContext[] = [];
  public abortCalls: string[] = [];
  public authCheckCount = 0;
  public quotaCheckCount = 0;

  constructor(options: MockProviderOptions = {}) {
    this.name = options.name ?? 'mock';
    this.rank = options.rank ?? 1;
    this.capabilities = options.capabilities ?? ['reasoning', 'coding'];
    this.costTier = options.costTier ?? 'free';
    this._available = options.available ?? true;
    this._authValid = options.authValid ?? true;
    this._authExpiresAt = options.authExpiresAt ?? null;
    this._quotaExhausted = options.quotaExhausted ?? false;
    this._healthScore = options.healthScore ?? 1.0;
    this._shouldFail = options.shouldFail ?? false;
    this._failAfterEvents = options.failAfterEvents ?? -1;
    this._responseText = options.responseText ?? 'Mock response';
    this._latencyMs = options.latencyMs ?? 0;
  }

  async isAvailable(): Promise<boolean> {
    return this._available;
  }

  async checkAuth(): Promise<AuthStatus> {
    this.authCheckCount++;
    return {
      valid: this._authValid,
      expiresAt: this._authExpiresAt,
      canAutoRefresh: false,
      requiresInteraction: !this._authValid,
    };
  }

  async getQuotaStatus(): Promise<QuotaStatus> {
    this.quotaCheckCount++;
    return {
      isExhausted: this._quotaExhausted,
      remainingRequests: this._quotaExhausted ? 0 : 100,
      cooldownUntil: null,
      healthScore: this._healthScore,
    };
  }

  async *execute(task: TaskContext): AsyncGenerator<AgentEvent> {
    this.executeCalls.push(task);

    if (this._latencyMs > 0) {
      await new Promise((r) => setTimeout(r, this._latencyMs));
    }

    if (this._shouldFail) {
      yield {
        type: 'error',
        timestamp: new Date(),
        content: { message: 'Mock provider failure' },
      };
      return;
    }

    let eventCount = 0;

    yield {
      type: 'thinking',
      timestamp: new Date(),
      content: { text: `Processing: ${task.task}` },
    };
    eventCount++;

    if (this._failAfterEvents >= 0 && eventCount >= this._failAfterEvents) {
      yield {
        type: 'error',
        timestamp: new Date(),
        content: { message: 'Mock provider failed mid-execution' },
      };
      return;
    }

    yield {
      type: 'text',
      timestamp: new Date(),
      content: { text: this._responseText },
    };
    eventCount++;

    if (this._failAfterEvents >= 0 && eventCount >= this._failAfterEvents) {
      yield {
        type: 'error',
        timestamp: new Date(),
        content: { message: 'Mock provider failed mid-execution' },
      };
      return;
    }

    yield {
      type: 'done',
      timestamp: new Date(),
      content: { text: 'Complete' },
    };
  }

  async abort(jobId: string): Promise<void> {
    this.abortCalls.push(jobId);
  }

  // ─── Test helpers ────────────────────────────────────────────────

  setAvailable(v: boolean): void {
    this._available = v;
  }

  setAuthValid(v: boolean): void {
    this._authValid = v;
  }

  setQuotaExhausted(v: boolean): void {
    this._quotaExhausted = v;
  }

  setHealthScore(v: number): void {
    this._healthScore = v;
  }

  setShouldFail(v: boolean): void {
    this._shouldFail = v;
  }

  reset(): void {
    this.executeCalls = [];
    this.abortCalls = [];
    this.authCheckCount = 0;
    this.quotaCheckCount = 0;
  }
}
