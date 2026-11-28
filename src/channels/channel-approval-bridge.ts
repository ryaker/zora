/**
 * ChannelApprovalBridge — carries ApprovalQueue questions and answers over the
 * ChannelManager adapters (Slack, Signal, Telegram) — #265.
 *
 * Before this, the only approval transport was the Telegram *steering*
 * gateway, and the daemon skips that gateway whenever `channel-policy.toml`
 * exists. So on the multi-channel setup (Slack, Signal) nothing registered a
 * send handler, and every action that should have asked was denied at once
 * (#218). Richard asked for approvals to reach him where he already talks to
 * Zora.
 *
 * Security shape:
 *  - Questions go only to approvers, by direct message.
 *  - An answer is accepted only from an approver, and only after the sender
 *    has passed the channel policy gate (ChannelManager calls `tryHandle()`
 *    after `canIntake()`), so both the platform identity and Zora's own
 *    allowlist vouch for it.
 *  - The answer is parsed by a fixed regex (`ApprovalQueue.parseApprovalCommand`)
 *    and never reaches an LLM, so it does not need the quarantine step: there
 *    is no model to inject into. Anything that is not exactly an approval
 *    command falls through to the normal pipeline untouched.
 *  - Team mailbox adapters never carry approvals: a mailbox is a third party,
 *    not a human approver.
 *  - Fail closed: no approver reachable means the send handler reports 0
 *    deliveries and the queue denies at once.
 */
import type { ApprovalQueue } from '../core/approval-queue.js';
import type { ChannelMessage, ChannelIdentity } from '../types/channel.js';
import type { IChannelAdapter } from './channel-adapter.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('channel-approval-bridge');

export interface ApproverIdentity {
  /** Adapter name, e.g. "slack", "signal", "telegram". */
  adapter: string;
  /** Platform identity the adapter reports as `from.phoneNumber`. */
  id: string;
}

/** Adapters that may carry approvals. A team mailbox is never an approver. */
function isHumanAdapter(name: string): boolean {
  return name !== 'team' && !name.startsWith('team:');
}

/**
 * Parse `[approval] approvers = ["slack:U0123", "signal:+14155551234"]`.
 * Entries that are not `<adapter>:<id>` strings are dropped with a warning
 * rather than guessed at.
 */
export function parseApprovers(raw: unknown): ApproverIdentity[] {
  if (!Array.isArray(raw)) return [];
  const out: ApproverIdentity[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'string') {
      log.warn({ entryType: typeof entry }, 'approval.approvers entry is not a string — ignoring');
      continue;
    }
    const idx = entry.indexOf(':');
    const adapter = idx > 0 ? entry.slice(0, idx).trim().toLowerCase() : '';
    const id = idx > 0 ? entry.slice(idx + 1).trim() : '';
    if (!adapter || !id || !isHumanAdapter(adapter)) {
      log.warn({ entry }, 'approval.approvers entry must look like "slack:U0123" — ignoring');
      continue;
    }
    out.push({ adapter, id });
  }
  return out;
}

export class ChannelApprovalBridge {
  private readonly _approvers: ApproverIdentity[];

  constructor(
    private readonly _queue: ApprovalQueue,
    approvers: ApproverIdentity[],
    private readonly _adapters: () => IChannelAdapter[],
  ) {
    this._approvers = approvers.filter((a) => isHumanAdapter(a.adapter));
  }

  get approverCount(): number {
    return this._approvers.length;
  }

  /** Register this bridge as the queue's transport. */
  attach(): void {
    this._queue.setSendHandler((message) => this._broadcast(message));
    log.info({ approvers: this._approvers.length }, 'ApprovalQueue wired to channel adapters');
  }

  /** Detach on shutdown: pending requests are denied (#218). */
  detach(): void {
    this._queue.clearSendHandler();
  }

  isApprover(adapterName: string, senderId: string): boolean {
    return this._approvers.some((a) => a.adapter === adapterName && a.id === senderId);
  }

  /**
   * Called by ChannelManager after the policy gate. Returns true when the
   * message was an approval command and has been consumed (answered or
   * refused); false means "not mine, run the normal pipeline".
   */
  async tryHandle(adapter: IChannelAdapter, msg: ChannelMessage): Promise<{ consumed: boolean; accepted?: boolean }> {
    const cmd = this._queue.parseApprovalCommand(msg.content);
    if (!cmd) return { consumed: false };

    if (!this.isApprover(adapter.name, msg.from.phoneNumber)) {
      log.warn({ adapter: adapter.name, sender: msg.from.phoneNumber }, 'Approval reply from a non-approver — refused');
      await this._safeSend(adapter, msg.from, msg.channelId, '⛔ You are not an approver for this Zora.');
      return { consumed: true, accepted: false };
    }

    const resolved = this._queue.handleReply(cmd.token, cmd.decision);
    const reply = resolved
      ? `✅ ${cmd.token}: ${cmd.decision}`
      : `⚠️ ${cmd.token} is unknown or has expired.`;
    await this._safeSend(adapter, msg.from, msg.channelId, reply);
    return { consumed: true, accepted: resolved };
  }

  private async _broadcast(message: string): Promise<number> {
    const adapters = new Map(this._adapters().filter((a) => isHumanAdapter(a.name)).map((a) => [a.name, a]));
    let delivered = 0;
    for (const approver of this._approvers) {
      const adapter = adapters.get(approver.adapter);
      if (!adapter) continue;
      const to: ChannelIdentity = { type: approver.adapter, phoneNumber: approver.id, isLinkedDevice: false };
      if (await this._safeSend(adapter, to, 'direct', message)) delivered++;
    }
    if (delivered === 0) log.warn('No approver reachable on any channel — the request will be denied');
    return delivered;
  }

  private async _safeSend(adapter: IChannelAdapter, to: ChannelIdentity, channelId: string, text: string): Promise<boolean> {
    try {
      await adapter.send(to, channelId, text);
      return true;
    } catch (err) {
      log.warn({ adapter: adapter.name, errName: err instanceof Error ? err.name : typeof err }, 'Approval message send failed');
      return false;
    }
  }
}
