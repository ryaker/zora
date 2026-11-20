/**
 * #167: how the dashboard chat correlates SSE events with the job it submitted.
 *
 * Every dashboard submission is broadcast over ONE shared SSE stream, so two
 * tabs (or one tab and a CLI-started job) see each other's events. The daemon
 * therefore stamps each event with a top-level `jobId`, and the chat only
 * reacts to events for the job its own POST /api/task returned.
 *
 * Terminal signals come from the task promise, not from provider lifecycle:
 * the daemon emits `job_completed` (resolved) or `job_failed` (rejected) after
 * `orchestrator.submitTask` settles. The provider's `done` / `task.end` events
 * only mean one provider stream finished; failover or a retry can follow, so
 * they are NOT terminal here.
 */
export interface StreamEvent {
  type?: unknown;
  data?: unknown;
  jobId?: unknown;
}

export interface TaskLifecycle {
  /** True when the event terminates the job. */
  finished: boolean;
  /** Final result text (job_completed only). */
  resultText?: string;
  /** Failure description (job_failed only). */
  failure?: string;
}

/** The job an event belongs to: envelope `jobId`, else `data.jobId`. */
export function eventJobId(event: StreamEvent): string | undefined {
  if (typeof event.jobId === 'string' && event.jobId) return event.jobId;
  const data = event.data;
  if (data && typeof data === 'object') {
    const id = (data as Record<string, unknown>)['jobId'];
    if (typeof id === 'string' && id) return id;
  }
  return undefined;
}

export function classifyTaskEvent(event: StreamEvent): TaskLifecycle {
  const data = (event.data ?? {}) as Record<string, unknown>;
  switch (event.type) {
    case 'job_completed': {
      const text = typeof data['text'] === 'string' && data['text'].length > 0 ? data['text'] : undefined;
      return { finished: true, resultText: text };
    }
    case 'job_failed': {
      const err = typeof data['error'] === 'string' ? data['error'] : 'Task failed';
      return { finished: true, failure: err };
    }
    case 'job_update': {
      const status = data['status'];
      return { finished: status === 'completed' || status === 'failed' };
    }
    default:
      return { finished: false };
  }
}

/**
 * Compare a job's final result with the text already streamed for that same
 * job. Returns the text to append as a new bubble, or undefined when the
 * stream already ended with the final answer (so it would be a duplicate).
 * Interim text ("Let me check…") before a distinct final answer does not
 * suppress the answer.
 */
export function reconcileFinalText(streamed: string, finalText: string | undefined): string | undefined {
  const final = finalText?.trim();
  if (!final) return undefined;
  return streamed.trim().endsWith(final) ? undefined : finalText;
}
