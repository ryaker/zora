/**
 * ClaudeProvider — LLMProvider implementation backed by the Claude Agent SDK.
 *
 * Spec §4.2 "Claude Provider" (type: "claude-sdk"):
 *   - SDK: @anthropic-ai/claude-agent-sdk
 *   - Authentication: Mac session token (no API key required)
 *   - Execution mode: Embedded agent with streaming events
 *   - Max turns: configurable (default 200)
 *
 * Design decisions:
 *   - query function is dependency-injected (queryFn) so tests never spawn real processes
 *   - SDKMessage → AgentEvent mapping is explicit and exhaustive
 *   - AbortController wired through for clean cancellation
 *   - Auth/quota checks use accountInfo() probe on the Query object
 */

import type {
  LLMProvider,
  AuthStatus,
  QuotaStatus,
  ProviderUsage,
  AgentEvent,
  AgentEventType,
  TaskContext,
  ProviderCapability,
  CostTier,
  ProviderConfig,
} from '../types.js';

// ─── SDK types (re-exported for test fixture typing) ────────────────

/**
 * Minimal subset of SDK message types we consume.
 * Using structural types rather than importing SDK internals directly
 * to keep the boundary clean and testable.
 */

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
  parent_tool_use_id: string | null;
}

export interface SDKResultMessage {
  type: 'result';
  subtype: 'success' | 'error_max_turns' | 'error_during_execution' | 'error_max_budget_usd' | 'error_max_structured_output_retries';
  uuid: string;
  session_id: string;
  duration_ms: number;
  is_error: boolean;
  num_turns: number;
  result?: string;
  total_cost_usd: number;
  errors?: string[];
}

export interface SDKSystemMessage {
  type: 'system';
  subtype: string;
  uuid: string;
  session_id: string;
  model?: string;
  tools?: string[];
}

export interface SDKUserMessage {
  type: 'user';
  uuid?: string;
  session_id: string;
  message: unknown;
  parent_tool_use_id: string | null;
}

export type SDKMessage =
  | SDKAssistantMessage
  | SDKResultMessage
  | SDKSystemMessage
  | SDKUserMessage
  | { type: string; [key: string]: unknown }; // catch-all for types we don't handle

/**
 * Minimal Query interface matching what the SDK returns.
 * We only depend on the AsyncGenerator behavior + abort.
 */
export interface SDKQuery extends AsyncGenerator<SDKMessage, void> {
  abort?: () => void;
}

/**
 * The injectable query function type.
 * Matches the SDK's `query({ prompt, options })` signature.
 */
export type QueryFn = (params: {
  prompt: string;
  options?: Record<string, unknown>;
}) => SDKQuery;

// ─── Provider Options ───────────────────────────────────────────────

export interface ClaudeProviderOptions {
  /** Provider config from config.toml */
  config: ProviderConfig;

  /** Injected query function. Defaults to the real SDK's query(). */
  queryFn?: QueryFn;

  /** Working directory for the agent. Defaults to process.cwd(). */
  cwd?: string;

  /** System prompt prefix. */
  systemPrompt?: string;

  /** Allowed tools list for the SDK. */
  allowedTools?: string[];

  /** Permission mode. Defaults to 'bypassPermissions' for autonomous operation. */
  permissionMode?: 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan';
}

// ─── Claude Provider ────────────────────────────────────────────────

export class ClaudeProvider implements LLMProvider {
  readonly name: string;
  readonly rank: number;
  readonly capabilities: ProviderCapability[];
  readonly costTier: CostTier;

  private readonly _config: ProviderConfig;
  private readonly _queryFn: QueryFn;
  private readonly _cwd: string;
  private readonly _systemPrompt: string;
  private readonly _allowedTools: string[];
  private readonly _permissionMode: string;

  /** Active queries indexed by jobId for abort support */
  private readonly _activeQueries: Map<string, { abort: AbortController; query: SDKQuery }> = new Map();

  /** Cached auth status from last check */
  private _lastAuthStatus: AuthStatus | null = null;

  /** Cached quota status from last check */
  private _lastQuotaStatus: QuotaStatus | null = null;

  /** Track cumulative cost */
  private _totalCostUsd = 0;

  /** Track cumulative token usage */
  private _totalInputTokens = 0;
  private _totalOutputTokens = 0;
  private _requestCount = 0;
  private _lastRequestAt: Date | null = null;

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

    // Dependency injection: use provided queryFn or lazy-load the real SDK
    if (options.queryFn) {
      this._queryFn = options.queryFn;
    } else {
      // Lazy import to avoid requiring the SDK at construction time
      // This will be resolved at first execute() call
      this._queryFn = null as unknown as QueryFn;
    }
  }

  /**
   * Resolve the query function — lazy-loads the real SDK if no mock was injected.
   */
  private async _resolveQueryFn(): Promise<QueryFn> {
    if (this._queryFn) return this._queryFn;

    // Dynamic import of the real SDK
    const sdk = await import('@anthropic-ai/claude-agent-sdk');
    const realQuery = sdk.query as unknown as QueryFn;
    // Cache it so we don't re-import
    (this as any)._queryFn = realQuery;
    return realQuery;
  }

  // ─── LLMProvider interface ──────────────────────────────────────

  async isAvailable(): Promise<boolean> {
    // Claude is available if:
    // 1. Provider is enabled in config
    // 2. Auth is valid (or we haven't checked yet — optimistic)
    if (!this._config.enabled) return false;
    if (this._lastAuthStatus && !this._lastAuthStatus.valid) return false;
    if (this._lastQuotaStatus?.isExhausted) return false;
    return true;
  }

  async checkAuth(): Promise<AuthStatus> {
    // For the injected mock path, we can't probe the real SDK.
    // Return optimistic auth if we have no cached status.
    // In production, the orchestrator's heartbeat loop calls this periodically
    // and the real SDK will surface auth errors during execute().
    if (this._lastAuthStatus) {
      return this._lastAuthStatus;
    }

    // Default to optimistic — auth will be validated on first execute()
    const status: AuthStatus = {
      valid: true,
      expiresAt: null,
      canAutoRefresh: true,
      requiresInteraction: false,
    };
    this._lastAuthStatus = status;
    return status;
  }

  async getQuotaStatus(): Promise<QuotaStatus> {
    if (this._lastQuotaStatus) {
      return this._lastQuotaStatus;
    }

    // Default to healthy
    const status: QuotaStatus = {
      isExhausted: false,
      remainingRequests: null,
      cooldownUntil: null,
      healthScore: 1.0,
    };
    this._lastQuotaStatus = status;
    return status;
  }

  async *execute(task: TaskContext): AsyncGenerator<AgentEvent> {
    const queryFn = await this._resolveQueryFn();
    const abortController = new AbortController();

    // Build SDK options
    const sdkOptions: Record<string, unknown> = {
      abortController,
      model: this._config.model ?? 'claude-sonnet-4-5',
      cwd: this._cwd,
      permissionMode: this._permissionMode,
      maxTurns: task.maxTurns ?? this._config.max_turns ?? 200,
      // Prefer the per-task system prompt, falling back to the provider default.
      systemPrompt: task.systemPrompt || this._systemPrompt,
    };

    if (this._allowedTools.length > 0) {
      sdkOptions['allowedTools'] = this._allowedTools;
    }

    // Wire policy enforcement into the SDK
    if (task.canUseTool) {
      sdkOptions['canUseTool'] = task.canUseTool;
    }

    // Build the prompt from task context
    const prompt = this._buildPrompt(task);

    try {
      // Create the SDK query
      const sdkQuery = queryFn({ prompt, options: sdkOptions });

      // Register for abort support
      this._activeQueries.set(task.jobId, { abort: abortController, query: sdkQuery });

      let emittedResult = false;

      for await (const message of sdkQuery) {
        const events = this._mapSDKMessage(message);
        for (const event of events) {
          if (event.type === 'done' || (event.type === 'error' && message.type === 'result')) {
            emittedResult = true;
          }
          yield event;

          // If we got a result message, update internal state
          if (message.type === 'result') {
            this._handleResultMessage(message as SDKResultMessage);
          }
        }
      }

      // Only yield fallback if the SDK never emitted a result message
      if (!emittedResult) {
        yield {
          type: 'done' as AgentEventType,
          timestamp: new Date(),
          source: this.name,
          content: { text: '' },
        };
      }
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : String(err);

      // Check for specific error types that indicate auth/quota issues
      if (this._isAuthError(errorMessage)) {
        this._lastAuthStatus = {
          valid: false,
          expiresAt: null,
          canAutoRefresh: false,
          requiresInteraction: true,
        };
      } else if (this._isQuotaError(errorMessage)) {
        this._lastQuotaStatus = {
          isExhausted: true,
          remainingRequests: 0,
          cooldownUntil: new Date(Date.now() + 60_000), // 1 min default cooldown
          healthScore: 0,
        };
      }

      yield {
        type: 'error' as AgentEventType,
        timestamp: new Date(),
        source: this.name,
        content: {
          message: errorMessage,
          isAuthError: this._isAuthError(errorMessage),
          isQuotaError: this._isQuotaError(errorMessage),
        },
      };
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

  // ─── SDK Message Mapping ──────────────────────────────────────────

  /**
   * Map an SDK message to zero or more AgentEvents.
   * One SDK message can produce multiple events (e.g., an assistant message
   * with both thinking and text content blocks).
   */
  private _mapSDKMessage(message: SDKMessage): AgentEvent[] {
    const events: AgentEvent[] = [];

    switch (message.type) {
      case 'assistant': {
        const msg = message as SDKAssistantMessage;
        for (const block of msg.message.content) {
          switch (block.type) {
            case 'thinking':
              events.push({
                type: 'thinking',
                timestamp: new Date(),
                source: this.name,
                content: { text: block.thinking },
              });
              break;
            case 'text':
              events.push({
                type: 'text',
                timestamp: new Date(),
                source: this.name,
                content: { text: block.text },
              });
              break;
            case 'tool_use':
              events.push({
                type: 'tool_call',
                timestamp: new Date(),
                source: this.name,
                content: {
                  toolCallId: block.id,
                  tool: block.name,
                  arguments: block.input,
                },
              });
              break;
            case 'tool_result':
              events.push({
                type: 'tool_result',
                timestamp: new Date(),
                source: this.name,
                content: {
                  toolCallId: block.tool_use_id,
                  result: block.content,
                },
              });
              break;
          }
        }
        break;
      }

      case 'result': {
        const msg = message as SDKResultMessage;
        if (msg.is_error) {
          events.push({
            type: 'error',
            timestamp: new Date(),
            source: this.name,
            content: {
              message: msg.errors?.join('; ') ?? `SDK error: ${msg.subtype}`,
              subtype: msg.subtype,
              duration_ms: msg.duration_ms,
              num_turns: msg.num_turns,
              total_cost_usd: msg.total_cost_usd,
            },
          });
        } else {
          events.push({
            type: 'done',
            timestamp: new Date(),
            source: this.name,
            content: {
              text: msg.result ?? '',
              duration_ms: msg.duration_ms,
              num_turns: msg.num_turns,
              total_cost_usd: msg.total_cost_usd,
            },
          });
        }
        break;
      }

      case 'system': {
        // System messages are informational — we don't emit them as AgentEvents
        // but we could log them for debugging
        break;
      }

      case 'user': {
        // User message replays — skip
        break;
      }

      default: {
        // Unknown message type — ignore gracefully
        break;
      }
    }

    return events;
  }

  // ─── Internal helpers ─────────────────────────────────────────────

  /**
   * Build a prompt string from task context.
   * Includes memory context, history, and system prompt elements.
   */
  private _buildPrompt(task: TaskContext): string {
    const parts: string[] = [];

    // Memory context (if any)
    if (task.memoryContext.length > 0) {
      parts.push('<memory_context>');
      parts.push(task.memoryContext.join('\n'));
      parts.push('</memory_context>');
      parts.push('');
    }

    // History (if any) — helps with restarts and steering
    if (task.history.length > 0) {
      parts.push('<execution_history>');
      for (const event of task.history) {
        if (event.type === 'text') {
          parts.push('  <assistant_response>');
          parts.push((event.content as any).text);
          parts.push('  </assistant_response>');
        } else if (event.type === 'tool_call') {
          const c = event.content as any;
          parts.push(`  <tool_call name="${c.tool}" id="${c.toolCallId}">`);
          parts.push(JSON.stringify(c.arguments, null, 2));
          parts.push('  </tool_call>');
        } else if (event.type === 'tool_result') {
          const c = event.content as any;
          parts.push(`  <tool_result id="${c.toolCallId}">`);
          parts.push(JSON.stringify(c.result, null, 2));
          parts.push('  </tool_result>');
        } else if (event.type === 'steering') {
          const c = event.content as any;
          parts.push(`  <human_steering source="${c.source}" author="${c.author}">`);
          parts.push(c.text);
          parts.push('  </human_steering>');
        }
      }
      parts.push('</execution_history>');
      parts.push('');
    }

    // The actual task
    parts.push(`Current Task: ${task.task}`);

    return parts.join('\n');
  }

  /**
   * Update internal state based on SDK result message.
   */
  private _handleResultMessage(msg: SDKResultMessage): void {
    this._totalCostUsd += msg.total_cost_usd;
    this._requestCount++;
    this._lastRequestAt = new Date();

    // Aggregate token usage from modelUsage if the SDK exposes it
    const raw = msg as unknown as Record<string, unknown>;
    if (raw.modelUsage && typeof raw.modelUsage === 'object') {
      for (const usage of Object.values(raw.modelUsage as Record<string, Record<string, number>>)) {
        this._totalInputTokens += usage.inputTokens ?? 0;
        this._totalOutputTokens += usage.outputTokens ?? 0;
      }
    }

    // If result was an error, check if it's auth/quota related
    if (msg.is_error && msg.subtype === 'error_max_turns') {
      // Not an auth/quota issue — just hit max turns
    }
  }

  /**
   * Heuristic to detect auth errors from error messages.
   */
  private _isAuthError(message: string): boolean {
    const authPatterns = [
      'authentication',
      'auth_error',
      'unauthorized',
      'session expired',
      'session_expired',
      'token expired',
      'invalid_token',
      'not authenticated',
      'login required',
    ];
    const lower = message.toLowerCase();
    return authPatterns.some((p) => lower.includes(p));
  }

  /**
   * Heuristic to detect quota/rate-limit errors from error messages.
   */
  private _isQuotaError(message: string): boolean {
    const quotaPatterns = [
      'rate_limit',
      'rate limit',
      'quota',
      'too many requests',
      'capacity',
      'overloaded',
      '429',
    ];
    const lower = message.toLowerCase();
    return quotaPatterns.some((p) => lower.includes(p));
  }

  // ─── Public getters for observability ─────────────────────────────

  get totalCostUsd(): number {
    return this._totalCostUsd;
  }

  get activeJobCount(): number {
    return this._activeQueries.size;
  }

  get lastAuthStatus(): AuthStatus | null {
    return this._lastAuthStatus;
  }

  get lastQuotaStatus(): QuotaStatus | null {
    return this._lastQuotaStatus;
  }

  getUsage(): ProviderUsage {
    return {
      totalCostUsd: this._totalCostUsd,
      totalInputTokens: this._totalInputTokens,
      totalOutputTokens: this._totalOutputTokens,
      requestCount: this._requestCount,
      lastRequestAt: this._lastRequestAt,
    };
  }

  /**
   * Force-set auth status (used by orchestrator on external auth events).
   */
  setAuthStatus(status: AuthStatus): void {
    this._lastAuthStatus = status;
  }

  /**
   * Force-set quota status (used by orchestrator on external quota events).
   */
  setQuotaStatus(status: QuotaStatus): void {
    this._lastQuotaStatus = status;
  }

  /**
   * Reset cached status (used after auth recovery).
   */
  resetStatus(): void {
    this._lastAuthStatus = null;
    this._lastQuotaStatus = null;
  }
}
