/**
 * DashboardServer — Local API and static file server for the Zora UI.
 *
 * Spec §6.0 "Web Dashboard Spec":
 *   - Binds to localhost:8070 by default.
 *   - Serves as the primary ingress for async steering.
 */

import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Server } from 'node:http';
import type { Response as ExpressResponse } from 'express';
import type { ExecutionLoop } from '../orchestrator/execution-loop.js';
import type { SessionManager } from '../orchestrator/session-manager.js';
import type { SteeringManager } from '../steering/steering-manager.js';
import type { AuthMonitor } from '../orchestrator/auth-monitor.js';
import type { LLMProvider, ProviderQuotaSnapshot } from '../types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Quota threshold for marking a provider as degraded.
 * Providers with healthScore below this value are considered DEGRADED.
 */
const DEGRADED_QUOTA_THRESHOLD = 0.5;

export interface SubmitTaskFn {
  (prompt: string): Promise<string>; // returns jobId
}

export interface DashboardOptions {
  loop?: ExecutionLoop;
  providers?: LLMProvider[];
  sessionManager: SessionManager;
  steeringManager: SteeringManager;
  authMonitor: AuthMonitor;
  submitTask?: SubmitTaskFn;
  port?: number;
  host?: string;
}

export class DashboardServer {
  private readonly _app: express.Application;
  private readonly _options: DashboardOptions;
  private _server: Server | undefined;
  private readonly _sseClients: Set<ExpressResponse> = new Set();

  constructor(options: DashboardOptions) {
    this._options = options;
    this._app = express();

    // R22: Explicit body size limits
    this._app.use(express.json({ limit: '1mb' }));

    // R21: Rate limiting — 100 requests per 15 minutes per IP
    this._app.use(this._createRateLimiter());

    // Serve static frontend files (Vite build output)
    const staticPath = path.join(__dirname, 'frontend', 'dist');
    this._app.use(express.static(staticPath));

    this._setupRoutes();
  }

  /**
   * Simple in-memory rate limiter (no external dependency).
   * Limits to 100 requests per 15 minutes per IP.
   * Exempts localhost requests to /api/* so the dashboard's own polling
   * (health, jobs, system) doesn't consume the rate limit budget.
   * Prunes expired entries periodically to prevent unbounded memory growth.
   */
  private _createRateLimiter(): express.RequestHandler {
    const windowMs = 15 * 60 * 1000;
    const maxRequests = 100;
    const clients = new Map<string, { count: number; resetAt: number }>();
    let lastCleanup = Date.now();

    return (req, res, next) => {
      // Exempt localhost API polling from rate limiting (#104).
      // The dashboard frontend polls /api/health, /api/jobs, and /api/system
      // frequently (~100 req/15min), which would hit the limit for its own UI.
      const ip = req.ip ?? req.socket.remoteAddress ?? 'unknown';
      const isLoopback = ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
      if (isLoopback && req.path.startsWith('/api/')) {
        next();
        return;
      }

      const now = Date.now();

      // Prune expired entries every 5 minutes
      if (now - lastCleanup > 5 * 60 * 1000) {
        for (const [key, rec] of clients) {
          if (rec.resetAt <= now) clients.delete(key);
        }
        lastCleanup = now;
      }

      const record = clients.get(ip);

      if (!record || now > record.resetAt) {
        clients.set(ip, { count: 1, resetAt: now + windowMs });
        next();
        return;
      }

      record.count++;
      if (record.count > maxRequests) {
        res.status(429).json({ ok: false, error: 'Too many requests. Try again later.' });
        return;
      }

      next();
    };
  }

  private _setupRoutes(): void {
    const { steeringManager, authMonitor, sessionManager } = this._options;

    // --- System APIs ---

    /** GET /api/health — LOG-03: Comprehensive health check with provider status, system metrics */
    this._app.get('/api/health', async (_req, res) => {
      try {
        const providers = this._options.providers ?? [];
        const authStatus = await authMonitor.checkAll();

        // Build per-provider health info
        const providerHealth = await Promise.all(
          providers.map(async (p) => {
            const auth = authStatus.get(p.name) ?? { valid: false, expiresAt: null, canAutoRefresh: false, requiresInteraction: true };
            let quota;
            try {
              quota = await p.getQuotaStatus();
            } catch {
              quota = { isExhausted: false, remainingRequests: null, cooldownUntil: null, healthScore: 0 };
            }

            // Determine per-provider status
            let status: 'OK' | 'DEGRADED' | 'DOWN' = 'OK';
            if (!auth.valid) status = 'DOWN';
            else if (quota.isExhausted || quota.healthScore < DEGRADED_QUOTA_THRESHOLD) status = 'DEGRADED';

            return {
              name: p.name,
              status,
              // Back-compat: expose auth fields at top level for existing consumers
              valid: auth.valid,
              expiresAt: auth.expiresAt?.toISOString() ?? null,
              canAutoRefresh: auth.canAutoRefresh,
              auth: {
                valid: auth.valid,
                expiresAt: auth.expiresAt?.toISOString() ?? null,
                canAutoRefresh: auth.canAutoRefresh,
              },
              quota: {
                isExhausted: quota.isExhausted,
                remainingRequests: quota.remainingRequests,
                healthScore: quota.healthScore,
              },
              costTier: p.costTier,
            };
          })
        );

        // Overall system status: CRITICAL if all down, DEGRADED if any down, OK otherwise
        const downCount = providerHealth.filter(p => p.status === 'DOWN').length;
        const degradedCount = providerHealth.filter(p => p.status === 'DEGRADED').length;
        let overallStatus: 'OK' | 'DEGRADED' | 'CRITICAL' = 'OK';
        if (providers.length > 0 && downCount === providers.length) overallStatus = 'CRITICAL';
        else if (downCount > 0 || degradedCount > 0) overallStatus = 'DEGRADED';

        const mem = process.memoryUsage();

        res.json({
          ok: overallStatus !== 'CRITICAL',
          status: overallStatus,
          timestamp: new Date().toISOString(),
          providers: providerHealth,
          system: {
            uptime: Math.floor(process.uptime()),
            memoryUsage: {
              heapUsedMB: Math.round(mem.heapUsed / (1024 * 1024)),
              heapTotalMB: Math.round(mem.heapTotal / (1024 * 1024)),
              rssMB: Math.round(mem.rss / (1024 * 1024)),
            },
          },
          sseClients: this._sseClients.size,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        res.status(500).json({ ok: false, status: 'CRITICAL', error: message });
      }
    });

    /** GET /api/quota — Provider quota, usage, and cost snapshots */
    this._app.get('/api/quota', async (_req, res) => {
      const providers = this._options.providers ?? [];
      try {
        const authStatus = await authMonitor.checkAll();
        const snapshots: ProviderQuotaSnapshot[] = await Promise.all(
          providers.map(async (p) => ({
            name: p.name,
            auth: authStatus.get(p.name) ?? { valid: false, expiresAt: null, canAutoRefresh: false, requiresInteraction: true },
            quota: await p.getQuotaStatus(),
            usage: p.getUsage(),
            costTier: p.costTier,
          }))
        );
        res.json({ ok: true, providers: snapshots });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        res.status(500).json({ ok: false, error: message });
      }
    });

    /** GET /api/jobs — R14: List active and historical jobs via SessionManager */
    this._app.get('/api/jobs', async (_req, res) => {
      try {
        const sessions = await sessionManager.listSessions();
        res.json({
          jobs: sessions.map(s => ({
            jobId: s.jobId,
            eventCount: s.eventCount,
            lastActivity: s.lastActivity?.toISOString() ?? null,
            status: s.status,
          })),
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        res.status(500).json({ ok: false, error: message });
      }
    });

    /** GET /api/system — Real process metrics for dashboard System Info panel */
    this._app.get('/api/system', (_req, res) => {
      const mem = process.memoryUsage();
      res.json({
        uptime: Math.floor(process.uptime()),
        memory: {
          used: Math.round(mem.heapUsed / (1024 * 1024)),
          total: Math.round(mem.heapTotal / (1024 * 1024)),
        },
      });
    });

    // --- Task Submission ---

    /** POST /api/task — Submit a new task to the orchestrator */
    this._app.post('/api/task', async (req, res) => {
      const { prompt } = req.body;

      if (typeof prompt !== 'string' || !prompt.trim()) {
        return res.status(400).json({ ok: false, error: 'prompt must be a non-empty string' });
      }

      const { submitTask } = this._options;
      if (!submitTask) {
        return res.status(503).json({ ok: false, error: 'Task submission not available' });
      }

      try {
        const jobId = await submitTask(prompt.trim());
        // Note: job_started event is now emitted by the orchestrator via onEvent callback
        res.json({ ok: true, jobId });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        res.status(500).json({ ok: false, error: message });
      }
    });

    // --- Steering APIs ---

    /** POST /api/steer — Inject a steering message */
    this._app.post('/api/steer', async (req, res) => {
      const { jobId, message, author, source } = req.body;

      if (typeof jobId !== 'string' || !jobId.trim() || typeof message !== 'string' || !message.trim()) {
        return res.status(400).json({ ok: false, error: 'jobId and message must be non-empty strings' });
      }

      try {
        await steeringManager.injectMessage({
          type: 'steer',
          jobId,
          message,
          author: author ?? 'web-user',
          source: source ?? 'dashboard',
          timestamp: new Date()
        });
        res.json({ ok: true });
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        res.status(500).json({ ok: false, error: errorMessage });
      }
    });

    // --- R17: SSE endpoint for real-time job updates ---

    /** GET /api/events — Server-Sent Events stream for live job status */
    this._app.get('/api/events', (req, res) => {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
      });

      res.write('data: {"type":"connected"}\n\n');
      this._sseClients.add(res);

      // Keep-alive comment every 30s to prevent proxy/firewall timeouts
      const keepAlive = setInterval(() => {
        res.write(': keepalive\n\n');
      }, 30_000);

      req.on('close', () => {
        clearInterval(keepAlive);
        this._sseClients.delete(res);
      });
    });

    // Catch-all: serve index.html for SPA routing
    this._app.get('*', (_req, res) => {
      res.sendFile(path.join(__dirname, 'frontend', 'dist', 'index.html'));
    });
  }

  /**
   * Broadcast an event to all connected SSE clients.
   */
  broadcastEvent(event: { type: string; data: unknown }): void {
    const payload = `data: ${JSON.stringify(event)}\n\n`;
    for (const client of this._sseClients) {
      try {
        client.write(payload);
      } catch {
        // Client disconnected — remove and clean up
        this._sseClients.delete(client);
        try { client.end(); } catch { /* already closed */ }
      }
    }
  }

  /**
   * Starts the dashboard server on localhost.
   */
  async start(): Promise<void> {
    const port = this._options.port ?? 8070;
    const host = this._options.host ?? '127.0.0.1';
    return new Promise((resolve) => {
      this._server = this._app.listen(port, host, () => {
        console.log(`[Dashboard] Zora Tactical Interface active at http://${host}:${port}`);
        resolve();
      });
    });
  }

  /**
   * Stops the dashboard server.
   */
  async stop(): Promise<void> {
    // Close all SSE connections
    for (const client of this._sseClients) {
      client.end();
    }
    this._sseClients.clear();

    if (this._server) {
      await new Promise<void>((resolve, reject) => {
        this._server!.close((err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    }
  }
}
