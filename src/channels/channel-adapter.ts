/**
 * IChannelAdapter — Abstract interface for Zora communication channels.
 *
 * All external integrations (Signal, Telegram, Slack, etc.) implement this
 * to participate in the secure ChannelManager pipeline.
 */

import { ChannelIdentity, ChannelMessage } from '../types/channel.js';

export interface SendOptions {
  /** Original message ID for quoting/replying (used by Telegram and other platforms) */
  quoteMessageId?: string;
  /** Original message timestamp for quoting (used by Signal group replies) */
  quoteTimestamp?: number;
  /** Author identifier for the quoted message (phone or UUID) */
  quoteAuthor?: string;
}

export interface IChannelAdapter {
  /**
   * Unique name for this adapter instance (e.g. "signal", "telegram").
   */
  readonly name: string;

  /**
   * Start the adapter (connect to daemon, start polling, etc.)
   */
  start(): Promise<void>;

  /**
   * Gracefully stop the adapter.
   */
  stop(): Promise<void>;

  /**
   * Register the message handler called for every inbound message.
   * Only one handler is supported per adapter.
   */
  onMessage(handler: (msg: ChannelMessage) => Promise<void>): void;

  /**
   * Send a response message back to the channel.
   *
   * @param to - Recipient identity
   * @param channelId - Target channel ("direct" or group ID)
   * @param content - Text response
   * @param options - Optional quoting context
   */
  send(
    to: ChannelIdentity,
    channelId: string,
    content: string,
    options?: SendOptions
  ): Promise<void>;

  /**
   * Accept an inbound webhook delivery — INVARIANT-10.
   *
   * Optional: an adapter that receives by polling or over a local intake
   * process (SignalAdapter) has no webhook path, and omitting this is what
   * makes `WebhookServer` answer 501 for it rather than inventing one.
   *
   * `WebhookServer` calls this only after the platform's signature validator
   * has authenticated the request, so an implementation may treat the payload
   * as coming from the platform. It must still not trust the *content*: that
   * proves the sender, not the sender's intent, and inbound text stays subject
   * to the ChannelManager quarantine pipeline (INVARIANT-9).
   *
   * Takes and returns Fetch types because the chat SDK's webhook handlers do;
   * the returned status is relayed to the platform, which is what drives retry.
   */
  handleWebhook?(request: Request): Promise<Response>;
}
