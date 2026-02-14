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
  private _lastQuotaStatus: QuotaStatus | null = null;
  private _requestCount = 0;
  private _lastRequestAt: Date | null = null;

  /** Active child processes indexed by jobId for abort support */
  private readonly _activeProcesses: Map<string, any> = new Map();

  constructor(options: GeminiProviderOptions) {
    const { config } = options;
    this.name = config.name;
    this.rank = config.rank;
    this.capabilities = config.capabilities;
    this.costTier = config.cost_tier;

    this._config = config;
    this._cliPath = options.cliPath ?? config.cli_path ?? 'gemini';
  }

  async isAvailable(): Promise<boolean> {
    if (!this._config.enabled) return false;
    const auth = await this.checkAuth();
    return auth.valid;
  }

  /**
   * R19: Verify actual auth status, not just binary existence.
   * Runs `gemini auth status` (or falls back to `--version`) to verify
   * the user is authenticated, not just that the CLI binary exists.
   */
  async checkAuth(): Promise<AuthStatus> {
    if (this._lastAuthStatus?.valid) return this._lastAuthStatus;

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
          resolve(status);
        });
        fallback.on('close', (code) => {
          if (resolved) return;
          resolved = true;
          const valid = code === 0;
          const status = { valid, expiresAt: null, canAutoRefresh: true, requiresInteraction: !valid };
          this._lastAuthStatus = status;
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
        resolve(status);
      });
    });
  }

  async getQuotaStatus(): Promise<QuotaStatus> {
    if (this._lastQuotaStatus) return this._lastQuotaStatus;
    const status = { isExhausted: false, remainingRequests: null, cooldownUntil: null, healthScore: 1.0 };
    this._lastQuotaStatus = status;
    return status;
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
      yield {
        type: 'error',
        timestamp: new Date(),
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
        buffer += line + '\n';
        yield {
          type: 'text',
          timestamp: new Date(),
          content: { text: line },
        };
      }

      const { code } = await exitPromise;
      if (spawnError) throw spawnError;
      
      const stderr = await stderrContent;

      if (code !== 0) {
        const errorMessage = stderr || `Gemini CLI exited with code ${code}`;
        const isQuota = errorMessage.toLowerCase().includes('quota') || errorMessage.includes('429');
        
        if (isQuota) {
          this._lastQuotaStatus = { 
            isExhausted: true, 
            remainingRequests: 0, 
            cooldownUntil: new Date(Date.now() + 60000), 
            healthScore: 0 
          };
        }

        yield {
          type: 'error',
          timestamp: new Date(),
          content: { message: errorMessage, code, isQuota },
        };
        return;
      }

      // Final parsing for tool calls
      const toolCalls = this._parseToolCalls(buffer);
      for (const toolCall of toolCalls) {
        yield {
          type: 'tool_call',
          timestamp: new Date(),
          content: toolCall,
        };
      }

      yield {
        type: 'done',
        timestamp: new Date(),
        content: { text: 'Gemini task complete' },
      };

    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      yield {
        type: 'error',
        timestamp: new Date(),
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
        if (event.type === 'text') {
          parts.push('  <assistant>');
          parts.push((event.content as any).text);
          parts.push('  </assistant>');
        } else if (event.type === 'tool_call') {
          const c = event.content as any;
          parts.push(`  <tool_call name="${c.tool}" id="${c.toolCallId}">`);
          parts.push(JSON.stringify(c.arguments));
          parts.push('  </tool_call>');
        } else if (event.type === 'tool_result') {
          const c = event.content as any;
          parts.push(`  <tool_result id="${c.toolCallId}">`);
          parts.push(JSON.stringify(c.result));
          parts.push('  </tool_result>');
        } else if (event.type === 'steering') {
          const c = event.content as any;
          parts.push('  <human_steering>');
          parts.push(c.text);
          parts.push('  </human_steering>');
        }
      }
      parts.push('</history>');
    }

    parts.push(`Task: ${task.task}`);
    return parts.join('\n\n');
  }

  private _parseToolCalls(text: string): any[] {
    const toolCalls: any[] = [];

    // 1. XML pattern
    const xmlRegex = /<tool_call\s+name=["'](.+?)["']>(.*?)<\/tool_call>/gs;
    let match;
    while ((match = xmlRegex.exec(text)) !== null) {
      try {
        toolCalls.push({
          toolCallId: `call_${Math.random().toString(36).slice(2, 9)}`,
          tool: match[1],
          arguments: JSON.parse(match[2]!.trim()),
        });
      } catch (e) {
        // ERR-02: Log malformed XML tool calls with full context for debugging
        const error = e instanceof Error ? e : new Error(String(e));
        console.error('[GeminiProvider] Failed to parse XML tool call:', {
          tool: match[1],
          rawContent: match[2]?.trim().slice(0, 200), // First 200 chars for context
          error: error.message,
          stack: error.stack,
        });
      }
    }

    // 2. Markdown JSON pattern if no XML
    if (toolCalls.length === 0) {
      const jsonRegex = /```json\s*(\{.*?\})\s*```/gs;
      while ((match = jsonRegex.exec(text)) !== null) {
        try {
          const data = JSON.parse(match[1]!);
          if (data.tool && data.arguments) {
            toolCalls.push({
              toolCallId: `call_${Math.random().toString(36).slice(2, 9)}`,
              tool: data.tool,
              arguments: data.arguments,
            });
          }
        } catch (e) {
          // ERR-02: Log malformed JSON tool calls with full context for debugging
          const error = e instanceof Error ? e : new Error(String(e));
          console.error('[GeminiProvider] Failed to parse JSON tool call:', {
            rawContent: match[1]?.slice(0, 200), // First 200 chars for context
            error: error.message,
            stack: error.stack,
          });
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
        console.warn(`[GeminiProvider] Output exceeded ${GeminiProvider.MAX_BUFFER_SIZE} bytes, truncating stream.`);
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
}
