/**
 * #167: which SSE events end a dashboard task, and what to show for them.
 *
 * The daemon's submitTask callback forwards orchestrator AgentEvents verbatim
 * (`done` carries `{ text }`) and emits `job_failed` when the task promise
 * rejects. It never emits `job_update`, so keying completion off that left the
 * UI stuck on "Working..." forever.
 */
export interface TaskLifecycle {
  /** True when the event terminates the running task. */
  finished: boolean;
  /** Final result text to surface when the stream did not already show an agent reply. */
  resultText?: string;
  /** System message describing a failure. */
  failure?: string;
}

export function classifyTaskEvent(event: { type?: unknown; data?: unknown }): TaskLifecycle {
  const data = (event.data ?? {}) as Record<string, unknown>;
  switch (event.type) {
    case 'done': {
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
