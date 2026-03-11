import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TelegramAdapter } from '../../../src/channels/telegram/telegram-adapter.js';
import { ChannelIdentity, ChannelMessage } from '../../../src/types/channel.js';

// Capture the message handlers registered on the Chat instance
let _newMessageHandler: ((thread: any, message: any) => Promise<void>) | null = null;
let _subscribedMessageHandler: ((thread: any, message: any) => Promise<void>) | null = null;

// Mock the Vercel chat SDK Chat class
vi.mock('chat', () => {
  return {
    Chat: vi.fn().mockImplementation(() => ({
      onNewMessage: vi.fn((_pattern: RegExp, handler: any) => {
        _newMessageHandler = handler;
      }),
      onSubscribedMessage: vi.fn((handler: any) => {
        _subscribedMessageHandler = handler;
      }),
      initialize: vi.fn().mockResolvedValue(undefined),
      shutdown: vi.fn().mockResolvedValue(undefined),
    })),
  };
});

const mockChatAdapter = {
  startPolling: vi.fn().mockResolvedValue(undefined),
  stopPolling: vi.fn().mockResolvedValue(undefined),
  isDM: vi.fn().mockReturnValue(true),
  openDM: vi.fn().mockResolvedValue('dm-thread-user-456'),
  postMessage: vi.fn().mockResolvedValue(undefined),
  postChannelMessage: vi.fn().mockResolvedValue(undefined),
};

// Mock @chat-adapter/telegram
vi.mock('@chat-adapter/telegram', () => {
  return {
    TelegramAdapter: vi.fn().mockImplementation(() => mockChatAdapter),
  };
});

// Mock the memory state adapter
vi.mock('../../../src/channels/telegram/memory-state-adapter.js', () => ({
  createMemoryState: vi.fn().mockReturnValue({}),
}));

describe('TelegramAdapter', () => {
  let adapter: TelegramAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    _newMessageHandler = null;
    _subscribedMessageHandler = null;
    adapter = new TelegramAdapter('fake-token');
  });

  it('initializes and starts polling', async () => {
    await adapter.start();
    expect(mockChatAdapter.startPolling).toHaveBeenCalled();
  });

  it('maps incoming telegram messages to ChannelMessage', async () => {
    await adapter.start();

    let received: ChannelMessage | undefined;
    adapter.onMessage(async (msg) => {
      received = msg;
    });

    // Simulate an incoming message via the chat SDK handler
    const mockThread = { id: 'thread-user-456' };
    const mockMessage = {
      id: 'tg-123',
      text: 'hello telegram',
      author: {
        userId: 'user-456',
        fullName: 'Test User',
        userName: 'testuser',
      },
      metadata: { dateSent: new Date('2025-01-01T00:00:00Z'), edited: false },
    };

    expect(_newMessageHandler).toBeDefined();
    await _newMessageHandler!(mockThread, mockMessage);

    expect(received).toBeDefined();
    expect(received?.id).toBe('tg-123');
    expect(received?.from.phoneNumber).toBe('user-456');
    expect(received?.from.displayName).toBe('Test User');
    expect(received?.content).toBe('hello telegram');
    expect(received?.channelType).toBe('direct');
    expect(received?.channelId).toBe('direct');
  });

  it('sends a direct message via openDM + postMessage', async () => {
    await adapter.start();
    const to: ChannelIdentity = {
      type: 'telegram',
      phoneNumber: 'user-456',
      isLinkedDevice: false,
    };

    await adapter.send(to, 'direct', 'hi there');

    expect(mockChatAdapter.openDM).toHaveBeenCalledWith('user-456');
    expect(mockChatAdapter.postMessage).toHaveBeenCalledWith('dm-thread-user-456', 'hi there');
  });

  it('sends a group message via postChannelMessage', async () => {
    await adapter.start();
    const to: ChannelIdentity = {
      type: 'telegram',
      phoneNumber: 'user-456',
      isLinkedDevice: false,
    };

    await adapter.send(to, '-100123456789', 'hello group');

    expect(mockChatAdapter.postChannelMessage).toHaveBeenCalledWith('-100123456789', 'hello group');
  });

  it('stops polling and shuts down chat on stop()', async () => {
    await adapter.start();
    await adapter.stop();

    expect(mockChatAdapter.stopPolling).toHaveBeenCalled();
  });
});
