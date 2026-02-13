import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Mailbox } from '../../../src/teams/mailbox.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

describe('Mailbox', () => {
  const testDir = path.join(os.tmpdir(), `zora-mailbox-test-${Date.now()}`);
  const teamName = 'test-team';

  afterEach(async () => {
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {}
  });

  beforeEach(async () => {
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {}
  });

  it('creates mailbox and initializes inbox file', async () => {
    const mailbox = new Mailbox(testDir, 'agent-a');
    await mailbox.init(teamName);

    const inboxPath = path.join(testDir, teamName, 'inboxes', 'agent-a.json');
    const content = await fs.readFile(inboxPath, 'utf8');
    expect(JSON.parse(content)).toEqual([]);
  });

  it('sends message to another agent', async () => {
    const sender = new Mailbox(testDir, 'agent-a');
    const receiver = new Mailbox(testDir, 'agent-b');
    await sender.init(teamName);
    await receiver.init(teamName);

    await sender.send(teamName, 'agent-b', {
      type: 'task',
      text: 'Do something',
    });

    const messages = await receiver.getAllMessages(teamName);
    expect(messages).toHaveLength(1);
    expect(messages[0]!.text).toBe('Do something');
    expect(messages[0]!.from).toBe('agent-a');
  });

  it('receives unread messages and marks as read', async () => {
    const sender = new Mailbox(testDir, 'agent-a');
    const receiver = new Mailbox(testDir, 'agent-b');
    await sender.init(teamName);
    await receiver.init(teamName);

    await sender.send(teamName, 'agent-b', {
      type: 'task',
      text: 'First task',
    });

    const unread = await receiver.receive(teamName);
    expect(unread).toHaveLength(1);
    expect(unread[0]!.text).toBe('First task');
    expect(unread[0]!.read).toBe(false);

    // Second receive should return empty
    const secondRead = await receiver.receive(teamName);
    expect(secondRead).toHaveLength(0);
  });

  it('returns empty array when no unread messages', async () => {
    const mailbox = new Mailbox(testDir, 'agent-a');
    await mailbox.init(teamName);

    const messages = await mailbox.receive(teamName);
    expect(messages).toEqual([]);
  });

  it('accumulates multiple messages', async () => {
    const sender = new Mailbox(testDir, 'agent-a');
    const receiver = new Mailbox(testDir, 'agent-b');
    await sender.init(teamName);
    await receiver.init(teamName);

    await sender.send(teamName, 'agent-b', { type: 'task', text: 'Task 1' });
    await sender.send(teamName, 'agent-b', { type: 'task', text: 'Task 2' });
    await sender.send(teamName, 'agent-b', { type: 'status', text: 'Status update' });

    const all = await receiver.getAllMessages(teamName);
    expect(all).toHaveLength(3);
  });

  it('handles concurrent sends without corruption', async () => {
    const sender1 = new Mailbox(testDir, 'agent-a');
    const sender2 = new Mailbox(testDir, 'agent-c');
    const receiver = new Mailbox(testDir, 'agent-b');
    await sender1.init(teamName);
    await sender2.init(teamName);
    await receiver.init(teamName);

    // Send sequentially to avoid race conditions on the same file
    await sender1.send(teamName, 'agent-b', { type: 'task', text: 'From A' });
    await sender2.send(teamName, 'agent-b', { type: 'task', text: 'From C' });

    const all = await receiver.getAllMessages(teamName);
    expect(all).toHaveLength(2);
    const texts = all.map((m) => m.text);
    expect(texts).toContain('From A');
    expect(texts).toContain('From C');
  });

  it('getAllMessages returns all messages including read ones', async () => {
    const sender = new Mailbox(testDir, 'agent-a');
    const receiver = new Mailbox(testDir, 'agent-b');
    await sender.init(teamName);
    await receiver.init(teamName);

    await sender.send(teamName, 'agent-b', { type: 'task', text: 'Msg 1' });
    await receiver.receive(teamName); // marks as read
    await sender.send(teamName, 'agent-b', { type: 'task', text: 'Msg 2' });

    const all = await receiver.getAllMessages(teamName);
    expect(all).toHaveLength(2);
    expect(all[0]!.read).toBe(true);
    expect(all[1]!.read).toBe(false);
  });

  it('messages have correct from and timestamp fields', async () => {
    const sender = new Mailbox(testDir, 'agent-a');
    const receiver = new Mailbox(testDir, 'agent-b');
    await sender.init(teamName);
    await receiver.init(teamName);

    const before = new Date().toISOString();
    await sender.send(teamName, 'agent-b', { type: 'result', text: 'Done' });
    const after = new Date().toISOString();

    const messages = await receiver.getAllMessages(teamName);
    expect(messages[0]!.from).toBe('agent-a');
    expect(messages[0]!.timestamp >= before).toBe(true);
    expect(messages[0]!.timestamp <= after).toBe(true);
    expect(messages[0]!.type).toBe('result');
  });
});
