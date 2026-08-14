/**
 * SEC-22 — the Gemini prompt must not travel through argv.
 *
 * `spawn(cli, ['chat', '--prompt', prompt])` put the entire _buildPrompt()
 * output — memory context plus the whole XML execution history — into a single
 * argv entry. Two failure modes:
 *
 *  - E2BIG: Linux caps one argv entry at MAX_ARG_STRLEN (128 KiB), so any
 *    non-trivial session fails to spawn with an error that looks like a Gemini
 *    outage, tripping the circuit breaker and triggering a needless failover.
 *  - Disclosure: argv is world-readable via `ps aux` and the per-process
 *    cmdline entries under /proc, so every local process could read the full
 *    prompt.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

const { spawnMock } = vi.hoisted(() => ({ spawnMock: vi.fn() }));

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, spawn: spawnMock };
});

const { GeminiProvider } = await import('../../../src/providers/gemini-provider.js');
import type { TaskContext, AgentEvent, ProviderConfig } from '../../../src/types.js';

const config: ProviderConfig = {
  name: 'gemini-test',
  type: 'gemini-cli',
  rank: 2,
  capabilities: ['reasoning'],
  cost_tier: 'free',
  enabled: true,
};

/** A fake child process that records what was written to stdin. */
function makeFakeChild() {
  const child = new EventEmitter() as EventEmitter & {
    stdin: PassThrough;
    stdout: PassThrough;
    stderr: PassThrough;
    kill: () => void;
  };
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = () => { /* no-op */ };

  const written: Buffer[] = [];
  child.stdin.on('data', (chunk: Buffer) => written.push(Buffer.from(chunk)));

  // Finish immediately once the caller has wired up its listeners.
  setImmediate(() => {
    child.stdout.end();
    child.stderr.end();
    setImmediate(() => child.emit('close', 0));
  });

  return { child, stdinText: () => Buffer.concat(written).toString('utf8') };
}

function makeTask(overrides: Partial<TaskContext> = {}): TaskContext {
  return {
    jobId: 'job-gemini-1',
    task: 'summarise the repository',
    requiredCapabilities: ['reasoning'],
    complexity: 'simple',
    resourceType: 'research',
    systemPrompt: 'system',
    memoryContext: [],
    history: [],
    ...overrides,
  };
}

async function runGemini(task: TaskContext, cwd?: string) {
  const { child, stdinText } = makeFakeChild();
  spawnMock.mockReturnValue(child);

  const provider = new GeminiProvider({ config, ...(cwd ? { cwd } : {}) });
  const events: AgentEvent[] = [];
  for await (const event of provider.execute(task)) events.push(event);

  const [command, args, options] = spawnMock.mock.calls.at(-1) as [
    string, string[], Record<string, unknown> | undefined,
  ];
  return { command, args, options, stdin: stdinText(), events };
}

describe('GeminiProvider prompt transport (SEC-22)', () => {
  beforeEach(() => {
    spawnMock.mockReset();
  });

  it('never puts the prompt in argv', async () => {
    const secret = 'CORRELATION-TOKEN-8fd3a1';
    const { args, stdin } = await runGemini(makeTask({ task: `do the thing with ${secret}` }));

    expect(args).not.toContain('--prompt');
    for (const arg of args) {
      expect(arg, `prompt text leaked into argv: ${arg}`).not.toContain(secret);
    }
    expect(stdin).toContain(secret);
  });

  it('opens a writable stdin pipe', async () => {
    const { options } = await runGemini(makeTask());
    expect(options?.['stdio']).toEqual(['pipe', 'pipe', 'pipe']);
  });

  it('keeps memory context and history off the command line', async () => {
    const { args, stdin } = await runGemini(makeTask({
      memoryContext: ['~/.ssh/config was read on Tuesday'],
      history: [{
        type: 'tool_call',
        timestamp: new Date(),
        source: 'gemini-test',
        content: { toolCallId: 't1', tool: 'Read', arguments: { file_path: '/home/u/private.env' } },
      } as AgentEvent],
    }));

    const argv = args.join(' ');
    expect(argv).not.toContain('.ssh/config');
    expect(argv).not.toContain('private.env');
    expect(stdin).toContain('.ssh/config');
    expect(stdin).toContain('private.env');
  });

  it('carries a prompt far larger than MAX_ARG_STRLEN', async () => {
    // 128 KiB is the per-argv-entry cap that used to turn a long session into
    // an E2BIG spawn failure.
    const huge = 'x'.repeat(200 * 1024);
    const { stdin, args } = await runGemini(makeTask({ task: huge }));

    expect(stdin.length).toBeGreaterThan(128 * 1024);
    expect(args.join(' ').length).toBeLessThan(1024);
  });

  it('still passes the model through as a flag', async () => {
    const { child } = makeFakeChild();
    spawnMock.mockReturnValue(child);

    const provider = new GeminiProvider({ config: { ...config, model: 'gemini-2.5-pro' } });
    for await (const _ of provider.execute(makeTask())) { /* drain */ }

    const [, args] = spawnMock.mock.calls.at(-1) as [string, string[]];
    expect(args).toEqual(['chat', '--model', 'gemini-2.5-pro']);
  });

  it('spawns in the configured workspace (PROV-10)', async () => {
    const { options } = await runGemini(makeTask(), '/srv/zora-workspace');
    expect(options?.['cwd']).toBe('/srv/zora-workspace');
  });
});
