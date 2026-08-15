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

  private readonly _mode: 'polling' | 'webhook';

  /**
   * INVARIANT-10: `mode` selects how updates arrive, and the two are mutually
   * exclusive on purpose. Telegram delivers each update once, to whichever
   * transport is active; running long-polling *and* a webhook against one bot
   * makes `getUpdates` and the webhook race for the same update, so a message
   * is processed twice or not at all. `polling` stays the default so existing
   * callers are unaffected.
   */
  constructor(botToken: string, options: { mode?: 'polling' | 'webhook' } = {}) {
    this._mode = options.mode ?? 'polling';
    this._chatAdapter = new ChatTelegramAdapter({
      botToken,
      mode: this._mode,
      // Note: no `secretToken` here. The chat adapter's own check is optional
      // (it is skipped entirely when unset) and compares with `!==`. Zora
      // authenticates webhooks in WebhookServer instead, where validation is
      // mandatory and the comparison is constant-time.
    });
  }

  async start(): Promise<void> {
    log.info({ mode: this._mode }, '[telegram] Starting Telegram adapter...');

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

    if (this._mode === 'polling') {
      await this._chatAdapter.startPolling();
      log.info('[telegram] Telegram adapter ready (long-polling)');
      return;
    }

    log.info('[telegram] Telegram adapter ready (webhook delivery via WebhookServer)');
  }

  async stop(): Promise<void> {
    if (this._mode === 'polling') {
      await this._chatAdapter.stopPolling();
    }
    if (this._chat) {
      await this._chat.shutdown();
      this._chat = null;
    }
    log.info('[telegram] Telegram adapter stopped');
  }

  /**
   * INVARIANT-10: accepts a webhook delivery that WebhookServer has already
   * authenticated.
   *
   * Handing the request to the chat SDK's own handler is what keeps webhook and
   * polling on one path: both end in `_handleChatMessage`, so an update that
   * arrives by webhook goes through the same ChannelManager pipeline — identity
   * resolution, policy gate, quarantine — as one that arrives by polling.
   * INVARIANT-9 would be broken by a shortcut here.
   */
  async handleWebhook(request: Request): Promise<Response> {
    if (!this._chat) {
      // Not started, so no handlers are registered and the update would be
      // swallowed. A 503 makes Telegram retry rather than drop it.
      log.warn('[telegram] Webhook arrived before adapter start — asking Telegram to retry');
      return new Response('Adapter not started', { status: 503 });
    }
    // `Chat<any>` makes the webhooks map an index signature, so the handler is
    // typed as possibly absent. Checked rather than asserted: if the adapter
    // key ever stops matching, this reports it instead of throwing a
    // "not a function" from inside the SDK.
    const handler = this._chat.webhooks['telegram'];
    if (typeof handler !== 'function') {
      log.error('[telegram] Chat SDK exposes no telegram webhook handler');
      return new Response('No webhook handler', { status: 500 });
    }
    return await handler(request);
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
