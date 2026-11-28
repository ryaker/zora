/**
 * #265 — approvals over Slack/Signal/Telegram through the ChannelManager.
 *
 * Guards the security shape: questions go only to approvers, answers are
 * accepted only from approvers who also passed the policy gate, an approval
 * command never reaches quarantine or the orchestrator, and nothing reachable
 * means the request is denied at once.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ChannelManager } from '../../../src/channels/channel-manager.js';
import { ChannelApprovalBridge, parseApprovers } from '../../../src/channels/channel-approval-bridge.js';
import { ApprovalQueue, DEFAULT_APPROVAL_CONFIG } from '../../../src/core/approval-queue.js';
import type { IChannelAdapter } from '../../../src/channels/channel-adapter.js';
import type { ChannelMessage } from '../../../src/types/channel.js';

const RICH = 'U0RICH';

function adapter(name: string): IChannelAdapter & { sent: Array<{ to: string; channelId: string; text: string }> } {
  const sent: Array<{ to: string; channelId: string; text: string }> = [];
  return {
    name,
    sent,
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    onMessage: vi.fn(),
    send: vi.fn(async (to, channelId, text) => { sent.push({ to: to.phoneNumber, channelId, text }); }),
  };
}

function msg(from: string, content: string): ChannelMessage {
  return {
    id: '1',
    from: { type: 'slack', phoneNumber: from, isLinkedDevice: false },
    channelId: 'direct',
    channelType: 'direct',
    content,
    timestamp: new Date(),
  };
}

describe('#265 parseApprovers', () => {
  it('reads adapter:id entries and drops anything else', () => {
    expect(parseApprovers(['slack:U0RICH', 'signal:+14155551234', 'nocolon', 42, 'team:x:y', ':U1'])).toEqual([
      { adapter: 'slack', id: 'U0RICH' },
      { adapter: 'signal', id: '+14155551234' },
    ]);
    expect(parseApprovers(undefined)).toEqual([]);
  });
});

describe('#265 ChannelApprovalBridge through ChannelManager', () => {
  let queue: ApprovalQueue;
  let slack: ReturnType<typeof adapter>;
  let team: ReturnType<typeof adapter>;
  let gate: { canIntake: ReturnType<typeof vi.fn> };
  let quarantine: { process: ReturnType<typeof vi.fn> };
  let orchestrator: { submitTask: ReturnType<typeof vi.fn> };
  let manager: ChannelManager;
  let bridge: ChannelApprovalBridge;

  beforeEach(async () => {
    queue = new ApprovalQueue({ ...DEFAULT_APPROVAL_CONFIG, enabled: true, timeoutMs: 5_000 });
    slack = adapter('slack');
    team = adapter('team:ops:zora');
    gate = { canIntake: vi.fn().mockResolvedValue(true) };
    quarantine = { process: vi.fn().mockResolvedValue({ goal: 'g', params: {}, suspicious: false }) };
    orchestrator = { submitTask: vi.fn().mockResolvedValue('done') };
    const resolver = { resolve: vi.fn().mockResolvedValue({ role: 'trusted_admin', allowedTools: ['read_file'], actionBudget: 10 }) };
    manager = new ChannelManager(orchestrator, gate as never, resolver as never, quarantine as never, null);
    await manager.registerAdapter(slack);
    await manager.registerAdapter(team);
    bridge = new ChannelApprovalBridge(
      queue,
      [{ adapter: 'slack', id: RICH }, { adapter: 'team:ops:zora', id: RICH }],
      () => manager.getAdapters(),
    );
    manager.setApprovalBridge(bridge);
    bridge.attach();
  });

  const inbound = (a: IChannelAdapter, m: ChannelMessage) => manager.handleMessage(a, m);

  async function ask(): Promise<{ token: string; result: Promise<boolean> }> {
    const result = queue.request({ action: 'git_push', score: 85, jobId: 'j1', tool: 'Bash' });
    await vi.waitFor(() => expect(slack.sent.length).toBe(1));
    const token = /ZORA-[A-Z0-9]{4}/.exec(slack.sent[0]!.text)![0];
    return { token, result };
  }

  it('sends the question to the approver by DM, never to a team mailbox', async () => {
    const { result, token } = await ask();
    expect(slack.sent[0]).toMatchObject({ to: RICH, channelId: 'direct' });
    expect(team.sent).toEqual([]);
    await inbound(slack, msg(RICH, `/approve ${token} deny`));
    expect(await result).toBe(false);
  });

  it('approves on the approver\'s reply, without quarantine or a task', async () => {
    const { token, result } = await ask();
    await inbound(slack, msg(RICH, `/approve ${token} allow`));
    expect(await result).toBe(true);
    expect(quarantine.process).not.toHaveBeenCalled();
    expect(orchestrator.submitTask).not.toHaveBeenCalled();
  });

  it('refuses an approval reply from someone who is not an approver', async () => {
    const { token, result } = await ask();
    await inbound(slack, msg('U0STRANGER', `/approve ${token} allow`));
    expect(slack.sent.at(-1)!.text).toContain('not an approver');
    expect(queue.getPendingCount()).toBe(1);
    expect(quarantine.process).not.toHaveBeenCalled();
    await inbound(slack, msg(RICH, `/approve ${token} deny`));
    expect(await result).toBe(false);
  });

  it('ignores an approval reply from a sender the policy gate rejects', async () => {
    const { token, result } = await ask();
    gate.canIntake.mockResolvedValueOnce(false);
    await inbound(slack, msg(RICH, `/approve ${token} allow`));
    expect(queue.getPendingCount()).toBe(1);
    await inbound(slack, msg(RICH, `/approve ${token} deny`));
    expect(await result).toBe(false);
  });

  it('runs an ordinary message through the normal pipeline', async () => {
    await inbound(slack, msg(RICH, 'please approve of my plan'));
    expect(quarantine.process).toHaveBeenCalledTimes(1);
  });

  it('denies at once when no approver is reachable', async () => {
    const lonely = new ApprovalQueue({ ...DEFAULT_APPROVAL_CONFIG, enabled: true, timeoutMs: 60_000 });
    new ChannelApprovalBridge(lonely, [{ adapter: 'signal', id: '+1' }], () => manager.getAdapters()).attach();
    const started = Date.now();
    expect(await lonely.request({ action: 'git_push', score: 85, jobId: 'j2', tool: 'Bash' })).toBe(false);
    expect(Date.now() - started).toBeLessThan(1_000);
  });
});
