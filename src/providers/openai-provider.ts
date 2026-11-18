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
 *     for tests. Redirects are refused (`redirect: 'error'`): a redirect could
 *     leave https/loopback and forward the prompt and memory context.
 *   - A custom `endpoint` is trusted with BOTH the API key and all task data
 *     (system prompt, memory context). Point it only at infrastructure you run.
 *   - Diagnostics are fixed local strings plus the HTTP status. Remote response
 *     bodies, exception messages and raw stream chunks are never copied into
 *     events or logs, so an upstream that echoes the key cannot publish it. The
 *     one exception is the model's own streamed text, which is returned to the
 *     caller by design (a hostile custom endpoint could put anything there).
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
import { createHash } from 'node:crypto';
import { createLogger } from '../utils/logger.js';
import { CircuitBreaker } from './circuit-breaker.js';

const log = createLogger('openai-provider');

export const OPENAI_DEFAULT_MODEL = 'gpt-6.2-sol';
export const OPENAI_DEFAULT_ENDPOINT = 'https://api.openai.com/v1';

/** SHA-256 fingerprint so the raw bearer key is never retained after use. */
function fingerprint(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}
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
  /**
   * The key value the API rejected with 401/403. Compared in memory only, never
   * logged. Routing and execute() refuse to use this exact key again; rotating
   * the env var to a different value clears the block without a restart.
   */
  // Fingerprints (never raw keys) of keys the API rejected; a Set so a delayed
  // 401 for an old key cannot erase the rejection of the current one.
  private _rejectedKeys = new Set<string>();
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

  private _isRejected(key: string): boolean {
    return this._rejectedKeys.has(fingerprint(key));
  }

  private _isCoolingDown(): boolean {
    if (this._cooldownUntil === null) return false;
    if (this._cooldownUntil.getTime() > Date.now()) return true;
    this._cooldownUntil = null;
    return false;
  }

  /** Only transient/server-side statuses count toward the breaker; 4xx are task-local. */
  private _isOutageStatus(status: number): boolean {
    return status >= 500 || status === 408;
  }

  async isAvailable(): Promise<boolean> {
    if (!this._config.enabled) return false;
    if (this._circuitBreaker.isOpen()) return false;
    // Routing checks isAvailable(), not getQuotaStatus(), so the 429 cooldown must be enforced here.
    if (this._isCoolingDown()) return false;
    const auth = await this.checkAuth();
    return auth.valid;
  }

  /** Local check only: no network call, so polling never spends credits or leaks the key. */
  async checkAuth(): Promise<AuthStatus> {
    const key = this._apiKey();
    const valid = key !== undefined && !this._isRejected(key) && isAllowedEndpoint(this._endpoint);
    return { valid, expiresAt: null, canAutoRefresh: false, requiresInteraction: !valid };
  }

  async getQuotaStatus(): Promise<QuotaStatus> {
    const cooling = this._isCoolingDown();
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
    if (this._isRejected(apiKey)) {
      yield this._error('OpenAI API error 401: key was rejected; set a different key', { httpStatus: 401, isAuthError: true });
      return;
    }
    if (this._isCoolingDown()) {
      yield this._error('OpenAI API error 429: provider is cooling down after a rate limit', {
        httpStatus: 429,
        isQuotaError: true,
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
          redirect: 'error',
        });
      } catch (err: unknown) {
        if (err instanceof Error && err.name === 'AbortError') {
          yield this._done('', started, { aborted: true });
          return;
        }
        this._circuitBreaker.recordFailure();
        // Fixed text: a fetch exception message can embed the request URL or headers.
        yield this._error('OpenAI connection failed');
        return;
      }

      if (!response.ok) {
        // Never read or relay the body: it is remote text and may echo the submitted key.
        await response.body?.cancel().catch(() => undefined);
        const isAuthError = response.status === 401 || response.status === 403;
        const isQuotaError = response.status === 429;
        if (isAuthError) this._rejectedKeys.add(fingerprint(apiKey));
        if (isQuotaError) {
          const retryAfter = Number(response.headers.get('retry-after'));
          this._cooldownUntil = new Date(Date.now() + (Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : 30) * 1000);
        }
        // Only 5xx/408 are outages. 401/403/429 and other 4xx (bad model, bad request) are
        // key- or task-local and must not open the breaker for unrelated jobs.
        if (this._isOutageStatus(response.status)) this._circuitBreaker.recordFailure();
        yield this._error(`OpenAI API error ${response.status}`, { httpStatus: response.status, isAuthError, isQuotaError });
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
            // Log shape only: the raw chunk is remote text.
            log.error({ chunkLength: data.length, errName: parseErr instanceof Error ? parseErr.name : 'unknown' }, 'Failed to parse streaming JSON chunk');
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
        yield this._error('OpenAI streaming error');
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
