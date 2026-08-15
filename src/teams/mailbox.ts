/**
 * Mailbox — Filesystem-based message passing between agents.
 *
 * Spec v0.6 §5.7 "Mailbox Protocol":
 *   - Each agent has an inbox JSON file under {teamsDir}/{teamName}/inboxes/{agentName}.json
 *   - Messages are appended atomically using write-then-rename.
 *   - Receive marks messages as read.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { writeAtomic, withFileLock } from '../utils/fs.js';

import type { MailboxMessage } from './team-types.js';

/**
 * ERR-22: how long a mailbox operation waits for the inbox lock.
 *
 * Well above `withFileLock`'s 5s default, deliberately. The lock serialises, so
 * with N concurrent senders the last one waits for N turns — a fixed deadline
 * is therefore a cap on how many agents may write at once, wearing a timeout's
 * clothing. Observed: 25 concurrent senders pass in ~0.5s idle and blow past 5s
 * under a loaded machine, which would surface as `send` throwing on a message
 * that was merely queued behind others.
 *
 * Waiting is the right behaviour here. An inbox write is not latency-critical,
 * and the deadline exists to escape a genuinely wedged lock, not to bound
 * queueing. It stays finite so a wedge still ends in a loud error.
 */
const INBOX_LOCK_TIMEOUT_MS = 60_000;

/**
 * Validates that a name does not contain path separators or traversal sequences.
 */
function validateName(name: string, label: string): void {
  if (/[/\\]/.test(name) || name.includes('..')) {
    throw new Error(`Invalid ${label}: must not contain path separators or ".." (got "${name}")`);
  }
}

export class Mailbox {
  private readonly _teamsDir: string;
  private readonly _agentName: string;

  constructor(teamsDir: string, agentName: string) {
    validateName(agentName, 'agentName');
    this._teamsDir = teamsDir;
    this._agentName = agentName;
  }

  /**
   * Initializes the inbox file for the agent if it does not exist.
   */
  async init(teamName: string): Promise<void> {
    const inboxPath = this._inboxPath(teamName, this._agentName);
    const dir = path.dirname(inboxPath);
    await fs.mkdir(dir, { recursive: true });

    try {
      await fs.access(inboxPath);
    } catch {
      await writeAtomic(inboxPath, JSON.stringify([], null, 2));
    }
  }

  /**
   * Sends a message to another agent's inbox.
   *
   * ERR-22: the read-append-write is under a file lock. Atomic writes alone do
   * not make this safe — two senders that both read `[A]` write `[A, B]` and
   * `[A, C]`, and the second write silently destroys the first sender's
   * message. Both writes are atomic; the message is gone anyway. Losing a
   * message on an agent-to-agent channel is invisible from both ends: the
   * sender saw a resolved promise and the recipient never knew there was
   * anything to wait for.
   */
  async send(
    teamName: string,
    targetAgent: string,
    message: Omit<MailboxMessage, 'from' | 'timestamp' | 'read'>,
  ): Promise<void> {
    const inboxPath = this._inboxPath(teamName, targetAgent);

    await withFileLock(inboxPath, async () => {
      const existing = await this._readInbox(inboxPath);

      const full: MailboxMessage = {
        ...message,
        from: this._agentName,
        // Stamped inside the lock so ordering in the file matches the order the
        // timestamps claim.
        timestamp: new Date().toISOString(),
        read: false,
      };

      existing.push(full);
      await writeAtomic(inboxPath, JSON.stringify(existing, null, 2));
    }, { timeoutMs: INBOX_LOCK_TIMEOUT_MS });
  }

  /**
   * Reads unread messages from own inbox and marks them as read.
   *
   * ERR-22: under the same lock as `send`, and for a sharper reason than
   * send-vs-send. A receive that interleaves with a send loses whole messages
   * in one direction — receiver reads `[A]`, sender writes `[A, B]`, receiver
   * writes back `[A(read)]` and B is destroyed before anyone saw it — and
   * resurrects already-handled messages in the other. Marking as read is a
   * read-modify-write like any other.
   */
  async receive(teamName: string): Promise<MailboxMessage[]> {
    const inboxPath = this._inboxPath(teamName, this._agentName);

    return await withFileLock(inboxPath, async () => {
      const all = await this._readInbox(inboxPath);

      const unread = all.filter((m) => !m.read);
      if (unread.length === 0) return [];

      // Snapshot unread messages before mutation
      const snapshot = unread.map((m) => ({ ...m }));

      // Mark as read in the persisted copy
      for (const msg of all) {
        msg.read = true;
      }
      await writeAtomic(inboxPath, JSON.stringify(all, null, 2));

      return snapshot;
    }, { timeoutMs: INBOX_LOCK_TIMEOUT_MS });
  }

  /**
   * Returns all messages (read and unread).
   */
  async getAllMessages(teamName: string): Promise<MailboxMessage[]> {
    const inboxPath = this._inboxPath(teamName, this._agentName);
    return this._readInbox(inboxPath);
  }

  private _inboxPath(teamName: string, agentName: string): string {
    validateName(teamName, 'teamName');
    validateName(agentName, 'agentName');
    return path.join(this._teamsDir, teamName, 'inboxes', `${agentName}.json`);
  }

  /**
   * ERR-22: an absent inbox is empty; an unreadable one is an error.
   *
   * This used to answer every failure with `[]`, which is the same fail-open
   * shape as the watchdog's health file — and here it is destructive rather
   * than merely blind, because the callers write back what they read. A single
   * unparseable byte turned "read the inbox" into `[]`, and the append that
   * followed persisted that `[]` as the new inbox: every queued message
   * discarded, silently, by a read. Only ENOENT is genuinely "no messages yet".
   */
  private async _readInbox(inboxPath: string): Promise<MailboxMessage[]> {
    let content: string;
    try {
      content = await fs.readFile(inboxPath, 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw new Error(`Mailbox: cannot read inbox ${inboxPath}: ${String(err)}`);
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(content) as unknown;
    } catch (err) {
      throw new Error(
        `Mailbox: inbox ${inboxPath} is not valid JSON and would be destroyed by writing to it: ${String(err)}`,
      );
    }

    if (!Array.isArray(parsed)) {
      throw new Error(`Mailbox: inbox ${inboxPath} is not a JSON array (got ${typeof parsed})`);
    }
    return parsed as MailboxMessage[];
  }
}
