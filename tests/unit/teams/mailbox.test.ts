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

  /**
   * ERR-22 regression guards.
   *
   * `send` and `receive` are read-modify-write cycles on a shared file.
   * `writeAtomic` makes each individual write all-or-nothing, which is a
   * different guarantee from making the read-then-write indivisible: two
   * senders that both read `[A]` write `[A, B]` and `[A, C]`, both atomically,
   * and one message is destroyed. The loss is invisible from both ends — the
   * sender's promise resolved, and the recipient never knew there was anything
   * to wait for.
   *
   * The counts here are exact, not lower bounds. "Most messages arrive" is the
   * bug.
   */
  describe('concurrent access (ERR-22)', () => {
    it('loses no messages when many senders write at once', async () => {
      const recipient = new Mailbox(testDir, 'bob');
      await recipient.init(teamName);

      // Distinct Mailbox instances, as separate agents would have. All sends
      // are started before any is awaited, so they genuinely overlap.
      const senderCount = 25;
      await Promise.all(
        Array.from({ length: senderCount }, (_, i) =>
          new Mailbox(testDir, `sender-${i}`).send(teamName, 'bob', {
            type: 'task',
            text: `message-${i}`,
          }),
        ),
      );

      const all = await recipient.getAllMessages(teamName);
      expect(all).toHaveLength(senderCount);
      // Every individual message, not just the right count.
      expect(new Set(all.map((m) => m.text)).size).toBe(senderCount);
    });

    it('delivers every message exactly once when receive races with send', async () => {
      const bob = new Mailbox(testDir, 'bob');
      await bob.init(teamName);

      // Interleave sends with receives. A receive that overlaps a send can
      // destroy the sent message (receiver writes back the copy it read before
      // the send landed) or re-deliver an already-read one.
      const messageCount = 20;
      const sends = Array.from({ length: messageCount }, (_, i) =>
        new Mailbox(testDir, `sender-${i}`).send(teamName, 'bob', {
          type: 'task',
          text: `message-${i}`,
        }),
      );
      const receives = Array.from({ length: 10 }, () => bob.receive(teamName));

      const [, ...received] = await Promise.all([Promise.all(sends), ...receives]);
      const drained = await bob.receive(teamName);

      const delivered = [...received.flat(), ...drained].map((m) => m.text);
      // Nothing lost, and nothing delivered twice.
      expect(delivered.length).toBe(messageCount);
      expect(new Set(delivered).size).toBe(messageCount);
      // And the inbox still holds every message, all marked read.
      const all = await bob.getAllMessages(teamName);
      expect(all).toHaveLength(messageCount);
      expect(all.every((m) => m.read)).toBe(true);
    });

    /**
     * The fail-open half of the same gap. `_readInbox` answered any read or
     * parse failure with `[]`, and both callers write back what they read — so
     * a single unparseable byte turned a read into a silent, total erase of the
     * queue on the very next send.
     */
    it('refuses to overwrite a corrupt inbox instead of erasing it', async () => {
      const bob = new Mailbox(testDir, 'bob');
      await bob.init(teamName);
      await new Mailbox(testDir, 'alice').send(teamName, 'bob', { type: 'task', text: 'precious' });

      const inboxPath = path.join(testDir, teamName, 'inboxes', 'bob.json');
      const corrupt = '[{"type":"task","text":"precious"} {"broken"';
      await fs.writeFile(inboxPath, corrupt, 'utf8');

      await expect(
        new Mailbox(testDir, 'alice').send(teamName, 'bob', { type: 'task', text: 'second' }),
      ).rejects.toThrow(/not valid JSON/);

      // The damaged file is left exactly as it was, for recovery by hand,
      // rather than replaced with a one-element array.
      expect(await fs.readFile(inboxPath, 'utf8')).toBe(corrupt);
    });

    it('reports an unreadable inbox rather than reporting it empty', async () => {
      const bob = new Mailbox(testDir, 'bob');
      await bob.init(teamName);

      // A directory where the inbox should be: a non-ENOENT errno, which is
      // "cannot tell", not "no messages".
      const inboxPath = path.join(testDir, teamName, 'inboxes', 'bob.json');
      await fs.rm(inboxPath, { force: true });
      await fs.mkdir(inboxPath, { recursive: true });

      await expect(bob.getAllMessages(teamName)).rejects.toThrow(/cannot read inbox/);
    });

    it('treats a not-yet-created inbox as empty', async () => {
      // The one failure that really does mean "no messages yet".
      const fresh = new Mailbox(testDir, 'nobody');
      await expect(fresh.getAllMessages(teamName)).resolves.toEqual([]);
    });
  });
});
