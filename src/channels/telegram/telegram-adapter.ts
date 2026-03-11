/**
 * TelegramAdapter — Telegram implementation of IChannelAdapter.
 *
 * Uses @chat-adapter/telegram and Vercel Chat SDK for cross-platform messaging.
 */

import { TelegramAdapter as ChatTelegramAdapter } from '@chat-adapter/telegram';
import { ChannelIdentity, ChannelMessage } from '../../types/channel.js';
import { IChannelAdapter, SendOptions } from '../channel-adapter.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('telegram-adapter');

export class TelegramAdapter implements IChannelAdapter {
  readonly name = 'telegram';
  private readonly _botToken: string;
  private _adapter: ChatTelegramAdapter | null = null;
  private _messageHandler: ((msg: ChannelMessage) => Promise<void>) | null = null;

  constructor(botToken: string) {
    this._botToken = botToken;
  }

  async start(): Promise<void> {
    log.info('[telegram] Starting Telegram adapter...');

    this._adapter = new ChatTelegramAdapter({
      token: this._botToken,
    });

    this._adapter.on('message', async (event) => {
      if (!this._messageHandler) return;

      const msg: ChannelMessage = {
        id: event.id,
        from: {
          type: 'telegram',
          phoneNumber: event.userId, // Telegram ID as the unique identifier
          displayName: event.username,
          isLinkedDevice: false,
        },
        channelId: event.channelId || 'direct',
        channelType: event.channelId ? 'group' : 'direct',
        content: event.text || '',
        timestamp: new Date(event.timestamp),
      };

      await this._messageHandler(msg);
    });

    await this._adapter.start();
    log.info('[telegram] Telegram adapter ready');
  }

  async stop(): Promise<void> {
    if (this._adapter) {
      await this._adapter.stop();
      this._adapter = null;
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
    options?: SendOptions
  ): Promise<void> {
    if (!this._adapter) {
      throw new Error('TelegramAdapter: cannot send message, adapter not started');
    }

    const recipient = channelId === 'direct' ? to.phoneNumber : channelId;

    await this._adapter.send({
      channelId: recipient,
      text: content,
      replyTo: options?.quoteTimestamp?.toString(),
    });

    log.info({ recipient, chars: content.length }, '[telegram] Response sent');
  }
}
