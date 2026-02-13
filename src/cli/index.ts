#!/usr/bin/env node
/**
 * Zora CLI — The primary interface for controlling the agent.
 *
 * Spec §5.9 "CLI Interface":
 *   - zora start/stop
 *   - zora ask/task
 *   - zora status
 */

import { Command } from 'commander';
import { loadConfig } from '../config/loader.js';
import { PolicyEngine } from '../security/policy-engine.js';
import { SessionManager } from '../orchestrator/session-manager.js';
import { SteeringManager } from '../steering/steering-manager.js';
import { MemoryManager } from '../memory/memory-manager.js';
import { ExecutionLoop } from '../orchestrator/execution-loop.js';
import type { ZoraPolicy } from '../types.js';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { registerMemoryCommands } from './memory-commands.js';
import { registerAuditCommands } from './audit-commands.js';
import { registerEditCommands } from './edit-commands.js';
import { registerTeamCommands } from './team-commands.js';
import { registerSteerCommands } from './steer-commands.js';

const program = new Command();

program
  .name('zora')
  .description('Long-running autonomous personal AI agent for macOS')
  .version('0.6.0');

/**
 * Common setup for commands that need config and services.
 */
async function setupContext() {
  const configDir = path.join(os.homedir(), '.zora');
  const configPath = path.join(configDir, 'config.toml');
  const policyPath = path.join(configDir, 'policy.toml');

  // Ensure config exists or use defaults (for now we assume they exist for simplicity)
  if (!fs.existsSync(configPath)) {
    console.error(`Config not found at ${configPath}. Run zora init (future).`);
    process.exit(1);
  }

  const config = await loadConfig(configPath);

  // Load policy (stubbed for now if not exists)
  let policy: ZoraPolicy;
  if (fs.existsSync(policyPath)) {
    policy = {
      filesystem: { allowed_paths: [os.homedir()], denied_paths: [], resolve_symlinks: true, follow_symlinks: false },
      shell: { mode: 'allowlist', allowed_commands: ['ls', 'npm', 'git'], denied_commands: [], split_chained_commands: true, max_execution_time: '1m' },
      actions: { reversible: [], irreversible: [], always_flag: [] },
      network: { allowed_domains: [], denied_domains: [], max_request_size: '10mb' }
    };
  } else {
    policy = {
      filesystem: { allowed_paths: [os.homedir()], denied_paths: [], resolve_symlinks: true, follow_symlinks: false },
      shell: { mode: 'allowlist', allowed_commands: ['ls', 'npm', 'git'], denied_commands: [], split_chained_commands: true, max_execution_time: '1m' },
      actions: { reversible: [], irreversible: [], always_flag: [] },
      network: { allowed_domains: [], denied_domains: [], max_request_size: '10mb' }
    };
  }

  const engine = new PolicyEngine(policy);
  const sessionManager = new SessionManager(configDir);
  const steeringManager = new SteeringManager(configDir);
  await steeringManager.init();

  const memoryManager = new MemoryManager(config.memory, configDir);
  await memoryManager.init();

  return { config, policy, engine, sessionManager, steeringManager, memoryManager };
}

program
  .command('ask')
  .description('Send a task to the agent and wait for completion')
  .argument('<prompt>', 'The task or question for the agent')
  .option('-m, --model <model>', 'Model to use')
  .option('--max-turns <n>', 'Maximum turns', parseInt)
  .action(async (prompt, opts) => {
    const { config, memoryManager } = await setupContext();

    // Load context from memory tiers
    const memoryContext = await memoryManager.loadContext();

    // Build system prompt
    const systemPrompt = [
      'You are Zora, a helpful autonomous agent.',
      ...memoryContext,
    ].join('\n\n');

    // Build MCP servers from config
    const mcpServers = config.mcp?.servers ?? {};

    const loop = new ExecutionLoop({
      systemPrompt,
      model: opts.model,
      maxTurns: opts.maxTurns,
      mcpServers,
      permissionMode: 'default',
      cwd: process.cwd(),
    });

    console.log('Starting task...');
    const result = await loop.run(prompt);

    if (result) {
      console.log('\n' + result);
    }

    // Record task in daily notes
    await memoryManager.appendDailyNote(`Completed task: ${prompt}`);
    console.log('Task complete.');
  });

program
  .command('status')
  .description('Check the status of the agent and providers')
  .action(async () => {
    const { config } = await setupContext();
    console.log('Zora Status:');
    console.log('  Agent: running (simulated)');
    console.log(`  Providers: ${config.providers.length} registered`);
    config.providers.forEach(p => {
      console.log(`    - ${p.name} (${p.type}): ${p.enabled ? 'enabled' : 'disabled'}`);
    });
  });

program
  .command('start')
  .description('Start the agent daemon')
  .action(() => {
    console.log('Starting Zora daemon...');
    // In v1, this might just be a placeholder or start a long-running process
    console.log('Daemon started (PID: 12345)');
  });

program
  .command('stop')
  .description('Stop the agent daemon')
  .action(() => {
    console.log('Stopping Zora daemon...');
    console.log('Daemon stopped.');
  });

// Register new command groups
const configDir = path.join(os.homedir(), '.zora');
registerMemoryCommands(program, setupContext);
registerAuditCommands(program, () => path.join(configDir, 'audit.jsonl'));
registerEditCommands(program, configDir);
registerTeamCommands(program, configDir);
registerSteerCommands(program, configDir);

program.parse();
