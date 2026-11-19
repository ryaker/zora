/**
 * #174 — [steering].dashboard_token was parsed but never reached DashboardServer,
 * so a configured token silently left the dashboard API unauthenticated.
 */
import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import request from 'supertest';
import { DEFAULT_CONFIG, validateConfig } from '../../../src/config/defaults.js';
import { DashboardServer } from '../../../src/dashboard/server.js';
import { SessionManager } from '../../../src/orchestrator/session-manager.js';
import { SteeringManager } from '../../../src/steering/steering-manager.js';
import { AuthMonitor } from '../../../src/orchestrator/auth-monitor.js';
import os from 'node:os';
import type { ZoraConfig } from '../../../src/types.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const provider = {
  name: 'claude', type: 'claude-sdk', rank: 1, capabilities: ['reasoning'],
  cost_tier: 'included', enabled: true,
} as ZoraConfig['providers'][number];

describe('steering.dashboard_token (#174)', () => {
  const saved = process.env['ZORA_DASHBOARD_TOKEN'];
  afterEach(() => {
    if (saved === undefined) delete process.env['ZORA_DASHBOARD_TOKEN'];
    else process.env['ZORA_DASHBOARD_TOKEN'] = saved;
  });

  function makeServer(dashboardToken?: string): unknown {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zora-174-'));
    const sessionManager = new SessionManager(dir);
    const steeringManager = new SteeringManager(dir);
    const authMonitor = new AuthMonitor({ providers: [], checkIntervalMs: 60_000 });
    const s = new DashboardServer({ sessionManager, steeringManager, authMonitor, dashboardToken, port: 0 });
    return (s as unknown as { _app: unknown })._app;
  }

  it('rejects a blank token instead of silently disabling auth', () => {
    const config: ZoraConfig = {
      ...DEFAULT_CONFIG,
      providers: [provider],
      steering: { ...DEFAULT_CONFIG.steering, dashboard_token: '   ' },
    };
    expect(validateConfig(config).join('\n')).toContain('steering.dashboard_token must not be blank');
    config.steering.dashboard_token = 'tok';
    expect(validateConfig(config)).toEqual([]);
  });

  it('denies protected requests without valid auth and accepts the configured token', async () => {
    delete process.env['ZORA_DASHBOARD_TOKEN'];
    const app = makeServer('cfg-token');
    expect((await request(app as never).get('/api/policy')).status).toBe(401);
    expect((await request(app as never).get('/api/policy').set('Authorization', 'Bearer wrong')).status).toBe(401);
    expect((await request(app as never).get('/api/policy').set('Authorization', 'Bearer cfg-token')).status).not.toBe(401);
  });

  it('explicit (config) token takes precedence over ZORA_DASHBOARD_TOKEN', async () => {
    process.env['ZORA_DASHBOARD_TOKEN'] = 'env-token';
    const app = makeServer('cfg-token');
    expect((await request(app as never).get('/api/policy').set('Authorization', 'Bearer env-token')).status).toBe(401);
    expect((await request(app as never).get('/api/policy').set('Authorization', 'Bearer cfg-token')).status).not.toBe(401);
  });

  it('daemon passes the configured token to DashboardServer', () => {
    // Source-level guard: the daemon is not unit-constructible, and the original
    // bug was precisely this argument being absent.
    const src = fs.readFileSync(path.join(ROOT, 'src/cli/daemon.ts'), 'utf8');
    expect(src).toMatch(/dashboardToken:\s*config\.steering\.dashboard_token/);
  });
});
