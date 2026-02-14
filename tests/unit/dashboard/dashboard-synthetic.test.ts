/**
 * Synthetic-user browser tests for the Zora Tactical Dashboard.
 *
 * Simulates real user journeys through the dashboard: page load, provider
 * health monitoring, quota display, steering message flow, SSE connection,
 * rate limiting, error handling, and responsive layout.
 *
 * Uses the same server setup pattern as dashboard-browser.test.ts.
 */

import { test, expect } from '@playwright/test';
import { DashboardServer } from '../../../src/dashboard/server.js';
import { ExecutionLoop } from '../../../src/orchestrator/execution-loop.js';
import { SessionManager } from '../../../src/orchestrator/session-manager.js';
import { SteeringManager } from '../../../src/steering/steering-manager.js';
import { AuthMonitor } from '../../../src/orchestrator/auth-monitor.js';
import { MockProvider } from '../../fixtures/mock-provider.js';
import { PolicyEngine } from '../../../src/security/policy-engine.js';
import { NotificationTools } from '../../../src/tools/notifications.js';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';

// ─── Shared test infrastructure ──────────────────────────────────────

const testDir = path.join(os.tmpdir(), 'zora-synthetic-test');
const port = 7073;
const baseUrl = `http://localhost:${port}`;

let server: DashboardServer;
let provider: MockProvider;
let secondProvider: MockProvider;

test.beforeAll(async () => {
  await fs.mkdir(testDir, { recursive: true });

  provider = new MockProvider({ name: 'claude', costTier: 'premium' });
  secondProvider = new MockProvider({ name: 'openai', costTier: 'free', healthScore: 0.5 });

  const engine = new PolicyEngine({
    filesystem: { allowed_paths: [], denied_paths: [], resolve_symlinks: true, follow_symlinks: false },
    shell: { mode: 'deny_all', allowed_commands: [], denied_commands: [], split_chained_commands: true, max_execution_time: '1m' },
    actions: { reversible: [], irreversible: [], always_flag: [] },
    network: { allowed_domains: [], denied_domains: [], max_request_size: '1mb' },
  });

  const sessionManager = new SessionManager(testDir);
  const steeringManager = new SteeringManager(testDir);
  const notifications = new NotificationTools();
  const authMonitor = new AuthMonitor({ providers: [provider, secondProvider], notifications });
  const loop = new ExecutionLoop({ provider, engine, sessionManager, steeringManager });

  server = new DashboardServer({
    loop,
    sessionManager,
    steeringManager,
    authMonitor,
    providers: [provider, secondProvider],
    port,
  });
  await server.start();
});

test.afterAll(async () => {
  await server.stop();
  await fs.rm(testDir, { recursive: true, force: true });
});

// ─── 1. Page Load Journey ────────────────────────────────────────────

test.describe('Page Load Journey', () => {
  test('dashboard loads with correct title', async ({ page }) => {
    await page.goto(baseUrl);
    await expect(page).toHaveTitle(/Zora — Tactical Interface/);
  });

  test('header bar renders with ZORA branding', async ({ page }) => {
    await page.goto(baseUrl);
    await expect(page.locator('text=ZORA // DASHBOARD')).toBeVisible();
  });

  test('all three column panels render', async ({ page }) => {
    await page.goto(baseUrl);
    await expect(page.locator('text=Provider Status')).toBeVisible();
    await expect(page.locator('text=Task Activity')).toBeVisible();
    await expect(page.locator('text=Security Policy')).toBeVisible();
  });

  test('footer displays version info', async ({ page }) => {
    await page.goto(baseUrl);
    // Scope to footer container to avoid matching header "ZORA // DASHBOARD"
    const footer = page.locator('.tracking-widest');
    await expect(footer).toContainText('Zora v0.6.0');
    await expect(footer).toContainText('Dashboard');
  });

  test('initial log entries are visible', async ({ page }) => {
    await page.goto(baseUrl);
    await expect(page.locator('text=Zora is running.')).toBeVisible();
    await expect(page.locator('text=Waiting for tasks...')).toBeVisible();
  });

  test('LCARS theme elements are present', async ({ page }) => {
    await page.goto(baseUrl);
    // LCARS bars exist for each section
    const lcarsBars = page.locator('.lcars-bar');
    await expect(lcarsBars).toHaveCount(5); // Header, Provider Status, Task Activity, Security Policy, Session Usage
  });
});

// ─── 2. Provider Health Monitoring ───────────────────────────────────

test.describe('Provider Health Monitoring', () => {
  test('health API returns provider data', async ({ request }) => {
    const res = await request.get(`${baseUrl}/api/health`);
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.providers).toHaveLength(2);
    expect(data.providers[0].name).toBe('claude');
    expect(data.providers[0].valid).toBe(true);
  });

  test('provider names render in the UI', async ({ page }) => {
    await page.goto(baseUrl);
    // Wait for health fetch to complete and render
    await expect(page.locator('text=claude').first()).toBeVisible({ timeout: 5000 });
    await expect(page.locator('text=openai').first()).toBeVisible({ timeout: 5000 });
  });

  test('connected status shown for healthy providers', async ({ page }) => {
    await page.goto(baseUrl);
    // Both providers have valid auth, so "Connected" should appear
    const connected = page.locator('text=Connected');
    await expect(connected.first()).toBeVisible({ timeout: 5000 });
  });

  test('health API handles provider auth failure gracefully', async ({ request }) => {
    provider.setAuthValid(false);
    try {
      const res = await request.get(`${baseUrl}/api/health`);
      const data = await res.json();
      expect(data.ok).toBe(true);
      const claude = data.providers.find((p: { name: string }) => p.name === 'claude');
      expect(claude.valid).toBe(false);
    } finally {
      provider.setAuthValid(true);
    }
  });
});

// ─── 3. Quota & Usage Display ────────────────────────────────────────

test.describe('Quota & Usage Display', () => {
  test('quota API returns provider snapshots', async ({ request }) => {
    const res = await request.get(`${baseUrl}/api/quota`);
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.providers).toHaveLength(2);
    expect(data.providers[0]).toHaveProperty('quota');
    expect(data.providers[0]).toHaveProperty('usage');
    expect(data.providers[0]).toHaveProperty('costTier');
  });

  test('health bars render for each provider', async ({ page }) => {
    await page.goto(baseUrl);
    // Wait for quota data to render — health bars are in the provider panel
    await page.waitForTimeout(1000);
    // Each provider gets a health bar showing percentage
    await expect(page.locator('text=100%').first()).toBeVisible({ timeout: 5000 });
    // The second provider has 0.5 health = 50%
    await expect(page.locator('text=50%').first()).toBeVisible({ timeout: 5000 });
  });

  test('session usage panel shows total cost and requests', async ({ page }) => {
    await page.goto(baseUrl);
    // Scope to Session Usage panel to avoid matching provider-level "REQUESTS"
    const usagePanel = page.locator('.lcars-panel.border-zora-cyan.bg-zora-cyan\\/5');
    await expect(usagePanel.locator('text=Total Cost')).toBeVisible({ timeout: 5000 });
    await expect(usagePanel.locator('text=Requests')).toBeVisible({ timeout: 5000 });
  });

  test('cost tier is displayed per provider', async ({ page }) => {
    await page.goto(baseUrl);
    await page.waitForTimeout(1000);
    await expect(page.locator('text=premium').first()).toBeVisible({ timeout: 5000 });
    await expect(page.locator('text=free').first()).toBeVisible({ timeout: 5000 });
  });

  test('exhausted quota shows EXHAUSTED label', async ({ page }) => {
    secondProvider.setQuotaExhausted(true);
    try {
      await page.goto(baseUrl);
      await expect(page.locator('text=QUOTA EXHAUSTED').first()).toBeVisible({ timeout: 5000 });
    } finally {
      secondProvider.setQuotaExhausted(false);
    }
  });

  test('quota API returns correct structure for exhausted provider', async ({ request }) => {
    secondProvider.setQuotaExhausted(true);
    try {
      const res = await request.get(`${baseUrl}/api/quota`);
      const data = await res.json();
      const openai = data.providers.find((p: { name: string }) => p.name === 'openai');
      expect(openai.quota.isExhausted).toBe(true);
      expect(openai.quota.remainingRequests).toBe(0);
    } finally {
      secondProvider.setQuotaExhausted(false);
    }
  });
});

// ─── 4. Steering Message Flow ────────────────────────────────────────

test.describe('Steering Message Flow', () => {
  test('steering input and send button are present', async ({ page }) => {
    await page.goto(baseUrl);
    const input = page.locator('input[placeholder="Send a message to the running task..."]');
    await expect(input).toBeVisible();
    await expect(page.locator('button:has-text("SEND")')).toBeVisible();
  });

  test('user types message and submits via button click', async ({ page }) => {
    await page.goto(baseUrl);
    const input = page.locator('input[placeholder="Send a message to the running task..."]');
    await input.fill('Increase output verbosity');
    await page.click('button:has-text("SEND")');

    await expect(page.locator('text=Message sent: Increase output verbosity')).toBeVisible({ timeout: 5000 });
  });

  test('user submits message via Enter key', async ({ page }) => {
    await page.goto(baseUrl);
    const input = page.locator('input[placeholder="Send a message to the running task..."]');
    await input.fill('Switch to defensive mode');
    await input.press('Enter');

    await expect(page.locator('text=Message sent: Switch to defensive mode')).toBeVisible({ timeout: 5000 });
  });

  test('input clears after successful submission', async ({ page }) => {
    await page.goto(baseUrl);
    const input = page.locator('input[placeholder="Send a message to the running task..."]');
    await input.fill('Run diagnostics');
    await page.click('button:has-text("SEND")');

    await expect(input).toHaveValue('');
  });

  test('empty message does not submit', async ({ page }) => {
    await page.goto(baseUrl);
    const initialLogCount = await page.locator('.font-data div').count();
    await page.click('button:has-text("SEND")');
    // Log count should not change (no "Message sent:" added)
    const afterLogCount = await page.locator('.font-data div').count();
    expect(afterLogCount).toBe(initialLogCount);
  });

  test('steer API validates required fields', async ({ request }) => {
    // Missing jobId
    let res = await request.post(`${baseUrl}/api/steer`, {
      data: { message: 'hello' },
    });
    expect(res.status()).toBe(400);

    // Missing message
    res = await request.post(`${baseUrl}/api/steer`, {
      data: { jobId: 'job_1' },
    });
    expect(res.status()).toBe(400);

    // Empty strings
    res = await request.post(`${baseUrl}/api/steer`, {
      data: { jobId: '', message: '' },
    });
    expect(res.status()).toBe(400);
  });

  test('steer API accepts valid payload', async ({ request }) => {
    const res = await request.post(`${baseUrl}/api/steer`, {
      data: { jobId: 'job_active', message: 'Engage warp drive', author: 'test', source: 'synthetic' },
    });
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data.ok).toBe(true);
  });
});

// ─── 5. SSE Connection ──────────────────────────────────────────────

test.describe('SSE Connection', () => {
  test('EventSource endpoint sends connected event', async ({ page }) => {
    await page.goto(baseUrl);
    const result = await page.evaluate(async (url) => {
      const controller = new AbortController();
      setTimeout(() => controller.abort(), 3000);
      try {
        const res = await fetch(`${url}/api/events`, { signal: controller.signal });
        const reader = res.body!.getReader();
        const { value } = await reader.read();
        reader.cancel();
        return {
          status: res.status,
          contentType: res.headers.get('content-type'),
          body: new TextDecoder().decode(value),
        };
      } catch {
        return { status: 0, contentType: '', body: '' };
      }
    }, baseUrl);
    expect(result.status).toBe(200);
    expect(result.contentType).toContain('text/event-stream');
    expect(result.body).toContain('{"type":"connected"}');
  });

  test('SSE headers include correct cache and connection directives', async ({ page }) => {
    await page.goto(baseUrl);
    const headers = await page.evaluate(async (url) => {
      const controller = new AbortController();
      setTimeout(() => controller.abort(), 3000);
      try {
        const res = await fetch(`${url}/api/events`, { signal: controller.signal });
        res.body?.cancel();
        return {
          cacheControl: res.headers.get('cache-control'),
          xAccelBuffering: res.headers.get('x-accel-buffering'),
        };
      } catch {
        return { cacheControl: '', xAccelBuffering: '' };
      }
    }, baseUrl);
    expect(headers.cacheControl).toBe('no-cache');
    // Note: 'connection' header is hop-by-hop and not exposed via fetch API
    expect(headers.xAccelBuffering).toBe('no');
  });

  test('broadcast sends events to connected clients', async ({ page }) => {
    await page.goto(baseUrl);

    // Set up an SSE listener via page evaluate
    const eventPromise = page.evaluate(() => {
      return new Promise<string>((resolve) => {
        const es = new EventSource('/api/events');
        let gotConnected = false;
        es.onmessage = (e) => {
          const data = JSON.parse(e.data);
          if (data.type === 'connected') {
            gotConnected = true;
            return;
          }
          if (gotConnected) {
            es.close();
            resolve(JSON.stringify(data));
          }
        };
        // Timeout safety
        setTimeout(() => { es.close(); resolve('timeout'); }, 5000);
      });
    });

    // Give the EventSource time to connect
    await page.waitForTimeout(500);

    // Broadcast from server
    server.broadcastEvent({ type: 'job_update', data: { jobId: 'test-123', status: 'running' } });

    const result = await eventPromise;
    expect(result).not.toBe('timeout');
    const parsed = JSON.parse(result);
    expect(parsed.type).toBe('job_update');
    expect(parsed.data.jobId).toBe('test-123');
  });
});

// ─── 6. Rate Limiting ───────────────────────────────────────────────

test.describe('Rate Limiting', () => {
  test('rapid requests eventually trigger 429', async ({ request }) => {
    // The rate limiter allows 100 requests per 15 min window per IP.
    // Fire requests rapidly and check that 429 is returned after the limit.
    // Note: other tests in this file also consume quota from the same IP,
    // so we just blast enough to hit the threshold.
    let got429 = false;

    for (let i = 0; i < 120; i++) {
      const res = await request.get(`${baseUrl}/api/health`);
      if (res.status() === 429) {
        got429 = true;
        const data = await res.json();
        expect(data.ok).toBe(false);
        expect(data.error).toContain('Too many requests');
        break;
      }
    }

    expect(got429).toBe(true);
  });
});

// ─── 7. Error Handling ──────────────────────────────────────────────

test.describe('Error Handling', () => {
  test('health API returns 500 on unexpected provider error', async ({ request }) => {
    const originalCheckAuth = provider.checkAuth.bind(provider);
    const originalCheckAuth2 = secondProvider.checkAuth.bind(secondProvider);
    (provider as any).checkAuth = async () => { throw new Error('Provider unavailable'); };
    (secondProvider as any).checkAuth = async () => { throw new Error('Provider unavailable'); };

    try {
      const res = await request.get(`${baseUrl}/api/health`);
      // AuthMonitor.checkAll() propagates the error, route handler returns 500
      expect(res.status()).toBe(500);
      const data = await res.json();
      expect(data.ok).toBe(false);
      expect(data.error).toContain('Provider unavailable');
    } finally {
      provider.checkAuth = originalCheckAuth;
      secondProvider.checkAuth = originalCheckAuth2;
    }
  });

  test('steer API gracefully handles malformed JSON', async ({ request }) => {
    const res = await request.post(`${baseUrl}/api/steer`, {
      headers: { 'Content-Type': 'application/json' },
      data: 'not-json{{{',
    });
    // Express returns 400 for malformed JSON body
    expect(res.status()).toBeGreaterThanOrEqual(400);
  });

  test('unknown API route serves SPA index.html', async ({ request }) => {
    const res = await request.get(`${baseUrl}/api/nonexistent-route`);
    // The catch-all serves index.html, not 404
    expect(res.ok()).toBeTruthy();
    const body = await res.text();
    expect(body).toContain('Zora');
  });

  test('dashboard shows failure log on steer error', async ({ page }) => {
    // Navigate to dashboard, then make it fail by submitting to a broken endpoint.
    // We'll intercept the /api/steer route to simulate a server error.
    await page.goto(baseUrl);

    await page.route('**/api/steer', (route) => {
      route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ ok: false, error: 'Internal error' }),
      });
    });

    const input = page.locator('input[placeholder="Send a message to the running task..."]');
    await input.fill('This will fail');
    await page.click('button:has-text("SEND")');

    await expect(page.locator('text=Failed to send message')).toBeVisible({ timeout: 5000 });
  });
});

// ─── 8. Responsive Layout ───────────────────────────────────────────

test.describe('Responsive Layout', () => {
  test('three-column grid renders at desktop width', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(baseUrl);

    // The grid uses col-span-3, col-span-6, col-span-3
    const grid = page.locator('.grid-cols-12');
    await expect(grid).toBeVisible();

    // Left column (Provider Status)
    const leftCol = page.locator('.col-span-3').first();
    await expect(leftCol).toBeVisible();

    // Center column (Task Activity)
    const centerCol = page.locator('.col-span-6');
    await expect(centerCol).toBeVisible();

    // Right column (Security Policy)
    const rightCol = page.locator('.col-span-3').last();
    await expect(rightCol).toBeVisible();
  });

  test('security policy panel displays active state', async ({ page }) => {
    await page.goto(baseUrl);
    await expect(page.locator('text=Policy: Active')).toBeVisible();
    await expect(page.locator('text=Approved commands only')).toBeVisible();
    await expect(page.locator('text=Dangerous actions require approval')).toBeVisible();
  });

  test('scanline overlay is present', async ({ page }) => {
    await page.goto(baseUrl);
    const scanline = page.locator('.scanline');
    await expect(scanline).toBeVisible();
  });

  test('page renders without JS errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));

    await page.goto(baseUrl);
    // Wait for health/quota fetches to resolve
    await page.waitForTimeout(2000);

    expect(errors).toHaveLength(0);
  });
});

// ─── 9. Jobs API ────────────────────────────────────────────────────

test.describe('Jobs API', () => {
  test('jobs endpoint returns session list', async ({ request }) => {
    const res = await request.get(`${baseUrl}/api/jobs`);
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data).toHaveProperty('jobs');
    expect(Array.isArray(data.jobs)).toBe(true);
  });
});
