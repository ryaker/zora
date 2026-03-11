/**
 * TelegramAdapter — Telegram implementation of IChannelAdapter.
 *
 * Uses @chat-adapter/telegram and the Vercel chat SDK (chat@4.19) for
 * cross-platform messaging. The chat SDK manages polling, message routing,
 * thread subscriptions, and locking. MemoryStateAdapter provides in-process
 * state (suitable for polling mode; swap for Redis in multi-process deploys).
 */

import { TelegramAdapter as ChatTelegramAdapter } from '@chat-adapter/telegram';
import { Chat, type Thread, type Message } from 'chat';
import { ChannelIdentity, ChannelMessage } from '../../types/channel.js';
import { IChannelAdapter, SendOptions } from '../channel-adapter.js';
import { createLogger } from '../../utils/logger.js';
import { createMemoryState } from './memory-state-adapter.js';

const log = createLogger('telegram-adapter');

export class TelegramAdapter implements IChannelAdapter {
  readonly name = 'telegram';
  private readonly _chatAdapter: ChatTelegramAdapter;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private _chat: Chat<any> | null = null;
  private _messageHandler: ((msg: ChannelMessage) => Promise<void>) | null = null;

  constructor(botToken: string) {
    this._chatAdapter = new ChatTelegramAdapter({
      botToken,
      mode: 'polling',
    });
  }

  async start(): Promise<void> {
    log.info('[telegram] Starting Telegram adapter...');

    this._chat = new Chat({
      userName: 'zora',
      adapters: { telegram: this._chatAdapter as any }, // eslint-disable-line @typescript-eslint/no-explicit-any
      state: createMemoryState(),
      logger: 'silent',
    });

    // Route all incoming messages (both new and subscribed threads) through Zora pipeline
    this._chat.onNewMessage(/[\s\S]*/, this._handleChatMessage.bind(this));
    this._chat.onSubscribedMessage(this._handleChatMessage.bind(this));

    await this._chat.initialize();
    await this._chatAdapter.startPolling();

    log.info('[telegram] Telegram adapter ready (long-polling)');
  }

  async stop(): Promise<void> {
    await this._chatAdapter.stopPolling();
    if (this._chat) {
      await this._chat.shutdown();
      this._chat = null;
    }
    log.info('[telegram] Telegram adapter stopped');
  }

  onMessage(handler: (msg: ChannelMessage) => Promise<void>): void {
    this._messageHandler = handler;
  }

  async send(
    to: ChannelIdentity,
    channelId: string,
    content: string,
    _options?: SendOptions
  ): Promise<void> {
    if (channelId === 'direct') {
      // For DMs: open a DM thread using the Telegram user ID stored in phoneNumber
      const threadId = await this._chatAdapter.openDM(to.phoneNumber!);
      await this._chatAdapter.postMessage(threadId, content);
    } else {
      // For group channels: use postChannelMessage
      await this._chatAdapter.postChannelMessage(channelId, content);
    }

    log.info(
      { recipient: channelId === 'direct' ? to.phoneNumber : channelId, chars: content.length },
      '[telegram] Response sent'
    );
  }

  private async _handleChatMessage(thread: Thread, message: Message): Promise<void> {
    if (!this._messageHandler) return;

    const isDM = this._chatAdapter.isDM(thread.id);

    const msg: ChannelMessage = {
      id: message.id,
      from: {
        type: 'telegram',
        phoneNumber: message.author.userId,
        displayName: message.author.fullName || message.author.userName,
        isLinkedDevice: false,
      },
      channelId: isDM ? 'direct' : thread.id,
      channelType: isDM ? 'direct' : 'group',
      content: message.text,
      timestamp: message.metadata.dateSent,
    };

    await this._messageHandler(msg);
  }
}
