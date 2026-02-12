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

  async checkAuth(): Promise<AuthStatus> {
    if (this._lastAuthStatus?.valid) return this._lastAuthStatus;

    return new Promise((resolve) => {
      const child = spawn(this._cliPath, ['--version']);
      
      child.on('error', () => {
        const status = { valid: false, expiresAt: null, canAutoRefresh: false, requiresInteraction: true };
        this._lastAuthStatus = status;
        resolve(status);
      });

      child.on('close', (code) => {
        const valid = code === 0;
        const status = { 
          valid, 
          expiresAt: null, 
          canAutoRefresh: true,
          requiresInteraction: !valid 
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

  async *execute(task: TaskContext): AsyncGenerator<AgentEvent> {
    const prompt = this._buildPrompt(task);
    const args = ['chat', '--prompt', prompt];
    
    if (this._config.model) {
      args.push('--model', this._config.model);
    }

    const child = spawn(this._cliPath, args);
    
    let buffer = '';

    // Track exit via promise
    const exitPromise = new Promise<{ code: number | null }>((resolve) => {
      child.on('close', (code) => resolve({ code }));
    });

    // Helper to process streams
    const stdoutLines = this._streamToLines(child.stdout);
    const stderrContent = this._collectStderr(child.stderr);

    try {
      for await (const line of stdoutLines) {
        buffer += line + '\n';
        yield {
          type: 'text',
          timestamp: new Date(),
          content: { text: line },
        };
      }

      const { code } = await exitPromise;
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
    }
  }

  async abort(_jobId: string): Promise<void> {
    // PID tracking needed for subprocess abort
  }

  private _buildPrompt(task: TaskContext): string {
    const parts: string[] = [];
    if (task.systemPrompt) parts.push(`System: ${task.systemPrompt}`);
    if (task.memoryContext.length > 0) {
      parts.push('<context>');
      parts.push(...task.memoryContext);
      parts.push('</context>');
    }
    parts.push(task.task);
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
      } catch (e) {}
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
        } catch (e) {}
      }
    }

    return toolCalls;
  }

  private async * _streamToLines(stream: NodeJS.ReadableStream): AsyncGenerator<string> {
    let buffer = '';
    for await (const chunk of stream) {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        yield line;
      }
    }
    if (buffer) yield buffer;
  }

  private async _collectStderr(stream: NodeJS.ReadableStream): Promise<string> {
    let buffer = '';
    for await (const chunk of stream) {
      buffer += chunk.toString();
    }
    return buffer.trim();
  }
}
