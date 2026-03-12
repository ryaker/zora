/**
 * WebhookServer — Handles incoming webhooks for multi-channel adapters.
 *
 * Each platform adapter translates Vercel Chat SDK events → ChannelMessage.
 *
 * INVARIANT-10: Webhook server validates platform signatures before processing.
 */

import express from 'express';
import { ChannelManager } from './channel-manager.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('webhook-server');

export class WebhookServer {
  private readonly _app: express.Application;
  private readonly _port: number;
  private readonly _manager: ChannelManager;
  private _server: any;

  constructor(manager: ChannelManager, port = 8080) {
    this._app = express();
    this._port = port;
    this._manager = manager;

    this._setupRoutes();
  }

  /**
   * Start the webhook server.
   */
  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this._server = this._app.listen(this._port, () => {
        log.info({ port: this._port }, 'Webhook server listening');
        resolve();
      });
      this._server.once('error', (err: Error) => {
        log.error({ err, port: this._port }, 'Webhook server failed to bind');
        reject(err);
      });
    });
  }

  /**
   * Stop the webhook server.
   */
  async stop(): Promise<void> {
    if (this._server) {
      await new Promise<void>((resolve) => this._server.close((err?: Error) => {
        if (err) log.warn({ err }, 'Webhook server close error');
        resolve();
      }));
      this._server = null;
    }
    log.info('Webhook server stopped');
  }

  private _setupRoutes(): void {
    // Basic health check
    this._app.get('/health', (_req, res) => {
      res.status(200).json({ status: 'ok' });
    });

    // Platform-specific webhooks
    // INVARIANT-10: Signature validation must be performed before dispatching.
    this._app.post('/webhooks/:platform', express.json(), async (req, res) => {
      const platform = req.params.platform;
      log.info({ platform }, 'Received webhook');

      // 1. Validate that the platform has a registered adapter
      const adapter = this._manager.getAdapter(platform);
      if (!adapter) {
        log.warn({ platform }, 'Webhook received for unknown platform');
        res.status(404).json({ error: 'Unknown platform' });
        return;
      }

      // 2. Signature validation placeholder — must be implemented per-platform
      //    before this server is used in production. Requests without a valid
      //    signature should be rejected here with 401.
      //    TODO: implement platform-specific HMAC signature validation.

      // 3. Payload dispatch is handled by each adapter's own polling/webhook handler.
      //    Adapters using the Vercel Chat SDK handle their own webhook registration.
      //    This route exists for platforms that push raw payloads here directly.
      res.status(200).send('OK');
    });
  }
}
