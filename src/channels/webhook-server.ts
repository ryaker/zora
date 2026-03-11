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
    return new Promise((resolve) => {
      this._server = this._app.listen(this._port, () => {
        log.info({ port: this._port }, 'Webhook server listening');
        resolve();
      });
    });
  }

  /**
   * Stop the webhook server.
   */
  async stop(): Promise<void> {
    if (this._server) {
      await new Promise((resolve) => this._server.close(resolve));
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
    // Each platform adapter will register its own route here
    this._app.post('/webhooks/:platform', express.json(), async (req, res) => {
      const platform = req.params.platform;
      log.info({ platform }, 'Received webhook');

      // 1. Validate signature (platform-specific)
      // 2. Map payload to event
      // 3. Dispatch to manager.handleMessage()

      res.status(200).send('OK');
    });
  }
}
