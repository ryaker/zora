/**
 * ProviderPromptRunner — #254.
 *
 * Memory extraction, context compression and the heartbeat used to call the
 * Claude Agent SDK directly through `ExecutionLoop`, whatever the configured
 * primary was. On an Ollama-first install that meant the "free" background
 * work was the part still billed to Anthropic — and with no Claude credentials
 * it simply failed.
 *
 * This runner gives those paths the same `run(prompt) → text` shape as
 * `ExecutionLoop`, but executes on whichever provider the Router picks, so the
 * ranked provider list applies to them too: a provider that fails before
 * taking any action is retried on the next available rank. Enforcement is
 * not re-implemented here: the caller hands in the same `canUseTool` and SDK
 * hook bridge it would have handed `ExecutionLoop`, they travel on
 * `TaskContext`, and the provider applies them (`ClaudeProvider` via the SDK,
 * `OllamaProvider` via `authorizeToolCall`).
 */

import type { AgentEvent, LLMProvider, TaskContext } from '../types.js';
import type { CustomToolDefinition } from '../tools/zora-mcp-server.js';
import type { ZoraSdkHooks } from '../hooks/sdk-hook-bridge.js';
import type { EnforcedCanUseTool } from '../security/enforced-sdk-options.js';

/** What HeartbeatSystem and the memory pipelines actually need from a loop. */
export interface PromptRunner {
  run(prompt: string): Promise<string>;
}

export interface ProviderPromptRunnerOptions {
  selectProvider: (task: TaskContext) => Promise<LLMProvider>;
  /**
   * Ranked providers to fall back to when the selected one fails before taking
   * any action. Mirrors failover for these paths; omitted = no fallback.
   */
  fallbackProviders?: () => LLMProvider[];
  /** Provider name to prefer (Router `modelPreference`), e.g. agent.heartbeat_provider. */
  modelPreference?: string;
  /** #261: model id for claude-sdk (advisor). */
  modelOverride?: string;
  systemPrompt: string;
  /** Stable label for audit/rate-limit attribution ('heartbeat', 'compress', …). */
  jobLabel: string;
  canUseTool?: EnforcedCanUseTool;
  hooks?: ZoraSdkHooks;
  customTools?: CustomToolDefinition[];
  /** SEC-23 `toolSurface: 'none'` for single-shot text calls. */
  disableTools?: boolean;
  maxTurns?: number;
  /** Caller-owned cancellation (extraction passes its deadline here). */
  signal?: AbortSignal;
  /** Overall deadline in ms; aborts the provider job when exceeded. */
  timeoutMs?: number;
}

let seq = 0;

export class ProviderPromptRunner implements PromptRunner {
  constructor(private readonly _opts: ProviderPromptRunnerOptions) {}

  async run(prompt: string): Promise<string> {
    const o = this._opts;
    const task: TaskContext = {
      jobId: `${o.jobLabel}-${Date.now()}-${++seq}`,
      task: prompt,
      requiredCapabilities: [],
      complexity: 'simple',
      resourceType: 'reasoning',
      systemPrompt: o.systemPrompt,
      memoryContext: [],
      history: [],
      maxTurns: o.maxTurns,
      customTools: o.disableTools ? undefined : o.customTools,
      canUseTool: o.canUseTool,
      sdkHooks: o.hooks,
      disableTools: o.disableTools,
      modelPreference: o.modelPreference,
      modelOverride: o.modelOverride,
    };

    const first = await o.selectProvider(task);
    const candidates = [first];
    for (const p of [...(o.fallbackProviders?.() ?? [])].sort((a, b) => a.rank - b.rank)) {
      if (!candidates.includes(p)) candidates.push(p);
    }

    let lastError: Error | undefined;
    for (const provider of candidates) {
      if (provider !== first && !(await provider.isAvailable().catch(() => false))) continue;
      const outcome = await this._runOn(provider, task);
      if (outcome.ok) return outcome.text;
      lastError = outcome.error;
      // Only an attempt that did nothing may be retried elsewhere: replaying a
      // heartbeat that already ran a tool could repeat a side effect.
      if (outcome.acted || outcome.cancelled) break;
    }
    throw lastError ?? new Error('No provider available');
  }

  private async _runOn(
    provider: LLMProvider,
    task: TaskContext,
  ): Promise<{ ok: true; text: string } | { ok: false; error: Error; acted: boolean; cancelled: boolean }> {
    const o = this._opts;

    let aborted = false;
    const abort = (): void => {
      aborted = true;
      void provider.abort(task.jobId);
    };
    if (o.signal?.aborted) return { ok: false, error: new Error('Execution cancelled'), acted: false, cancelled: true };
    o.signal?.addEventListener('abort', abort, { once: true });
    const timer = o.timeoutMs ? setTimeout(abort, o.timeoutMs) : null;
    timer?.unref?.();

    let streamed = '';
    let acted = false;
    const cancelled = () => ({ ok: false as const, error: new Error('Execution cancelled'), acted, cancelled: true });
    try {
      for await (const event of provider.execute(task) as AsyncIterable<AgentEvent>) {
        const content = event.content as { text?: unknown; message?: unknown };
        if (event.type === 'tool_call') acted = true;
        if (event.type === 'text' && typeof content.text === 'string') streamed += content.text;
        if (event.type === 'error') {
          if (aborted) return cancelled();
          const message = typeof content.message === 'string' ? content.message : `${provider.name} failed`;
          return { ok: false, error: new Error(message), acted, cancelled: false };
        }
        if (event.type === 'done') {
          if (aborted) return cancelled();
          return { ok: true, text: typeof content.text === 'string' && content.text.length > 0 ? content.text : streamed };
        }
      }
      if (aborted) return cancelled();
      return { ok: true, text: streamed };
    } catch (err) {
      if (aborted) return cancelled();
      return { ok: false, error: err instanceof Error ? err : new Error(String(err)), acted, cancelled: false };
    } finally {
      if (timer) clearTimeout(timer);
      o.signal?.removeEventListener('abort', abort);
    }
  }
}
