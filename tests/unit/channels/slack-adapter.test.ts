import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SlackAdapter, type SlackSocket, type SlackWeb } from '../../../src/channels/slack/slack-adapter.js';
import type { ChannelMessage } from '../../../src/types/channel.js';

function setup() {
  const listeners: Record<string, (a: any) => void> = {};
  const socket: SlackSocket = {
    on: vi.fn((ev: string, l: (a: any) => void) => { listeners[ev] = l; }),
    start: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
  };
  const web = {
    auth: { test: vi.fn().mockResolvedValue({ user_id: 'UBOT' }) },
    conversations: { open: vi.fn().mockResolvedValue({ channel: { id: 'D999' } }) },
    chat: { postMessage: vi.fn().mockResolvedValue({}) },
  } satisfies SlackWeb;
  const adapter = new SlackAdapter('xoxb-test', 'xapp-test', { socket, web });
  const received: ChannelMessage[] = [];
  adapter.onMessage(async (m) => { received.push(m); });
  const emit = async (ev: 'message' | 'app_mention', event: any) => {
    const ack = vi.fn().mockResolvedValue(undefined);
    listeners[ev]({ event, ack });
    await new Promise((r) => setTimeout(r, 0));
    return ack;
  };
  return { adapter, socket, web, received, emit };
}

describe('SlackAdapter', () => {
  let t: ReturnType<typeof setup>;
  beforeEach(async () => { t = setup(); await t.adapter.start(); });

  it('connects via Socket Mode after resolving its own user id', () => {
    expect(t.web.auth.test).toHaveBeenCalled();
    expect(t.socket.start).toHaveBeenCalled();
  });

  it('acks and forwards a DM as a direct ChannelMessage', async () => {
    const ack = await t.emit('message', { user: 'U1', channel: 'D1', channel_type: 'im', text: 'hi', ts: '1700000000.000100' });
    expect(ack).toHaveBeenCalled();
    expect(t.received).toHaveLength(1);
    expect(t.received[0]).toMatchObject({
      id: '1700000000.000100', channelId: 'direct', channelType: 'direct', content: 'hi',
      from: { type: 'slack', phoneNumber: 'U1' },
    });
  });

  it('answers channel mentions only, stripping the bot mention', async () => {
    await t.emit('app_mention', { user: 'U1', channel: 'C1', channel_type: 'channel', text: '<@UBOT> status?', ts: '1.1' });
    expect(t.received[0]).toMatchObject({ channelId: 'C1', channelType: 'group', content: 'status?' });
  });

  it('ignores plain channel chatter, so a mention is not processed twice', async () => {
    await t.emit('message', { user: 'U1', channel: 'C1', channel_type: 'channel', text: '<@UBOT> hi', ts: '2.1' });
    expect(t.received).toHaveLength(0);
  });

  it('ignores bots, own posts, edits and redeliveries', async () => {
    await t.emit('message', { user: 'UBOT', channel: 'D1', channel_type: 'im', text: 'x', ts: '3.1' });
    await t.emit('message', { user: 'U2', bot_id: 'B1', channel: 'D1', channel_type: 'im', text: 'x', ts: '3.2' });
    await t.emit('message', { user: 'U2', subtype: 'message_changed', channel: 'D1', channel_type: 'im', text: 'x', ts: '3.3' });
    expect(t.received).toHaveLength(0);
    const ev = { user: 'U2', channel: 'D1', channel_type: 'im', text: 'x', ts: '3.4' };
    await t.emit('message', ev);
    await t.emit('message', ev);
    expect(t.received).toHaveLength(1);
  });

  it('acks even when the handler throws', async () => {
    t.adapter.onMessage(async () => { throw new Error('boom'); });
    const ack = await t.emit('message', { user: 'U1', channel: 'D1', channel_type: 'im', text: 'x', ts: '4.1' });
    expect(ack).toHaveBeenCalled();
  });

  it('sends DMs by opening a conversation with the user', async () => {
    await t.adapter.send({ type: 'slack', phoneNumber: 'U1', isLinkedDevice: false }, 'direct', 'yo');
    expect(t.web.conversations.open).toHaveBeenCalledWith({ users: 'U1' });
    expect(t.web.chat.postMessage).toHaveBeenCalledWith({ channel: 'D999', text: 'yo', thread_ts: undefined });
  });

  it('replies in-thread in channels and chunks long output', async () => {
    const long = 'a'.repeat(8000);
    await t.adapter.send({ type: 'slack', phoneNumber: 'U1', isLinkedDevice: false }, 'C1', long, { quoteMessageId: '5.1' });
    const calls = t.web.chat.postMessage.mock.calls;
    expect(calls).toHaveLength(3);
    expect(calls.every((c) => c[0].channel === 'C1' && c[0].thread_ts === '5.1')).toBe(true);
    expect(calls.map((c) => c[0].text).join('')).toBe(long);
  });

  it('disconnects on stop', async () => {
    await t.adapter.stop();
    expect(t.socket.disconnect).toHaveBeenCalled();
  });
});

describe('slackProxyAgent (#235)', () => {
  it('returns undefined without proxy env', async () => {
    const { slackProxyAgent } = await import('../../../src/channels/slack/slack-adapter.js');
    expect(slackProxyAgent({})).toBeUndefined();
  });

  it('builds a proxy agent from HTTPS_PROXY (either case)', async () => {
    const { slackProxyAgent } = await import('../../../src/channels/slack/slack-adapter.js');
    expect(slackProxyAgent({ HTTPS_PROXY: 'http://x:y@localhost:10255' })).toBeDefined();
    expect(slackProxyAgent({ https_proxy: 'http://localhost:10255' })).toBeDefined();
  });
});
