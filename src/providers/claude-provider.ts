/**
 * ClaudeProvider — LLMProvider implementation backed by the Claude Agent SDK.
 *
 * Spec §4.2 "Claude Provider" (type: "claude-sdk"):
 *   - SDK: @anthropic-ai/claude-agent-sdk
 *   - Authentication: Mac session token (no API key required)
 *   - Execution mode: Embedded agent with streaming events
 *   - Max turns: configurable (default 200)
 */

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

// ─── SDK types (structural types to avoid hard dependency) ──────────

export interface SDKAssistantMessage {
  type: 'assistant';
  uuid: string;
  session_id: string;
  message: {
    role: 'assistant';
    content: Array<
      | { type: 'text'; text: string }
      | { type: 'thinking'; thinking: string }
      | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
      | { type: 'tool_result'; tool_use_id: string; content: unknown }
    >;
  };
}

export interface SDKResultMessage {
  type: 'result';
  subtype: string;
  uuid: string;
  session_id: string;
  duration_ms: number;
  is_error: boolean;
  num_turns: number;
  result?: string;
  total_cost_usd: number;
  errors?: string[];
}

export type SDKMessage =
  | SDKAssistantMessage
  | SDKResultMessage
  | { type: 'system' | 'user'; [key: string]: unknown }
  | { type: string; [key: string]: unknown };

export interface SDKQuery extends AsyncGenerator<SDKMessage, void> {
  abort?: () => void;
}

export type QueryFn = (params: {
  prompt: string;
  options?: Record<string, unknown>;
}) => SDKQuery;

export interface ClaudeProviderOptions {
  config: ProviderConfig;
  queryFn?: QueryFn;
  cwd?: string;
  systemPrompt?: string;
  allowedTools?: string[];
  permissionMode?: 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan';
}

export class ClaudeProvider implements LLMProvider {
  readonly name: string;
  readonly rank: number;
  readonly capabilities: ProviderCapability[];
  readonly costTier: CostTier;

  private readonly _config: ProviderConfig;
  private _queryFn: QueryFn | null;
  private readonly _cwd: string;
  private readonly _systemPrompt: string;
  private readonly _allowedTools: string[];
  private readonly _permissionMode: string;

  private readonly _activeQueries: Map<string, { abort: AbortController; query: SDKQuery }> = new Map();
  private _lastAuthStatus: AuthStatus | null = null;
  private _lastQuotaStatus: QuotaStatus | null = null;
  private _totalCostUsd = 0;

  constructor(options: ClaudeProviderOptions) {
    const { config } = options;
    this.name = config.name;
    this.rank = config.rank;
    this.capabilities = config.capabilities;
    this.costTier = config.cost_tier;

    this._config = config;
    this._cwd = options.cwd ?? process.cwd();
    this._systemPrompt = options.systemPrompt ?? '';
    this._allowedTools = options.allowedTools ?? [];
    this._permissionMode = options.permissionMode ?? 'bypassPermissions';
    this._queryFn = options.queryFn ?? null;
  }

  private async _resolveQueryFn(): Promise<QueryFn> {
    if (this._queryFn) return this._queryFn;
    const sdk = await import('@anthropic-ai/claude-agent-sdk');
    this._queryFn = (sdk as any).query as QueryFn;
    return this._queryFn;
  }

  async isAvailable(): Promise<boolean> {
    if (!this._config.enabled) return false;
    if (this._lastAuthStatus && !this._lastAuthStatus.valid) return false;
    if (this._lastQuotaStatus?.isExhausted) return false;
    return true;
  }

  async checkAuth(): Promise<AuthStatus> {
    if (this._lastAuthStatus) return this._lastAuthStatus;
    const status = { valid: true, expiresAt: null, canAutoRefresh: true, requiresInteraction: false };
    this._lastAuthStatus = status;
    return status;
  }

  async getQuotaStatus(): Promise<QuotaStatus> {
    if (this._lastQuotaStatus) return this._lastQuotaStatus;
    const status = { isExhausted: false, remainingRequests: null, cooldownUntil: null, healthScore: 1.0 };
    this._lastQuotaStatus = status;
    return status;
  }

  async *execute(task: TaskContext): AsyncGenerator<AgentEvent> {
    const queryFn = await this._resolveQueryFn();
    const abortController = new AbortController();

    const sdkOptions = {
      abortController,
      model: this._config.model ?? 'claude-sonnet-4-5',
      cwd: this._cwd,
      permissionMode: this._permissionMode,
      maxTurns: task.maxTurns ?? this._config.max_turns ?? 200,
      systemPrompt: this._systemPrompt,
      allowedTools: this._allowedTools,
    };

    const prompt = task.memoryContext.length > 0 
      ? `<memory_context>\n${task.memoryContext.join('\n')}\n</memory_context>\n\n${task.task}`
      : task.task;

    try {
      const sdkQuery = queryFn({ prompt, options: sdkOptions });
      this._activeQueries.set(task.jobId, { abort: abortController, query: sdkQuery });

      for await (const message of sdkQuery) {
        const events = this._mapSDKMessage(message);
        for (const event of events) {
          yield event;
        }
        if (message.type === 'result') {
          const msg = message as SDKResultMessage;
          this._totalCostUsd += msg.total_cost_usd;
        }
      }

      yield { type: 'done' as AgentEventType, timestamp: new Date(), content: { text: 'Query completed' } };
    } catch (err: any) {
      const msg = err.message || String(err);
      yield { type: 'error' as AgentEventType, timestamp: new Date(), content: { message: msg } };
    } finally {
      this._activeQueries.delete(task.jobId);
    }
  }

  async abort(jobId: string): Promise<void> {
    const entry = this._activeQueries.get(jobId);
    if (entry) {
      entry.abort.abort();
      this._activeQueries.delete(jobId);
    }
  }

  private _mapSDKMessage(message: SDKMessage): AgentEvent[] {
    const events: AgentEvent[] = [];
    if (message.type === 'assistant') {
      const msg = message as SDKAssistantMessage;
      for (const block of msg.message.content) {
        if (block.type === 'thinking') events.push({ type: 'thinking', timestamp: new Date(), content: { text: block.thinking } });
        if (block.type === 'text') events.push({ type: 'text', timestamp: new Date(), content: { text: block.text } });
        if (block.type === 'tool_use') events.push({ type: 'tool_call', timestamp: new Date(), content: { toolCallId: block.id, tool: block.name, arguments: block.input } });
        if (block.type === 'tool_result') events.push({ type: 'tool_result', timestamp: new Date(), content: { toolCallId: block.tool_use_id, result: block.content } });
      }
    } else if (message.type === 'result') {
      const msg = message as SDKResultMessage;
      if (msg.is_error) {
        events.push({ type: 'error', timestamp: new Date(), content: { message: msg.errors?.join('; ') || msg.subtype } });
      } else {
        events.push({ type: 'done', timestamp: new Date(), content: { text: msg.result || '', turns: msg.num_turns, cost: msg.total_cost_usd } });
      }
    }
    return events;
  }

  get totalCostUsd(): number { return this._totalCostUsd; }
}
