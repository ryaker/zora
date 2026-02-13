import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { GeminiBridge } from '../../../src/teams/gemini-bridge.js';
import { Mailbox } from '../../../src/teams/mailbox.js';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

function createMockProcess(stdout: string, exitCode = 0) {
  const proc = new EventEmitter() as EventEmitter & {
    stdout: Readable;
    stderr: Readable;
    kill: ReturnType<typeof vi.fn>;
  };
  proc.stdout = Readable.from([Buffer.from(stdout)]);
  proc.stderr = Readable.from([]);
  proc.kill = vi.fn();

  // Emit close after a short delay to simulate async execution
  setTimeout(() => {
    proc.emit('close', exitCode);
  }, 10);

  return proc;
}

vi.mock('node:child_process', () => ({
  spawn: vi.fn(() => createMockProcess('gemini result')),
}));

describe('GeminiBridge', () => {
  const testDir = path.join(os.tmpdir(), `zora-bridge-test-${Date.now()}`);
  const teamName = 'bridge-team';
  let mailbox: Mailbox;
  let bridge: GeminiBridge;

  beforeEach(async () => {
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {}

    mailbox = new Mailbox(testDir, 'gemini-agent');
    await mailbox.init(teamName);

    // Also init coordinator inbox for result messages
    const coordMailbox = new Mailbox(testDir, 'coordinator');
    await coordMailbox.init(teamName);

    bridge = new GeminiBridge(teamName, mailbox, {
      pollIntervalMs: 50,
      geminiCliPath: '/usr/bin/echo',
    });
  });

  afterEach(async () => {
    bridge.stop();
    vi.restoreAllMocks();
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {}
  });

  it('starts and stops without error', () => {
    bridge.start();
    expect(bridge.isRunning()).toBe(true);
    bridge.stop();
    expect(bridge.isRunning()).toBe(false);
  });

  it('isRunning returns correct state', () => {
    expect(bridge.isRunning()).toBe(false);
    bridge.start();
    expect(bridge.isRunning()).toBe(true);
    bridge.stop();
    expect(bridge.isRunning()).toBe(false);
  });

  it('does not start twice', () => {
    bridge.start();
    bridge.start(); // should be no-op
    expect(bridge.isRunning()).toBe(true);
    bridge.stop();
  });

  it('processes task messages from inbox', async () => {
    // Send a task to the gemini-agent inbox
    const sender = new Mailbox(testDir, 'coordinator');
    await sender.send(teamName, 'gemini-agent', {
      type: 'task',
      text: 'Analyze this code',
    });

    bridge.start();

    // Wait for polling + execution
    await new Promise((resolve) => setTimeout(resolve, 200));

    bridge.stop();

    // Check that a result was sent back to coordinator
    const coordMailbox = new Mailbox(testDir, 'coordinator');
    const results = await coordMailbox.getAllMessages(teamName);
    expect(results.length).toBeGreaterThanOrEqual(1);
    const resultMsg = results.find((m) => m.type === 'result');
    expect(resultMsg).toBeDefined();
    expect(resultMsg!.text).toBe('gemini result');
  });

  it('posts results to coordinator inbox', async () => {
    const sender = new Mailbox(testDir, 'coordinator');
    await sender.send(teamName, 'gemini-agent', {
      type: 'task',
      text: 'Generate report',
    });

    bridge.start();
    await new Promise((resolve) => setTimeout(resolve, 200));
    bridge.stop();

    const coordMailbox = new Mailbox(testDir, 'coordinator');
    const messages = await coordMailbox.getAllMessages(teamName);
    const results = messages.filter((m) => m.from === 'gemini-agent');
    expect(results.length).toBeGreaterThanOrEqual(1);
  });
});
