import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Mailbox } from '../../../src/teams/mailbox.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { GeminiBridge, type TeamTaskSubmitter } from '../../../src/teams/gemini-bridge.js';

/**
 * SEC-22 follow-up: these tests used to mock `node:child_process` and assert on
 * `spawn` calls, because the bridge ran delegated tasks as a subprocess. It
 * submits them to the orchestrator now, so the seam under test is the injected
 * submitter and no process mocking is needed.
 */

interface SubmitterStub {
  submit: TeamTaskSubmitter;
  /** Prompts the bridge asked to run, in order. */
  prompts: string[];
}

/** A submitter that records what it was asked to run and answers as told. */
function stubSubmitter(
  respond: (prompt: string) => Promise<{ ok: true; output: string } | { ok: false; error: string }>,
): SubmitterStub {
  const prompts: string[] = [];
  return {
    prompts,
    submit: async (request) => {
      prompts.push(request.prompt);
      return respond(request.prompt);
    },
  };
}

/**
 * TEST-20: wait for an observable condition instead of sleeping a fixed span.
 *
 * The bridge reaches every observable state through a chain of asynchronous
 * work — one poll tick, then `Mailbox.receive()`, which is readFile + mkdir +
 * writeFile + rename. On an idle machine that chain completes ~66 ms after
 * `start()`; under filesystem contention it can take several times that, while
 * a `setTimeout` in the test keeps running on the wall clock regardless. A
 * fixed sleep therefore races the filesystem. Polling a condition against a
 * deadline cannot: a slow machine only makes the wait longer, never wrong.
 */
async function until(
  predicate: () => boolean | Promise<boolean>,
  label: string,
  timeoutMs = 10_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    let ok = false;
    try {
      ok = await predicate();
    } catch {
      ok = false; // e.g. the file we poll for does not exist yet
    }
    if (ok) return;
    if (Date.now() >= deadline) {
      throw new Error(`timed out after ${timeoutMs}ms waiting for: ${label}`);
    }
    await new Promise((r) => setTimeout(r, 5));
  }
}

describe('GeminiBridge', () => {
  const testDir = path.join(os.tmpdir(), `zora-bridge-test-${process.pid}-${Date.now()}`);
  const teamName = 'bridge-team';

  beforeEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true }).catch(() => {});
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true }).catch(() => {});
  });

  it('starts and stops polling', async () => {
    const mailbox = new Mailbox(testDir, 'gemini-agent');
    await mailbox.init(teamName);

    const bridge = new GeminiBridge(teamName, mailbox, {
      pollIntervalMs: 100,
      geminiCliPath: '/usr/bin/gemini',
    });

    expect(bridge.isRunning()).toBe(false);
    bridge.start();
    expect(bridge.isRunning()).toBe(true);
    bridge.stop();
    expect(bridge.isRunning()).toBe(false);
  });

  it('does not start twice', async () => {
    const mailbox = new Mailbox(testDir, 'gemini-agent');
    await mailbox.init(teamName);

    const bridge = new GeminiBridge(teamName, mailbox, {
      pollIntervalMs: 100,
      geminiCliPath: '/usr/bin/gemini',
    });

    bridge.start();
    bridge.start(); // second start should be a no-op
    expect(bridge.isRunning()).toBe(true);
    bridge.stop();
  });

  it('runs a delegated task and posts the result back to the sender', async () => {
    const geminiMailbox = new Mailbox(testDir, 'gemini-agent');
    const coordMailbox = new Mailbox(testDir, 'coordinator');
    await geminiMailbox.init(teamName);
    await coordMailbox.init(teamName);

    await coordMailbox.send(teamName, 'gemini-agent', {
      type: 'task',
      text: 'analyze the repo',
    });

    const submitter = stubSubmitter(async () => ({ ok: true, output: 'Analysis complete' }));
    const bridge = new GeminiBridge(teamName, geminiMailbox, {
      pollIntervalMs: 30,
      submitTask: submitter.submit,
    });

    bridge.start();
    await until(() => submitter.prompts.length > 0, 'the delegated task to be submitted');

    // The instruction reaches the submitter verbatim.
    expect(submitter.prompts).toEqual(['analyze the repo']);

    const inboxPath = path.join(testDir, teamName, 'inboxes', 'coordinator.json');
    let inbox: Array<{ type: string; text: string }> = [];
    await until(async () => {
      inbox = JSON.parse(await fs.readFile(inboxPath, 'utf8'));
      return inbox.some((m) => m.type === 'result');
    }, 'result message in the coordinator inbox');
    bridge.stop();

    expect(inbox.find((m) => m.type === 'result')?.text).toBe('Analysis complete');
  }, 20_000);

  it('reports a failed task back to the requester instead of swallowing it', async () => {
    const geminiMailbox = new Mailbox(testDir, 'gemini-agent');
    const coordMailbox = new Mailbox(testDir, 'coordinator');
    await geminiMailbox.init(teamName);
    await coordMailbox.init(teamName);

    await coordMailbox.send(teamName, 'gemini-agent', { type: 'task', text: 'fail please' });

    const bridge = new GeminiBridge(teamName, geminiMailbox, {
      pollIntervalMs: 30,
      submitTask: stubSubmitter(async () => ({ ok: false, error: 'provider unavailable' })).submit,
    });

    bridge.start();
    const inboxPath = path.join(testDir, teamName, 'inboxes', 'coordinator.json');
    await until(async () => {
      const inbox = JSON.parse(await fs.readFile(inboxPath, 'utf8')) as Array<{ type: string; text: string }>;
      return inbox.some((m) => m.type === 'result' && m.text.includes('provider unavailable'));
    }, 'failure result posted back to the coordinator');

    bridge.stop();
    expect(bridge.isRunning()).toBe(false);
  }, 20_000);

  /**
   * A submitter that throws is a wiring bug rather than a task failure, and the
   * requester must not be left waiting on a reply that never comes.
   */
  it('answers the requester even when the submitter throws', async () => {
    const geminiMailbox = new Mailbox(testDir, 'gemini-agent');
    const coordMailbox = new Mailbox(testDir, 'coordinator');
    await geminiMailbox.init(teamName);
    await coordMailbox.init(teamName);

    await coordMailbox.send(teamName, 'gemini-agent', { type: 'task', text: 'boom' });

    const bridge = new GeminiBridge(teamName, geminiMailbox, {
      pollIntervalMs: 30,
      submitTask: async () => {
        throw new Error('orchestrator not booted');
      },
    });

    bridge.start();
    const inboxPath = path.join(testDir, teamName, 'inboxes', 'coordinator.json');
    await until(async () => {
      const inbox = JSON.parse(await fs.readFile(inboxPath, 'utf8')) as Array<{ type: string; text: string }>;
      return inbox.some((m) => m.type === 'result' && m.text.includes('orchestrator not booted'));
    }, 'submission failure reported back to the coordinator');

    bridge.stop();
  }, 20_000);

  it('does not post a result for a task that finished after stop()', async () => {
    const geminiMailbox = new Mailbox(testDir, 'gemini-agent');
    const coordMailbox = new Mailbox(testDir, 'coordinator');
    await geminiMailbox.init(teamName);
    await coordMailbox.init(teamName);

    await coordMailbox.send(teamName, 'gemini-agent', { type: 'task', text: 'slow task' });

    let release: (() => void) | null = null;
    const started = new Promise<void>((resolve) => {
      release = resolve;
    });
    let submitCalled = false;

    const bridge = new GeminiBridge(teamName, geminiMailbox, {
      pollIntervalMs: 30,
      submitTask: async () => {
        submitCalled = true;
        await started; // held open until the test stops the bridge
        return { ok: true, output: 'too late' };
      },
    });

    bridge.start();
    await until(() => submitCalled, 'the task to be submitted');
    bridge.stop();
    release!();

    // Give the resolved submission a chance to post, so this asserts silence
    // rather than merely racing ahead of it.
    await new Promise((r) => setTimeout(r, 200));

    const inbox = JSON.parse(
      await fs.readFile(path.join(testDir, teamName, 'inboxes', 'coordinator.json'), 'utf8'),
    ) as Array<{ type: string }>;
    expect(inbox.some((m) => m.type === 'result')).toBe(false);
  }, 20_000);

  /**
   * SEC-22 regression guard, asserted against the source rather than behaviour.
   *
   * The bridge used to run `spawn(geminiCliPath, ['chat', '--prompt', taskText])`
   * — the exact construction SEC-22 removed from GeminiProvider, because argv is
   * world-readable and a large prompt dies at MAX_ARG_STRLEN. A behavioural test
   * cannot show the absence of a subprocess without mocking the module back in,
   * so this pins the property directly: the bridge does not execute anything
   * itself, it delegates to the submitter.
   */
  it('never executes a subprocess of its own', async () => {
    const source = await fs.readFile(
      fileURLToPath(new URL('../../../src/teams/gemini-bridge.ts', import.meta.url)),
      'utf8',
    );
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

    expect(code, 'gemini-bridge imports node:child_process again').not.toMatch(/from ['"]node:child_process['"]/);
    expect(code, 'gemini-bridge spawns a process again — see SEC-22').not.toMatch(/\bspawn\s*\(/);
    expect(code, 'gemini-bridge execs a process again — see SEC-22').not.toMatch(/\bexec(Sync|File)?\s*\(/);
  });
});
