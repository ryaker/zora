/**
 * GeminiProvider — LLMProvider implementation backed by the Gemini CLI.
 *
 * Spec §4.2 "Gemini Provider" (type: "gemini-cli"):
 *   - CLI: gemini (Google Workspace authenticated)
 *   - Execution mode: Subprocess wrapper with streaming output parsing
 *   - Output format: Handles text, markdown-fenced JSON, and XML blocks
 */

import { spawn } from 'node:child_process';
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
import { isTextEvent, isToolCallEvent, isToolResultEvent, isSteeringEvent } from '../types.js';
import { createLogger } from '../utils/logger.js';
import { CircuitBreaker } from './circuit-breaker.js';

const log = createLogger('gemini-provider');

export interface GeminiProviderOptions {
  config: ProviderConfig;
  cliPath?: string;
}

export class GeminiProvider implements LLMProvider {
  readonly name: string;
  readonly rank: number;
  readonly capabilities: ProviderCapability[];
  readonly costTier: CostTier;

  private readonly _config: ProviderConfig;
  private readonly _cliPath: string;
  private _lastAuthStatus: AuthStatus | null = null;
  private _lastAuthCheckAt: number = 0;
  private static readonly AUTH_CACHE_TTL_MS = 60_000; // re-check every 60s
  private _requestCount = 0;
  private _lastRequestAt: Date | null = null;

  /** Circuit breaker for failure tracking (PROV-02) */
  private readonly _circuitBreaker: CircuitBreaker;

  /** Active child processes indexed by jobId for abort support */
  private readonly _activeProcesses: Map<string, import('node:child_process').ChildProcess> = new Map();

  constructor(options: GeminiProviderOptions) {
    const { config } = options;
    this.name = config.name;
    this.rank = config.rank;
    this.capabilities = config.capabilities;
    this.costTier = config.cost_tier;

    this._config = config;
    this._cliPath = options.cliPath ?? config.cli_path ?? 'gemini';
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
   * R19: Verify actual auth status, not just binary existence.
   * Runs `gemini auth status` (or falls back to `--version`) to verify
   * the user is authenticated, not just that the CLI binary exists.
   */
  async checkAuth(): Promise<AuthStatus> {
    const now = Date.now();
    if (this._lastAuthStatus?.valid && (now - this._lastAuthCheckAt) < GeminiProvider.AUTH_CACHE_TTL_MS) {
      return this._lastAuthStatus;
    }

    return new Promise((resolve) => {
      let resolved = false;
      // Try `gemini auth status` first for real auth verification
      const child = spawn(this._cliPath, ['auth', 'status']);
      let stdout = '';

      if (child.stdout) {
        child.stdout.on('data', (chunk: Buffer) => {
          stdout += chunk.toString();
        });
      }

      child.on('error', () => {
        if (resolved) return;
        // CLI binary not found — fall back to --version check
        const fallback = spawn(this._cliPath, ['--version']);
        fallback.on('error', () => {
          if (resolved) return;
          resolved = true;
          const status = { valid: false, expiresAt: null, canAutoRefresh: false, requiresInteraction: true };
          this._lastAuthStatus = status;
          this._lastAuthCheckAt = Date.now();
          resolve(status);
        });
        fallback.on('close', (code) => {
          if (resolved) return;
          resolved = true;
          const valid = code === 0;
          const status = { valid, expiresAt: null, canAutoRefresh: true, requiresInteraction: !valid };
          this._lastAuthStatus = status;
          this._lastAuthCheckAt = Date.now();
          resolve(status);
        });
      });

      child.on('close', (code) => {
        if (resolved) return;
        resolved = true;
        const valid = code === 0;
        const isAuthenticated = valid && !stdout.toLowerCase().includes('not authenticated');
        const status = {
          valid: isAuthenticated,
          expiresAt: null,
          canAutoRefresh: true,
          requiresInteraction: !isAuthenticated
        };
        this._lastAuthStatus = status;
        this._lastAuthCheckAt = Date.now();
        resolve(status);
      });
    });
  }

  async getQuotaStatus(): Promise<QuotaStatus> {
    // PROV-01: Derive health score from circuit breaker state
    const cbState = this._circuitBreaker.getState();
    return {
      isExhausted: cbState === 'OPEN',
      remainingRequests: null,
      cooldownUntil: null,
      healthScore: this._circuitBreaker.healthScore,
    };
  }

  getUsage(): ProviderUsage {
    return {
      totalCostUsd: 0, // Gemini CLI doesn't expose cost data
      totalInputTokens: 0,
      totalOutputTokens: 0,
      requestCount: this._requestCount,
      lastRequestAt: this._lastRequestAt,
    };
  }

  async *execute(task: TaskContext): AsyncGenerator<AgentEvent> {
    // PROV-02: Reject immediately if circuit breaker is OPEN
    if (this._circuitBreaker.isOpen()) {
      yield {
        type: 'error',
        timestamp: new Date(),
        source: this.name,
        content: {
          message: `Circuit breaker is OPEN for provider ${this.name} — too many recent failures`,
          isCircuitOpen: true,
        },
      };
      return;
    }

    this._requestCount++;
    this._lastRequestAt = new Date();
    const prompt = this._buildPrompt(task);
    const args = ['chat', '--prompt', prompt];

    if (this._config.model) {
      args.push('--model', this._config.model);
    }

    const child = spawn(this._cliPath, args);
    this._activeProcesses.set(task.jobId, child);

    let buffer = '';
    let bufferTruncated = false;

    // Track spawn/execution errors
    let spawnError: Error | null = null;
    child.on('error', (err) => {
      spawnError = err;
    });

    // Track exit via promise
    const exitPromise = new Promise<{ code: number | null }>((resolve) => {
      child.on('close', (code) => resolve({ code }));
    });

    // Safe stream access (Spec §4.2: subprocess wrapper resilience)
    if (!child.stdout || !child.stderr) {
      this._circuitBreaker.recordFailure();
      yield {
        type: 'error',
        timestamp: new Date(),
        source: this.name,
        content: { message: `Failed to open stdio streams for ${this._cliPath}` },
      };
      this._activeProcesses.delete(task.jobId);
      return;
    }

    const stdoutLines = this._streamToLines(child.stdout);
    const stderrContent = this._collectStderr(child.stderr);

    try {
      for await (const line of stdoutLines) {
        if (spawnError) throw spawnError;
        // OPS-04: Cap the tool-call parsing buffer at MAX_BUFFER_SIZE
        if (!bufferTruncated) {
          if (buffer.length + line.length + 1 > GeminiProvider.MAX_BUFFER_SIZE) {
            bufferTruncated = true;
            log.warn({ maxBytes: GeminiProvider.MAX_BUFFER_SIZE }, 'Tool-call parsing buffer exceeded limit; further output will not be parsed for tool calls');
          } else {
            buffer += line + '\n';
          }
        }
        yield {
          type: 'text',
          timestamp: new Date(),
          source: this.name,
          content: { text: line },
        };
      }

      const { code } = await exitPromise;
      if (spawnError) throw spawnError;

      const stderr = await stderrContent;

      if (code !== 0) {
        const errorMessage = stderr || `Gemini CLI exited with code ${code}`;
        const isQuotaError = errorMessage.toLowerCase().includes('quota') || errorMessage.includes('429');

        // PROV-02: Record failure on the circuit breaker
        this._circuitBreaker.recordFailure();

        yield {
          type: 'error',
          timestamp: new Date(),
          source: this.name,
          content: { message: errorMessage, code, isQuotaError },
        };
        return;
      }

      // PROV-02: Record success on the circuit breaker
      this._circuitBreaker.recordSuccess();

      // Final parsing for tool calls
      const toolCalls = this._parseToolCalls(buffer);
      for (const toolCall of toolCalls) {
        yield {
          type: 'tool_call',
          timestamp: new Date(),
          source: this.name,
          content: toolCall,
        };
      }

      yield {
        type: 'done',
        timestamp: new Date(),
        source: this.name,
        content: { text: 'Gemini task complete' },
      };

    } catch (err: unknown) {
      // PROV-02: Record failure on the circuit breaker
      this._circuitBreaker.recordFailure();

      const msg = err instanceof Error ? err.message : String(err);
      yield {
        type: 'error',
        timestamp: new Date(),
        source: this.name,
        content: { message: `Gemini execution failed: ${msg}` },
      };
    } finally {
      this._activeProcesses.delete(task.jobId);
    }
  }

  async abort(jobId: string): Promise<void> {
    const child = this._activeProcesses.get(jobId);
    if (child) {
      child.kill();
      this._activeProcesses.delete(jobId);
    }
  }

  private _buildPrompt(task: TaskContext): string {
    const parts: string[] = [];
    if (task.systemPrompt) parts.push(`System: ${task.systemPrompt}`);

    if (task.memoryContext.length > 0) {
      parts.push('<context>');
      parts.push(...task.memoryContext);
      parts.push('</context>');
    }

    if (task.history.length > 0) {
      parts.push('<history>');
      for (const event of task.history) {
        if (isTextEvent(event)) {
          parts.push('  <assistant>');
          parts.push(event.content.text);
          parts.push('  </assistant>');
        } else if (isToolCallEvent(event)) {
          parts.push(`  <tool_call name="${event.content.tool}" id="${event.content.toolCallId}">`);
          parts.push(JSON.stringify(event.content.arguments));
          parts.push('  </tool_call>');
        } else if (isToolResultEvent(event)) {
          parts.push(`  <tool_result id="${event.content.toolCallId}">`);
          parts.push(JSON.stringify(event.content.result));
          parts.push('  </tool_result>');
        } else if (isSteeringEvent(event)) {
          parts.push('  <human_steering>');
          parts.push(event.content.text);
          parts.push('  </human_steering>');
        }
      }
      parts.push('</history>');
    }

    parts.push(`Task: ${task.task}`);
    return parts.join('\n\n');
  }

  private _parseToolCalls(text: string): Array<{ toolCallId: string; tool: string; arguments: Record<string, unknown> }> {
    const toolCalls: Array<{ toolCallId: string; tool: string; arguments: Record<string, unknown> }> = [];

    // 1. XML pattern
    const xmlRegex = /<tool_call\s+name=["'](.+?)["']>(.*?)<\/tool_call>/gs;
    let match;
    while ((match = xmlRegex.exec(text)) !== null) {
      try {
        const toolName = match[1] ?? '';
        const rawArgs = match[2]?.trim() ?? '';
        const args = JSON.parse(rawArgs);
        if (args && typeof args === 'object' && !Array.isArray(args)) {
          toolCalls.push({
            toolCallId: `call_${Math.random().toString(36).slice(2, 9)}`,
            tool: toolName,
            arguments: args as Record<string, unknown>,
          });
        } else {
          throw new Error('Tool arguments must be a non-null object');
        }
      } catch (e) {
        // ERR-02: Log malformed XML tool calls with full context for debugging
        const error = e instanceof Error ? e : new Error(String(e));
        log.error({ err: error, tool: match[1], rawContent: match[2]?.trim().slice(0, 200) }, 'Failed to parse XML tool call');
      }
    }

    // 2. Markdown JSON pattern if no XML
    if (toolCalls.length === 0) {
      const jsonRegex = /```json\s*(\{.*?\})\s*```/gs;
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
        } catch (e) {
          // ERR-02/TYPE-05: Log malformed JSON tool calls with full context for debugging
          const error = e instanceof Error ? e : new Error(String(e));
          log.error({ err: error, rawContent: match[1]?.slice(0, 200) }, 'Failed to parse JSON tool call');
        }
      }
    }

    return toolCalls;
  }

  /** R28: Max buffer size to prevent unbounded memory consumption (50MB) */
  private static readonly MAX_BUFFER_SIZE = 50 * 1024 * 1024;

  private async * _streamToLines(stream: NodeJS.ReadableStream): AsyncGenerator<string> {
    let buffer = '';
    let totalBytes = 0;
    let truncated = false;
    for await (const chunk of stream) {
      const str = chunk.toString();
      totalBytes += str.length;
      if (totalBytes > GeminiProvider.MAX_BUFFER_SIZE) {
        log.warn({ maxBytes: GeminiProvider.MAX_BUFFER_SIZE }, 'Output exceeded maximum buffer size, truncating stream');
        yield '[Output truncated: exceeded maximum buffer size]';
        truncated = true;
        break;
      }
      buffer += str;
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        yield line;
      }
    }
    if (buffer && !truncated) yield buffer;
  }

  private async _collectStderr(stream: NodeJS.ReadableStream): Promise<string> {
    let buffer = '';
    for await (const chunk of stream) {
      buffer += chunk.toString();
    }
    return buffer.trim();
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
}
