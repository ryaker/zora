/**
 * Event Verbosity Filter — TYPE-12
 *
 * Filters AgentEvent streams based on verbosity level, following the
 * ia-agents printStream pattern:
 *
 *   - terse:   Only text + done + error (end-user facing)
 *   - normal:  + tool_call + tool_result + steering (developer facing)
 *   - verbose: Everything including thinking, deltas, lifecycle markers (debug)
 */

import type { AgentEvent, AgentEventType } from '../types.js';

export type VerbosityLevel = 'terse' | 'normal' | 'verbose';

/** Event types included at each verbosity level */
const TERSE_EVENTS: Set<AgentEventType> = new Set([
  'text',
  'done',
  'error',
]);

const NORMAL_EVENTS: Set<AgentEventType> = new Set([
  ...TERSE_EVENTS,
  'tool_call',
  'tool_result',
  'steering',
]);

const VERBOSE_EVENTS: Set<AgentEventType> = new Set([
  ...NORMAL_EVENTS,
  'thinking',
  'task.start',
  'task.end',
  'turn.start',
  'turn.end',
  'text.delta',
  'tool.start',
  'tool.end',
]);

const LEVEL_MAP: Record<VerbosityLevel, Set<AgentEventType>> = {
  terse: TERSE_EVENTS,
  normal: NORMAL_EVENTS,
  verbose: VERBOSE_EVENTS,
};

/**
 * Returns true if the event should be included at the given verbosity level.
 */
export function shouldIncludeEvent(event: AgentEvent, level: VerbosityLevel): boolean {
  return LEVEL_MAP[level].has(event.type);
}

/**
 * Filters an array of events by verbosity level.
 */
export function filterEvents(events: AgentEvent[], level: VerbosityLevel): AgentEvent[] {
  return events.filter(e => shouldIncludeEvent(e, level));
}

/**
 * Creates an async generator that filters events from a source by verbosity.
 */
export async function* filterEventStream(
  source: AsyncIterable<AgentEvent>,
  level: VerbosityLevel,
): AsyncGenerator<AgentEvent> {
  for await (const event of source) {
    if (shouldIncludeEvent(event, level)) {
      yield event;
    }
  }
}
