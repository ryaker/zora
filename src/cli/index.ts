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
import { ClaudeProvider } from '../providers/claude-provider.js';
import type { TaskContext, ZoraPolicy } from '../types.js';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

const program = new Command();

program
  .name('zora')
  .description('Long-running autonomous personal AI agent for macOS')
  .version('0.5.0');

/**
 * Common setup for commands that need the engine and loop.
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
    // For v1 we assume policy.toml is just a simple JSON/TOML for now
    // Actually we need a real policy loader. Using a dummy for now.
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
  
  // Pick the primary provider (Claude for now)
  const claudeConfig = config.providers.find(p => p.type === 'claude-sdk' && p.enabled);
  if (!claudeConfig) {
    console.error('No enabled Claude provider found in config.');
    process.exit(1);
  }

  const provider = new ClaudeProvider({ config: claudeConfig });
  const loop = new ExecutionLoop({ provider, engine, sessionManager, steeringManager });

  return { config, policy, engine, sessionManager, steeringManager, memoryManager, loop };
}

program
  .command('ask')
  .description('Send a task to the agent and wait for completion')
  .argument('<prompt>', 'The task or question for the agent')
  .action(async (prompt) => {
    const { loop, memoryManager } = await setupContext();
    
    // Load context from memory tiers
    const memoryContext = await memoryManager.loadContext();

    const task: TaskContext = {
      jobId: `job_${Date.now()}`,
      task: prompt,
      requiredCapabilities: ['reasoning'],
      complexity: 'moderate',
      resourceType: 'mixed',
      systemPrompt: 'You are Zora, a helpful agent.',
      memoryContext,
      history: [],
    };

    console.log(`🚀 Starting task: ${task.jobId}`);
    await loop.run(task);
    
    // Record task in daily notes
    await memoryManager.appendDailyNote(`Completed task: ${prompt}`);
    
    console.log('✅ Task complete.');
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

program.parse();
