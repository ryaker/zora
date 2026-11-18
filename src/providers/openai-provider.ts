/**
 * OpenAIProvider — LLMProvider backed by the OpenAI Chat Completions API.
 *
 * Scope of v1 (issue #187, roadmap #184 Phase 1):
 *   - API-key auth only. The key is read from the environment variable named by
 *     `config.api_key_env` (default OPENAI_API_KEY) at call time. It is never
 *     stored in config, logged, or placed in an AgentEvent.
 *   - Text-only: no `tools` are sent to the model and no tool_call events are
 *     emitted. Tool use by this provider is therefore impossible, so the
 *     PreToolUse / canUseTool enforcement chain (docs: CLAUDE.md "Security
 *     Model") is neither bypassed nor needed. Adding tool calling is a separate
 *     change that must route through buildZoraMcpServer() and that chain.
 *   - Transport is plain `fetch` (no new dependency). `fetchFn` is injectable
 *     for tests.
 *
 * Default model is `gpt-6.2-sol`, overridable via `config.model` or
 * `task.modelPreference`.
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
import { isTextEvent, isSteeringEvent } from '../types.js';
import { createLogger } from '../utils/logger.js';
import { CircuitBreaker } from './circuit-breaker.js';

const log = createLogger('openai-provider');

export const OPENAI_DEFAULT_MODEL = 'gpt-6.2-sol';
export const OPENAI_DEFAULT_ENDPOINT = 'https://api.openai.com/v1';
const DEFAULT_KEY_ENV = 'OPENAI_API_KEY';
const MAX_STREAM_CHARS = 50 * 1024 * 1024;

export interface OpenAIProviderOptions {
  config: ProviderConfig;
  /** Injected for tests. Defaults to global fetch. */
  fetchFn?: typeof fetch;
  /** Injected for tests. Defaults to process.env. */
  env?: NodeJS.ProcessEnv;
}

/** True when the endpoint is safe to send a bearer key to (https, or loopback for local gateways). */
function isAllowedEndpoint(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol === 'https:') return true;
  return url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
}

export class OpenAIProvider implements LLMProvider {
  readonly name: string;
  readonly rank: number;
  readonly capabilities: ProviderCapability[];
  readonly costTier: CostTier;

  private readonly _config: ProviderConfig;
  private readonly _endpoint: string;
  private readonly _model: string;
  private readonly _keyEnv: string;
  private readonly _fetch: typeof fetch;
  private readonly _env: NodeJS.ProcessEnv;
  private readonly _activeRequests: Map<string, AbortController> = new Map();
  private readonly _circuitBreaker = new CircuitBreaker();

  private _requestCount = 0;
  private _inputTokens = 0;
  private _outputTokens = 0;
  private _lastRequestAt: Date | null = null;
  /** Set on a 401/403 so isAvailable() stops routing here until the key changes. */
  private _authRejected = false;
  private _cooldownUntil: Date | null = null;

  constructor(options: OpenAIProviderOptions) {
    const { config } = options;
    this.name = config.name;
    this.rank = config.rank;
    this.capabilities = config.capabilities;
    this.costTier = config.cost_tier;
    this._config = config;
    this._endpoint = (config.endpoint ?? OPENAI_DEFAULT_ENDPOINT).replace(/\/$/, '');
    this._model = config.model ?? OPENAI_DEFAULT_MODEL;
    this._keyEnv = config.api_key_env ?? DEFAULT_KEY_ENV;
    this._fetch = options.fetchFn ?? fetch;
    this._env = options.env ?? process.env;
  }

  private _apiKey(): string | undefined {
    const key = this._env[this._keyEnv];
    return key && key.trim() ? key.trim() : undefined;
  }

  async isAvailable(): Promise<boolean> {
    if (!this._config.enabled) return false;
    if (this._circuitBreaker.isOpen()) return false;
    const auth = await this.checkAuth();
    return auth.valid;
  }

  /** Local check only: no network call, so polling never spends credits or leaks the key. */
  async checkAuth(): Promise<AuthStatus> {
    const valid = this._apiKey() !== undefined && !this._authRejected && isAllowedEndpoint(this._endpoint);
    return { valid, expiresAt: null, canAutoRefresh: false, requiresInteraction: !valid };
  }

  async getQuotaStatus(): Promise<QuotaStatus> {
    const cooling = this._cooldownUntil !== null && this._cooldownUntil.getTime() > Date.now();
    return {
      isExhausted: this._circuitBreaker.getState() === 'OPEN' || cooling,
      remainingRequests: null,
      cooldownUntil: cooling ? this._cooldownUntil : null,
      healthScore: this._circuitBreaker.healthScore,
    };
  }

  async *execute(task: TaskContext): AsyncGenerator<AgentEvent> {
    if (this._circuitBreaker.isOpen()) {
      yield this._error(`Circuit breaker is OPEN for provider ${this.name} — too many recent failures`, {
        isCircuitOpen: true,
      });
      return;
    }

    const apiKey = this._apiKey();
    if (!apiKey) {
      yield this._error(`${this._keyEnv} is not set; configure it through the credential gateway`, {
        isAuthError: true,
      });
      return;
    }
    if (!isAllowedEndpoint(this._endpoint)) {
      // Refuse rather than send a bearer key over cleartext to a non-loopback host.
      yield this._error('OpenAI endpoint must be https (or loopback http)', { isAuthError: true });
      return;
    }

    const controller = new AbortController();
    this._activeRequests.set(task.jobId, controller);
    this._requestCount++;
    this._lastRequestAt = new Date();
    const started = Date.now();

    try {
      let response: Response;
      try {
        response = await this._fetch(`${this._endpoint}/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({
            model: task.modelPreference && task.modelPreference !== this.name ? task.modelPreference : this._model,
            messages: this._buildMessages(task),
            stream: true,
            stream_options: { include_usage: true },
          }),
          signal: controller.signal,
        });
      } catch (err: unknown) {
        if (err instanceof Error && err.name === 'AbortError') {
          yield this._done('', started, { aborted: true });
          return;
        }
        this._circuitBreaker.recordFailure();
        yield this._error(`OpenAI connection failed: ${err instanceof Error ? err.message : String(err)}`);
        return;
      }

      if (!response.ok) {
        const body = (await response.text().catch(() => '')).slice(0, 500);
        const isAuthError = response.status === 401 || response.status === 403;
        const isQuotaError = response.status === 429;
        if (isAuthError) this._authRejected = true;
        if (isQuotaError) {
          const retryAfter = Number(response.headers.get('retry-after'));
          this._cooldownUntil = new Date(Date.now() + (Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : 30) * 1000);
        }
        // Auth and rate-limit rejections are not provider outages; keep them off the breaker.
        if (!isAuthError && !isQuotaError) this._circuitBreaker.recordFailure();
        yield this._error(`OpenAI API error ${response.status}: ${body}`, { isAuthError, isQuotaError });
        return;
      }

      if (!response.body) {
        this._circuitBreaker.recordFailure();
        yield this._error('OpenAI returned no response body');
        return;
      }

      let fullText = '';
      let sawDone = false;
      try {
        for await (const data of this._sseData(response.body)) {
          if (data === '[DONE]') {
            sawDone = true;
            break;
          }
          let chunk: {
            choices?: Array<{ delta?: { content?: unknown } }>;
            usage?: { prompt_tokens?: number; completion_tokens?: number } | null;
          };
          try {
            chunk = JSON.parse(data);
          } catch (parseErr: unknown) {
            log.error(
              { err: parseErr instanceof Error ? parseErr : new Error(String(parseErr)), rawContent: data.slice(0, 200) },
              'Failed to parse streaming JSON chunk',
            );
            continue;
          }
          const text = chunk.choices?.[0]?.delta?.content;
          if (typeof text === 'string' && text) {
            fullText += text;
            yield { type: 'text' as AgentEventType, timestamp: new Date(), source: this.name, content: { text } };
          }
          if (chunk.usage) {
            this._inputTokens += chunk.usage.prompt_tokens ?? 0;
            this._outputTokens += chunk.usage.completion_tokens ?? 0;
          }
        }
      } catch (err: unknown) {
        if (err instanceof Error && err.name === 'AbortError') {
          yield this._done(fullText, started, { aborted: true });
          return;
        }
        this._circuitBreaker.recordFailure();
        yield this._error(`OpenAI streaming error: ${err instanceof Error ? err.message : String(err)}`);
        return;
      }

      if (!sawDone) {
        // A stream that ends without [DONE] was cut off; do not report it as a clean completion.
        this._circuitBreaker.recordFailure();
        yield this._error('OpenAI stream ended before completion');
        return;
      }
      this._circuitBreaker.recordSuccess();
      yield this._done(fullText, started);
    } finally {
      this._activeRequests.delete(task.jobId);
    }
  }

  getUsage(): ProviderUsage {
    // Cost stays 0: Zora carries no price table for this provider; spend is tracked
    // from the OpenAI project (ops/spend.md), not estimated here.
    return {
      totalCostUsd: 0,
      totalInputTokens: this._inputTokens,
      totalOutputTokens: this._outputTokens,
      requestCount: this._requestCount,
      lastRequestAt: this._lastRequestAt,
    };
  }

  async abort(jobId: string): Promise<void> {
    this._activeRequests.get(jobId)?.abort();
    this._activeRequests.delete(jobId);
  }

  get circuitBreaker(): CircuitBreaker {
    return this._circuitBreaker;
  }

  // ─── Internal helpers ─────────────────────────────────────────────

  private _error(message: string, extra: Record<string, unknown> = {}): AgentEvent {
    return { type: 'error' as AgentEventType, timestamp: new Date(), source: this.name, content: { message, ...extra } };
  }

  private _done(text: string, started: number, extra: Record<string, unknown> = {}): AgentEvent {
    return {
      type: 'done' as AgentEventType,
      timestamp: new Date(),
      source: this.name,
      content: { text, duration_ms: Date.now() - started, model: this._model, ...extra },
    };
  }

  private _buildMessages(task: TaskContext): Array<{ role: string; content: string }> {
    const messages: Array<{ role: string; content: string }> = [];
    const systemParts: string[] = [];
    if (task.systemPrompt) systemParts.push(task.systemPrompt);
    if (task.memoryContext.length > 0) {
      systemParts.push('<memory_context>', task.memoryContext.join('\n'), '</memory_context>');
    }
    if (systemParts.length > 0) messages.push({ role: 'system', content: systemParts.join('\n\n') });

    for (const event of task.history) {
      if (isTextEvent(event)) messages.push({ role: 'assistant', content: event.content.text });
      else if (isSteeringEvent(event)) messages.push({ role: 'user', content: event.content.text });
    }
    messages.push({ role: 'user', content: task.task });
    return messages;
  }

  /** Yields the payload of each SSE `data:` line. */
  private async *_sseData(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let total = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const str = decoder.decode(value, { stream: true });
        total += str.length;
        if (total > MAX_STREAM_CHARS) {
          log.warn('Output exceeded 50MB, truncating stream');
          break;
        }
        buffer += str;
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed.startsWith('data:')) yield trimmed.slice(5).trim();
        }
      }
      const tail = buffer.trim();
      if (tail.startsWith('data:')) yield tail.slice(5).trim();
    } finally {
      reader.releaseLock();
    }
  }
}
