import { describe, it, expect } from 'vitest';
import { filterEvents, shouldIncludeEvent, filterEventStream } from '../../../src/utils/event-filter.js';
import type { VerbosityLevel } from '../../../src/utils/event-filter.js';
import type { AgentEvent, AgentEventType } from '../../../src/types.js';

function makeEvent(type: AgentEventType): AgentEvent {
  return {
    type,
    timestamp: new Date(),
    source: 'test',
    content: {},
  };
}

describe('shouldIncludeEvent', () => {
  const eventTypes: AgentEventType[] = [
    'text', 'done', 'error', 'thinking', 'tool_call', 'tool_result',
    'steering', 'task.start', 'task.end', 'turn.start', 'turn.end',
    'text.delta', 'tool.start', 'tool.end',
  ];

  it('terse level includes only text, done, error', () => {
    const included = eventTypes.filter(t => shouldIncludeEvent(makeEvent(t), 'terse'));
    expect(included).toEqual(['text', 'done', 'error']);
  });

  it('normal level adds tool_call, tool_result, steering', () => {
    const included = eventTypes.filter(t => shouldIncludeEvent(makeEvent(t), 'normal'));
    expect(included).toEqual(['text', 'done', 'error', 'tool_call', 'tool_result', 'steering']);
  });

  it('verbose level includes everything', () => {
    const included = eventTypes.filter(t => shouldIncludeEvent(makeEvent(t), 'verbose'));
    expect(included).toEqual(eventTypes);
  });
});

describe('filterEvents', () => {
  it('filters array of events by verbosity', () => {
    const events: AgentEvent[] = [
      makeEvent('task.start'),
      makeEvent('turn.start'),
      makeEvent('thinking'),
      makeEvent('text'),
      makeEvent('tool_call'),
      makeEvent('tool_result'),
      makeEvent('done'),
      makeEvent('task.end'),
    ];

    const terse = filterEvents(events, 'terse');
    expect(terse.map(e => e.type)).toEqual(['text', 'done']);

    const normal = filterEvents(events, 'normal');
    expect(normal.map(e => e.type)).toEqual(['text', 'tool_call', 'tool_result', 'done']);

    const verbose = filterEvents(events, 'verbose');
    expect(verbose).toHaveLength(events.length);
  });

  it('returns empty array for empty input', () => {
    expect(filterEvents([], 'terse')).toEqual([]);
  });
});

describe('filterEventStream', () => {
  async function* makeStream(types: AgentEventType[]): AsyncGenerator<AgentEvent> {
    for (const type of types) {
      yield makeEvent(type);
    }
  }

  async function collectTypes(gen: AsyncGenerator<AgentEvent>): Promise<AgentEventType[]> {
    const types: AgentEventType[] = [];
    for await (const event of gen) {
      types.push(event.type);
    }
    return types;
  }

  it('filters async stream by verbosity', async () => {
    const types: AgentEventType[] = ['task.start', 'thinking', 'text', 'tool_call', 'done', 'task.end'];

    const terse = await collectTypes(filterEventStream(makeStream(types), 'terse'));
    expect(terse).toEqual(['text', 'done']);

    const normal = await collectTypes(filterEventStream(makeStream(types), 'normal'));
    expect(normal).toEqual(['text', 'tool_call', 'done']);

    const verbose = await collectTypes(filterEventStream(makeStream(types), 'verbose'));
    expect(verbose).toEqual(types);
  });
});
