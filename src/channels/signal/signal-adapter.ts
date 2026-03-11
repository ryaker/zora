/**
 * SignalAdapter — Signal implementation of IChannelAdapter.
 *
 * Wraps SignalIntakeAdapter (incoming) and SignalResponseGateway (outgoing).
 */

import { ChannelIdentity, ChannelMessage } from '../../types/channel.js';
import { IChannelAdapter, SendOptions } from '../channel-adapter.js';
import { SignalIntakeAdapter } from './signal-intake-adapter.js';
import { SignalResponseGateway } from './signal-response-gateway.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('signal-adapter');

export class SignalAdapter implements IChannelAdapter {
  readonly name = 'signal';
  private readonly _intake: SignalIntakeAdapter;
  private _gateway: SignalResponseGateway | null = null;

  constructor(intake: SignalIntakeAdapter) {
    this._intake = intake;
  }

  async start(): Promise<void> {
    await this._intake.start();
    const cli = this._intake.getCli();
    if (!cli) {
      throw new Error('SignalIntakeAdapter: failed to get SignalCli after start');
    }
    this._gateway = new SignalResponseGateway(cli);
    log.info('[signal] Adapter started');
  }

  async stop(): Promise<void> {
    await this._intake.stop();
    this._gateway = null;
    log.info('[signal] Adapter stopped');
  }

  onMessage(handler: (msg: ChannelMessage) => Promise<void>): void {
    this._intake.onMessage(handler);
  }

  async send(
    to: ChannelIdentity,
    channelId: string,
    content: string,
    options?: SendOptions
  ): Promise<void> {
    if (!this._gateway) {
      throw new Error('SignalAdapter: cannot send message, adapter not started');
    }

    await this._gateway.send(to, channelId, content, {
      quoteTimestamp: options?.quoteTimestamp,
      quoteAuthor: options?.quoteAuthor,
    });
  }
}
