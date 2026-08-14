/**
 * ERR-20 — the stream timeout must abort, not throw.
 *
 * The timeout callback used to `throw`. A throw inside a setTimeout callback
 * does not reject the awaiting `for await`; it surfaces as an uncaughtException
 * that the surrounding try/finally cannot catch, and with no handler installed
 * it takes the daemon down. So the protection against a hung stream turned a
 * hang into a crash.
 *
 * These tests pin the two properties that fix depends on: the SDK is given an
 * AbortController, and the timeout path produces a rejected promise.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Hoisted so the module mock below can see it.
const { queryMock } = vi.hoisted(() => ({ queryMock: vi.fn() }));

vi.mock('@anthropic-ai/claude-agent-sdk', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, query: queryMock };
});

const { ExecutionLoop } = await import('../../../src/orchestrator/execution-loop.js');

/** A stream that yields `count` messages and then hangs until aborted. */
function hangingStream(signal: AbortSignal, count = 0) {
  return (async function* () {
    for (let i = 0; i < count; i++) {
      yield { type: 'assistant', session_id: 's1' } as never;
    }
    await new Promise<void>((_resolve, reject) => {
      if (signal.aborted) return reject(new Error('aborted'));
      signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    });
  })();
}

describe('ExecutionLoop stream timeout (ERR-20)', () => {
  beforeEach(() => {
    queryMock.mockReset();
  });

  it('passes an AbortController to the SDK', async () => {
    let captured: Record<string, unknown> | undefined;
    queryMock.mockImplementation(({ options }: { options: Record<string, unknown> }) => {
      captured = options;
      return (async function* () { yield { type: 'result', result: 'done', session_id: 's' } as never; })();
    });

    const loop = new ExecutionLoop({ streamTimeout: 50_000 });
    await loop.run('hi');

    expect(captured?.['abortController']).toBeInstanceOf(AbortController);
  });

  it('rejects on timeout instead of raising an uncaught exception', async () => {
    let signal: AbortSignal | undefined;
    queryMock.mockImplementation(({ options }: { options: Record<string, unknown> }) => {
      const controller = options['abortController'] as AbortController;
      signal = controller.signal;
      return hangingStream(controller.signal);
    });

    const uncaught = vi.fn();
    process.on('uncaughtException', uncaught);
    try {
      const loop = new ExecutionLoop({ streamTimeout: 20 });
      await expect(loop.run('hang')).rejects.toThrow(/Stream timeout/);
      // Let any stray uncaughtException land before we assert none did.
      await new Promise((r) => setTimeout(r, 20));
      expect(uncaught, 'timeout escaped as an uncaughtException').not.toHaveBeenCalled();
    } finally {
      process.off('uncaughtException', uncaught);
    }

    expect(signal?.aborted, 'the SDK query was never aborted').toBe(true);
  });

  it('covers a stream that hangs before yielding anything', async () => {
    // The timer used to be armed only inside the loop body, so a stream that
    // never produced a first message had no timeout at all.
    queryMock.mockImplementation(({ options }: { options: Record<string, unknown> }) =>
      hangingStream((options['abortController'] as AbortController).signal, 0));

    const loop = new ExecutionLoop({ streamTimeout: 20 });
    await expect(loop.run('silent')).rejects.toThrow(/Stream timeout/);
  });

  it('resets the deadline on each event', async () => {
    queryMock.mockImplementation(({ options }: { options: Record<string, unknown> }) => {
      const signal = (options['abortController'] as AbortController).signal;
      return (async function* () {
        // Six 15ms gaps: over the 40ms budget in total, under it individually.
        for (let i = 0; i < 6; i++) {
          await new Promise((r) => setTimeout(r, 15));
          if (signal.aborted) throw new Error('aborted');
          yield { type: 'assistant', session_id: 's1' } as never;
        }
        yield { type: 'result', result: 'finished', session_id: 's1' } as never;
      })();
    });

    const loop = new ExecutionLoop({ streamTimeout: 40 });
    await expect(loop.run('slow but alive')).resolves.toBe('finished');
  });
});

describe('ExecutionLoop cancellation (ERR-20)', () => {
  beforeEach(() => {
    queryMock.mockReset();
  });

  it('cancel() aborts an in-flight run and rejects it as cancelled', async () => {
    queryMock.mockImplementation(({ options }: { options: Record<string, unknown> }) =>
      hangingStream((options['abortController'] as AbortController).signal, 1));

    const loop = new ExecutionLoop({ streamTimeout: 60_000 });
    const running = loop.run('long job');

    await vi.waitFor(() => expect(loop.isRunning).toBe(true));
    expect(loop.cancel()).toBe(true);

    await expect(running).rejects.toThrow(/cancelled/i);
    expect(loop.isRunning).toBe(false);
  });

  it('cancel() reports false when nothing is running', () => {
    expect(new ExecutionLoop({}).cancel()).toBe(false);
  });

  it('honours an externally supplied AbortController', async () => {
    const abortController = new AbortController();
    queryMock.mockImplementation(() => hangingStream(abortController.signal, 1));

    const loop = new ExecutionLoop({ abortController, streamTimeout: 60_000 });
    const running = loop.run('long job');

    await vi.waitFor(() => expect(loop.isRunning).toBe(true));
    abortController.abort();

    await expect(running).rejects.toThrow(/cancelled/i);
  });
});
