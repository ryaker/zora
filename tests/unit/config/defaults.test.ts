import { describe, it, expect } from 'vitest';
import {
  DEFAULT_CONFIG,
  validateConfig,
  validateProviderConfig,
} from '../../../src/config/defaults.js';
import type { ZoraConfig, ProviderConfig } from '../../../src/types.js';

describe('DEFAULT_CONFIG', () => {
  it('has all required top-level sections', () => {
    expect(DEFAULT_CONFIG.agent).toBeDefined();
    expect(DEFAULT_CONFIG.providers).toBeDefined();
    expect(DEFAULT_CONFIG.routing).toBeDefined();
    expect(DEFAULT_CONFIG.failover).toBeDefined();
    expect(DEFAULT_CONFIG.memory).toBeDefined();
    expect(DEFAULT_CONFIG.security).toBeDefined();
    expect(DEFAULT_CONFIG.steering).toBeDefined();
    expect(DEFAULT_CONFIG.notifications).toBeDefined();
  });

  it('has correct agent defaults from spec', () => {
    expect(DEFAULT_CONFIG.agent.name).toBe('zora-agent');
    expect(DEFAULT_CONFIG.agent.max_parallel_jobs).toBe(3);
    expect(DEFAULT_CONFIG.agent.default_timeout).toBe('2h');
    expect(DEFAULT_CONFIG.agent.heartbeat_interval).toBe('30m');
    expect(DEFAULT_CONFIG.agent.log_level).toBe('info');
  });

  it('has resource throttling defaults from Grok review', () => {
    expect(DEFAULT_CONFIG.agent.resources.cpu_throttle_percent).toBe(80);
    expect(DEFAULT_CONFIG.agent.resources.memory_limit_mb).toBe(4096);
  });

  it('defaults to respect_ranking routing mode', () => {
    expect(DEFAULT_CONFIG.routing.mode).toBe('respect_ranking');
  });

  it('enables failover by default', () => {
    expect(DEFAULT_CONFIG.failover.enabled).toBe(true);
    expect(DEFAULT_CONFIG.failover.auto_handoff).toBe(true);
    expect(DEFAULT_CONFIG.failover.max_retries).toBe(3);
  });

  it('starts with empty providers array', () => {
    expect(DEFAULT_CONFIG.providers).toEqual([]);
  });

  it('enables all notification types by default', () => {
    expect(DEFAULT_CONFIG.notifications.enabled).toBe(true);
    expect(DEFAULT_CONFIG.notifications.on_task_complete).toBe(true);
    expect(DEFAULT_CONFIG.notifications.on_all_providers_down).toBe(true);
  });

  it('sets dashboard port to 8070', () => {
    expect(DEFAULT_CONFIG.steering.dashboard_port).toBe(8070);
  });
});

describe('validateProviderConfig', () => {
  const validProvider: ProviderConfig = {
    name: 'claude',
    type: 'claude-sdk',
    rank: 1,
    capabilities: ['reasoning', 'coding'],
    cost_tier: 'included',
    enabled: true,
  };

  it('accepts a valid provider', () => {
    const errors = validateProviderConfig(validProvider, 0);
    expect(errors).toEqual([]);
  });

  it('rejects missing name', () => {
    const errors = validateProviderConfig({ ...validProvider, name: '' }, 0);
    expect(errors).toContainEqual(expect.stringContaining('name'));
  });

  it('rejects missing type', () => {
    const errors = validateProviderConfig({ ...validProvider, type: '' }, 0);
    expect(errors).toContainEqual(expect.stringContaining('type'));
  });

  it('rejects rank < 1', () => {
    const errors = validateProviderConfig({ ...validProvider, rank: 0 }, 0);
    expect(errors).toContainEqual(expect.stringContaining('rank'));
  });

  it('rejects empty capabilities', () => {
    const errors = validateProviderConfig({ ...validProvider, capabilities: [] }, 0);
    expect(errors).toContainEqual(expect.stringContaining('capabilities'));
  });

  it('rejects invalid cost_tier', () => {
    const errors = validateProviderConfig(
      { ...validProvider, cost_tier: 'expensive' as ProviderConfig['cost_tier'] },
      0,
    );
    expect(errors).toContainEqual(expect.stringContaining('cost_tier'));
  });

  it('includes index in error messages', () => {
    const errors = validateProviderConfig({ ...validProvider, name: '' }, 3);
    expect(errors[0]).toContain('providers[3]');
  });
});

describe('validateConfig', () => {
  function makeValidConfig(): ZoraConfig {
    return {
      ...DEFAULT_CONFIG,
      providers: [
        {
          name: 'claude',
          type: 'claude-sdk',
          rank: 1,
          capabilities: ['reasoning'],
          cost_tier: 'included',
          enabled: true,
        },
      ],
    };
  }

  it('accepts a valid config', () => {
    const errors = validateConfig(makeValidConfig());
    expect(errors).toEqual([]);
  });

  it('accepts config with no providers (defaults only)', () => {
    const errors = validateConfig(DEFAULT_CONFIG);
    expect(errors).toEqual([]);
  });

  it('rejects invalid routing mode', () => {
    const config = makeValidConfig();
    (config.routing as Record<string, unknown>).mode = 'invalid';
    const errors = validateConfig(config);
    expect(errors).toContainEqual(expect.stringContaining('routing.mode'));
  });

  it('requires provider_only_name when mode is provider_only', () => {
    const config = makeValidConfig();
    config.routing.mode = 'provider_only';
    config.routing.provider_only_name = undefined;
    const errors = validateConfig(config);
    expect(errors).toContainEqual(expect.stringContaining('provider_only_name'));
  });

  it('rejects duplicate provider names', () => {
    const config = makeValidConfig();
    config.providers.push({
      name: 'claude',
      type: 'openai-api',
      rank: 2,
      capabilities: ['coding'],
      cost_tier: 'metered',
      enabled: true,
    });
    const errors = validateConfig(config);
    expect(errors).toContainEqual(expect.stringContaining('Duplicate provider names'));
  });

  it('rejects duplicate ranks among enabled providers', () => {
    const config = makeValidConfig();
    config.providers.push({
      name: 'gemini',
      type: 'gemini-cli',
      rank: 1, // same as claude
      capabilities: ['search'],
      cost_tier: 'included',
      enabled: true,
    });
    const errors = validateConfig(config);
    expect(errors).toContainEqual(expect.stringContaining('Duplicate provider ranks'));
  });

  it('allows duplicate ranks if one provider is disabled', () => {
    const config = makeValidConfig();
    config.providers.push({
      name: 'gemini',
      type: 'gemini-cli',
      rank: 1,
      capabilities: ['search'],
      cost_tier: 'included',
      enabled: false, // disabled, so rank conflict doesn't matter
    });
    const errors = validateConfig(config);
    expect(errors).not.toContainEqual(expect.stringContaining('Duplicate provider ranks'));
  });

  it('rejects max_parallel_jobs < 1', () => {
    const config = makeValidConfig();
    config.agent.max_parallel_jobs = 0;
    const errors = validateConfig(config);
    expect(errors).toContainEqual(expect.stringContaining('max_parallel_jobs'));
  });

  it('rejects cpu_throttle_percent out of range', () => {
    const config = makeValidConfig();
    config.agent.resources.cpu_throttle_percent = 101;
    const errors = validateConfig(config);
    expect(errors).toContainEqual(expect.stringContaining('cpu_throttle_percent'));
  });

  it('rejects memory_limit_mb < 256', () => {
    const config = makeValidConfig();
    config.agent.resources.memory_limit_mb = 128;
    const errors = validateConfig(config);
    expect(errors).toContainEqual(expect.stringContaining('memory_limit_mb'));
  });

  it('rejects negative max_retries', () => {
    const config = makeValidConfig();
    config.failover.max_retries = -1;
    const errors = validateConfig(config);
    expect(errors).toContainEqual(expect.stringContaining('max_retries'));
  });

  it('rejects invalid dashboard port', () => {
    const config = makeValidConfig();
    config.steering.dashboard_port = 0;
    const errors = validateConfig(config);
    expect(errors).toContainEqual(expect.stringContaining('dashboard_port'));
  });
});
