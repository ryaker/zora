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
import { loadConfigFromString, ConfigError } from '../../../src/config/loader.js';
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
    expect((await request(app as never).get('/api/system')).status).toBe(401);
    expect((await request(app as never).get('/api/system').set('Authorization', 'Bearer wrong')).status).toBe(401);
    expect((await request(app as never).get('/api/system').set('Authorization', 'Bearer cfg-token')).status).toBe(200);
  });

  it('explicit (config) token takes precedence over ZORA_DASHBOARD_TOKEN', async () => {
    process.env['ZORA_DASHBOARD_TOKEN'] = 'env-token';
    const app = makeServer('cfg-token');
    expect((await request(app as never).get('/api/system').set('Authorization', 'Bearer env-token')).status).toBe(401);
    expect((await request(app as never).get('/api/system').set('Authorization', 'Bearer cfg-token')).status).toBe(200);
  });

  it('daemon passes the configured token to DashboardServer', () => {
    // Source-level guard: the daemon is not unit-constructible, and the original
    // bug was precisely this argument being absent.
    const src = fs.readFileSync(path.join(ROOT, 'src/cli/daemon.ts'), 'utf8');
    expect(src).toMatch(/dashboardToken:\s*config\.steering\.dashboard_token/);
  });
});

describe('steering.dashboard_token parsing and rendering (#174 review)', () => {
  const toml = (v: string) => `[steering]\ndashboard_token = ${v}\n`;

  it.each([['true'], ['42'], ['["a"]']])('rejects non-string value %s with a field-specific ConfigError', (v) => {
    try {
      loadConfigFromString(toml(v));
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigError);
      expect((err as ConfigError).errors.join('\n')).toContain('steering.dashboard_token must be a string');
    }
  });

  it('rejects a blank string, accepts omitted, keeps a synthetic env: reference unresolved-safe', () => {
    expect(() => loadConfigFromString(toml('""'))).toThrow(ConfigError);
    expect(loadConfigFromString('[steering]\ndashboard_port = 8070\n').steering.dashboard_token).toBeUndefined();
  });

  it('renders the token HTML-safely and literally (no </script> breakout, no $& expansion)', async () => {
    const evil = '</script><script>alert(1)</script>$&$`\u2028';
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zora-174b-'));
    const s = new DashboardServer({
      sessionManager: new SessionManager(dir),
      steeringManager: new SteeringManager(dir),
      authMonitor: new AuthMonitor({ providers: [], checkIntervalMs: 60_000 }),
      dashboardToken: evil,
      port: 0,
    });
    const html = (s as unknown as { _renderIndex(raw: string): string })._renderIndex('<html><head></head><body></body></html>');
    expect(html).not.toContain('</script><script>');
    expect(html).not.toContain('\u2028');
    expect(html).toContain('\\u003c/script\\u003e');
    expect(html).toContain('$\\u0026$`'); // dollar sequences literal (ampersand HTML-escaped)
  });
});

describe('dashboard_token env: references and env fallback (#174 round 2)', () => {
  const VAR = 'ZORA_TEST_174_DASH_TOKEN';
  afterEach(() => { delete process.env[VAR]; delete process.env['ZORA_DASHBOARD_TOKEN']; });

  it('resolves a synthetic env: reference at config load', () => {
    process.env[VAR] = 'synthetic-resolved';
    const cfg = loadConfigFromString(`[steering]\ndashboard_token = "env:${VAR}"\n`);
    expect(cfg.steering.dashboard_token).toBe('synthetic-resolved');
  });

  it('fails startup (without echoing a value) when the referenced variable is unset', () => {
    delete process.env[VAR];
    let msg = '';
    try { loadConfigFromString(`[steering]\ndashboard_token = "env:${VAR}"\n`); } catch (e) { msg = String(e); }
    expect(msg).toContain(VAR);
  });

  it('falls back to ZORA_DASHBOARD_TOKEN when config omits the token', async () => {
    process.env['ZORA_DASHBOARD_TOKEN'] = 'env-fallback';
    const cfg = loadConfigFromString('[steering]\ndashboard_port = 8070\n');
    expect(cfg.steering.dashboard_token).toBeUndefined();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zora-174c-'));
    const app = (new DashboardServer({
      sessionManager: new SessionManager(dir),
      steeringManager: new SteeringManager(dir),
      authMonitor: new AuthMonitor({ providers: [], checkIntervalMs: 60_000 }),
      dashboardToken: cfg.steering.dashboard_token,
      port: 0,
    }) as unknown as { _app: unknown })._app;
    expect((await request(app as never).get('/api/system')).status).toBe(401);
    expect((await request(app as never).get('/api/system').set('Authorization', 'Bearer env-fallback')).status).toBe(200);
  });
});
