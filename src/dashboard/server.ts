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
import type { ExecutionLoop } from '../orchestrator/execution-loop.js';
import type { SessionManager } from '../orchestrator/session-manager.js';
import type { SteeringManager } from '../steering/steering-manager.js';
import type { AuthMonitor } from '../orchestrator/auth-monitor.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface DashboardOptions {
  loop: ExecutionLoop;
  sessionManager: SessionManager;
  steeringManager: SteeringManager;
  authMonitor: AuthMonitor;
  port?: number;
}

export class DashboardServer {
  private readonly _app: express.Application;
  private readonly _options: DashboardOptions;
  private _server: Server | undefined;

  constructor(options: DashboardOptions) {
    this._options = options;
    this._app = express();
    this._app.use(express.json());

    // Serve static frontend files (Vite build output)
    const staticPath = path.join(__dirname, 'frontend', 'dist');
    this._app.use(express.static(staticPath));

    this._setupRoutes();
  }

  private _setupRoutes(): void {
    const { steeringManager, authMonitor } = this._options;

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

    /** GET /api/jobs — List active and historical jobs */
    this._app.get('/api/jobs', async (_req, res) => {
      // In a real implementation, we'd query the session manager or a database
      // For now, return a placeholder
      res.json({ jobs: [] });
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

    // Catch-all: serve index.html for SPA routing
    this._app.get('*', (_req, res) => {
      res.sendFile(path.join(__dirname, 'frontend', 'dist', 'index.html'));
    });
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
  stop(): void {
    if (this._server) {
      this._server.close();
    }
  }
}
