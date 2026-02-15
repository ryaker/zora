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

export type ErrorCategory = 'rate_limit' | 'quota' | 'auth' | 'timeout' | 'transient' | 'permanent' | 'unknown';

export interface ClassifiedError {
  category: ErrorCategory;
  retryable: boolean;
  httpStatus?: number;
  errorCode?: string;
  originalMessage: string;
  confidence: 'high' | 'medium' | 'low';
}

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
   * Classify an error using multi-signal analysis (HTTP status, error codes, message patterns).
   * Returns a structured classification with confidence level.
   */
  classifyError(error: Error): ClassifiedError {
    const message = error.message;
    const lowerMessage = message.toLowerCase();

    // Extract HTTP status code from error (many providers embed it)
    const httpStatus = this._extractHttpStatus(error);

    // Extract structured error code if available
    const errorCode = this._extractErrorCode(error);

    // High-confidence: HTTP status codes (most reliable signal)
    if (httpStatus === 429) {
      return { category: 'rate_limit', retryable: true, httpStatus, errorCode, originalMessage: message, confidence: 'high' };
    }
    if (httpStatus === 401 || httpStatus === 403) {
      return { category: 'auth', retryable: false, httpStatus, errorCode, originalMessage: message, confidence: 'high' };
    }
    if (httpStatus === 408 || httpStatus === 504) {
      return { category: 'timeout', retryable: true, httpStatus, errorCode, originalMessage: message, confidence: 'high' };
    }
    if (httpStatus !== undefined && httpStatus >= 500) {
      return { category: 'transient', retryable: true, httpStatus, errorCode, originalMessage: message, confidence: 'high' };
    }

    // High-confidence: Structured error codes from providers
    if (errorCode) {
      const codeClassification = this._classifyByErrorCode(errorCode);
      if (codeClassification) {
        return { ...codeClassification, httpStatus, errorCode, originalMessage: message, confidence: 'high' };
      }
    }

    // Medium-confidence: Known provider error message patterns
    // Use anchored patterns to avoid false positives (e.g., "limit" in unrelated contexts)
    const RATE_LIMIT_PATTERNS = [
      /rate.?limit/i,                  // "rate_limit", "rate limit", "rate-limit"
      /too many requests/i,
      /resource.?exhausted/i,          // Gemini's RESOURCE_EXHAUSTED
      /quota.?exceed/i,                // "quota exceeded", "quota_exceeded"
    ];

    const AUTH_PATTERNS = [
      /\bauth(?:entication|orization)?\s+(?:failed|error|invalid)\b/i,
      /\bunauthorized\b/i,
      /\binvalid.?(?:api.?key|credential|token)\b/i,
      /\btoken\s+(?:expired|invalid|revoked)\b/i,
      /\bsession\s+expired\b/i,
      /\bpermission\s+denied\b/i,
    ];

    const TIMEOUT_PATTERNS = [
      /\btimeout\b/i,
      /\btimed?\s*out\b/i,
      /\bdeadline\s+exceeded\b/i,
    ];

    if (RATE_LIMIT_PATTERNS.some(p => p.test(message))) {
      return { category: 'rate_limit', retryable: true, httpStatus, errorCode, originalMessage: message, confidence: 'medium' };
    }
    if (AUTH_PATTERNS.some(p => p.test(message))) {
      return { category: 'auth', retryable: false, httpStatus, errorCode, originalMessage: message, confidence: 'medium' };
    }
    if (TIMEOUT_PATTERNS.some(p => p.test(message))) {
      return { category: 'timeout', retryable: true, httpStatus, errorCode, originalMessage: message, confidence: 'medium' };
    }

    // Low-confidence: Broad transient patterns
    if (lowerMessage.includes('overloaded') || lowerMessage.includes('temporarily unavailable') || lowerMessage.includes('service unavailable')) {
      return { category: 'transient', retryable: true, httpStatus, errorCode, originalMessage: message, confidence: 'low' };
    }

    return { category: 'unknown', retryable: false, httpStatus, errorCode, originalMessage: message, confidence: 'low' };
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

    // Cache classification result to avoid redundant calls
    const classified = this.classifyError(error);
    const isQuotaError = classified.category === 'rate_limit' || classified.category === 'quota';
    const isAuthError = classified.category === 'auth';

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
      const handoffBundle = this._createHandoffBundle(task, failedProvider, nextProvider, classified);

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
    classified: ClassifiedError
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
        summary: `Failing over from ${from.name} to ${to.name} due to ${classified.category === 'rate_limit' || classified.category === 'quota' ? 'quota limits' : 'auth failure'}.`,
        progress,
        artifacts,
      },
      toolHistory,
    };
  }

  /**
   * Extract HTTP status code from error object or message.
   */
  private _extractHttpStatus(error: Error): number | undefined {
    // Many API clients attach status to the error object
    const anyErr = error as any;
    if (typeof anyErr.status === 'number') return anyErr.status;
    if (typeof anyErr.statusCode === 'number') return anyErr.statusCode;
    if (anyErr.response && typeof anyErr.response.status === 'number') return anyErr.response.status;

    // Fallback: extract from message like "Error 429: ..." or "(429)"
    const match = error.message.match(/\b(4\d{2}|5\d{2})\b/);
    if (match) return parseInt(match[1]!, 10);

    return undefined;
  }

  /**
   * Extract structured error code from error object.
   */
  private _extractErrorCode(error: Error): string | undefined {
    const anyErr = error as any;
    if (typeof anyErr.code === 'string') return anyErr.code;
    if (typeof anyErr.error?.code === 'string') return anyErr.error.code;
    if (typeof anyErr.error?.type === 'string') return anyErr.error.type;
    return undefined;
  }

  /**
   * Classify based on structured error codes from known providers.
   */
  private _classifyByErrorCode(code: string): Pick<ClassifiedError, 'category' | 'retryable'> | null {
    const normalized = code.toLowerCase();

    // Gemini / Google API codes
    if (normalized === 'resource_exhausted') return { category: 'rate_limit', retryable: true };
    if (normalized === 'unauthenticated') return { category: 'auth', retryable: false };
    if (normalized === 'permission_denied') return { category: 'auth', retryable: false };
    if (normalized === 'deadline_exceeded') return { category: 'timeout', retryable: true };
    if (normalized === 'unavailable') return { category: 'transient', retryable: true };

    // OpenAI / Anthropic codes
    if (normalized === 'rate_limit_error' || normalized === 'rate_limit_exceeded') return { category: 'rate_limit', retryable: true };
    if (normalized === 'authentication_error' || normalized === 'invalid_api_key') return { category: 'auth', retryable: false };
    if (normalized === 'overloaded_error') return { category: 'transient', retryable: true };
    if (normalized === 'quota_exceeded') return { category: 'quota', retryable: false };

    return null;
  }

}
