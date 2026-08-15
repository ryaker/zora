/**
 * WebhookServer — Handles incoming webhooks for multi-channel adapters.
 *
 * Each platform adapter translates Vercel Chat SDK events → ChannelMessage.
 *
 * INVARIANT-10: Webhook server validates platform signatures before processing.
 *
 * Every request is authenticated by a per-platform validator before anything
 * else happens to it — before the adapter is looked up, before the body is
 * interpreted, before any of it reaches the ChannelManager pipeline. A platform
 * with no registered validator is refused, so adding an adapter cannot quietly
 * open an unauthenticated route.
 *
 * This gate is not redundant with the one inside `@chat-adapter/telegram`.
 * That check is conditional on a secret being configured
 * (`if (this.secretToken)`), so an operator who omits it gets an endpoint that
 * accepts anything, and it compares with `!==`, which returns early on the
 * first differing byte. Here validation is mandatory — an unvalidatable request
 * is never dispatched — and the comparison is constant-time.
 */

import express from 'express';
import type { Server } from 'node:http';
import { ChannelManager } from './channel-manager.js';
import { createLogger } from '../utils/logger.js';
import { WebhookValidatorRegistry, type WebhookRequestContext } from './webhook-signatures.js';

const log = createLogger('webhook-server');

/** Express request with the unparsed body captured for signature validation. */
interface RawBodyRequest extends express.Request {
  rawBody?: Buffer;
}

export class WebhookServer {
  private readonly _app: express.Application;
  private readonly _port: number;
  private readonly _manager: ChannelManager;
  private readonly _validators: WebhookValidatorRegistry;
  private _server: Server | null = null;

  /**
   * INVARIANT-10 (review finding): ceiling on one adapter dispatch.
   *
   * `handleWebhook` runs the whole inbound pipeline inline — quarantine calls
   * an LLM — and an unbounded await means the HTTP response never completes if
   * that stalls. Telegram gives up and redelivers the same `update_id`, so a
   * stalled update gets processed twice, the second time while the first is
   * still running. Answering 503 keeps the retry but bounds the overlap.
   */
  private static readonly DISPATCH_TIMEOUT_MS = 25_000;

  constructor(manager: ChannelManager, validators: WebhookValidatorRegistry, port = 8080) {
    this._app = express();
    this._port = port;
    this._manager = manager;
    this._validators = validators;

    this._setupRoutes();
  }

  /**
   * Start the webhook server.
   */
  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      const server = this._app.listen(this._port, () => {
        log.info(
          { port: this._port, platforms: this._validators.platforms() },
          'Webhook server listening',
        );
        resolve();
      });
      this._server = server;
      server.once('error', (err: Error) => {
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
      const server = this._server;
      await new Promise<void>((resolve) => server.close((err?: Error) => {
        if (err) log.warn({ err }, 'Webhook server close error');
        resolve();
      }));
      this._server = null;
    }
    log.info('Webhook server stopped');
  }

  /** The bound port. Differs from the configured one when port 0 was requested. */
  address(): number | null {
    const addr = this._server?.address();
    return addr && typeof addr === 'object' ? addr.port : null;
  }

  private _setupRoutes(): void {
    // Basic health check
    this._app.get('/health', (_req, res) => {
      res.status(200).json({ status: 'ok' });
    });

    // INVARIANT-10: the raw bytes are kept before any parsing, because a
    // body-signature validator has to digest exactly what was sent. Re-encoding
    // a parsed object reorders keys and drops whitespace, so the digest would
    // cover something the sender never signed.
    const captureRawBody = express.json({
      verify: (req, _res, buf) => {
        (req as RawBodyRequest).rawBody = Buffer.from(buf);
      },
      limit: '1mb',
    });

    this._app.post('/webhooks/:platform', captureRawBody, async (req, res) => {
      const platform = req.params.platform ?? '';
      const rawBody = (req as RawBodyRequest).rawBody;

      // A request whose body was never captured cannot be validated — it was
      // not JSON, so `express.json()` left it alone. Treated as unauthenticated
      // rather than passed on with an empty body.
      if (!rawBody) {
        log.warn({ platform, contentType: req.headers['content-type'] }, 'Webhook rejected: no raw body captured');
        res.status(401).json({ error: 'Unauthenticated' });
        return;
      }

      const ctx: WebhookRequestContext = {
        headers: req.headers as Record<string, string | undefined>,
        rawBody,
      };

      // ── INVARIANT-10 gate. Nothing below this point runs for a request that
      // does not authenticate. Signature is checked before the adapter is even
      // looked up, and every rejection answers with the same status and body,
      // so an unauthenticated caller learns neither which adapters are
      // registered nor which platforms have a validator.
      const verdict = this._validators.validate(platform, ctx);
      if (!verdict.valid) {
        // Every rejection here answers identically. Review finding on #179:
        // returning 501 "not configured" for an unregistered platform and 401
        // for a bad signature let an unauthenticated caller walk the validator
        // registry one platform at a time — configuration disclosure, not a
        // bypass, but it made the claim above false as written. The operator
        // still needs the distinction, so it goes to the log, which is where
        // operators look and attackers do not.
        //
        // Fail closed either way: a platform without a validator is refused,
        // not waved through. That is the state Signal is in — signal-cli
        // delivers over a local intake process and has no webhook mechanism at
        // all, so there is no signature that could authenticate one.
        if ('unconfigured' in verdict) {
          log.warn({ platform }, 'Webhook rejected: no signature validator registered for platform');
        } else {
          log.warn({ platform, reason: verdict.reason }, 'Webhook rejected: signature validation failed');
        }
        res.status(401).json({ error: 'Unauthenticated' });
        return;
      }

      // ── Authenticated past this point.
      const adapter = this._manager.getAdapter(platform);
      if (!adapter) {
        log.warn({ platform }, 'Webhook received for unknown platform');
        res.status(404).json({ error: 'Unknown platform' });
        return;
      }

      if (!adapter.handleWebhook) {
        log.warn({ platform }, 'Adapter does not accept webhook delivery');
        res.status(501).json({ error: 'Adapter does not accept webhook delivery' });
        return;
      }

      log.info({ platform }, 'Dispatching authenticated webhook');
      try {
        // The adapter takes a Fetch Request, which is what the chat SDK's
        // webhook handlers expect. Rebuilt from the captured bytes so the
        // adapter sees the same body that was validated.
        const request = new Request(`http://webhook.local${req.originalUrl}`, {
          method: 'POST',
          headers: this._fetchHeaders(req.headers),
          body: rawBody,
        });

        let timer: ReturnType<typeof setTimeout> | undefined;
        const timeout = new Promise<'timeout'>((resolve) => {
          timer = setTimeout(() => resolve('timeout'), WebhookServer.DISPATCH_TIMEOUT_MS);
        });
        let outcome: Response | 'timeout';
        try {
          outcome = await Promise.race([adapter.handleWebhook(request), timeout]);
        } finally {
          if (timer) clearTimeout(timer);
        }

        if (outcome === 'timeout') {
          // The dispatch is still running; it is not cancellable, so this only
          // frees the connection. 503 is retryable, which is the honest answer:
          // we do not know whether the update was processed.
          log.error(
            { platform, timeoutMs: WebhookServer.DISPATCH_TIMEOUT_MS },
            'Webhook dispatch timed out — answering retryable while it continues in the background',
          );
          res.status(503).json({ error: 'Dispatch timed out' });
          return;
        }

        const text = await outcome.text();
        res.status(outcome.status).send(text);
      } catch (err) {
        // A failure inside the adapter must not surface as a 2xx: Telegram
        // retries on a non-2xx, and reporting success would drop the update.
        log.error({ err, platform }, 'Webhook dispatch failed');
        res.status(500).json({ error: 'Webhook dispatch failed' });
      }
    });
  }

  /** Node's header bag → Fetch Headers, dropping the multi-value entries. */
  private _fetchHeaders(nodeHeaders: express.Request['headers']): Headers {
    const headers = new Headers();
    for (const [key, value] of Object.entries(nodeHeaders)) {
      if (typeof value === 'string') headers.set(key, value);
    }
    return headers;
  }
}
