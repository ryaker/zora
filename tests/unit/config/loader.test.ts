import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig, loadConfigFromString, parseConfig, ConfigError } from '../../../src/config/loader.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const FIXTURE_DIR = resolve(__dirname, '../../fixtures');

describe('loadConfig (from file)', () => {
  it('loads and parses the sample config fixture', async () => {
    const config = await loadConfig(resolve(FIXTURE_DIR, 'sample-config.toml'));

    expect(config.agent.name).toBe('zora-test');
    expect(config.agent.max_parallel_jobs).toBe(2);
    expect(config.agent.log_level).toBe('debug');
  });

  it('loads providers from the sample fixture', async () => {
    const config = await loadConfig(resolve(FIXTURE_DIR, 'sample-config.toml'));

    expect(config.providers).toHaveLength(5);
    expect(config.providers[0]!.name).toBe('claude-opus');
    expect(config.providers[0]!.type).toBe('claude-sdk');
    expect(config.providers[0]!.rank).toBe(1);
    expect(config.providers[0]!.capabilities).toContain('reasoning');
    expect(config.providers[1]!.name).toBe('claude-sonnet');
    expect(config.providers[1]!.rank).toBe(2);
    expect(config.providers[2]!.name).toBe('claude-haiku');
    expect(config.providers[2]!.cost_tier).toBe('free');
    expect(config.providers[3]!.name).toBe('gemini');
    expect(config.providers[3]!.rank).toBe(4);
    expect(config.providers[4]!.name).toBe('ollama');
    expect(config.providers[4]!.type).toBe('ollama');
    expect(config.providers[4]!.cost_tier).toBe('free');
  });

  it('throws on non-existent file', async () => {
    await expect(loadConfig('/nonexistent/config.toml')).rejects.toThrow();
  });
});

describe('loadConfigFromString', () => {
  it('parses minimal TOML with just agent name', () => {
    const config = loadConfigFromString(`
[agent]
name = "test"
`);
    // Should merge with defaults
    expect(config.agent.name).toBe('test');
    expect(config.agent.max_parallel_jobs).toBe(3); // from default
    expect(config.routing.mode).toBe('respect_ranking'); // from default
    expect(config.failover.enabled).toBe(true); // from default
  });

  it('parses config with providers', () => {
    const config = loadConfigFromString(`
[agent]
name = "test"

[[providers]]
name = "mock"
type = "mock"
rank = 1
capabilities = ["reasoning"]
cost_tier = "free"
enabled = true
`);
    expect(config.providers).toHaveLength(1);
    expect(config.providers[0]!.name).toBe('mock');
    expect(config.providers[0]!.cost_tier).toBe('free');
  });

  it('overrides nested defaults correctly', () => {
    const config = loadConfigFromString(`
[agent]
name = "custom"
max_parallel_jobs = 5

[agent.resources]
cpu_throttle_percent = 50
memory_limit_mb = 8192
`);
    expect(config.agent.name).toBe('custom');
    expect(config.agent.max_parallel_jobs).toBe(5);
    expect(config.agent.resources.cpu_throttle_percent).toBe(50);
    expect(config.agent.resources.memory_limit_mb).toBe(8192);
    // Default for throttle_check_interval should still be there
    expect(config.agent.resources.throttle_check_interval).toBe('10s');
  });

  it('throws ConfigError for invalid config', () => {
    expect(() =>
      loadConfigFromString(`
[agent]
name = "test"
max_parallel_jobs = 0
`),
    ).toThrow(ConfigError);
  });

  it('ConfigError contains specific error messages', () => {
    try {
      loadConfigFromString(`
[agent]
name = "test"
max_parallel_jobs = 0

[agent.resources]
cpu_throttle_percent = 200
memory_limit_mb = 64
`);
      expect.unreachable('Should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(ConfigError);
      const err = e as ConfigError;
      expect(err.errors.length).toBeGreaterThanOrEqual(3);
      expect(err.errors).toContainEqual(expect.stringContaining('max_parallel_jobs'));
      expect(err.errors).toContainEqual(expect.stringContaining('cpu_throttle_percent'));
      expect(err.errors).toContainEqual(expect.stringContaining('memory_limit_mb'));
    }
  });

  it('throws on malformed TOML', () => {
    expect(() => loadConfigFromString('not valid toml ][')).toThrow();
  });
});

describe('parseConfig', () => {
  it('returns defaults for empty input', () => {
    const config = parseConfig({});
    expect(config.agent.name).toBe('zora');
    expect(config.routing.mode).toBe('respect_ranking');
    expect(config.providers).toEqual([]);
  });

  it('handles providers array correctly', () => {
    const config = parseConfig({
      providers: [
        {
          name: 'test',
          type: 'mock',
          rank: 1,
          capabilities: ['fast'],
          cost_tier: 'free',
        },
      ],
    });
    expect(config.providers).toHaveLength(1);
    expect(config.providers[0]!.name).toBe('test');
    expect(config.providers[0]!.enabled).toBe(true); // default
  });

  it('preserves routing overrides', () => {
    const config = parseConfig({
      routing: { mode: 'optimize_cost' },
    });
    expect(config.routing.mode).toBe('optimize_cost');
  });
});
