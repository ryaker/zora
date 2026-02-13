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
import { writeAtomic } from '../utils/fs.js';
import type { MailboxMessage } from './team-types.js';

export class Mailbox {
  private readonly _teamsDir: string;
  private readonly _agentName: string;

  constructor(teamsDir: string, agentName: string) {
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
   */
  async send(
    teamName: string,
    targetAgent: string,
    message: Omit<MailboxMessage, 'from' | 'timestamp' | 'read'>,
  ): Promise<void> {
    const inboxPath = this._inboxPath(teamName, targetAgent);
    const existing = await this._readInbox(inboxPath);

    const full: MailboxMessage = {
      ...message,
      from: this._agentName,
      timestamp: new Date().toISOString(),
      read: false,
    };

    existing.push(full);
    await writeAtomic(inboxPath, JSON.stringify(existing, null, 2));
  }

  /**
   * Reads unread messages from own inbox and marks them as read.
   */
  async receive(teamName: string): Promise<MailboxMessage[]> {
    const inboxPath = this._inboxPath(teamName, this._agentName);
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
  }

  /**
   * Returns all messages (read and unread).
   */
  async getAllMessages(teamName: string): Promise<MailboxMessage[]> {
    const inboxPath = this._inboxPath(teamName, this._agentName);
    return this._readInbox(inboxPath);
  }

  private _inboxPath(teamName: string, agentName: string): string {
    return path.join(this._teamsDir, teamName, 'inboxes', `${agentName}.json`);
  }

  private async _readInbox(inboxPath: string): Promise<MailboxMessage[]> {
    try {
      const content = await fs.readFile(inboxPath, 'utf8');
      return JSON.parse(content) as MailboxMessage[];
    } catch {
      return [];
    }
  }
}
