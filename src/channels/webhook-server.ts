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

      // 2. Signature validation — INVARIANT-10 requires per-platform HMAC checks before
      //    processing any webhook payload. Until per-platform validation is implemented,
      //    reject all inbound webhook calls with 501 to prevent spoofed requests from
      //    being treated as successful.
      //    TODO: implement platform-specific HMAC signature validation, then replace
      //    this block with the validated dispatch path.
      log.warn({ platform }, 'Webhook endpoint not yet implemented — signature validation required');
      res.status(501).json({ error: 'Webhook signature validation not yet implemented for this platform' });
    });
  }
}
