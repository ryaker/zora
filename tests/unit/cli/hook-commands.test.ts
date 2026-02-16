/**
 * Tests for ORCH-13: Hook CLI commands (list/test)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Command } from 'commander';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { registerHookCommands } from '../../../src/cli/hook-commands.js';

describe('Hook CLI Commands — ORCH-13', () => {
  let program: Command;
  let tmpDir: string;
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    program = new Command();
    program.exitOverride();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zora-hook-test-'));
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('registers hooks command group', () => {
    registerHookCommands(program, tmpDir);
    const hooks = program.commands.find((c) => c.name() === 'hooks');
    expect(hooks).toBeDefined();
    expect(hooks!.description()).toBe('Manage lifecycle hooks');
  });

  it('registers list subcommand', () => {
    registerHookCommands(program, tmpDir);
    const hooks = program.commands.find((c) => c.name() === 'hooks');
    const list = hooks!.commands.find((c) => c.name() === 'list');
    expect(list).toBeDefined();
  });

  it('registers test subcommand', () => {
    registerHookCommands(program, tmpDir);
    const hooks = program.commands.find((c) => c.name() === 'hooks');
    const test = hooks!.commands.find((c) => c.name() === 'test');
    expect(test).toBeDefined();
  });

  it('hooks list shows help when no config exists', async () => {
    registerHookCommands(program, tmpDir);
    await program.parseAsync(['node', 'zora', 'hooks', 'list']);

    const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
    expect(output).toContain('No hooks configured');
  });

  it('hooks list shows configured hooks from config.toml', async () => {
    // Write a minimal config.toml with hooks
    const configContent = `
[agent]
name = "test"
workspace = "/tmp"
max_parallel_jobs = 1
default_timeout = "30m"
heartbeat_interval = "30m"
log_level = "info"

[agent.identity]
soul_file = "~/.zora/SOUL.md"

[agent.resources]
cpu_throttle_percent = 80
memory_limit_mb = 4096
throttle_check_interval = "30s"

[[providers]]
name = "test"
type = "claude-sdk"
rank = 1
capabilities = ["reasoning"]
cost_tier = "metered"
enabled = true

[routing]
mode = "respect_ranking"

[failover]
enabled = false
auto_handoff = false
max_handoff_context_tokens = 8000
retry_after_cooldown = true
max_retries = 3
checkpoint_on_auth_failure = true
notify_on_failover = true

[memory]
long_term_file = "~/.zora/memory/long-term.md"
daily_notes_dir = "~/.zora/memory/daily"
items_dir = "~/.zora/memory/items"
categories_dir = "~/.zora/memory/categories"
context_days = 3
max_context_items = 50
max_category_summaries = 5
auto_extract_interval = 300
auto_extract = true

[security]
policy_file = "~/.zora/policy.toml"
audit_log = "~/.zora/audit.jsonl"
audit_hash_chain = true
audit_single_writer = true
integrity_check = true
integrity_interval = "5m"
integrity_includes_tool_registry = true
leak_detection = true
sanitize_untrusted_content = true
jit_secret_decryption = false

[steering]
enabled = false
poll_interval = "2s"
dashboard_port = 8070
notify_on_flag = true
flag_timeout = "5m"
auto_approve_low_risk = false
always_flag_irreversible = true

[notifications]
enabled = false
on_task_complete = true
on_error = true
on_failover = true
on_auth_expiry = true
on_all_providers_down = true

[[hooks]]
event = "beforeToolExecute"
match = "Bash"
script = "~/.zora/hooks/validate-bash.sh"

[[hooks]]
event = "onTaskEnd"
`;

    fs.writeFileSync(path.join(tmpDir, 'config.toml'), configContent);

    registerHookCommands(program, tmpDir);
    await program.parseAsync(['node', 'zora', 'hooks', 'list']);

    const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
    expect(output).toContain('Found 2 hook(s)');
    expect(output).toContain('beforeToolExecute');
    expect(output).toContain('onTaskEnd');
    expect(output).toContain('match=Bash');
  });

  it('hooks test validates event name', async () => {
    registerHookCommands(program, tmpDir);

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('process.exit called');
    }) as never);

    try {
      await program.parseAsync(['node', 'zora', 'hooks', 'test', 'invalidEvent']);
    } catch {
      // Expected: process.exit throws
    }

    const output = errorSpy.mock.calls.map((c) => c[0]).join('\n');
    expect(output).toContain('Invalid hook event');

    errorSpy.mockRestore();
    exitSpy.mockRestore();
  });
});
