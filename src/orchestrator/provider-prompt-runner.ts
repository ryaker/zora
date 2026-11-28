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
 * ranked provider list (and its failover) applies to them too. Enforcement is
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
    };

    const provider = await o.selectProvider(task);

    let aborted = false;
    const abort = (): void => {
      aborted = true;
      void provider.abort(task.jobId);
    };
    if (o.signal?.aborted) throw new Error('Execution cancelled');
    o.signal?.addEventListener('abort', abort, { once: true });
    const timer = o.timeoutMs ? setTimeout(abort, o.timeoutMs) : null;
    timer?.unref?.();

    let streamed = '';
    try {
      for await (const event of provider.execute(task) as AsyncIterable<AgentEvent>) {
        const content = event.content as { text?: unknown; message?: unknown };
        if (event.type === 'text' && typeof content.text === 'string') streamed += content.text;
        if (event.type === 'error') {
          throw new Error(typeof content.message === 'string' ? content.message : `${provider.name} failed`);
        }
        if (event.type === 'done') {
          if (aborted) throw new Error('Execution cancelled');
          return typeof content.text === 'string' && content.text.length > 0 ? content.text : streamed;
        }
      }
      if (aborted) throw new Error('Execution cancelled');
      return streamed;
    } finally {
      if (timer) clearTimeout(timer);
      o.signal?.removeEventListener('abort', abort);
    }
  }
}
