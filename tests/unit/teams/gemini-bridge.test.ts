import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Mailbox } from '../../../src/teams/mailbox.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { EventEmitter } from 'node:events';
import type { Readable } from 'node:stream';

vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}));

import { spawn } from 'node:child_process';
import { GeminiBridge } from '../../../src/teams/gemini-bridge.js';

const mockSpawn = vi.mocked(spawn);

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
    mockSpawn.mockReset();
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

  it('spawns CLI on task message and posts result', async () => {
    const geminiMailbox = new Mailbox(testDir, 'gemini-agent');
    const coordMailbox = new Mailbox(testDir, 'coordinator');
    await geminiMailbox.init(teamName);
    await coordMailbox.init(teamName);

    // Send a task to gemini-agent inbox
    await coordMailbox.send(teamName, 'gemini-agent', {
      type: 'task',
      text: 'analyze this code',
    });

    // Track if close event is emitted
    let closeFired = false;
    mockSpawn.mockImplementation((_cmd: any, _args: any, _opts: any) => {
      const proc = new EventEmitter() as any;
      const stdoutStream = new EventEmitter() as Readable;
      const stderrStream = new EventEmitter() as Readable;
      proc.stdout = stdoutStream;
      proc.stderr = stderrStream;
      proc.kill = vi.fn();
      proc.pid = 12345;

      setTimeout(() => {
        stdoutStream.emit('data', Buffer.from('Analysis complete'));
        proc.emit('close', 0);
        closeFired = true;
      }, 10);

      return proc;
    });

    const bridge = new GeminiBridge(teamName, geminiMailbox, {
      pollIntervalMs: 30,
      geminiCliPath: '/usr/bin/gemini',
    });

    bridge.start();
    // Wait for the poll to spawn the CLI and for the mocked process to close.
    await until(() => closeFired, 'mocked gemini process to close');
    bridge.stop();

    expect(mockSpawn).toHaveBeenCalled();
    expect(closeFired).toBe(true);

    // The result is written to the coordinator inbox asynchronously after close.
    const inboxPath = path.join(testDir, teamName, 'inboxes', 'coordinator.json');
    let inboxData: any[] = [];
    await until(async () => {
      inboxData = JSON.parse(await fs.readFile(inboxPath, 'utf8')) as any[];
      return inboxData.some((m: any) => m.type === 'result');
    }, 'result message in the coordinator inbox');

    const resultMsg = inboxData.find((m: any) => m.type === 'result');
    expect(resultMsg).toBeDefined();
    expect(resultMsg.text).toBe('Analysis complete');
  }, 20_000);

  it('handles process errors gracefully', async () => {
    const geminiMailbox = new Mailbox(testDir, 'gemini-agent');
    const coordMailbox = new Mailbox(testDir, 'coordinator');
    await geminiMailbox.init(teamName);
    await coordMailbox.init(teamName);

    await coordMailbox.send(teamName, 'gemini-agent', {
      type: 'task',
      text: 'fail please',
    });

    let errorFired = false;
    mockSpawn.mockImplementation(() => {
      const proc = new EventEmitter() as any;
      proc.stdout = new EventEmitter() as Readable;
      proc.stderr = new EventEmitter() as Readable;
      proc.kill = vi.fn();

      setTimeout(() => {
        proc.emit('error', new Error('spawn failed'));
        errorFired = true;
      }, 5);

      return proc;
    });

    const bridge = new GeminiBridge(teamName, geminiMailbox, {
      pollIntervalMs: 30,
      geminiCliPath: '/nonexistent',
    });

    bridge.start();
    await until(() => errorFired, 'mocked spawn to emit an error');

    // The failure is reported back to the requesting agent, not swallowed.
    const inboxPath = path.join(testDir, teamName, 'inboxes', 'coordinator.json');
    await until(async () => {
      const inbox = JSON.parse(await fs.readFile(inboxPath, 'utf8')) as any[];
      return inbox.some((m: any) => m.type === 'result' && m.text.includes('spawn failure'));
    }, 'spawn-failure result posted back to the coordinator');

    bridge.stop();

    // Should not crash
    expect(bridge.isRunning()).toBe(false);
  }, 20_000);

  it('kills active process on stop', async () => {
    const mailbox = new Mailbox(testDir, 'gemini-agent');
    await mailbox.init(teamName);

    // Send a task
    const sender = new Mailbox(testDir, 'coord');
    await sender.send(teamName, 'gemini-agent', { type: 'task', text: 'long task' });

    const killFn = vi.fn();
    mockSpawn.mockImplementation(() => {
      const proc = new EventEmitter() as any;
      proc.stdout = new EventEmitter() as Readable;
      proc.stderr = new EventEmitter() as Readable;
      proc.kill = killFn;
      // Process never closes — simulates a long-running task
      return proc;
    });

    const bridge = new GeminiBridge(teamName, mailbox, {
      pollIntervalMs: 30,
      geminiCliPath: '/usr/bin/gemini',
    });

    bridge.start();
    // TEST-20: stop() can only kill a process that has already been spawned, so
    // wait for the spawn itself rather than for a fixed span that has to be long
    // enough to cover a poll tick plus four filesystem syscalls.
    await until(() => mockSpawn.mock.calls.length > 0, 'the CLI subprocess to be spawned');

    bridge.stop();
    expect(killFn).toHaveBeenCalled();
  }, 20_000);
});
