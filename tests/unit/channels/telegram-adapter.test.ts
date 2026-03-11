import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TelegramAdapter } from '../../../src/channels/telegram/telegram-adapter.js';
import { ChannelIdentity, ChannelMessage } from '../../../src/types/channel.js';

// Mock the Vercel Chat SDK Telegram adapter
vi.mock('@chat-adapter/telegram', () => {
  return {
    TelegramAdapter: vi.fn().mockImplementation(() => ({
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
      on: vi.fn(),
      send: vi.fn().mockResolvedValue(undefined),
    })),
  };
});

describe('TelegramAdapter', () => {
  let adapter: TelegramAdapter;

  beforeEach(() => {
    adapter = new TelegramAdapter('fake-token');
  });

  it('initializes and starts the underlying adapter', async () => {
    await adapter.start();
    const chatAdapter = (adapter as any)._adapter;
    expect(chatAdapter.start).toHaveBeenCalled();
  });

  it('maps incoming telegram events to ChannelMessage', async () => {
    await adapter.start();
    const chatAdapter = (adapter as any)._adapter;
    const onHandler = chatAdapter.on.mock.calls.find((c: any) => c[0] === 'message')[1];

    let received: ChannelMessage | undefined;
    adapter.onMessage(async (msg) => {
      received = msg;
    });

    await onHandler({
      id: 'tg-123',
      userId: 'user-456',
      username: 'testuser',
      text: 'hello telegram',
      timestamp: Date.now(),
    });

    expect(received).toBeDefined();
    expect(received?.id).toBe('tg-123');
    expect(received?.from.phoneNumber).toBe('user-456');
    expect(received?.content).toBe('hello telegram');
  });

  it('sends a response back to telegram', async () => {
    await adapter.start();
    const chatAdapter = (adapter as any)._adapter;
    const to: ChannelIdentity = {
      type: 'signal',
      phoneNumber: 'user-456',
      isLinkedDevice: false,
    };

    await adapter.send(to, 'direct', 'hi there');

    expect(chatAdapter.send).toHaveBeenCalledWith(expect.objectContaining({
      channelId: 'user-456',
      text: 'hi there',
    }));
  });
});
