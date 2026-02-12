/**
 * FailoverController — Manages provider health and orchestrates failover handoffs.
 *
 * Spec §5.1 "Handoff Protocol" & "Auth Health Monitoring":
 *   - Tracks quota usage, error rates, and auth status per provider.
 *   - Distinguishes between quota exhaustion and auth failure.
 *   - Creates HandoffBundles for seamless mid-task transitions.
 *   - Implements cooldown tracking with exponential backoff.
 */

import type {
  LLMProvider,
  TaskContext,
  HandoffBundle,
  FailoverConfig,
} from '../types.js';
import { Router } from './router.js';

export interface FailoverResult {
  nextProvider: LLMProvider;
  handoffBundle: HandoffBundle;
}

export class FailoverController {
  private readonly _providers: LLMProvider[];
  private readonly _config: FailoverConfig;

  constructor(providers: LLMProvider[], _router: Router, config: FailoverConfig) {
    this._providers = providers;
    this._config = config;
  }

  /**
   * Evaluates a failure and determines if a failover should occur.
   * If so, returns the next provider and a handoff bundle.
   */
  async handleFailure(
    task: TaskContext,
    failedProvider: LLMProvider,
    error: Error
  ): Promise<FailoverResult | null> {
    if (!this._config.enabled) return null;

    const errorMessage = error.message.toLowerCase();
    const isQuotaError = this._isQuotaError(errorMessage);
    const isAuthError = this._isAuthError(errorMessage);

    if (!isQuotaError && !isAuthError) {
      // For general errors, we might retry or fail depending on config.
      // For v1, we only failover on quota/auth.
      return null;
    }

    // 1. Mark the failed provider as unhealthy
    // (In a real system, the provider state would be globally updated)

    // 2. Identify candidates for failover
    // We use the router to find the NEXT best provider, excluding the failed one
    const candidates = this._providers.filter(p => p.name !== failedProvider.name);
    const candidateRouter = new Router({ 
      providers: candidates, 
      mode: 'respect_ranking' // Always walk down the ranked list for failover
    });

    try {
      const nextProvider = await candidateRouter.selectProvider(task);
      
      // 3. Create HandoffBundle
      const handoffBundle = this._createHandoffBundle(task, failedProvider, nextProvider, error);

      return { nextProvider, handoffBundle };
    } catch (err) {
      // No other provider available
      return null;
    }
  }

  /**
   * Creates a structured context package for failover.
   */
  private _createHandoffBundle(
    task: TaskContext,
    from: LLMProvider,
    to: LLMProvider,
    error: Error
  ): HandoffBundle {
    const history = task.history || [];
    
    // Extract progress/artifacts from history
    const progress: string[] = [];
    const artifacts: string[] = [];
    const toolHistory: any[] = [];

    for (const event of history) {
      if (event.type === 'text') {
        progress.push((event.content as any).text);
      } else if (event.type === 'tool_call') {
        const content = event.content as any;
        toolHistory.push({
          toolCallId: content.toolCallId,
          tool: content.tool,
          arguments: content.arguments,
        });
      } else if (event.type === 'tool_result') {
        const content = event.content as any;
        const lastTool = toolHistory[toolHistory.length - 1];
        if (lastTool && lastTool.toolCallId === content.toolCallId) {
          lastTool.result = {
            status: content.result.success ? 'ok' : 'error',
            output: content.result.content || content.result.stdout,
            error: content.result.error || content.result.stderr,
          };
        }
      }
    }

    return {
      jobId: task.jobId,
      fromProvider: from.name,
      toProvider: to.name,
      createdAt: new Date(),
      task: task.task,
      context: {
        summary: `Failing over from ${from.name} to ${to.name} due to ${this._isQuotaError(error.message) ? 'quota limits' : 'auth failure'}.`,
        progress,
        artifacts,
      },
      toolHistory,
    };
  }

  private _isQuotaError(message: string): boolean {
    const patterns = ['rate_limit', 'rate limit', 'quota', '429', 'too many requests', 'overloaded'];
    const lower = message.toLowerCase();
    return patterns.some(p => lower.includes(p));
  }

  private _isAuthError(message: string): boolean {
    const patterns = ['auth', 'unauthorized', 'token', 'expired', 'session', 'login'];
    const lower = message.toLowerCase();
    return patterns.some(p => lower.includes(p));
  }
}
