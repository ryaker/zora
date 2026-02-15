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

export interface OllamaProviderOptions {
  config: ProviderConfig;
  /** Base URL for the Ollama API. Defaults to config.endpoint or http://localhost:11434 */
  endpoint?: string;
}

export class OllamaProvider implements LLMProvider {
  readonly name: string;
  readonly rank: number;
  readonly capabilities: ProviderCapability[];
  readonly costTier: CostTier;

  private readonly _config: ProviderConfig;
  private readonly _endpoint: string;
  private readonly _model: string;

  /** Track active requests by jobId for abort support */
  private readonly _activeRequests: Map<string, AbortController> = new Map();

  private _lastAuthStatus: AuthStatus | null = null;

  constructor(options: OllamaProviderOptions) {
    const { config } = options;
    this.name = config.name;
    this.rank = config.rank;
    this.capabilities = config.capabilities;
    this.costTier = config.cost_tier;

    this._config = config;
    this._endpoint = (options.endpoint ?? config.endpoint ?? 'http://localhost:11434').replace(/\/$/, '');
    this._model = config.model ?? 'llama3.2';
  }

  async isAvailable(): Promise<boolean> {
    if (!this._config.enabled) return false;
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
    // Local models have no quota limits
    return {
      isExhausted: false,
      remainingRequests: null,
      cooldownUntil: null,
      healthScore: 1.0,
    };
  }

  async *execute(task: TaskContext): AsyncGenerator<AgentEvent> {
    const abortController = new AbortController();
    this._activeRequests.set(task.jobId, abortController);

    const messages = this._buildMessages(task);

    let response: Response;
    try {
      response = await fetch(`${this._endpoint}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this._model,
          messages,
          stream: true,
        }),
        signal: abortController.signal,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this._lastAuthStatus = { valid: false, expiresAt: null, canAutoRefresh: true, requiresInteraction: false };
      yield {
        type: 'error' as AgentEventType,
        timestamp: new Date(),
        source: this.name,
        content: { message: `Ollama connection failed: ${msg}. Is Ollama running? (ollama serve)` },
      };
      this._activeRequests.delete(task.jobId);
      return;
    }

    if (!response.ok) {
      const body = await response.text().catch((readErr) => {
        console.error('[OllamaProvider] Failed to read error response body:', readErr);
        return '';
      });
      yield {
        type: 'error' as AgentEventType,
        timestamp: new Date(),
        source: this.name,
        content: { message: `Ollama API error ${response.status}: ${body}` },
      };
      this._activeRequests.delete(task.jobId);
      return;
    }

    if (!response.body) {
      yield {
        type: 'error' as AgentEventType,
        timestamp: new Date(),
        source: this.name,
        content: { message: 'Ollama returned no response body' },
      };
      this._activeRequests.delete(task.jobId);
      return;
    }

    // Stream the response
    let fullText = '';
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
          const msg = parseErr instanceof Error ? parseErr.message : String(parseErr);
          console.error('[OllamaProvider] Failed to parse streaming JSON line:', {
            rawContent: line.slice(0, 200),
            error: msg,
          });
          continue;
        }

        // Null check before accessing chunk properties
        if (!chunk) {
          continue;
        }

        const chunkMessage = chunk.message as Record<string, unknown> | undefined;
        if (chunkMessage?.content) {
          const text = String(chunkMessage.content);
          fullText += text;
          yield {
            type: 'text' as AgentEventType,
            timestamp: new Date(),
            source: this.name,
            content: { text },
          };
        }

        // Ollama signals completion with done: true
        if (chunk.done) {
          // Extract tool calls from the response text (best-effort)
          const toolCalls = this._parseToolCalls(fullText);
          for (const toolCall of toolCalls) {
            yield {
              type: 'tool_call' as AgentEventType,
              timestamp: new Date(),
              source: this.name,
              content: toolCall,
            };
          }

          yield {
            type: 'done' as AgentEventType,
            timestamp: new Date(),
            source: this.name,
            content: {
              text: fullText,
              model: chunk.model,
              total_duration: chunk.total_duration,
              eval_count: chunk.eval_count,
            },
          };
          break;
        }
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') {
        yield {
          type: 'done' as AgentEventType,
          timestamp: new Date(),
          source: this.name,
          content: { text: fullText, aborted: true },
        };
      } else {
        const msg = err instanceof Error ? err.message : String(err);
        yield {
          type: 'error' as AgentEventType,
          timestamp: new Date(),
          source: this.name,
          content: { message: `Ollama streaming error: ${msg}` },
        };
      }
    } finally {
      this._activeRequests.delete(task.jobId);
    }
  }

  getUsage(): ProviderUsage {
    return {
      totalCostUsd: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      requestCount: 0,
      lastRequestAt: null,
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

  /**
   * Build Ollama chat messages from TaskContext.
   */
  private _buildMessages(task: TaskContext): Array<{ role: string; content: string }> {
    const messages: Array<{ role: string; content: string }> = [];

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
   * Parse tool calls from Ollama response text.
   * Ollama models may output tool calls in JSON format within the text.
   */
  private _parseToolCalls(text: string): Array<{ toolCallId: string; tool: string; arguments: Record<string, unknown> }> {
    const toolCalls: Array<{ toolCallId: string; tool: string; arguments: Record<string, unknown> }> = [];

    // Look for JSON blocks that resemble tool calls
    const jsonRegex = /```json\s*(\{.*?\})\s*```/gs;
    let match;
    while ((match = jsonRegex.exec(text)) !== null) {
      try {
        const data = JSON.parse(match[1]!);
        if (data && typeof data === 'object' && !Array.isArray(data) &&
            typeof data.tool === 'string' &&
            data.arguments && typeof data.arguments === 'object' && !Array.isArray(data.arguments)) {
          toolCalls.push({
            toolCallId: `call_${Math.random().toString(36).slice(2, 9)}`,
            tool: data.tool,
            arguments: data.arguments as Record<string, unknown>,
          });
        }
      } catch (parseErr: unknown) {
        // TYPE-05: Log malformed tool call JSON instead of silently dropping
        const msg = parseErr instanceof Error ? parseErr.message : String(parseErr);
        console.error('[OllamaProvider] Failed to parse JSON tool call:', {
          rawContent: match[1]?.slice(0, 200),
          error: msg,
        });
      }
    }

    return toolCalls;
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
          console.warn('[OllamaProvider] Output exceeded 50MB, truncating stream.');
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

  /**
   * Reset cached status (used after recovery).
   */
  resetStatus(): void {
    this._lastAuthStatus = null;
  }

  get activeJobCount(): number {
    return this._activeRequests.size;
  }
}
