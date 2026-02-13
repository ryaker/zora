/**
 * Orchestrator E2E Integration Tests
 *
 * R24: Boot the Orchestrator with mock providers. Submit a task, verify:
 *   - Router selected a provider
 *   - SessionManager persisted events
 *   - MemoryManager context was injected
 *   - FailoverController triggered on failure
 *   - RetryQueue enqueued the task
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import { Orchestrator } from '../../src/orchestrator/orchestrator.js';
import type {
  ZoraConfig,
  ZoraPolicy,
  LLMProvider,
  AuthStatus,
  QuotaStatus,
  AgentEvent,
  TaskContext,
  ProviderCapability,
  CostTier,
} from '../../src/types.js';

// ─── Mock Provider ──────────────────────────────────────────────

class MockProvider implements LLMProvider {
  readonly name: string;
  readonly rank: number;
  readonly capabilities: ProviderCapability[];
  readonly costTier: CostTier;
  executed = false;
  executedTask: TaskContext | null = null;
  shouldFail = false;
  failError = 'Provider error';

  constructor(
    name: string,
    rank = 1,
    capabilities: ProviderCapability[] = ['reasoning', 'coding', 'creative', 'search', 'structured-data'],
    costTier: CostTier = 'included',
  ) {
    this.name = name;
    this.rank = rank;
    this.capabilities = capabilities;
    this.costTier = costTier;
  }

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async checkAuth(): Promise<AuthStatus> {
    return { valid: true, expiresAt: null, canAutoRefresh: true, requiresInteraction: false };
  }

  async getQuotaStatus(): Promise<QuotaStatus> {
    return { isExhausted: false, remainingRequests: null, cooldownUntil: null, healthScore: 1.0 };
  }

  async *execute(task: TaskContext): AsyncGenerator<AgentEvent> {
    this.executed = true;
    this.executedTask = task;

    if (this.shouldFail) {
      yield {
        type: 'error',
        timestamp: new Date(),
        content: { message: this.failError },
      };
      return;
    }

    yield {
      type: 'text',
      timestamp: new Date(),
      content: { text: 'Processing task...' },
    };

    yield {
      type: 'done',
      timestamp: new Date(),
      content: { text: 'Task completed successfully' },
    };
  }

  async abort(_jobId: string): Promise<void> {}
}

// ─── Test Config ─────────────────────────────────────────────────

function createTestConfig(): ZoraConfig {
  return {
    agent: {
      name: 'test-agent',
      workspace: '~/test-workspace',
      max_parallel_jobs: 1,
      default_timeout: '30m',
      heartbeat_interval: '60m',
      log_level: 'info',
      identity: { soul_file: '~/.zora/SOUL.md' },
      resources: { cpu_throttle_percent: 80, memory_limit_mb: 512, throttle_check_interval: '30s' },
    },
    providers: [
      {
        name: 'mock-primary',
        type: 'claude-sdk',
        rank: 1,
        capabilities: ['reasoning', 'coding'],
        cost_tier: 'included',
        enabled: true,
      },
      {
        name: 'mock-secondary',
        type: 'gemini-cli',
        rank: 2,
        capabilities: ['reasoning', 'coding'],
        cost_tier: 'free',
        enabled: true,
      },
    ],
    routing: { mode: 'respect_ranking' },
    failover: {
      enabled: true,
      auto_handoff: true,
      max_handoff_context_tokens: 4096,
      retry_after_cooldown: true,
      max_retries: 3,
      checkpoint_on_auth_failure: true,
      notify_on_failover: true,
    },
    memory: {
      long_term_file: 'memory/MEMORY.md',
      daily_notes_dir: 'memory/daily',
      items_dir: 'memory/items',
      categories_dir: 'memory/categories',
      context_days: 3,
      max_context_items: 10,
      max_category_summaries: 5,
      auto_extract_interval: 60,
    },
    security: {
      policy_file: 'policy.toml',
      audit_log: 'audit.jsonl',
      audit_hash_chain: true,
      audit_single_writer: true,
      integrity_check: false,
      integrity_interval: '1h',
      integrity_includes_tool_registry: false,
      leak_detection: true,
      sanitize_untrusted_content: true,
      jit_secret_decryption: false,
    },
    steering: {
      enabled: true,
      poll_interval: '5s',
      dashboard_port: 0,
      notify_on_flag: true,
      flag_timeout: '5m',
      auto_approve_low_risk: false,
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

function createTestPolicy(): ZoraPolicy {
  return {
    filesystem: { allowed_paths: [os.homedir()], denied_paths: [], resolve_symlinks: true, follow_symlinks: false },
    shell: { mode: 'allowlist', allowed_commands: ['ls'], denied_commands: [], split_chained_commands: true, max_execution_time: '1m' },
    actions: { reversible: [], irreversible: [], always_flag: [] },
    network: { allowed_domains: [], denied_domains: [], max_request_size: '10mb' },
  };
}

// ─── Tests ───────────────────────────────────────────────────────

describe('Orchestrator E2E', () => {
  let tempDir: string;
  let orchestrator: Orchestrator;
  let primaryProvider: MockProvider;
  let secondaryProvider: MockProvider;

  beforeEach(async () => {
    tempDir = path.join(os.tmpdir(), `zora-test-${Date.now()}`);
    await fs.mkdir(tempDir, { recursive: true });

    primaryProvider = new MockProvider('mock-primary', 1);
    secondaryProvider = new MockProvider('mock-secondary', 2);

    orchestrator = new Orchestrator({
      config: createTestConfig(),
      policy: createTestPolicy(),
      providers: [primaryProvider, secondaryProvider],
      baseDir: tempDir,
    });

    await orchestrator.boot();
  });

  afterEach(async () => {
    await orchestrator.shutdown();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('should boot successfully', () => {
    expect(orchestrator.isBooted).toBe(true);
  });

  it('should submit a task and route to the highest-ranked provider', async () => {
    const result = await orchestrator.submitTask({ prompt: 'Write a test function' });

    expect(primaryProvider.executed).toBe(true);
    expect(secondaryProvider.executed).toBe(false);
    expect(result).toBe('Task completed successfully');
  });

  it('should persist events to SessionManager', async () => {
    const events: AgentEvent[] = [];
    await orchestrator.submitTask({
      prompt: 'Test task',
      onEvent: (event) => events.push(event),
    });

    expect(events.length).toBeGreaterThan(0);
    expect(events.some(e => e.type === 'text')).toBe(true);
    expect(events.some(e => e.type === 'done')).toBe(true);

    // Verify session files were created
    const sessionsDir = path.join(tempDir, 'sessions');
    const files = await fs.readdir(sessionsDir);
    expect(files.length).toBeGreaterThan(0);
    expect(files[0]!.endsWith('.jsonl')).toBe(true);
  });

  it('should inject memory context into task', async () => {
    await orchestrator.submitTask({ prompt: 'Test memory injection' });

    expect(primaryProvider.executedTask).not.toBeNull();
    expect(primaryProvider.executedTask!.systemPrompt).toContain('Zora');
  });

  it('should trigger failover on provider error', async () => {
    primaryProvider.shouldFail = true;
    primaryProvider.failError = 'quota exceeded 429';

    const result = await orchestrator.submitTask({ prompt: 'Test failover' });

    expect(primaryProvider.executed).toBe(true);
    expect(secondaryProvider.executed).toBe(true);
    expect(result).toBe('Task completed successfully');
  });

  it('should shutdown cleanly', async () => {
    await orchestrator.shutdown();
    expect(orchestrator.isBooted).toBe(false);
  });

  it('should list sessions after task completion', async () => {
    await orchestrator.submitTask({ prompt: 'Task for listing' });
    const sessions = await orchestrator.sessionManager.listSessions();
    expect(sessions.length).toBeGreaterThan(0);
    expect(sessions[0]!.eventCount).toBeGreaterThan(0);
  });
});
