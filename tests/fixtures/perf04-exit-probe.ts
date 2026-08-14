/**
 * PERF-04 exit probe — run as a child process by
 * tests/unit/orchestrator/orchestrator-perf.test.ts.
 *
 * Boots an Orchestrator exactly the way one-shot `ask` mode does
 * (skipChannels: true), runs a task, shuts down, and then does NOT call
 * process.exit(). If any background timer still holds a ref, Node's event loop
 * stays alive and this process hangs — which is the regression PERF-04 guards.
 *
 * Prints EXIT_PROBE_OK on the happy path and lets the process fall off the end.
 */

import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import { Orchestrator } from '../../src/orchestrator/orchestrator.js';
import { DEFAULT_CONFIG } from '../../src/config/defaults.js';
import { MockProvider } from './mock-provider.js';
import type { ZoraConfig, ZoraPolicy } from '../../src/types.js';

const baseDir = path.join(os.tmpdir(), `zora-perf04-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);

const policy: ZoraPolicy = {
  filesystem: { allowed_paths: [os.tmpdir()], denied_paths: [], resolve_symlinks: false, follow_symlinks: false },
  shell: { mode: 'allowlist', allowed_commands: ['echo'], denied_commands: [], split_chained_commands: true, max_execution_time: '30s' },
  actions: { reversible: ['read_file'], irreversible: ['write_file'], always_flag: [] },
  network: { allowed_domains: [], denied_domains: [], max_request_size: '10MB' },
};

const config: ZoraConfig = structuredClone(DEFAULT_CONFIG);
config.agent.log_level = 'error';
config.agent.workspace = path.join(baseDir, 'workspace');
config.agent.identity.soul_file = path.join(baseDir, 'SOUL.md');
config.memory.long_term_file = path.join(baseDir, 'memory', 'MEMORY.md');
config.memory.daily_notes_dir = path.join(baseDir, 'memory', 'daily');
config.memory.items_dir = path.join(baseDir, 'memory', 'items');
config.memory.categories_dir = path.join(baseDir, 'memory', 'categories');
config.security.policy_file = path.join(baseDir, 'policy.toml');
config.security.audit_log = path.join(baseDir, 'audit', 'audit.jsonl');
config.security.integrity_check = false;
config.steering.enabled = false;
config.notifications.enabled = false;

async function main(): Promise<void> {
  await fs.mkdir(baseDir, { recursive: true });

  const orchestrator = new Orchestrator({
    config,
    policy,
    providers: [new MockProvider({ name: 'primary', rank: 1 })],
    baseDir,
    // This is exactly what `zora-agent ask` passes.
    skipChannels: true,
  });

  await orchestrator.boot();
  await orchestrator.submitTask({ prompt: 'exit probe' });

  // `--no-shutdown` is the strict form of the check: without shutdown() nothing
  // clears the background timers, so the process can only exit if every one of
  // them is unref'd. (Real `ask` mode does call shutdown, then process.exit —
  // this probe is what makes that belt-and-braces rather than load-bearing.)
  if (!process.argv.includes('--no-shutdown')) {
    await orchestrator.shutdown();
  }
  await fs.rm(baseDir, { recursive: true, force: true }).catch(() => {});

  process.stdout.write('EXIT_PROBE_OK\n');
  // Deliberately no process.exit(): the event loop must drain on its own.
}

main().catch((err) => {
  process.stderr.write(`EXIT_PROBE_FAIL ${String(err)}\n`);
  process.exit(1);
});
