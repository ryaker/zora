/**
 * TEST-01: Integration Tests for Orchestration
 *
 * End-to-end tests that boot the Orchestrator with all subsystems and
 * validate the full task lifecycle:
 * - Bootstrap with all dependencies
 * - Task submission end-to-end
 * - Event emission and persistence
 * - Provider routing
 * - Failover when primary fails
 * - Shutdown cleanup
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import { Orchestrator } from '../../src/orchestrator/orchestrator.js';
import { MockProvider } from '../fixtures/mock-provider.js';
import type { ZoraConfig, ZoraPolicy, AgentEvent } from '../../src/types.js';

// ─── Test Helpers ───────────────────────────────────────────────────

function makeTestDir(): string {
  return path.join(os.tmpdir(), `zora-integration-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
}

function makePolicy(): ZoraPolicy {
  return {
    filesystem: {
      allowed_paths: ['/tmp'],
      denied_paths: ['/etc/passwd'],
      resolve_symlinks: false,
      follow_symlinks: false,
    },
    shell: {
      mode: 'allowlist',
      allowed_commands: ['echo', 'ls'],
      denied_commands: ['rm', 'dd'],
      split_chained_commands: true,
      max_execution_time: '30s',
    },
    actions: {
      reversible: ['read_file', 'list_files'],
      irreversible: ['delete_file', 'write_file'],
      always_flag: ['delete_file'],
    },
    network: {
      allowed_domains: ['*.example.com'],
      denied_domains: ['evil.com'],
      max_request_size: '10MB',
    },
  };
}

function makeConfig(baseDir: string): ZoraConfig {
  return {
    agent: {
      name: 'zora-integration-test',
      workspace: path.join(baseDir, 'workspace'),
      max_parallel_jobs: 2,
      default_timeout: '1h',
      heartbeat_interval: '60m',
      log_level: 'error',
      identity: { soul_file: path.join(baseDir, 'SOUL.md') },
      resources: { cpu_throttle_percent: 80, memory_limit_mb: 1024, throttle_check_interval: '10s' },
    },
    providers: [],
    routing: { mode: 'respect_ranking' },
    failover: {
      enabled: true,
      auto_handoff: true,
      max_handoff_context_tokens: 50000,
      retry_after_cooldown: true,
      max_retries: 3,
      checkpoint_on_auth_failure: true,
      notify_on_failover: true,
    },
    memory: {
      long_term_file: path.join(baseDir, 'memory', 'MEMORY.md'),
      daily_notes_dir: path.join(baseDir, 'memory', 'daily'),
      items_dir: path.join(baseDir, 'memory', 'items'),
      categories_dir: path.join(baseDir, 'memory', 'categories'),
      context_days: 7,
      max_context_items: 20,
      max_category_summaries: 5,
      auto_extract_interval: 10,
      auto_extract: true,
    },
    security: {
      policy_file: path.join(baseDir, 'policy.toml'),
      audit_log: path.join(baseDir, 'audit', 'audit.jsonl'),
      audit_hash_chain: false,
      audit_single_writer: false,
      integrity_check: false,
      integrity_interval: '30m',
      integrity_includes_tool_registry: false,
      leak_detection: false,
      sanitize_untrusted_content: false,
      jit_secret_decryption: false,
    },
    steering: {
      enabled: false,
      poll_interval: '5s',
      dashboard_port: 0,
      notify_on_flag: false,
      flag_timeout: '10m',
      auto_approve_low_risk: true,
      always_flag_irreversible: true,
    },
    notifications: {
      enabled: false,
      on_task_complete: false,
      on_error: false,
      on_failover: false,
      on_auth_expiry: false,
      on_all_providers_down: false,
    },
  };
}

// ─── Tests ──────────────────────────────────────────────────────────

describe('Orchestrator Integration', () => {
  let testDir: string;
  let orchestrator: Orchestrator;

  beforeEach(async () => {
    testDir = makeTestDir();
    await fs.mkdir(testDir, { recursive: true });

    // Suppress console.error from expected errors during tests
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(async () => {
    if (orchestrator?.isBooted) {
      await orchestrator.shutdown();
    }
    vi.restoreAllMocks();
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch { /* ignore */ }
  });

  describe('bootstrap lifecycle', () => {
    it('boots successfully with mock providers', async () => {
      const primary = new MockProvider({ name: 'primary', rank: 1 });
      orchestrator = new Orchestrator({
        config: makeConfig(testDir),
        policy: makePolicy(),
        providers: [primary],
        baseDir: testDir,
      });

      expect(orchestrator.isBooted).toBe(false);
      await orchestrator.boot();
      expect(orchestrator.isBooted).toBe(true);
    });

    it('initializes all subsystems on boot', async () => {
      const primary = new MockProvider({ name: 'primary', rank: 1 });
      orchestrator = new Orchestrator({
        config: makeConfig(testDir),
        policy: makePolicy(),
        providers: [primary],
        baseDir: testDir,
      });

      await orchestrator.boot();

      // All subsystems should be accessible after boot
      expect(orchestrator.router).toBeDefined();
      expect(orchestrator.sessionManager).toBeDefined();
      expect(orchestrator.steeringManager).toBeDefined();
      expect(orchestrator.memoryManager).toBeDefined();
      expect(orchestrator.authMonitor).toBeDefined();
      expect(orchestrator.retryQueue).toBeDefined();
      expect(orchestrator.policyEngine).toBeDefined();
    });

    it('boot is idempotent', async () => {
      const primary = new MockProvider({ name: 'primary', rank: 1 });
      orchestrator = new Orchestrator({
        config: makeConfig(testDir),
        policy: makePolicy(),
        providers: [primary],
        baseDir: testDir,
      });

      await orchestrator.boot();
      await orchestrator.boot(); // Second call should be a no-op
      expect(orchestrator.isBooted).toBe(true);
    });

    it('shutdown is clean', async () => {
      const primary = new MockProvider({ name: 'primary', rank: 1 });
      orchestrator = new Orchestrator({
        config: makeConfig(testDir),
        policy: makePolicy(),
        providers: [primary],
        baseDir: testDir,
      });

      await orchestrator.boot();
      expect(orchestrator.isBooted).toBe(true);

      await orchestrator.shutdown();
      expect(orchestrator.isBooted).toBe(false);
    });

    it('shutdown is idempotent', async () => {
      const primary = new MockProvider({ name: 'primary', rank: 1 });
      orchestrator = new Orchestrator({
        config: makeConfig(testDir),
        policy: makePolicy(),
        providers: [primary],
        baseDir: testDir,
      });

      await orchestrator.boot();
      await orchestrator.shutdown();
      await orchestrator.shutdown(); // Second call should be a no-op
      expect(orchestrator.isBooted).toBe(false);
    });

    it('throws when accessing subsystems before boot', () => {
      const primary = new MockProvider({ name: 'primary', rank: 1 });
      orchestrator = new Orchestrator({
        config: makeConfig(testDir),
        policy: makePolicy(),
        providers: [primary],
        baseDir: testDir,
      });

      expect(() => orchestrator.router).toThrow('boot()');
    });
  });

  describe('task submission', () => {
    it('submits task and receives done event', async () => {
      const primary = new MockProvider({ name: 'primary', rank: 1, responseText: 'Task completed!' });
      orchestrator = new Orchestrator({
        config: makeConfig(testDir),
        policy: makePolicy(),
        providers: [primary],
        baseDir: testDir,
      });
      await orchestrator.boot();

      const events: AgentEvent[] = [];
      const result = await orchestrator.submitTask({
        prompt: 'Say hello',
        onEvent: (e) => events.push(e),
      });

      expect(result).toBe('Complete');
      expect(primary.executeCalls).toHaveLength(1);
      expect(primary.executeCalls[0]!.task).toBe('Say hello');
    });

    it('emits thinking, text, and done events in order', async () => {
      const primary = new MockProvider({ name: 'primary', rank: 1 });
      orchestrator = new Orchestrator({
        config: makeConfig(testDir),
        policy: makePolicy(),
        providers: [primary],
        baseDir: testDir,
      });
      await orchestrator.boot();

      const events: AgentEvent[] = [];
      await orchestrator.submitTask({
        prompt: 'Test task',
        onEvent: (e) => events.push(e),
      });

      const types = events.map(e => e.type);
      expect(types).toContain('thinking');
      expect(types).toContain('text');
      expect(types).toContain('done');
      // thinking should come before text, which should come before done
      expect(types.indexOf('thinking')).toBeLessThan(types.indexOf('text'));
      expect(types.indexOf('text')).toBeLessThan(types.indexOf('done'));
    });

    it('generates unique job IDs', async () => {
      const primary = new MockProvider({ name: 'primary', rank: 1 });
      orchestrator = new Orchestrator({
        config: makeConfig(testDir),
        policy: makePolicy(),
        providers: [primary],
        baseDir: testDir,
      });
      await orchestrator.boot();

      await orchestrator.submitTask({ prompt: 'Task 1' });
      await orchestrator.submitTask({ prompt: 'Task 2' });

      expect(primary.executeCalls).toHaveLength(2);
      const jobId1 = primary.executeCalls[0]!.jobId;
      const jobId2 = primary.executeCalls[1]!.jobId;
      expect(jobId1).not.toBe(jobId2);
    });

    it('allows custom job ID', async () => {
      const primary = new MockProvider({ name: 'primary', rank: 1 });
      orchestrator = new Orchestrator({
        config: makeConfig(testDir),
        policy: makePolicy(),
        providers: [primary],
        baseDir: testDir,
      });
      await orchestrator.boot();

      await orchestrator.submitTask({ prompt: 'Custom ID task', jobId: 'custom-job-123' });

      expect(primary.executeCalls[0]!.jobId).toBe('custom-job-123');
    });
  });

  describe('provider routing', () => {
    it('routes to highest-ranked available provider', async () => {
      const primary = new MockProvider({ name: 'primary', rank: 1, capabilities: ['reasoning', 'coding'] });
      const secondary = new MockProvider({ name: 'secondary', rank: 2, capabilities: ['reasoning', 'coding'] });

      orchestrator = new Orchestrator({
        config: makeConfig(testDir),
        policy: makePolicy(),
        providers: [primary, secondary],
        baseDir: testDir,
      });
      await orchestrator.boot();

      await orchestrator.submitTask({ prompt: 'Route to best' });

      expect(primary.executeCalls).toHaveLength(1);
      expect(secondary.executeCalls).toHaveLength(0);
    });

    it('throws when no providers are available', async () => {
      const unavailable = new MockProvider({ name: 'unavailable', rank: 1, available: false });

      orchestrator = new Orchestrator({
        config: makeConfig(testDir),
        policy: makePolicy(),
        providers: [unavailable],
        baseDir: testDir,
      });
      await orchestrator.boot();

      await expect(orchestrator.submitTask({ prompt: 'No one home' })).rejects.toThrow('No provider available');
    });
  });

  describe('failover', () => {
    it('fails over to secondary when primary has quota error', async () => {
      // FailoverController only triggers on quota/auth errors, not general failures
      const primary = new MockProvider({ name: 'primary', rank: 1 });
      // Make primary emit a quota error event
      primary.setMockEvents([
        { type: 'error', timestamp: new Date(), content: { message: 'quota exceeded 429' } },
      ]);
      const secondary = new MockProvider({ name: 'secondary', rank: 2, responseText: 'Failover success' });

      orchestrator = new Orchestrator({
        config: makeConfig(testDir),
        policy: makePolicy(),
        providers: [primary, secondary],
        baseDir: testDir,
      });
      await orchestrator.boot();

      const events: AgentEvent[] = [];
      const result = await orchestrator.submitTask({
        prompt: 'Failover test',
        onEvent: (e) => events.push(e),
      });

      // Primary should have been tried first
      expect(primary.executeCalls).toHaveLength(1);
      // Secondary should have been tried as failover
      expect(secondary.executeCalls).toHaveLength(1);
      // Result should come from secondary
      expect(result).toBe('Complete');
    });

    it('throws error when primary fails with general error and no failover', async () => {
      const primary = new MockProvider({ name: 'primary', rank: 1, shouldFail: true });

      orchestrator = new Orchestrator({
        config: makeConfig(testDir),
        policy: makePolicy(),
        providers: [primary],
        baseDir: testDir,
      });
      await orchestrator.boot();

      await expect(orchestrator.submitTask({ prompt: 'No failover' }))
        .rejects.toThrow('Mock provider failure');
    });
  });

  describe('event persistence', () => {
    it('persists events to session manager', async () => {
      const primary = new MockProvider({ name: 'primary', rank: 1 });
      orchestrator = new Orchestrator({
        config: makeConfig(testDir),
        policy: makePolicy(),
        providers: [primary],
        baseDir: testDir,
      });
      await orchestrator.boot();

      const events: AgentEvent[] = [];
      await orchestrator.submitTask({
        prompt: 'Persistence test',
        onEvent: (e) => events.push(e),
      });

      // Events should have been persisted — verify via session manager
      const jobId = primary.executeCalls[0]!.jobId;
      const sessionHistory = await orchestrator.sessionManager.getHistory(jobId);
      expect(sessionHistory.length).toBeGreaterThan(0);
    });
  });

  describe('memory context injection', () => {
    it('includes memory context in task context', async () => {
      const primary = new MockProvider({ name: 'primary', rank: 1 });
      orchestrator = new Orchestrator({
        config: makeConfig(testDir),
        policy: makePolicy(),
        providers: [primary],
        baseDir: testDir,
      });
      await orchestrator.boot();

      await orchestrator.submitTask({ prompt: 'Memory test' });

      const task = primary.executeCalls[0]!;
      // memoryContext should be an array (possibly empty for test)
      expect(Array.isArray(task.memoryContext)).toBe(true);
      // systemPrompt should include security preamble
      expect(task.systemPrompt).toContain('SECURITY');
    });
  });
});
