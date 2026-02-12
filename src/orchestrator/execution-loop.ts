/**
 * ExecutionLoop — The core agentic cycle (think-act-observe).
 *
 * Spec §5.2 "Execution Loop":
 *   - Receives task
 *   - Builds context
 *   - Calls LLM provider
 *   - Validates and executes tool calls
 *   - Feeds back results
 *   - Enforces max iterations and timeout
 */

import type { 
  LLMProvider, 
  TaskContext, 
  AgentEvent
} from '../types.js';
import { FilesystemTools, ShellTools, WebTools } from '../tools/index.js';
import { PolicyEngine } from '../security/policy-engine.js';
import { SessionManager } from './session-manager.js';

export interface ExecutionLoopOptions {
  provider: LLMProvider;
  engine: PolicyEngine;
  sessionManager: SessionManager;
  maxTurns?: number;
}

export class ExecutionLoop {
  private readonly _provider: LLMProvider;
  private readonly _engine: PolicyEngine;
  private readonly _sessionManager: SessionManager;
  private readonly _fsTools: FilesystemTools;
  private readonly _shellTools: ShellTools;
  private readonly _webTools: WebTools;
  private readonly _maxTurns: number;

  constructor(options: ExecutionLoopOptions) {
    this._provider = options.provider;
    this._engine = options.engine;
    this._sessionManager = options.sessionManager;
    this._maxTurns = options.maxTurns ?? 200;

    // Initialize tools
    this._fsTools = new FilesystemTools(this._engine);
    this._shellTools = new ShellTools(this._engine);
    this._webTools = new WebTools();
  }

  /**
   * Executes a single task through the agentic loop.
   */
  async run(task: TaskContext): Promise<void> {
    let turnCount = 0;
    const maxTurns = task.maxTurns ?? this._maxTurns;

    // The execution is handled by the provider's execute generator
    // which yields events (thinking, text, tool_call, tool_result, error, done).
    // The ExecutionLoop's job is to intercept tool_calls, run them, and feed
    // results back to the provider if it's an interactive multi-turn provider.
    
    // NOTE: For v1, we assume the provider (Claude SDK) handles its own
    // internal tool loop if it's an embedded agent.
    // However, for consistency with the spec, we track and persist everything.

    try {
      for await (const event of this._provider.execute(task)) {
        // 1. Persist the event
        await this._sessionManager.appendEvent(task.jobId, event);

        // 2. Handle specific event types if needed
        if (event.type === 'tool_call') {
          // If the provider expects us to execute the tool (standard multi-turn)
          // we would do it here. The Claude SDK handles this internally, 
          // but other providers (Gemini CLI) might not.
          await this._handleToolCall(task.jobId, event);
        }

        if (event.type === 'done') {
          break;
        }

        if (event.type === 'error') {
          break;
        }

        turnCount++;
        if (turnCount >= maxTurns) {
          await this._sessionManager.appendEvent(task.jobId, {
            type: 'error',
            timestamp: new Date(),
            content: { message: 'Maximum turns exceeded' },
          });
          break;
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      await this._sessionManager.appendEvent(task.jobId, {
        type: 'error',
        timestamp: new Date(),
        content: { message: `Execution loop failure: ${msg}` },
      });
    }
  }

  /**
   * Dispatches a tool call to the appropriate tool implementation.
   */
  private async _handleToolCall(jobId: string, event: AgentEvent): Promise<void> {
    const { tool, arguments: args, toolCallId } = event.content as any;
    let result: any;

    try {
      switch (tool) {
        case 'read_file':
          result = this._fsTools.readFile(args.path);
          break;
        case 'write_file':
          result = this._fsTools.writeFile(args.path, args.content);
          break;
        case 'edit_file':
          result = this._fsTools.editFile(args.path, args.oldString, args.newString);
          break;
        case 'list_directory':
          result = this._fsTools.listDirectory(args.path);
          break;
        case 'shell_exec':
          result = this._shellTools.execute(args.command);
          break;
        case 'web_fetch':
          result = await this._webTools.fetch(args.url);
          break;
        default:
          result = { success: false, error: `Unknown tool: ${tool}` };
      }

      // Record the result
      await this._sessionManager.appendEvent(jobId, {
        type: 'tool_result',
        timestamp: new Date(),
        content: {
          toolCallId,
          result,
        },
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      await this._sessionManager.appendEvent(jobId, {
        type: 'error',
        timestamp: new Date(),
        content: { message: `Tool execution failed: ${msg}` },
      });
    }
  }
}
