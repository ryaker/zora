/**
 * MailboxChannelAdapter — a team inbox presented as a channel.
 *
 * A task arriving in an agent's inbox is untrusted input from a third party
 * that causes Zora to act. That is precisely what `ChannelManager` exists for,
 * and INVARIANT-9 already says all channels use that path: policy gate →
 * capability resolver → dual-LLM quarantine → orchestrator.
 *
 * `GeminiBridge` did none of it. It polled the same inbox and ran the message
 * itself, so a delegated instruction skipped the authorization and quarantine
 * that the identical instruction arriving over Signal or Telegram would have
 * gone through. Presenting the mailbox as an adapter is what makes team
 * delegation secure by construction rather than by checks bolted on later.
 *
 * Quarantine matters more here than it looks. Prompt injection travels
 * agent-to-agent: a teammate that ingested a poisoned page can forward it as a
 * task, and INVARIANT-4 is what keeps that content out of the privileged loop.
 *
 * Identities are `team:<agent>` rather than bare agent names, so a team entry
 * in `channel-policy.toml` cannot collide with a phone number and an agent
 * cannot be granted intake by accident.
 */

import type { IChannelAdapter, SendOptions } from '../channel-adapter.js';
import type { ChannelIdentity, ChannelMessage } from '../../types/channel.js';
import type { Mailbox } from '../../teams/mailbox.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('mailbox-channel');

/** Prefix marking a channel identity as a team agent rather than a phone number. */
export const TEAM_IDENTITY_PREFIX = 'team:';

/** The `channel-policy.toml` subject for a team member. */
export function teamIdentity(agentName: string): string {
  return `${TEAM_IDENTITY_PREFIX}${agentName}`;
}

/** Inverse of `teamIdentity`, for addressing a reply back to the sender's inbox. */
export function agentNameFrom(identity: ChannelIdentity): string {
  return identity.phoneNumber.startsWith(TEAM_IDENTITY_PREFIX)
    ? identity.phoneNumber.slice(TEAM_IDENTITY_PREFIX.length)
    : identity.phoneNumber;
}

export interface MailboxChannelAdapterOptions {
  teamName: string;
  /** The agent whose inbox this adapter drains. */
  agentName: string;
  mailbox: Mailbox;
  pollIntervalMs?: number;
}

export class MailboxChannelAdapter implements IChannelAdapter {
  readonly name: string;
  private readonly _teamName: string;
  private readonly _agentName: string;
  private readonly _mailbox: Mailbox;
  private readonly _pollIntervalMs: number;
  private _handler: ((msg: ChannelMessage) => Promise<void>) | null = null;
  private _timer: ReturnType<typeof setInterval> | null = null;
  private _running = false;
  private _polling = false;
  private _onPollComplete?: () => void | Promise<void>;

  constructor(options: MailboxChannelAdapterOptions) {
    // Unique per team and agent: ChannelManager refuses duplicate adapter
    // names, and one process may drain several inboxes.
    this.name = `team:${options.teamName}:${options.agentName}`;
    this._teamName = options.teamName;
    this._agentName = options.agentName;
    this._mailbox = options.mailbox;
    this._pollIntervalMs = options.pollIntervalMs ?? 2000;
  }

  async start(): Promise<void> {
    if (this._running) return;
    this._running = true;
    await this._mailbox.init(this._teamName);
    this._timer = setInterval(() => {
      void this._poll();
    }, this._pollIntervalMs);
    log.info({ team: this._teamName, agent: this._agentName }, 'Mailbox channel started');
  }

  async stop(): Promise<void> {
    this._running = false;
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
    log.info({ team: this._teamName, agent: this._agentName }, 'Mailbox channel stopped');
  }

  onMessage(handler: (msg: ChannelMessage) => Promise<void>): void {
    this._handler = handler;
  }

  /**
   * ERR-21: called after each poll cycle that completed without throwing.
   *
   * This is the `SupervisedPoller` seam BridgeWatchdog drives its heartbeat
   * from. It fires on a completed cycle, not on a cycle that found work — an
   * idle inbox is healthy, and treating it as silence would have the watchdog
   * restart a perfectly good adapter every staleness window.
   */
  setOnPollComplete(callback: () => void | Promise<void>): void {
    this._onPollComplete = callback;
  }

  /**
   * Posts a reply into the requesting agent's inbox.
   *
   * `ChannelManager` calls this with the orchestrator's output, so a team
   * result travels the same way a Signal reply does.
   */
  async send(
    to: ChannelIdentity,
    _channelId: string,
    content: string,
    _options?: SendOptions,
  ): Promise<void> {
    await this._mailbox.send(this._teamName, agentNameFrom(to), {
      type: 'result',
      text: content,
    });
  }

  /** Drains unread task messages and hands each to the ChannelManager pipeline. */
  private async _poll(): Promise<void> {
    if (!this._running || this._polling) return;
    this._polling = true;
    try {
      const messages = await this._mailbox.receive(this._teamName);
      for (const message of messages) {
        // Only `task` is an instruction. `result`/`status` are replies to work
        // this agent requested; treating them as instructions is how a
        // delegation cycle would start.
        if (message.type !== 'task') continue;
        if (!this._running) break;
        if (!this._handler) {
          log.warn({ team: this._teamName }, 'Task received before a handler was registered — dropped');
          continue;
        }

        try {
          await this._handler(this._toChannelMessage(message.from, message.text, message.timestamp));
        } catch (err) {
          // One bad message must not stop the drain, and it must not look like
          // success to the watchdog either.
          log.error({ err, team: this._teamName, from: message.from }, 'Team task failed in the channel pipeline');
        }
      }
      // Deliberately after the drain and inside the try: a cycle that threw
      // before here did not complete, and must not look alive to the watchdog.
      if (this._onPollComplete) await this._onPollComplete();
    } catch (err) {
      log.error({ err, team: this._teamName }, 'Mailbox poll error');
    } finally {
      this._polling = false;
    }
  }

  private _toChannelMessage(fromAgent: string, text: string, timestamp: string): ChannelMessage {
    const parsed = new Date(timestamp);
    return {
      id: `${this._teamName}:${fromAgent}:${timestamp}`,
      from: {
        type: 'team',
        phoneNumber: teamIdentity(fromAgent),
        displayName: fromAgent,
        isLinkedDevice: false,
      },
      // The team is the channel, so `channel-policy.toml` can grant intake per
      // team rather than per agent pair.
      channelId: this._teamName,
      channelType: 'group',
      content: text,
      timestamp: Number.isFinite(parsed.getTime()) ? parsed : new Date(),
    };
  }
}
