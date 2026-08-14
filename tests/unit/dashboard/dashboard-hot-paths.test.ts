/**
 * PERF-02 — Dashboard request-path audit.
 *
 * The dashboard is polled continuously, so nothing on a request path should do
 * per-request disk I/O or recompute a body that is fixed for the process
 * lifetime. These tests pin that down without changing any route shape or the
 * auth behaviour the frontend depends on.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { DashboardServer } from '../../../src/dashboard/server.js';
import { SessionManager } from '../../../src/orchestrator/session-manager.js';
import { SteeringManager } from '../../../src/steering/steering-manager.js';
import { AuthMonitor } from '../../../src/orchestrator/auth-monitor.js';
import { MockProvider } from '../../fixtures/mock-provider.js';
import type { ZoraPolicy } from '../../../src/types.js';

const SRC_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../src');
const DIST_DIR = path.join(SRC_DIR, 'dashboard', 'frontend', 'dist');
const INDEX_HTML = path.join(DIST_DIR, 'index.html');

/** Minimal policy shaped like the real ZoraPolicy for /api/policy. */
const TEST_POLICY = {
  shell: { mode: 'allowlist', allowed_commands: ['ls'], denied_commands: ['rm'] },
  filesystem: { allowed_paths: ['~/work'], denied_paths: ['~/.ssh'] },
} as unknown as ZoraPolicy;

describe('Dashboard hot paths (PERF-02)', () => {
  let testDir: string;
  let sessionManager: SessionManager;
  let steeringManager: SteeringManager;
  let authMonitor: AuthMonitor;
  let dashboard: DashboardServer;
  let app: unknown;

  /** True when this test created the placeholder index.html and must clean it up. */
  let createdIndexHtml = false;

  beforeAll(async () => {
    // src/dashboard/frontend/dist is gitignored build output; only fabricate a
    // placeholder when a real build isn't present, and remove it afterwards.
    try {
      await fs.access(INDEX_HTML);
    } catch {
      await fs.mkdir(DIST_DIR, { recursive: true });
      await fs.writeFile(INDEX_HTML, '<html><head><title>Zora</title></head><body></body></html>');
      createdIndexHtml = true;
    }
  });

  afterAll(async () => {
    if (createdIndexHtml) {
      await fs.rm(INDEX_HTML, { force: true });
    }
  });

  beforeEach(async () => {
    testDir = path.join(os.tmpdir(), `zora-hotpath-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
    await fs.mkdir(testDir, { recursive: true });

    sessionManager = new SessionManager(testDir);
    steeringManager = new SteeringManager(testDir);
    await steeringManager.init();
    authMonitor = new AuthMonitor({
      providers: [new MockProvider({ name: 'test-provider', rank: 1 })],
      checkIntervalMs: 60_000,
    });

    dashboard = new DashboardServer({
      sessionManager,
      steeringManager,
      authMonitor,
      policy: TEST_POLICY,
      projectConfig: { name: 'Bench', color: '#123456' } as never,
      port: 18099,
    });
    app = (dashboard as unknown as { _app: unknown })._app;
  });

  afterEach(async () => {
    await dashboard.stop();
    await fs.rm(testDir, { recursive: true, force: true });
  });

  it('serves index.html from cache — no disk read per request', async () => {
    const first = await request(app as never).get('/');
    expect(first.status).toBe(200);
    expect(first.text).toContain('<html');

    // Remove the file from under the server. A cached response still succeeds;
    // a per-request readFileSync would now 500.
    await fs.rm(INDEX_HTML, { force: true });
    try {
      const second = await request(app as never).get('/');
      expect(second.status).toBe(200);
      expect(second.text).toBe(first.text);
    } finally {
      await fs.writeFile(INDEX_HTML, '<html><head><title>Zora</title></head><body></body></html>');
    }
  });

  it('injects the token exactly once and only for authenticated requests', async () => {
    const authed = new DashboardServer({
      sessionManager,
      steeringManager,
      authMonitor,
      dashboardToken: 'tok-123',
      port: 18098,
    });
    const authedApp = (authed as unknown as { _app: unknown })._app;

    // Unauthenticated GET / must not leak the token — behaviour unchanged.
    const denied = await request(authedApp as never).get('/');
    expect(denied.status).toBe(401);

    const ok = await request(authedApp as never).get('/').set('Authorization', 'Bearer tok-123');
    expect(ok.status).toBe(200);
    expect(ok.text).toContain('window.__ZORA_TOKEN__="tok-123"');
    // Injected once, not once per request/render.
    expect(ok.text.match(/__ZORA_TOKEN__/g) ?? []).toHaveLength(1);

    const again = await request(authedApp as never).get('/').set('Authorization', 'Bearer tok-123');
    expect(again.text).toBe(ok.text);

    await authed.stop();
  });

  it('returns stable, cached bodies for the static endpoints', async () => {
    for (const route of ['/api/policy', '/api/project']) {
      const a = await request(app as never).get(route);
      const b = await request(app as never).get(route);
      expect(a.status).toBe(200);
      expect(b.body).toEqual(a.body);
    }

    const policy = await request(app as never).get('/api/policy');
    expect(policy.body).toEqual({
      ok: true,
      policy: {
        preset: 'balanced',
        allowedPaths: ['~/work'],
        deniedPaths: ['~/.ssh'],
        allowedCommands: ['ls'],
        blockedCommands: ['rm'],
      },
    });

    const project = await request(app as never).get('/api/project');
    expect(project.body).toMatchObject({ name: 'Bench', color: '#123456', port: 18099 });

    const favicon = await request(app as never).get('/favicon.svg');
    expect(favicon.status).toBe(200);
    expect(favicon.headers['content-type']).toContain('image/svg+xml');
    // supertest buffers unknown content types — read the SVG out of the body.
    const svg = Buffer.from(favicon.body).toString('utf8');
    expect(svg).toContain('#123456');
    const favicon2 = await request(app as never).get('/favicon.svg');
    expect(Buffer.from(favicon2.body).toString('utf8')).toBe(svg);
  });

  it('/api/jobs and /api/history stay correct over the session index', async () => {
    const ts = new Date('2026-01-01T00:00:00.000Z');
    await sessionManager.appendEvent('job-a', { type: 'text', timestamp: ts, content: { text: 'hi' } });
    await sessionManager.appendEvent('job-a', { type: 'done', timestamp: ts, content: {} });
    await sessionManager.appendEvent('job-b', { type: 'error', timestamp: ts, content: { message: 'boom' } });

    const jobs = await request(app as never).get('/api/jobs');
    expect(jobs.status).toBe(200);
    const byId = Object.fromEntries(
      (jobs.body.jobs as Array<{ jobId: string; eventCount: number; status: string }>).map(j => [j.jobId, j]),
    );
    expect(byId['job-a']).toMatchObject({ eventCount: 2, status: 'completed' });
    expect(byId['job-b']).toMatchObject({ eventCount: 1, status: 'failed' });

    // A second poll comes from the warm index and must agree exactly.
    const jobs2 = await request(app as never).get('/api/jobs');
    expect(jobs2.body).toEqual(jobs.body);

    // New events land in the listing immediately.
    await sessionManager.appendEvent('job-a', { type: 'text', timestamp: ts, content: { text: 'more' } });
    const jobs3 = await request(app as never).get('/api/jobs');
    const a3 = (jobs3.body.jobs as Array<{ jobId: string; eventCount: number }>).find(j => j.jobId === 'job-a');
    expect(a3!.eventCount).toBe(3);

    const history = await request(app as never).get('/api/history?limit=5');
    expect(history.status).toBe(200);
    expect(history.body.ok).toBe(true);
    expect((history.body.events as unknown[]).length).toBeGreaterThan(0);
  });
});
