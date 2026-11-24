/**
 * #219: settings_not_in_effect reaches the hash-chained audit log, metadata only.
 * Covers both observation paths: ClaudeProvider (task path) and ExecutionLoop.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';

vi.mock('@anthropic-ai/claude-agent-sdk', async (orig) => {
  const actual = await orig<Record<string, unknown>>();
  return {
    ...actual,
    query: () => ({
      async *[Symbol.asyncIterator]() {
        yield { type: 'system', subtype: 'informational', tag: 'settings_not_in_effect',
          content: 'SDK diagnostic text that must never be persisted', session_id: 'sess-123' };
        yield { type: 'result', subtype: 'success', uuid: 'r', session_id: 'sess-123', duration_ms: 1,
          is_error: false, num_turns: 1, result: 'ok', total_cost_usd: 0 };
      },
      interrupt: async () => {},
    }),
  };
});
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import { Orchestrator } from '../../src/orchestrator/orchestrator.js';
import { ClaudeProvider } from '../../src/providers/claude-provider.js';
import type { SDKMessage, SDKQuery } from '../../src/providers/claude-provider.js';
import type { ZoraConfig, ZoraPolicy } from '../../src/types.js';

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


const SECRET_TEXT = 'SDK diagnostic text that must never be persisted';
const notice = {
  type: 'system', subtype: 'informational', tag: 'settings_not_in_effect',
  content: SECRET_TEXT, session_id: 'sess-123',
};

function fakeQuery(): SDKQuery {
  const messages = [
    notice,
    { type: 'result', subtype: 'success', uuid: 'r', session_id: 'sess-123', duration_ms: 1,
      is_error: false, num_turns: 1, result: 'ok', total_cost_usd: 0 },
  ];
  return {
    async *[Symbol.asyncIterator]() { for (const m of messages) yield m as unknown as SDKMessage; },
    interrupt: async () => {},
  } as unknown as SDKQuery;
}

async function readRows(dir: string): Promise<Array<Record<string, unknown>>> {
  const raw = await fs.readFile(path.join(dir, 'audit', 'audit-security.jsonl'), 'utf8');
  return raw.trim().split('\n').map((l) => JSON.parse(l));
}

describe('settings_not_in_effect → audit row (#219)', () => {
  let dir: string;
  let orch: Orchestrator | undefined;
  afterEach(async () => {
    if (orch?.isBooted) await orch.shutdown();
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  });

  async function boot(): Promise<{ provider: ClaudeProvider }> {
    dir = makeTestDir();
    await fs.mkdir(dir, { recursive: true });
    const provider = new ClaudeProvider({
      config: { name: 'claude', type: 'claude-sdk', rank: 1, capabilities: ['reasoning', 'coding', 'creative', 'structured-data', 'large-context'],
        cost_tier: 'premium', enabled: true } as never,
      queryFn: () => fakeQuery(),
    });
    orch = new Orchestrator({ config: makeConfig(dir), policy: makePolicy(), providers: [provider], baseDir: dir });
    await orch.boot();
    return { provider };
  }

  it('ClaudeProvider path writes a metadata-only row', async () => {
    await boot();
    await orch!.submitTask({ prompt: 'hi', onEvent: () => {} });
    await orch!.auditLogger.log({ jobId: 'flush', eventType: 'notification', timestamp: new Date().toISOString(),
      provider: 'x', toolName: 'flush', parameters: {}, result: {} });
    const rows = (await readRows(dir)).filter((r) => r.toolName === 'settings_not_in_effect');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ eventType: 'notification', provider: 'claude', result: { sessionId: 'sess-123' } });
    expect(rows[0]!.jobId).not.toBe('system');
    expect(JSON.stringify(rows[0])).not.toContain(SECRET_TEXT);
  });

  it('ExecutionLoop path (user+project settings) writes a metadata-only row', async () => {
    await boot();
    // Real ExecutionLoop built by the Orchestrator (heartbeat factory), SDK query mocked.
    const loop = (orch as unknown as { _buildHeartbeatLoop(c: string, t: number): { run(p: string): Promise<string> } })
      ._buildHeartbeatLoop(dir, 5000);
    await loop.run('ping');
    await orch!.auditLogger.log({ jobId: 'flush', eventType: 'notification', timestamp: new Date().toISOString(),
      provider: 'x', toolName: 'flush', parameters: {}, result: {} });
    const rows = (await readRows(dir)).filter((r) => r.toolName === 'settings_not_in_effect');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ provider: 'execution-loop', result: { sessionId: 'sess-123' } });
    expect(JSON.stringify(rows[0])).not.toContain(SECRET_TEXT);
  });
});
