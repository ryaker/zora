import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Mailbox } from '../../../src/teams/mailbox.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

describe('Mailbox', () => {
  const testDir = path.join(os.tmpdir(), `zora-mailbox-test-${Date.now()}`);
  const teamName = 'test-team';

  beforeEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true }).catch(() => {});
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true }).catch(() => {});
  });

  it('creates inbox file on init', async () => {
    const mailbox = new Mailbox(testDir, 'agent-a');
    await mailbox.init(teamName);

    const inboxPath = path.join(testDir, teamName, 'inboxes', 'agent-a.json');
    const content = await fs.readFile(inboxPath, 'utf8');
    expect(JSON.parse(content)).toEqual([]);
  });

  it('does not overwrite existing inbox on init', async () => {
    const mailbox = new Mailbox(testDir, 'agent-a');
    await mailbox.init(teamName);

    // Send a message to populate the inbox
    const sender = new Mailbox(testDir, 'agent-b');
    await sender.send(teamName, 'agent-a', { type: 'task', text: 'do something' });

    // Re-init should not clear messages
    await mailbox.init(teamName);

    const all = await mailbox.getAllMessages(teamName);
    expect(all).toHaveLength(1);
  });

  it('sends and receives messages', async () => {
    const alice = new Mailbox(testDir, 'alice');
    const bob = new Mailbox(testDir, 'bob');
    await alice.init(teamName);
    await bob.init(teamName);

    await alice.send(teamName, 'bob', { type: 'task', text: 'hello bob' });

    const received = await bob.receive(teamName);
    expect(received).toHaveLength(1);
    expect(received[0]!.text).toBe('hello bob');
    expect(received[0]!.from).toBe('alice');
    expect(received[0]!.type).toBe('task');
    expect(received[0]!.read).toBe(false);
  });

  it('marks messages as read after receive', async () => {
    const alice = new Mailbox(testDir, 'alice');
    const bob = new Mailbox(testDir, 'bob');
    await alice.init(teamName);
    await bob.init(teamName);

    await alice.send(teamName, 'bob', { type: 'task', text: 'msg1' });
    await alice.send(teamName, 'bob', { type: 'status', text: 'msg2' });

    // First receive gets both
    const first = await bob.receive(teamName);
    expect(first).toHaveLength(2);

    // Second receive gets none (all read)
    const second = await bob.receive(teamName);
    expect(second).toHaveLength(0);
  });

  it('getAllMessages returns read and unread', async () => {
    const alice = new Mailbox(testDir, 'alice');
    const bob = new Mailbox(testDir, 'bob');
    await alice.init(teamName);
    await bob.init(teamName);

    await alice.send(teamName, 'bob', { type: 'task', text: 'task1' });
    await bob.receive(teamName); // mark as read
    await alice.send(teamName, 'bob', { type: 'task', text: 'task2' }); // new unread

    const all = await bob.getAllMessages(teamName);
    expect(all).toHaveLength(2);
    expect(all[0]!.read).toBe(true);
    expect(all[1]!.read).toBe(false);
  });

  it('handles empty inbox gracefully', async () => {
    const mailbox = new Mailbox(testDir, 'lonely');
    await mailbox.init(teamName);

    const received = await mailbox.receive(teamName);
    expect(received).toHaveLength(0);
  });

  it('receive returns messages in order', async () => {
    const alice = new Mailbox(testDir, 'alice');
    const bob = new Mailbox(testDir, 'bob');
    await alice.init(teamName);
    await bob.init(teamName);

    await alice.send(teamName, 'bob', { type: 'task', text: 'first' });
    await alice.send(teamName, 'bob', { type: 'task', text: 'second' });
    await alice.send(teamName, 'bob', { type: 'task', text: 'third' });

    const received = await bob.receive(teamName);
    expect(received).toHaveLength(3);
    expect(received[0]!.text).toBe('first');
    expect(received[1]!.text).toBe('second');
    expect(received[2]!.text).toBe('third');
  });

  it('includes metadata in messages', async () => {
    const alice = new Mailbox(testDir, 'alice');
    const bob = new Mailbox(testDir, 'bob');
    await alice.init(teamName);
    await bob.init(teamName);

    await alice.send(teamName, 'bob', {
      type: 'result',
      text: 'done',
      metadata: { exitCode: 0, duration: '2.5s' },
    });

    const received = await bob.receive(teamName);
    expect(received[0]!.metadata).toEqual({ exitCode: 0, duration: '2.5s' });
  });

  it('sets timestamp on sent messages', async () => {
    const alice = new Mailbox(testDir, 'alice');
    const bob = new Mailbox(testDir, 'bob');
    await alice.init(teamName);
    await bob.init(teamName);

    const before = new Date().toISOString();
    await alice.send(teamName, 'bob', { type: 'task', text: 'timed' });
    const after = new Date().toISOString();

    const received = await bob.receive(teamName);
    expect(received[0]!.timestamp >= before).toBe(true);
    expect(received[0]!.timestamp <= after).toBe(true);
  });
});
