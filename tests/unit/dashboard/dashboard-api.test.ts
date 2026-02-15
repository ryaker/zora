/**
 * TEST-04: Dashboard Endpoints Tests
 *
 * Validates all REST API endpoints:
 * - GET /api/health
 * - GET /api/quota
 * - GET /api/jobs
 * - GET /api/system
 * - POST /api/task
 * - POST /api/steer
 * - Error handling and validation
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import { DashboardServer } from '../../../src/dashboard/server.js';
import { SessionManager } from '../../../src/orchestrator/session-manager.js';
import { SteeringManager } from '../../../src/steering/steering-manager.js';
import { AuthMonitor } from '../../../src/orchestrator/auth-monitor.js';
import { MockProvider } from '../../fixtures/mock-provider.js';
import type { AuthStatus } from '../../../src/types.js';

// ─── Helpers ────────────────────────────────────────────────────────

function makeTestDir(): string {
  return path.join(os.tmpdir(), `zora-dashboard-test-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
}

describe('Dashboard API Endpoints', () => {
  let testDir: string;
  let sessionManager: SessionManager;
  let steeringManager: SteeringManager;
  let authMonitor: AuthMonitor;
  let provider: MockProvider;
  let dashboard: DashboardServer;

  beforeEach(async () => {
    testDir = makeTestDir();
    await fs.mkdir(testDir, { recursive: true });

    provider = new MockProvider({ name: 'test-provider', rank: 1 });
    sessionManager = new SessionManager(testDir);
    steeringManager = new SteeringManager(testDir);
    await steeringManager.init();

    authMonitor = new AuthMonitor({
      providers: [provider],
      notifications: { sendNotification: vi.fn() } as any,
      preExpiryWarningHours: 2,
    });

    dashboard = new DashboardServer({
      providers: [provider],
      sessionManager,
      steeringManager,
      authMonitor,
      port: 0,
    });
  });

  afterEach(async () => {
    try {
      await dashboard.stop();
    } catch { /* not started */ }
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch { /* ignore */ }
  });

  // Access the Express app for supertest
  function getApp(): express.Application {
    return (dashboard as any)._app;
  }

  describe('GET /api/health', () => {
    it('returns provider health status', async () => {
      const res = await request(getApp()).get('/api/health');
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.providers).toBeInstanceOf(Array);
      expect(res.body.providers.length).toBeGreaterThan(0);
      expect(res.body.providers[0].name).toBe('test-provider');
    });

    it('includes auth status fields', async () => {
      const res = await request(getApp()).get('/api/health');
      const providerStatus = res.body.providers[0];
      expect(providerStatus).toHaveProperty('valid');
      expect(providerStatus).toHaveProperty('canAutoRefresh');
    });
  });

  describe('GET /api/quota', () => {
    it('returns quota snapshots for all providers', async () => {
      const res = await request(getApp()).get('/api/quota');
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.providers).toBeInstanceOf(Array);

      const snapshot = res.body.providers[0];
      expect(snapshot.name).toBe('test-provider');
      expect(snapshot).toHaveProperty('auth');
      expect(snapshot).toHaveProperty('quota');
      expect(snapshot).toHaveProperty('usage');
      expect(snapshot).toHaveProperty('costTier');
    });
  });

  describe('GET /api/jobs', () => {
    it('returns empty job list when no sessions exist', async () => {
      const res = await request(getApp()).get('/api/jobs');
      expect(res.status).toBe(200);
      expect(res.body.jobs).toBeInstanceOf(Array);
      expect(res.body.jobs).toHaveLength(0);
    });

    it('returns jobs after events are persisted', async () => {
      // Persist some events
      await sessionManager.appendEvent('job-1', {
        type: 'text',
        timestamp: new Date(),
        content: { text: 'hello' },
      });

      const res = await request(getApp()).get('/api/jobs');
      expect(res.status).toBe(200);
      expect(res.body.jobs.length).toBeGreaterThan(0);
      expect(res.body.jobs[0].jobId).toBe('job-1');
      expect(res.body.jobs[0].eventCount).toBeGreaterThan(0);
    });
  });

  describe('GET /api/system', () => {
    it('returns system info with uptime and memory', async () => {
      const res = await request(getApp()).get('/api/system');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('uptime');
      expect(typeof res.body.uptime).toBe('number');
      expect(res.body).toHaveProperty('memory');
      expect(res.body.memory).toHaveProperty('used');
      expect(res.body.memory).toHaveProperty('total');
    });
  });

  describe('POST /api/task', () => {
    it('rejects empty prompt', async () => {
      const res = await request(getApp())
        .post('/api/task')
        .send({ prompt: '' });
      expect(res.status).toBe(400);
      expect(res.body.ok).toBe(false);
      expect(res.body.error).toContain('prompt');
    });

    it('rejects missing prompt', async () => {
      const res = await request(getApp())
        .post('/api/task')
        .send({});
      expect(res.status).toBe(400);
      expect(res.body.ok).toBe(false);
    });

    it('returns 503 when submitTask not configured', async () => {
      const res = await request(getApp())
        .post('/api/task')
        .send({ prompt: 'Do something' });
      expect(res.status).toBe(503);
      expect(res.body.ok).toBe(false);
      expect(res.body.error).toContain('not available');
    });

    it('submits task when submitTask is configured', async () => {
      const mockSubmit = vi.fn().mockResolvedValue('job-123');
      const dashboardWithSubmit = new DashboardServer({
        providers: [provider],
        sessionManager,
        steeringManager,
        authMonitor,
        submitTask: mockSubmit,
      });
      const app = (dashboardWithSubmit as any)._app;

      const res = await request(app)
        .post('/api/task')
        .send({ prompt: 'Test task' });
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.jobId).toBe('job-123');
      expect(mockSubmit).toHaveBeenCalledWith('Test task');
    });
  });

  describe('POST /api/steer', () => {
    it('rejects missing jobId', async () => {
      const res = await request(getApp())
        .post('/api/steer')
        .send({ message: 'Fix the bug' });
      expect(res.status).toBe(400);
      expect(res.body.ok).toBe(false);
    });

    it('rejects missing message', async () => {
      const res = await request(getApp())
        .post('/api/steer')
        .send({ jobId: 'job-1' });
      expect(res.status).toBe(400);
      expect(res.body.ok).toBe(false);
    });

    it('injects steering message successfully', async () => {
      const res = await request(getApp())
        .post('/api/steer')
        .send({ jobId: 'job-1', message: 'Fix the bug' });
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
    });

    it('uses default author and source when not provided', async () => {
      const spy = vi.spyOn(steeringManager, 'injectMessage');
      await request(getApp())
        .post('/api/steer')
        .send({ jobId: 'job-1', message: 'Fix it' });

      expect(spy).toHaveBeenCalledWith(
        expect.objectContaining({
          author: 'web-user',
          source: 'dashboard',
        })
      );
    });
  });
});
