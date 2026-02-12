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

interface ToolCallContent {
  tool: string;
  arguments: Record<string, any>;
  toolCallId: string;
}

export class ExecutionLoop {
  private readonly _provider: LLMProvider;
  private readonly _engine: PolicyEngine;
  private readonly _sessionManager: SessionManager;
  private readonly _fsTools: FilesystemTools;
  private readonly _shellTools: ShellTools;
  private readonly _webTools: WebTools;
  private readonly _maxTurns: number;

  /** Map of tool names to their handler functions for scalable dispatch */
  private readonly _toolHandlers: Map<string, (args: any) => any>;

  constructor(options: ExecutionLoopOptions) {
    this._provider = options.provider;
    this._engine = options.engine;
    this._sessionManager = options.sessionManager;
    this._maxTurns = options.maxTurns ?? 200;

    // Initialize tools
    this._fsTools = new FilesystemTools(this._engine);
    this._shellTools = new ShellTools(this._engine);
    this._webTools = new WebTools();

    // Register tool handlers (Spec §5.3)
    this._toolHandlers = new Map<string, (args: any) => any>([
      ['read_file', (args) => this._fsTools.readFile(args.path)],
      ['write_file', (args) => this._fsTools.writeFile(args.path, args.content)],
      ['edit_file', (args) => this._fsTools.editFile(args.path, args.oldString, args.newString)],
      ['list_directory', (args) => this._fsTools.listDirectory(args.path)],
      ['shell_exec', (args) => this._shellTools.execute(args.command)],
      ['web_fetch', (args) => this._webTools.fetch(args.url)],
    ] as [string, (args: any) => any][]);
  }

  /**
   * Executes a single task through the agentic loop.
   */
  async run(task: TaskContext): Promise<void> {
    let turnCount = 0;
    const maxTurns = task.maxTurns ?? this._maxTurns;

    try {
      for await (const event of this._provider.execute(task)) {
        // 1. Persist the event
        await this._sessionManager.appendEvent(task.jobId, event);

        // 2. Handle specific event types
        if (event.type === 'tool_call') {
          // A tool call represents a significant agentic action, count it as a turn
          turnCount++;
          await this._handleToolCall(task.jobId, event);
        }

        if (event.type === 'text') {
          // A text response is a logical turn
          turnCount++;
        }

        if (event.type === 'done') {
          break;
        }

        if (event.type === 'error') {
          break;
        }

        if (turnCount >= maxTurns) {
          await this._sessionManager.appendEvent(task.jobId, {
            type: 'error',
            timestamp: new Date(),
            content: { message: `Maximum turns exceeded (${maxTurns})` },
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
    const content = event.content as ToolCallContent;
    const { tool, arguments: args, toolCallId } = content;
    
    let result: any;

    try {
      const handler = this._toolHandlers.get(tool);
      if (handler) {
        result = await handler(args);
      } else {
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
        content: { message: `Tool execution failed (${tool}): ${msg}` },
      });
    }
  }
}
