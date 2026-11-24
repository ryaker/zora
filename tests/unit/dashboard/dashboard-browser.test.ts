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

test.describe('Zora Tactical Dashboard', () => {
  let server: DashboardServer;
  const testDir = path.join(os.tmpdir(), 'zora-dashboard-test');
  const port = 7071;
  const jobId = 'job_browser_test';
  let submittedPrompt: string | undefined;
  // #167: when set, submitTask hands out these jobIds in order and emits an
  // early text event BEFORE returning, so the SSE event races the POST response.
  let queuedJobs: string[] = [];

  test.beforeAll(async () => {
    await fs.mkdir(testDir, { recursive: true });

    const provider = new MockProvider();
    const engine = new PolicyEngine({
      filesystem: { allowed_paths: [], denied_paths: [], resolve_symlinks: true, follow_symlinks: false },
      shell: { mode: 'deny_all', allowed_commands: [], denied_commands: [], split_chained_commands: true, max_execution_time: '1m' },
      actions: { reversible: [], irreversible: [], always_flag: [] },
      network: { allowed_domains: [], denied_domains: [], max_request_size: '1mb' },
    });
    const sessionManager = new SessionManager(testDir);
    const steeringManager = new SteeringManager(testDir);
    const notifications = new NotificationTools();
    const authMonitor = new AuthMonitor({ providers: [provider], notifications });
    const loop = new ExecutionLoop({ provider, engine, sessionManager, steeringManager });

    server = new DashboardServer({
      loop, sessionManager, steeringManager, authMonitor, port,
      submitTask: async (prompt) => {
        submittedPrompt = prompt;
        const queued = queuedJobs.shift();
        if (!queued) return jobId;
        server.broadcastEvent({ type: 'text', jobId: queued, data: { text: `early:${queued} ` } });
        await new Promise(resolve => setTimeout(resolve, 150));
        return queued;
      },
    });
    await server.start();
  });

  test.afterAll(async () => {
    await server.stop();
  });

  test('loads the tactical interface', async ({ page }) => {
    await page.addInitScript(() => { localStorage.setItem('zora_onboarding_complete', 'true'); });
    await page.goto(`http://localhost:${port}`);
    await expect(page).toHaveTitle(/Zora — Tactical Interface/);
    await expect(page.locator('text=ZORA / DASHBOARD')).toBeVisible();
  });

  test('submits a task via chat and displays its final result', async ({ page }) => {
    // Dismiss onboarding overlay so the main input is interactive
    await page.addInitScript(() => { localStorage.setItem('zora_onboarding_complete', 'true'); });
    const connected = page.waitForResponse(response => response.url().endsWith('/api/events') && response.ok());
    await page.goto(`http://localhost:${port}`);
    await connected;

    const input = page.locator('[placeholder="Ask Zora to do something..."]');
    await input.fill('Engage impulse engines');
    const submitted = page.waitForResponse(response => response.url().endsWith('/api/task') && response.request().method() === 'POST');
    await page.click('button:has-text("SEND")');

    expect((await submitted).ok()).toBe(true);
    expect(submittedPrompt).toBe('Engage impulse engines');
    await expect(page.getByText('Working...', { exact: true })).toBeVisible();
    // Provider `done` is not terminal; only the task promise settling is.
    server.broadcastEvent({ type: 'done', jobId, data: { text: 'provider stream finished' } });
    await expect(page.getByText('Working...', { exact: true })).toBeVisible();
    server.broadcastEvent({ type: 'job_completed', jobId, data: { jobId, text: `Completed: ${submittedPrompt}` } });
    await expect(page.getByText('Completed: Engage impulse engines', { exact: true })).toBeVisible();
    await expect(page.getByText('Working...', { exact: true })).toBeHidden();
  });

  test('overlapping jobs in two tabs only complete their own tab', async ({ browser }) => {
    queuedJobs = ['job_tab_a', 'job_tab_b'];
    const ctx = await browser.newContext();
    await ctx.addInitScript(() => { localStorage.setItem('zora_onboarding_complete', 'true'); });
    const open = async () => {
      const page = await ctx.newPage();
      const connected = page.waitForResponse(r => r.url().endsWith('/api/events') && r.ok());
      await page.goto(`http://localhost:${port}`);
      await connected;
      return page;
    };
    const send = async (page: Awaited<ReturnType<typeof open>>, text: string) => {
      await page.locator('[placeholder="Ask Zora to do something..."]').fill(text);
      const posted = page.waitForResponse(r => r.url().endsWith('/api/task') && r.request().method() === 'POST');
      await page.click('button:has-text("SEND")');
      expect((await posted).ok()).toBe(true);
    };
    const tabA = await open();
    const tabB = await open();
    await send(tabA, 'alpha');
    await send(tabB, 'beta');

    // Early events that raced the POST response are replayed into the right tab only.
    await expect(tabA.getByText('early:job_tab_a', { exact: false })).toBeVisible();
    await expect(tabA.getByText('early:job_tab_b', { exact: false })).toHaveCount(0);
    await expect(tabB.getByText('early:job_tab_b', { exact: false })).toBeVisible();
    await expect(tabB.getByText('early:job_tab_a', { exact: false })).toHaveCount(0);

    // Job B finishes first (out of submission order): tab A must keep working.
    server.broadcastEvent({ type: 'job_completed', jobId: 'job_tab_b', data: { jobId: 'job_tab_b', text: 'B result' } });
    await expect(tabB.getByText('B result', { exact: true })).toBeVisible();
    await expect(tabB.getByText('Working...', { exact: true })).toBeHidden();
    await expect(tabA.getByText('Working...', { exact: true })).toBeVisible();
    await expect(tabA.getByText('B result', { exact: true })).toHaveCount(0);

    // Job A fails: error lands only under tab A.
    server.broadcastEvent({ type: 'job_failed', jobId: 'job_tab_a', data: { jobId: 'job_tab_a', error: 'boom' } });
    await expect(tabA.getByText('Task failed: boom', { exact: true })).toBeVisible();
    await expect(tabA.getByText('Working...', { exact: true })).toBeHidden();
    await expect(tabB.getByText('Task failed: boom', { exact: true })).toHaveCount(0);
    await ctx.close();
  });

  test('final result is reconciled against the same job\'s streamed output', async ({ page }) => {
    await page.addInitScript(() => { localStorage.setItem('zora_onboarding_complete', 'true'); });
    const connected = page.waitForResponse(r => r.url().endsWith('/api/events') && r.ok());
    await page.goto(`http://localhost:${port}`);
    await connected;
    await page.locator('[placeholder="Ask Zora to do something..."]').fill('reconcile');
    const posted = page.waitForResponse(r => r.url().endsWith('/api/task') && r.request().method() === 'POST');
    await page.click('button:has-text("SEND")');
    await posted;

    // text → tool_call → tool_result → done: same answer must not be appended twice.
    server.broadcastEvent({ type: 'text', jobId, data: { text: 'Interim thought.' } });
    server.broadcastEvent({ type: 'tool_call', jobId, data: { tool: 'Read' } });
    server.broadcastEvent({ type: 'tool_result', jobId, data: { result: 'ok' } });
    server.broadcastEvent({ type: 'text', jobId, data: { text: 'The answer is 4.' } });
    server.broadcastEvent({ type: 'done', jobId, data: { text: 'The answer is 4.' } });
    server.broadcastEvent({ type: 'job_completed', jobId, data: { jobId, text: 'The answer is 4.' } });
    await expect(page.getByText('Working...', { exact: true })).toBeHidden();
    await expect(page.getByText('The answer is 4.', { exact: true })).toHaveCount(1);
  });

  // Drop every SSE connection so each tab's EventSource auto-reconnects.
  const dropSseClients = () => Promise.all(
    [...(server as any)._sseClients.keys()].map(client => new Promise<void>(resolve => {
      client.req.once('close', resolve);
      client.end();
    })),
  );

  test('reconnect recovers only this tab\'s missed terminal while another job still runs', async ({ browser }) => {
    queuedJobs = ['job_rc_a', 'job_rc_b'];
    const ctx = await browser.newContext();
    await ctx.addInitScript(() => { localStorage.setItem('zora_onboarding_complete', 'true'); });
    const open = async () => {
      const page = await ctx.newPage();
      const connected = page.waitForResponse(r => r.url().endsWith('/api/events') && r.ok());
      await page.goto(`http://localhost:${port}`);
      await connected;
      return page;
    };
    const send = async (page: Awaited<ReturnType<typeof open>>, text: string) => {
      await page.locator('[placeholder="Ask Zora to do something..."]').fill(text);
      const posted = page.waitForResponse(r => r.url().endsWith('/api/task') && r.request().method() === 'POST');
      await page.click('button:has-text("SEND")');
      expect((await posted).ok()).toBe(true);
    };
    const tabA = await open();
    const tabB = await open();
    await send(tabA, 'alpha');
    await send(tabB, 'beta');

    // Tab A misses its completion: drop SSE, settle job A while nobody listens.
    await dropSseClients();
    server.broadcastEvent({ type: 'job_completed', jobId: 'job_rc_a', data: { jobId: 'job_rc_a', text: 'A recovered' } });

    // On reconnect A recovers job A only; B's job is still running and must not matter.
    await expect(tabA.getByText('A recovered', { exact: true })).toBeVisible({ timeout: 15000 });
    await expect(tabA.getByText('Working...', { exact: true })).toBeHidden();
    await expect(tabB.getByText('Working...', { exact: true })).toBeVisible();
    await expect(tabB.getByText('A recovered', { exact: true })).toHaveCount(0);
    await ctx.close();
  });

  test('SSE reconnect while the POST response is pending still recovers the settled job', async ({ page }) => {
    // #167 round-3 P1: terminal event missed while the jobId is unknown must be
    // recovered once the POST response binds it.
    queuedJobs = ['job_pp_1'];
    await page.addInitScript(() => { localStorage.setItem('zora_onboarding_complete', 'true'); });
    const connected = page.waitForResponse(r => r.url().endsWith('/api/events') && r.ok());
    await page.goto(`http://localhost:${port}`);
    await connected;

    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    let upstreamDone!: () => void;
    const upstream = new Promise<void>(resolve => { upstreamDone = resolve; });
    await page.route('**/api/task', async route => {
      if (route.request().method() !== 'POST') return route.fallback();
      const response = await route.fetch(); // the daemon has accepted the task
      upstreamDone();
      await gate; // ...but the browser has not seen the response yet
      await route.fulfill({ response });
    });

    await page.locator('[placeholder="Ask Zora to do something..."]').fill('pending');
    await page.click('button:has-text("SEND")');
    await upstream;

    // Drop SSE, settle the job while disconnected, wait for the reconnect.
    await dropSseClients();
    server.broadcastEvent({ type: 'job_completed', jobId: 'job_pp_1', data: { jobId: 'job_pp_1', text: 'PP recovered' } });
    await page.waitForResponse(r => r.url().includes('/api/events') && r.ok());

    release();
    await expect(page.getByText('PP recovered', { exact: true })).toBeVisible({ timeout: 15000 });
    await expect(page.getByText('Working...', { exact: true })).toBeHidden();
  });

  test('a stale reconnect response cannot clear a newer submission', async ({ page }) => {
    queuedJobs = ['job_st_1', 'job_st_2'];
    await page.addInitScript(() => { localStorage.setItem('zora_onboarding_complete', 'true'); });
    const connected = page.waitForResponse(r => r.url().endsWith('/api/events') && r.ok());
    await page.goto(`http://localhost:${port}`);
    await connected;
    const send = async (text: string) => {
      await page.locator('[placeholder="Ask Zora to do something..."]').fill(text);
      const posted = page.waitForResponse(r => r.url().endsWith('/api/task') && r.request().method() === 'POST');
      await page.click('button:has-text("SEND")');
      expect((await posted).ok()).toBe(true);
    };

    // Hold job 1's recovery response so it arrives late.
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    let held!: () => void;
    const heldSeen = new Promise<void>(resolve => { held = resolve; });
    await page.route('**/api/task/job_st_1', async route => {
      held();
      await gate;
      await route.fulfill({ json: { ok: true, jobId: 'job_st_1', status: 'completed', text: 'STALE' } });
    });

    await send('first');
    await dropSseClients();
    await heldSeen; // reconnect fired job-scoped recovery for job 1

    // Job 1 finishes live, then the tab starts job 2.
    server.broadcastEvent({ type: 'job_completed', jobId: 'job_st_1', data: { jobId: 'job_st_1', text: 'first done' } });
    await expect(page.getByText('first done', { exact: true })).toBeVisible();
    await send('second');
    await expect(page.getByText('Working...', { exact: true })).toBeVisible();

    // The stale job-1 response lands now: it must be discarded.
    release();
    await page.waitForTimeout(300);
    await expect(page.getByText('Working...', { exact: true })).toBeVisible();
    await expect(page.getByText('STALE', { exact: true })).toHaveCount(0);

    server.broadcastEvent({ type: 'job_completed', jobId: 'job_st_2', data: { jobId: 'job_st_2', text: 'second done' } });
    await expect(page.getByText('second done', { exact: true })).toBeVisible();
  });
});
