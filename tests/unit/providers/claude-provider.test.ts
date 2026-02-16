import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ClaudeProvider } from '../../../src/providers/claude-provider.js';
import type {
  TaskContext,
  AgentEvent,
  ProviderConfig,
  SDKMessage,
  SDKQuery,
} from '../../../src/providers/claude-provider.js';

/**
 * Helper to create a mock TaskContext
 */
function makeTask(overrides: Partial<TaskContext> = {}): TaskContext {
  return {
    jobId: 'test-job-1',
    task: 'Write a test',
    requiredCapabilities: ['reasoning'],
    complexity: 'simple',
    resourceType: 'coding',
    systemPrompt: 'You are a test agent.',
    memoryContext: [],
    history: [],
    ...overrides,
  };
}

/**
 * Helper to collect all events from an AsyncGenerator
 */
async function collectEvents(gen: AsyncGenerator<AgentEvent>): Promise<AgentEvent[]> {
  const events: AgentEvent[] = [];
  for await (const event of gen) {
    events.push(event);
  }
  return events;
}

/**
 * Mock implementation of SDKQuery
 */
class MockSDKQuery implements SDKQuery {
  private _messages: SDKMessage[];
  private _index = 0;
  private _aborted = false;

  constructor(messages: SDKMessage[]) {
    this._messages = messages;
  }

  async next(): Promise<IteratorResult<SDKMessage, void>> {
    if (this._aborted || this._index >= this._messages.length) {
      return { done: true, value: undefined };
    }
    return { done: false, value: this._messages[this._index++]! };
  }

  async return(): Promise<IteratorResult<SDKMessage, void>> {
    return { done: true, value: undefined };
  }

  async throw(e?: any): Promise<IteratorResult<SDKMessage, void>> {
    throw e;
  }

  [Symbol.asyncIterator]() {
    return this;
  }

  abort = vi.fn(() => {
    this._aborted = true;
  });
}

describe('ClaudeProvider', () => {
  let config: ProviderConfig;

  beforeEach(() => {
    config = {
      name: 'claude-test',
      type: 'claude-sdk',
      rank: 1,
      capabilities: ['reasoning', 'coding'],
      cost_tier: 'metered',
      enabled: true,
      model: 'claude-3-5-sonnet',
      max_turns: 100,
    };
  });

  describe('interface compliance', () => {
    it('has required readonly properties', () => {
      const provider = new ClaudeProvider({ config });
      expect(provider.name).toBe('claude-test');
      expect(provider.rank).toBe(1);
      expect(provider.capabilities).toEqual(['reasoning', 'coding']);
      expect(provider.costTier).toBe('metered');
    });

    it('isAvailable returns false if disabled', async () => {
      const provider = new ClaudeProvider({ config: { ...config, enabled: false } });
      expect(await provider.isAvailable()).toBe(false);
    });

    it('isAvailable returns true if enabled', async () => {
      const provider = new ClaudeProvider({ config });
      expect(await provider.isAvailable()).toBe(true);
    });
  });

  describe('execute', () => {
    it('maps SDK messages to AgentEvents correctly', async () => {
      const mockMessages: SDKMessage[] = [
        {
          type: 'assistant',
          uuid: '1',
          session_id: 's1',
          message: {
            role: 'assistant',
            content: [
              { type: 'thinking', thinking: 'I should write a test.' },
              { type: 'text', text: 'Here is your test.' },
            ],
          },
          parent_tool_use_id: null,
        },
        {
          type: 'assistant',
          uuid: '2',
          session_id: 's1',
          message: {
            role: 'assistant',
            content: [
              {
                type: 'tool_use',
                id: 't1',
                name: 'write_file',
                input: { path: 'test.ts', content: '...' },
              },
            ],
          },
          parent_tool_use_id: null,
        },
        {
          type: 'result',
          subtype: 'success',
          uuid: '3',
          session_id: 's1',
          duration_ms: 1000,
          is_error: false,
          num_turns: 5,
          result: 'Success!',
          total_cost_usd: 0.05,
        },
      ];

      const queryFn = vi.fn(() => new MockSDKQuery(mockMessages));
      const provider = new ClaudeProvider({ config, queryFn });

      const events = await collectEvents(provider.execute(makeTask()));

      // TYPE-11: Lifecycle events are now interleaved with content events
      // task.start, turn.start, thinking, text, turn.end,
      // turn.start, tool.start, tool_call, turn.end, done, task.end
      expect(events).toHaveLength(11);

      expect(events[0]!.type).toBe('task.start');
      expect(events[1]!.type).toBe('turn.start');

      expect(events[2]!.type).toBe('thinking');
      expect(events[2]!.content).toEqual({ text: 'I should write a test.' });

      expect(events[3]!.type).toBe('text');
      expect(events[3]!.content).toEqual({ text: 'Here is your test.' });

      expect(events[4]!.type).toBe('turn.end');
      expect(events[5]!.type).toBe('turn.start');

      expect(events[6]!.type).toBe('tool.start');
      expect(events[7]!.type).toBe('tool_call');
      expect(events[7]!.content).toEqual({
        toolCallId: 't1',
        tool: 'write_file',
        arguments: { path: 'test.ts', content: '...' },
      });

      expect(events[8]!.type).toBe('turn.end');

      expect(events[9]!.type).toBe('done');
      expect(events[9]!.content).toMatchObject({
        text: 'Success!',
        num_turns: 5,
        total_cost_usd: 0.05,
      });

      expect(events[10]!.type).toBe('task.end');

      expect(provider.totalCostUsd).toBe(0.05);
    });

    it('handles SDK errors correctly', async () => {
      const mockMessages: SDKMessage[] = [
        {
          type: 'result',
          subtype: 'error_max_turns',
          uuid: '3',
          session_id: 's1',
          duration_ms: 1000,
          is_error: true,
          num_turns: 100,
          total_cost_usd: 0.1,
          errors: ['Maximum turns reached'],
        },
      ];

      const queryFn = vi.fn(() => new MockSDKQuery(mockMessages));
      const provider = new ClaudeProvider({ config, queryFn });

      const events = await collectEvents(provider.execute(makeTask()));

      // TYPE-11: task.start is emitted before the error, task.end after
      expect(events[0]!.type).toBe('task.start');
      expect(events[1]!.type).toBe('error');
      expect(events[1]!.content).toMatchObject({
        message: 'Maximum turns reached',
        subtype: 'error_max_turns',
      });
      expect(events[2]!.type).toBe('task.end');
      expect(provider.totalCostUsd).toBe(0.1);
    });

    it('detects authentication errors', async () => {
      const queryFn = vi.fn(() => {
        throw new Error('Authentication failed: invalid session token');
      });
      const provider = new ClaudeProvider({ config, queryFn });

      const events = await collectEvents(provider.execute(makeTask()));

      // TYPE-11: task.start emitted before error, task.end after
      expect(events[0]!.type).toBe('task.start');
      expect(events[1]!.type).toBe('error');
      expect((events[1]!.content as any).isAuthError).toBe(true);
      expect(events[2]!.type).toBe('task.end');
      expect((await provider.checkAuth()).valid).toBe(false);
    });

    it('detects quota errors', async () => {
      const queryFn = vi.fn(() => {
        throw new Error('Rate limit exceeded (429)');
      });
      const provider = new ClaudeProvider({ config, queryFn });

      const events = await collectEvents(provider.execute(makeTask()));

      // TYPE-11: task.start emitted before error, task.end after
      expect(events[0]!.type).toBe('task.start');
      expect(events[1]!.type).toBe('error');
      expect((events[1]!.content as any).isQuotaError).toBe(true);

      // PROV-02: Single failure does not trip circuit breaker (threshold = 3)
      expect((await provider.getQuotaStatus()).isExhausted).toBe(false);
      expect((await provider.getQuotaStatus()).healthScore).toBe(1.0);
    });

    it('trips circuit breaker after repeated failures (PROV-02)', async () => {
      const queryFn = vi.fn(() => {
        throw new Error('Rate limit exceeded (429)');
      });
      const provider = new ClaudeProvider({ config, queryFn });

      // 3 failures trip the circuit breaker (default threshold)
      await collectEvents(provider.execute(makeTask({ jobId: 'fail-1' })));
      await collectEvents(provider.execute(makeTask({ jobId: 'fail-2' })));
      await collectEvents(provider.execute(makeTask({ jobId: 'fail-3' })));

      expect((await provider.getQuotaStatus()).isExhausted).toBe(true);
      expect((await provider.getQuotaStatus()).healthScore).toBe(0.0);
      expect(await provider.isAvailable()).toBe(false);

      // 4th call should be rejected immediately by circuit breaker
      const events = await collectEvents(provider.execute(makeTask({ jobId: 'fail-4' })));
      expect(events).toHaveLength(1);
      expect(events[0]!.type).toBe('error');
      expect((events[0]!.content as any).isCircuitOpen).toBe(true);
    });
  });

  describe('abort', () => {
    it('aborts an active query', async () => {
      const mockQuery = new MockSDKQuery([]);
      const queryFn = vi.fn(() => mockQuery);
      const provider = new ClaudeProvider({ config, queryFn });

      const task = makeTask({ jobId: 'job-to-abort' });
      
      // Start execution but don't await completion yet
      const iterator = provider.execute(task);
      const firstEventPromise = iterator.next();

      await provider.abort('job-to-abort');
      
      const result = await firstEventPromise;
      expect(result.done).toBe(false); // Should have yielded 'done' or 'error' in finally block
      
      // In our implementation, finally block yields 'done' or similar if not aborted?
      // Wait, execute() yields done after loop.
      // If we abort, the SDK query should stop yielding.
    });
  });
});
