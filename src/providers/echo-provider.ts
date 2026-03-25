/**
 * EchoProvider — Deterministic LLMProvider for e2e testing.
 *
 * type: 'echo' in config. No API keys required. Always available.
 * Produces deterministic responses based on prompt keywords so that
 * e2e tests can assert on output without real LLM calls.
 *
 * Response rules (first match wins):
 *   "reverse"              → reversed words of the prompt
 *   "count"                → word count of the prompt
 *   "summarize"/"summary"  → first sentence + "Summary complete."
 *   "code"/"function"/"write" → minimal code snippet
 *   "evaluate"/"review"/"check" → "EVALUATION: [provider:echo] Task appears correct. No issues found."
 *   otherwise              → "Echo: <first 100 chars of task>"
 */

import type {
  LLMProvider,
  AuthStatus,
  QuotaStatus,
  ProviderUsage,
  AgentEvent,
  TaskContext,
  ProviderCapability,
  CostTier,
  ProviderConfig,
} from '../types.js';

export interface EchoProviderOptions {
  config: ProviderConfig;
}

export class EchoProvider implements LLMProvider {
  readonly name: string;
  readonly rank: number;
  readonly capabilities: ProviderCapability[];
  readonly costTier: CostTier = 'free';

  private readonly _config: ProviderConfig;
  private _requestCount = 0;
  private _lastRequestAt: Date | null = null;

  constructor(options: EchoProviderOptions) {
    const { config } = options;
    this.name = config.name;
    this.rank = config.rank;
    this.capabilities = config.capabilities;
    this.costTier = 'free';
    this._config = config;
  }

  async isAvailable(): Promise<boolean> {
    return this._config.enabled;
  }

  async checkAuth(): Promise<AuthStatus> {
    return {
      valid: true,
      expiresAt: null,
      canAutoRefresh: false,
      requiresInteraction: false,
    };
  }

  async getQuotaStatus(): Promise<QuotaStatus> {
    return {
      isExhausted: false,
      remainingRequests: null,
      cooldownUntil: null,
      healthScore: 1,
    };
  }

  getUsage(): ProviderUsage {
    return {
      totalCostUsd: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      requestCount: this._requestCount,
      lastRequestAt: this._lastRequestAt,
    };
  }

  async abort(_jobId: string): Promise<void> {
    // Nothing to abort for synchronous echo provider
  }

  /**
   * Generates deterministic responses based on prompt content.
   * Emits: task.start → text → task.end → done
   *
   * Uses AgentEvent.source to record the provider name so consumers
   * can identify which provider handled the task from the session log.
   */
  async *execute(task: TaskContext): AsyncGenerator<AgentEvent> {
    this._requestCount++;
    this._lastRequestAt = new Date();

    const startedAt = Date.now();
    const prompt = task.task.toLowerCase();

    // task.start
    yield {
      type: 'task.start',
      source: this.name,
      timestamp: new Date(),
      content: {
        jobId: task.jobId,
        task: task.task,
      },
    };

    // Compute deterministic response
    const responseText = this._computeResponse(task.task, prompt);

    // text event
    yield {
      type: 'text',
      source: this.name,
      timestamp: new Date(),
      content: {
        text: responseText,
      },
    };

    const duration = Date.now() - startedAt;

    // task.end
    yield {
      type: 'task.end',
      source: this.name,
      timestamp: new Date(),
      content: {
        jobId: task.jobId,
        duration_ms: duration,
        success: true,
      },
    };

    // done
    yield {
      type: 'done',
      source: this.name,
      timestamp: new Date(),
      content: {
        text: responseText,
        duration_ms: duration,
        num_turns: 1,
        total_cost_usd: 0,
        model: 'echo',
      },
    };
  }

  private _computeResponse(originalTask: string, lowerPrompt: string): string {
    if (lowerPrompt.includes('reverse')) {
      const words = originalTask.trim().split(/\s+/);
      return words.reverse().join(' ');
    }

    if (lowerPrompt.includes('count')) {
      const words = originalTask.trim().split(/\s+/);
      return `Word count: ${words.length}`;
    }

    if (lowerPrompt.includes('summarize') || lowerPrompt.includes('summary')) {
      // First sentence: up to the first period, exclamation, or question mark
      const match = originalTask.match(/^[^.!?]+[.!?]/);
      const firstSentence = match ? match[0]!.trim() : originalTask.slice(0, 80);
      return `${firstSentence} Summary complete.`;
    }

    if (lowerPrompt.includes('code') || lowerPrompt.includes('function') || lowerPrompt.includes('write')) {
      return [
        '```typescript',
        'function echoTask(input: string): string {',
        '  return input;',
        '}',
        '```',
      ].join('\n');
    }

    if (lowerPrompt.includes('evaluate') || lowerPrompt.includes('review') || lowerPrompt.includes('check')) {
      return `EVALUATION: [provider:echo] Task appears correct. No issues found.`;
    }

    // Default
    const preview = originalTask.slice(0, 100);
    return `Echo: ${preview}`;
  }
}
