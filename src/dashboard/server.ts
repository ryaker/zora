/**
 * DashboardServer — Local API and static file server for the Zora UI.
 *
 * Spec §6.0 "Web Dashboard Spec":
 *   - Binds to localhost:7070 by default.
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

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface DashboardOptions {
  loop?: ExecutionLoop;
  sessionManager: SessionManager;
  steeringManager: SteeringManager;
  authMonitor: AuthMonitor;
  port?: number;
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
   * Prunes expired entries periodically to prevent unbounded memory growth.
   */
  private _createRateLimiter(): express.RequestHandler {
    const windowMs = 15 * 60 * 1000;
    const maxRequests = 100;
    const clients = new Map<string, { count: number; resetAt: number }>();
    let lastCleanup = Date.now();

    return (req, res, next) => {
      const ip = req.ip ?? req.socket.remoteAddress ?? 'unknown';
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

    /** GET /api/health — Provider and auth status */
    this._app.get('/api/health', async (_req, res) => {
      try {
        const authStatus = await authMonitor.checkAll();
        res.json({
          ok: true,
          providers: Array.from(authStatus.entries()).map(([name, status]) => ({
            name,
            ...status
          }))
        });
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

    /** GET /api/system — Real system metrics */
    this._app.get('/api/system', async (_req, res) => {
      try {
        const uptime = process.uptime();
        const mem = process.memoryUsage();
        const sessions = await sessionManager.listSessions();
        const activeJobs = sessions.filter(s => s.status === 'running').length;

        res.json({
          ok: true,
          uptime: Math.floor(uptime),
          memory: {
            used: Math.round(mem.heapUsed / 1024 / 1024),
            total: Math.round(mem.heapTotal / 1024 / 1024),
            rss: Math.round(mem.rss / 1024 / 1024),
          },
          activeJobs,
          totalJobs: sessions.length,
          version: '0.6.0',
        });
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
    const port = this._options.port ?? 7070;
    return new Promise((resolve) => {
      this._server = this._app.listen(port, '127.0.0.1', () => {
        console.log(`[Dashboard] Zora Tactical Interface active at http://localhost:${port}`);
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
