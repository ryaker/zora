/**
 * SlackAdapter — Slack implementation of IChannelAdapter over Socket Mode.
 *
 * Socket Mode is an outbound WebSocket, so Zora needs no public URL and no
 * webhook route (INVARIANT-10 does not apply: there is no inbound HTTP to
 * authenticate; the connection itself is authenticated by the app token).
 *
 * Every inbound message ends in the same handler as Signal/Telegram, so
 * identity resolution, the policy gate and CaMeL quarantine (INVARIANT-9) all
 * apply. This adapter only translates; it decides nothing about trust.
 *
 * Which events are answered:
 *  - DMs (`message` with channel_type "im")           → channelId "direct"
 *  - channel mentions (`app_mention`)                 → channelId = Slack channel ID
 * Plain channel chatter is ignored on purpose: Zora acts on what it is
 * addressed with, and `message` + `app_mention` would otherwise both fire for
 * one mention and run the task twice.
 *
 * Credentials (bot token xoxb-…, app token xapp-…) are never read here; the
 * caller passes them in. Under OneCLI they are placeholders and the gateway
 * injects the real tokens; if HTTPS_PROXY is set the SDK clients route through
 * it (see slackProxyAgent).
 */

import { SocketModeClient } from '@slack/socket-mode';
import { WebClient } from '@slack/web-api';
import { HttpsProxyAgent } from 'https-proxy-agent';
import type { Agent } from 'node:http';
import { ChannelIdentity, ChannelMessage } from '../../types/channel.js';
import { IChannelAdapter, SendOptions } from '../channel-adapter.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('slack-adapter');

/** Minimal surface of SocketModeClient we depend on (lets tests inject a fake). */
export interface SlackSocket {
  on(event: string, listener: (args: any) => void): unknown; // eslint-disable-line @typescript-eslint/no-explicit-any
  start(): Promise<unknown>;
  disconnect(): Promise<unknown>;
}

/** Minimal surface of WebClient we depend on. */
export interface SlackWeb {
  auth: { test(): Promise<{ user_id?: string }> };
  conversations: { open(args: { users: string }): Promise<{ channel?: { id?: string } }> };
  chat: {
    postMessage(args: {
      channel: string;
      text: string;
      thread_ts?: string;
    }): Promise<unknown>;
  };
}

export interface SlackAdapterOptions {
  socket?: SlackSocket;
  web?: SlackWeb;
}

/** Slack caps message text around 40k chars; chunk well below to stay readable. */
const MAX_CHUNK = 3500;
/** Remember recent message IDs so Slack redeliveries don't run a task twice. */
const SEEN_LIMIT = 500;

/**
 * Build an HTTP(S) proxy agent from the standard proxy env vars, or undefined.
 *
 * Why: when Zora runs behind the OneCLI gateway (dogfooding on the M2 Air), the
 * real Slack tokens never enter the process — it sends placeholder tokens and
 * the gateway injects the real ones. Node's http/https/ws stack ignores
 * HTTPS_PROXY on its own, so without an explicit agent the Slack calls would go
 * direct and be rejected (invalid_auth). The SDKs reuse this agent for the
 * Socket Mode WebSocket too. (#235)
 */
export function slackProxyAgent(env: NodeJS.ProcessEnv = process.env): Agent | undefined {
  const url = env['HTTPS_PROXY'] ?? env['https_proxy'];
  if (!url) return undefined;
  return new HttpsProxyAgent(url);
}

export class SlackAdapter implements IChannelAdapter {
  readonly name = 'slack';
  private readonly _socket: SlackSocket;
  private readonly _web: SlackWeb;
  private _botUserId: string | null = null;
  private _handler: ((msg: ChannelMessage) => Promise<void>) | null = null;
  private readonly _seen = new Set<string>();

  constructor(botToken: string, appToken: string, options: SlackAdapterOptions = {}) {
    const agent = slackProxyAgent();
    this._socket =
      options.socket ??
      (new SocketModeClient({
        appToken,
        ...(agent ? { clientOptions: { agent } } : {}),
      }) as unknown as SlackSocket);
    this._web =
      options.web ?? (new WebClient(botToken, agent ? { agent } : {}) as unknown as SlackWeb);
  }

  async start(): Promise<void> {
    // Our own user ID lets us drop our own posts and strip our mention.
    const auth = await this._web.auth.test();
    this._botUserId = auth.user_id ?? null;

    this._socket.on('message', (args) => void this._onEvent(args, 'message'));
    this._socket.on('app_mention', (args) => void this._onEvent(args, 'app_mention'));
    await this._socket.start();
    log.info('[slack] Slack adapter ready (Socket Mode)');
  }

  async stop(): Promise<void> {
    await this._socket.disconnect();
    log.info('[slack] Slack adapter stopped');
  }

  onMessage(handler: (msg: ChannelMessage) => Promise<void>): void {
    this._handler = handler;
  }

  async send(
    to: ChannelIdentity,
    channelId: string,
    content: string,
    options?: SendOptions,
  ): Promise<void> {
    let target = channelId;
    let threadTs: string | undefined;
    if (channelId === 'direct') {
      const opened = await this._web.conversations.open({ users: to.phoneNumber });
      const id = opened.channel?.id;
      if (!id) throw new Error('[slack] conversations.open returned no channel');
      target = id;
    } else {
      // Reply in the thread of the message we are answering.
      threadTs = options?.quoteMessageId;
    }

    for (const text of chunk(content)) {
      await this._web.chat.postMessage({ channel: target, text, thread_ts: threadTs });
    }
    log.info({ channel: target, chars: content.length }, '[slack] Response sent');
  }

  private async _onEvent(
    args: { event?: any; ack?: () => Promise<void> }, // eslint-disable-line @typescript-eslint/no-explicit-any
    kind: 'message' | 'app_mention',
  ): Promise<void> {
    // Ack first: Slack redelivers anything not acknowledged within ~3s, and
    // the task itself can take far longer than that.
    try {
      await args.ack?.();
    } catch (err) {
      log.warn({ err }, '[slack] ack failed');
    }

    try {
      const msg = this._toChannelMessage(args.event, kind);
      if (!msg || !this._handler) return;
      await this._handler(msg);
    } catch (err) {
      log.error({ err }, '[slack] Failed to handle inbound event');
    }
  }

  private _toChannelMessage(
    event: any, // eslint-disable-line @typescript-eslint/no-explicit-any
    kind: 'message' | 'app_mention',
  ): ChannelMessage | null {
    if (!event || typeof event.user !== 'string' || typeof event.ts !== 'string') return null;
    // Edits, joins, bot posts etc. carry a subtype; a user message has none
    // (file_share is a user message with an upload).
    if (event.subtype && event.subtype !== 'file_share') return null;
    if (event.bot_id) return null;
    if (this._botUserId && event.user === this._botUserId) return null;

    const isDM = event.channel_type === 'im';
    if (kind === 'message' && !isDM) return null;
    if (kind === 'app_mention' && isDM) return null;

    if (this._seen.has(event.ts + ':' + event.channel)) return null;
    this._seen.add(event.ts + ':' + event.channel);
    if (this._seen.size > SEEN_LIMIT) {
      const oldest = this._seen.values().next().value;
      if (oldest !== undefined) this._seen.delete(oldest);
    }

    let text = typeof event.text === 'string' ? event.text : '';
    if (this._botUserId) {
      text = text.split(`<@${this._botUserId}>`).join('').trim();
    }

    return {
      id: event.thread_ts ?? event.ts,
      from: {
        type: 'slack',
        // Platform user ID (U…), the key used in channel-policy.toml.
        phoneNumber: event.user,
        isLinkedDevice: false,
      },
      channelId: isDM ? 'direct' : String(event.channel),
      channelType: isDM ? 'direct' : 'group',
      content: text,
      timestamp: new Date(Number(event.ts) * 1000),
    };
  }
}

function chunk(text: string): string[] {
  if (text.length <= MAX_CHUNK) return [text];
  const out: string[] = [];
  for (let i = 0; i < text.length; i += MAX_CHUNK) out.push(text.slice(i, i + MAX_CHUNK));
  return out;
}
