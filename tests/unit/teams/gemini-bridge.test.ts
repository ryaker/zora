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

describe('GeminiBridge', () => {
  const testDir = path.join(os.tmpdir(), `zora-bridge-test-${Date.now()}`);
  const teamName = 'bridge-team';

  beforeEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true }).catch(() => {});
    mockSpawn.mockReset();
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true }).catch(() => {});
  });

  function createMockProcess(stdout: string, exitCode: number) {
    const proc = new EventEmitter() as any;
    const stdoutStream = new EventEmitter() as Readable;
    const stderrStream = new EventEmitter() as Readable;
    proc.stdout = stdoutStream;
    proc.stderr = stderrStream;
    proc.kill = vi.fn();

    setTimeout(() => {
      if (stdout) stdoutStream.emit('data', Buffer.from(stdout));
      proc.emit('close', exitCode);
    }, 5);

    return proc;
  }

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
    // Wait for poll + process + result posting
    await new Promise((r) => setTimeout(r, 500));
    bridge.stop();

    // Verify spawn was called and close fired
    expect(mockSpawn).toHaveBeenCalled();
    expect(closeFired).toBe(true);

    // Wait a bit more for async operations to settle
    await new Promise((r) => setTimeout(r, 200));

    // Check the coordinator inbox directly
    const inboxPath = path.join(testDir, teamName, 'inboxes', 'coordinator.json');
    const rawContent = await fs.readFile(inboxPath, 'utf8');
    const inboxData = JSON.parse(rawContent) as any[];
    expect(inboxData.length).toBeGreaterThan(0);

    const resultMsg = inboxData.find((m: any) => m.type === 'result');
    expect(resultMsg).toBeDefined();
    expect(resultMsg.text).toBe('Analysis complete');
  });

  it('handles process errors gracefully', async () => {
    const geminiMailbox = new Mailbox(testDir, 'gemini-agent');
    const coordMailbox = new Mailbox(testDir, 'coordinator');
    await geminiMailbox.init(teamName);
    await coordMailbox.init(teamName);

    await coordMailbox.send(teamName, 'gemini-agent', {
      type: 'task',
      text: 'fail please',
    });

    mockSpawn.mockImplementation(() => {
      const proc = new EventEmitter() as any;
      proc.stdout = new EventEmitter() as Readable;
      proc.stderr = new EventEmitter() as Readable;
      proc.kill = vi.fn();

      setTimeout(() => {
        proc.emit('error', new Error('spawn failed'));
      }, 5);

      return proc;
    });

    const bridge = new GeminiBridge(teamName, geminiMailbox, {
      pollIntervalMs: 30,
      geminiCliPath: '/nonexistent',
    });

    bridge.start();
    await new Promise((r) => setTimeout(r, 200));
    bridge.stop();

    // Should not crash
    expect(bridge.isRunning()).toBe(false);
  });

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
    await new Promise((r) => setTimeout(r, 150));

    bridge.stop();
    expect(killFn).toHaveBeenCalled();
  });
});
