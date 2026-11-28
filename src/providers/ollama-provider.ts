/**
 * OllamaProvider — LLMProvider implementation backed by Ollama (local models).
 *
 * Spec §4.2 "Ollama Provider" (type: "ollama"):
 *   - API: Ollama REST API (http://localhost:11434 by default)
 *   - Authentication: None (local service)
 *   - Execution mode: HTTP streaming via /api/chat
 *   - Cost tier: 'free' (runs locally, no API metering)
 *
 * Supports any model Ollama can run: Llama, Mistral, Qwen, Gemma,
 * DeepSeek, Phi, CodeLlama, etc.
 *
 * #254: tool calling. Ollama-served models get the native built-ins
 * (src/tools/local-builtin-tools.ts) plus the task's Zora tools, and every call
 * is authorised by src/tools/enforced-tool-call.ts — the same PreToolUse hooks
 * and canUseTool the claude-sdk path receives on TaskContext. Before #254 this
 * provider sent no tools and "parsed" JSON blocks out of the reply text into
 * tool_call events that nothing ever executed.
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
  ZoraPolicy,
} from '../types.js';
import { isTextEvent, isSteeringEvent } from '../types.js';
import { createLogger } from '../utils/logger.js';
import { CircuitBreaker } from './circuit-breaker.js';
import { DEFAULT_OLLAMA_MODEL } from './model-defaults.js';
import { deriveDisallowedTools } from '../security/enforced-sdk-options.js';
import { toolFilterMatches } from '../security/tool-names.js';
import { authorizeToolCall, runPostToolUse, type ToolChain } from '../tools/enforced-tool-call.js';
import { LOCAL_BUILTIN_TOOLS } from '../tools/local-builtin-tools.js';
import { qualifyZoraToolName } from '../tools/zora-mcp-server.js';
import { PolicyEngine } from '../security/policy-engine.js';
import { matchesSensitivePath } from '../hooks/built-in/sensitive-file-guard.js';

const log = createLogger('ollama-provider');

/** Turn budget when neither the task nor config.toml sets max_turns. */
const DEFAULT_MAX_TURNS = 50;

export interface OllamaProviderOptions {
  config: ProviderConfig;
  /** Base URL for the Ollama API. Defaults to config.endpoint or http://localhost:11434 */
  endpoint?: string;
  /** #254: working directory for Bash. Defaults to process.cwd(). */
  cwd?: string;
  /**
   * #254: the resolved policy, for layer [1] (static tool bans), as
   * ClaudeProvider takes it. canUseTool and the hooks are unaffected by it.
   */
  policy?: ZoraPolicy;
}

interface OllamaToolCall {
  function: { name: string; arguments: unknown };
}

interface OllamaMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: OllamaToolCall[];
  tool_name?: string;
}

interface OllamaTool {
  /** The name the enforcement chain sees (SDK spelling; Zora tools qualified). */
  chainName: string;
  description: string;
  parameters: Record<string, unknown>;
  run: (input: Record<string, unknown>, signal: AbortSignal) => Promise<string>;
}

type ChatReply =
  | { kind: 'ok'; text: string; toolCalls: OllamaToolCall[]; model?: string; evalCount?: number }
  | { kind: 'error'; message: string }
  | { kind: 'aborted'; text: string }
  | { kind: 'tools_unsupported' };

/** Ollama documents `arguments` as an object; some models emit a JSON string. */
function parseArguments(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return { ...(raw as Record<string, unknown>) };
  if (typeof raw === 'string') {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
    } catch { /* fall through */ }
  }
  return {};
}

export class OllamaProvider implements LLMProvider {
  readonly name: string;
  readonly rank: number;
  readonly capabilities: ProviderCapability[];
  readonly costTier: CostTier;

  private readonly _config: ProviderConfig;
  private readonly _endpoint: string;
  private readonly _model: string;
  private readonly _cwd: string;
  private readonly _policy: ZoraPolicy | undefined;
  private readonly _allowPath: (absPath: string) => boolean;

  /** Track active requests by jobId for abort support */
  private readonly _activeRequests: Map<string, AbortController> = new Map();

  /** Circuit breaker for failure tracking (PROV-02) */
  private readonly _circuitBreaker: CircuitBreaker;

  private _lastAuthStatus: AuthStatus | null = null;
  private _requestCount = 0;
  private _lastRequestAt: Date | null = null;

  constructor(options: OllamaProviderOptions) {
    const { config } = options;
    this.name = config.name;
    this.rank = config.rank;
    this.capabilities = config.capabilities;
    this.costTier = config.cost_tier;

    this._config = config;
    this._endpoint = (options.endpoint ?? config.endpoint ?? 'http://localhost:11434').replace(/\/$/, '');
    this._model = config.model ?? DEFAULT_OLLAMA_MODEL;
    this._cwd = options.cwd ?? process.cwd();
    this._policy = options.policy;
    // #254 review: Glob/Grep descend below the root the chain judged, so each
    // entry is re-checked against the same path policy and sensitive-file list.
    const engine = options.policy ? new PolicyEngine(options.policy) : null;
    this._allowPath = (p: string) =>
      matchesSensitivePath(p) === null && (engine ? engine.validatePath(p).allowed : true);
    this._circuitBreaker = new CircuitBreaker();
  }

  async isAvailable(): Promise<boolean> {
    if (!this._config.enabled) return false;
    // PROV-02: Check circuit breaker before auth
    if (this._circuitBreaker.isOpen()) return false;
    const auth = await this.checkAuth();
    return auth.valid;
  }

  /**
   * Check if the Ollama server is running and responsive.
   * Pings the /api/tags endpoint which lists available models.
   */
  async checkAuth(): Promise<AuthStatus> {
    if (this._lastAuthStatus?.valid) return this._lastAuthStatus;

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);

      const res = await fetch(`${this._endpoint}/api/tags`, {
        signal: controller.signal,
      });
      clearTimeout(timeout);

      const valid = res.ok;
      const status: AuthStatus = {
        valid,
        expiresAt: null,
        canAutoRefresh: true,
        requiresInteraction: false,
      };
      this._lastAuthStatus = status;
      return status;
    } catch {
      const status: AuthStatus = {
        valid: false,
        expiresAt: null,
        canAutoRefresh: true,
        requiresInteraction: false,
      };
      this._lastAuthStatus = status;
      return status;
    }
  }

  async getQuotaStatus(): Promise<QuotaStatus> {
    // PROV-01: Derive health score from circuit breaker state
    // Local models have no quota limits, but circuit breaker reflects reliability
    const cbState = this._circuitBreaker.getState();
    return {
      isExhausted: cbState === 'OPEN',
      remainingRequests: null,
      cooldownUntil: null,
      healthScore: this._circuitBreaker.healthScore,
    };
  }

  /**
   * #254: run the task as a tool loop.
   *
   * Ollama's /api/chat returns tool calls as data; nothing executes them unless
   * the provider does. Each call goes through `authorizeToolCall()` — the same
   * PreToolUse hooks and canUseTool the SDK path is given on `TaskContext` — and
   * only an authorised call is executed, with the (possibly redacted) input the
   * chain returned. Results go back to the model as `role: "tool"` messages
   * until it answers without a tool call or the turn budget runs out.
   */
  async *execute(task: TaskContext): AsyncGenerator<AgentEvent> {
    // PROV-02: Reject immediately if circuit breaker is OPEN
    if (this._circuitBreaker.isOpen()) {
      yield this._event('error', {
        message: `Circuit breaker is OPEN for provider ${this.name} — too many recent failures`,
        isCircuitOpen: true,
      });
      return;
    }

    const abortController = new AbortController();
    this._activeRequests.set(task.jobId, abortController);
    this._requestCount++;
    this._lastRequestAt = new Date();

    const tools = task.disableTools ? new Map<string, OllamaTool>() : this._buildTools(task);
    const chain: ToolChain = {
      disallowedTools: deriveDisallowedTools(this._policy),
      hooks: task.sdkHooks,
      canUseTool: task.canUseTool,
      signal: abortController.signal,
    };
    const messages = this._buildMessages(task);
    const maxTurns = task.maxTurns ?? this._config.max_turns ?? DEFAULT_MAX_TURNS;
    let sendTools = tools.size > 0;
    let fullText = '';

    try {
      for (let turn = 1; turn <= maxTurns; turn++) {
        yield this._event('turn.start', { turn });

        const reply = yield* this._chatOnce(messages, sendTools ? tools : null, abortController.signal);
        if (reply.kind === 'tools_unsupported') {
          // Some local models reject `tools` outright. Degrade to chat rather
          // than fail: the task still gets an answer, just no actions.
          log.warn({ model: this._model }, 'Model does not support tool calling — continuing without tools');
          sendTools = false;
          turn--;
          continue;
        }
        if (reply.kind === 'error') {
          this._circuitBreaker.recordFailure();
          yield this._event('error', { message: reply.message });
          return;
        }
        if (reply.kind === 'aborted') {
          yield this._event('done', { text: fullText + reply.text, aborted: true });
          return;
        }

        fullText += reply.text;
        yield this._event('turn.end', { turn });

        if (reply.toolCalls.length === 0) {
          this._circuitBreaker.recordSuccess();
          // The result is the final answer; earlier turns' narration ("let me
          // check…") already streamed as text events.
          yield this._event('done', { text: reply.text, model: reply.model, eval_count: reply.evalCount, turns: turn });
          return;
        }

        messages.push({ role: 'assistant', content: reply.text, tool_calls: reply.toolCalls });
        for (const [i, call] of reply.toolCalls.entries()) {
          const toolUseId = `call_ollama_${task.jobId}_${turn}_${i}`;
          const content = yield* this._runToolCall(call, toolUseId, tools, chain, task);
          messages.push({ role: 'tool', tool_name: call.function.name, content });
        }
      }

      this._circuitBreaker.recordSuccess();
      yield this._event('error', {
        message: `Ollama task stopped after ${maxTurns} turns without a final answer`,
        text: fullText,
      });
    } finally {
      this._activeRequests.delete(task.jobId);
    }
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

  async abort(jobId: string): Promise<void> {
    const controller = this._activeRequests.get(jobId);
    if (controller) {
      controller.abort();
      this._activeRequests.delete(jobId);
    }
  }

  // ─── Internal helpers ─────────────────────────────────────────────

  private _event(type: string, content: unknown): AgentEvent {
    return { type: type as AgentEventType, timestamp: new Date(), source: this.name, content } as AgentEvent;
  }

  /**
   * #254: the tool surface for one task — native built-ins plus the task's
   * Zora tools. Policy-banned tools (layer [1]) are never offered, so the model
   * does not waste turns discovering them.
   *
   * Zora tools are offered to the model under their bare name but presented to
   * the enforcement chain fully qualified (`mcp__zora-tools__memory_save`),
   * which is exactly how the SDK path names them. Hooks, capability tokens and
   * channel allowlists therefore see the same string on both providers.
   */
  private _buildTools(task: TaskContext): Map<string, OllamaTool> {
    const banned = deriveDisallowedTools(this._policy);
    const tools = new Map<string, OllamaTool>();
    for (const t of LOCAL_BUILTIN_TOOLS) {
      if (toolFilterMatches(banned, t.name)) continue;
      tools.set(t.name, {
        chainName: t.name,
        description: t.description,
        parameters: t.input_schema,
        run: (input, signal) => t.run(input, { cwd: this._cwd, signal, allowPath: this._allowPath }),
      });
    }
    for (const t of task.customTools ?? []) {
      const chainName = qualifyZoraToolName(t.name);
      if (toolFilterMatches(banned, chainName)) continue;
      tools.set(t.name, {
        chainName,
        description: t.description,
        parameters: t.input_schema,
        run: async (input) => {
          const out = await t.handler(input);
          // JSON.stringify(undefined) is undefined; a tool message needs content.
          return typeof out === 'string' ? out : (JSON.stringify(out) ?? '');
        },
      });
    }
    return tools;
  }

  /** Authorise, execute and observe one tool call; returns the text for the model. */
  private async *_runToolCall(
    call: OllamaToolCall,
    toolUseId: string,
    tools: Map<string, OllamaTool>,
    chain: ToolChain,
    task: TaskContext,
  ): AsyncGenerator<AgentEvent, string> {
    const name = call.function.name;
    const rawArgs = parseArguments(call.function.arguments);
    const tool = tools.get(name);
    const chainName = tool?.chainName ?? name;

    if (!tool) {
      yield this._event('tool_call', { toolCallId: toolUseId, tool: chainName, arguments: rawArgs });
      const error = `Unknown tool '${name}'. Available: ${[...tools.keys()].join(', ') || 'none'}`;
      yield this._event('tool_result', { toolCallId: toolUseId, error });
      return `Error: ${error}`;
    }

    const auth = await authorizeToolCall(chain, chainName, rawArgs, toolUseId);
    const args = auth.allowed ? auth.input : rawArgs;
    yield this._event('tool.start', { toolCallId: toolUseId, tool: chainName });
    yield this._event('tool_call', { toolCallId: toolUseId, tool: chainName, arguments: args });

    if (!auth.allowed) {
      log.warn({ jobId: task.jobId, tool: chainName, layer: auth.layer }, 'Tool call denied');
      yield this._event('tool_result', { toolCallId: toolUseId, error: auth.reason });
      yield this._event('tool.end', { toolCallId: toolUseId, tool: chainName, error: auth.reason });
      return `Denied: ${auth.reason}`;
    }

    const started = Date.now();
    let result: string;
    let error: string | undefined;
    try {
      result = await tool.run(args, chain.signal);
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      result = `Error: ${error}`;
    }
    const durationMs = Date.now() - started;
    await runPostToolUse(chain, chainName, args, error ? { error } : result, toolUseId, durationMs);

    yield this._event('tool_result', error ? { toolCallId: toolUseId, error } : { toolCallId: toolUseId, result });
    yield this._event('tool.end', { toolCallId: toolUseId, tool: chainName, duration_ms: durationMs, error });
    return result;
  }

  /**
   * One streamed /api/chat round. Yields text as it arrives and returns the
   * assembled reply. Ollama sends each tool call whole inside a chunk's
   * `message.tool_calls`; they are accumulated across chunks.
   */
  private async *_chatOnce(
    messages: OllamaMessage[],
    tools: Map<string, OllamaTool> | null,
    signal: AbortSignal,
  ): AsyncGenerator<AgentEvent, ChatReply> {
    const body: Record<string, unknown> = { model: this._model, messages, stream: true };
    if (tools && tools.size > 0) {
      body['tools'] = [...tools.entries()].map(([name, t]) => ({
        type: 'function',
        function: { name, description: t.description, parameters: t.parameters },
      }));
    }

    let response: Response;
    try {
      response = await fetch(`${this._endpoint}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal,
      });
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') return { kind: 'aborted', text: '' };
      const msg = err instanceof Error ? err.message : String(err);
      this._lastAuthStatus = { valid: false, expiresAt: null, canAutoRefresh: true, requiresInteraction: false };
      return { kind: 'error', message: `Ollama connection failed: ${msg}. Is Ollama running? (ollama serve)` };
    }

    if (!response.ok) {
      const text = await response.text().catch((readErr) => {
        log.error({ err: readErr }, 'Failed to read error response body');
        return '';
      });
      if (tools && response.status === 400 && /does not support tools/i.test(text)) {
        return { kind: 'tools_unsupported' };
      }
      return { kind: 'error', message: `Ollama API error ${response.status}: ${text}` };
    }
    if (!response.body) return { kind: 'error', message: 'Ollama returned no response body' };

    let text = '';
    const toolCalls: OllamaToolCall[] = [];
    try {
      for await (const line of this._streamLines(response.body)) {
        if (!line.trim()) continue;
        let chunk: Record<string, unknown>;
        try {
          const parsed = JSON.parse(line);
          if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            throw new Error('Invalid JSON chunk: expected object');
          }
          chunk = parsed as Record<string, unknown>;
        } catch (parseErr: unknown) {
          // TYPE-05: Log malformed NDJSON lines instead of silently dropping them
          const error = parseErr instanceof Error ? parseErr : new Error(String(parseErr));
          log.error({ err: error, rawContent: line.slice(0, 200) }, 'Failed to parse streaming JSON line');
          continue;
        }
        if (typeof chunk['error'] === 'string') return { kind: 'error', message: `Ollama error: ${chunk['error']}` };

        const msg = chunk['message'] as Record<string, unknown> | undefined;
        if (msg?.['content']) {
          const piece = String(msg['content']);
          text += piece;
          yield this._event('text', { text: piece });
        }
        if (Array.isArray(msg?.['tool_calls'])) {
          for (const c of msg['tool_calls'] as unknown[]) {
            const fn = (c as { function?: { name?: unknown; arguments?: unknown } })?.function;
            if (fn && typeof fn.name === 'string') {
              toolCalls.push({ function: { name: fn.name, arguments: fn.arguments } });
            }
          }
        }
        if (chunk['done']) {
          return {
            kind: 'ok',
            text,
            toolCalls,
            model: typeof chunk['model'] === 'string' ? chunk['model'] : undefined,
            evalCount: typeof chunk['eval_count'] === 'number' ? chunk['eval_count'] : undefined,
          };
        }
      }
      return { kind: 'error', message: 'Ollama stream ended without a done chunk' };
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') return { kind: 'aborted', text };
      const msg = err instanceof Error ? err.message : String(err);
      return { kind: 'error', message: `Ollama streaming error: ${msg}` };
    }
  }

  /**
   * Build Ollama chat messages from TaskContext.
   */
  private _buildMessages(task: TaskContext): OllamaMessage[] {
    const messages: OllamaMessage[] = [];

    // System message with context
    const systemParts: string[] = [];
    if (task.systemPrompt) {
      systemParts.push(task.systemPrompt);
    }
    if (task.memoryContext.length > 0) {
      systemParts.push('<memory_context>');
      systemParts.push(task.memoryContext.join('\n'));
      systemParts.push('</memory_context>');
    }
    if (systemParts.length > 0) {
      messages.push({ role: 'system', content: systemParts.join('\n\n') });
    }

    // History as conversation turns
    for (const event of task.history) {
      if (isTextEvent(event)) {
        messages.push({ role: 'assistant', content: event.content.text });
      } else if (isSteeringEvent(event)) {
        messages.push({ role: 'user', content: event.content.text });
      }
    }

    // The actual task
    messages.push({ role: 'user', content: task.task });

    return messages;
  }

  /**
   * Stream a ReadableStream as newline-delimited lines.
   * Ollama sends NDJSON (one JSON object per line).
   */
  private async *_streamLines(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let totalBytes = 0;
    const MAX_BUFFER = 50 * 1024 * 1024; // 50MB safety limit

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const str = decoder.decode(value, { stream: true });
        totalBytes += str.length;

        if (totalBytes > MAX_BUFFER) {
          log.warn('Output exceeded 50MB, truncating stream');
          break;
        }

        buffer += str;
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          yield line;
        }
      }

      // Flush remaining buffer
      if (buffer) yield buffer;
    } finally {
      reader.releaseLock();
    }
  }

  /** Expose circuit breaker for external inspection / testing */
  get circuitBreaker(): CircuitBreaker {
    return this._circuitBreaker;
  }

  /**
   * Reset cached status (used after recovery).
   */
  resetStatus(): void {
    this._lastAuthStatus = null;
    this._circuitBreaker.reset();
  }

  get activeJobCount(): number {
    return this._activeRequests.size;
  }
}
