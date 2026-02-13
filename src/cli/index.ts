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
import * as clack from '@clack/prompts';
import { loadConfig } from '../config/loader.js';
import { PolicyEngine } from '../security/policy-engine.js';
import { SessionManager } from '../orchestrator/session-manager.js';
import { SteeringManager } from '../steering/steering-manager.js';
import { MemoryManager } from '../memory/memory-manager.js';
import { Orchestrator } from '../orchestrator/orchestrator.js';
import { ClaudeProvider } from '../providers/claude-provider.js';
import { GeminiProvider } from '../providers/gemini-provider.js';
import type { ZoraPolicy, ZoraConfig, LLMProvider } from '../types.js';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { registerMemoryCommands } from './memory-commands.js';
import { registerAuditCommands } from './audit-commands.js';
import { registerEditCommands } from './edit-commands.js';
import { registerTeamCommands } from './team-commands.js';
import { registerSteerCommands } from './steer-commands.js';
import { registerSkillCommands } from './skill-commands.js';
import { registerInitCommand } from './init-command.js';
import { runDoctorChecks } from './doctor.js';

const program = new Command();

program
  .name('zora')
  .description('Long-running autonomous personal AI agent')
  .version('0.6.0');

/**
 * Creates LLMProvider instances from config.
 */
function createProviders(config: ZoraConfig): LLMProvider[] {
  const providers: LLMProvider[] = [];

  for (const pConfig of config.providers) {
    if (!pConfig.enabled) continue;

    switch (pConfig.type) {
      case 'claude-sdk':
        providers.push(new ClaudeProvider({ config: pConfig }));
        break;
      case 'gemini-cli':
        providers.push(new GeminiProvider({ config: pConfig }));
        break;
      default:
        console.warn(`Unknown provider type: ${pConfig.type}, skipping ${pConfig.name}`);
    }
  }

  return providers;
}

/**
 * Returns the path to the daemon PID file.
 */
function getPidFilePath(): string {
  return path.join(os.homedir(), '.zora', 'state', 'daemon.pid');
}

/**
 * Common setup for commands that need config and services.
 */
async function setupContext() {
  const configDir = path.join(os.homedir(), '.zora');
  const configPath = path.join(configDir, 'config.toml');
  const policyPath = path.join(configDir, 'policy.toml');

  // Ensure config exists
  if (!fs.existsSync(configPath)) {
    console.error("Zora isn't configured yet. Run 'zora init' to set up in 2 minutes.");
    process.exit(1);
  }

  const config = await loadConfig(configPath);

  // Load policy from TOML if it exists, otherwise use a safe fallback
  let policy: ZoraPolicy;
  if (fs.existsSync(policyPath)) {
    const { parse: parseTOML } = await import('smol-toml');
    const raw = parseTOML(fs.readFileSync(policyPath, 'utf-8')) as Record<string, unknown>;
    const fsPol = raw['filesystem'] as Record<string, unknown> | undefined;
    const shPol = raw['shell'] as Record<string, unknown> | undefined;
    const actPol = raw['actions'] as Record<string, unknown> | undefined;
    const netPol = raw['network'] as Record<string, unknown> | undefined;
    policy = {
      filesystem: {
        allowed_paths: (fsPol?.['allowed_paths'] as string[]) ?? [],
        denied_paths: (fsPol?.['denied_paths'] as string[]) ?? [],
        resolve_symlinks: (fsPol?.['resolve_symlinks'] as boolean) ?? true,
        follow_symlinks: (fsPol?.['follow_symlinks'] as boolean) ?? false,
      },
      shell: {
        mode: (shPol?.['mode'] as 'allowlist' | 'denylist' | 'deny_all') ?? 'allowlist',
        allowed_commands: (shPol?.['allowed_commands'] as string[]) ?? ['ls', 'npm', 'git'],
        denied_commands: (shPol?.['denied_commands'] as string[]) ?? [],
        split_chained_commands: (shPol?.['split_chained_commands'] as boolean) ?? true,
        max_execution_time: (shPol?.['max_execution_time'] as string) ?? '1m',
      },
      actions: {
        reversible: (actPol?.['reversible'] as string[]) ?? [],
        irreversible: (actPol?.['irreversible'] as string[]) ?? [],
        always_flag: (actPol?.['always_flag'] as string[]) ?? [],
      },
      network: {
        allowed_domains: (netPol?.['allowed_domains'] as string[]) ?? [],
        denied_domains: (netPol?.['denied_domains'] as string[]) ?? [],
        max_request_size: (netPol?.['max_request_size'] as string) ?? '10mb',
      },
    };
  } else {
    console.error('Policy not found at ~/.zora/policy.toml. Run `zora init` first.');
    process.exit(1);
  }

  const engine = new PolicyEngine(policy);
  const sessionManager = new SessionManager(configDir);
  const steeringManager = new SteeringManager(configDir);
  await steeringManager.init();

  const memoryManager = new MemoryManager(config.memory, configDir);
  await memoryManager.init();

  return { config, policy, engine, sessionManager, steeringManager, memoryManager };
}

// R10: Refactored `ask` command to use Orchestrator
program
  .command('ask')
  .description('Send a task to the agent and wait for completion')
  .argument('<prompt>', 'The task or question for the agent')
  .option('-m, --model <model>', 'Model to use')
  .option('--max-turns <n>', 'Maximum turns', parseInt)
  .action(async (prompt, opts) => {
    const { config, policy } = await setupContext();

    const providers = createProviders(config);
    if (providers.length === 0) {
      console.error('No enabled providers found in config.');
      process.exit(1);
    }

    const orchestrator = new Orchestrator({ config, policy, providers });
    await orchestrator.boot();

    try {
      const spinner = clack.spinner();
      spinner.start('Running task...');

      const result = await orchestrator.submitTask({
        prompt,
        model: opts.model,
        maxTurns: opts.maxTurns,
      });

      spinner.stop('Task complete.');

      if (result) {
        console.log('\n' + result);
      }
    } finally {
      await orchestrator.shutdown();
    }
  });

// R13: Real status command
program
  .command('status')
  .description('Check the status of the agent and providers')
  .action(async () => {
    const configDir = path.join(os.homedir(), '.zora');
    const configPath = path.join(configDir, 'config.toml');

    // Check if config exists before calling setupContext
    if (!fs.existsSync(configPath)) {
      console.log("Zora isn't set up yet. Run `zora init` to get started in under 2 minutes.");
      return;
    }

    const { config } = await setupContext();
    const pidFile = getPidFilePath();

    let daemonStatus = 'stopped';
    let daemonPid: number | null = null;

    if (fs.existsSync(pidFile)) {
      try {
        daemonPid = parseInt(fs.readFileSync(pidFile, 'utf8').trim(), 10);
        // Check if process is alive
        process.kill(daemonPid, 0);
        daemonStatus = 'running';
      } catch {
        daemonStatus = 'stopped (stale pidfile)';
        daemonPid = null;
      }
    }

    console.log('Zora Status:');
    console.log(`  Daemon: ${daemonStatus}${daemonPid ? ` (PID: ${daemonPid})` : ''}`);
    console.log(`  Providers: ${config.providers.length} registered`);
    config.providers.forEach(p => {
      console.log(`    - ${p.name} (${p.type}): ${p.enabled ? 'enabled' : 'disabled'}`);
    });
  });

// R11: Real start command
program
  .command('start')
  .description('Start the agent daemon')
  .action(async () => {
    const pidFile = getPidFilePath();

    // Check if already running
    if (fs.existsSync(pidFile)) {
      try {
        const existingPid = parseInt(fs.readFileSync(pidFile, 'utf8').trim(), 10);
        process.kill(existingPid, 0);
        console.log(`Zora daemon is already running (PID: ${existingPid}).`);
        return;
      } catch {
        // Stale pidfile, clean up
        fs.unlinkSync(pidFile);
      }
    }

    // Ensure state directory exists
    const stateDir = path.dirname(pidFile);
    if (!fs.existsSync(stateDir)) {
      fs.mkdirSync(stateDir, { recursive: true, mode: 0o700 });
    }

    // Fork a detached child process
    const { fork } = await import('node:child_process');
    const { fileURLToPath } = await import('node:url');
    const daemonScript = path.join(path.dirname(fileURLToPath(import.meta.url)), 'daemon.js');

    // Check if daemon script exists; if not, run inline
    const child = fork(daemonScript, [], {
      detached: true,
      stdio: 'ignore',
    });

    if (child.pid) {
      fs.writeFileSync(pidFile, String(child.pid), { mode: 0o600 });
      child.unref();
      console.log(`Zora daemon started (PID: ${child.pid}).`);
    } else {
      console.error('Failed to start daemon.');
    }
  });

// R12: Real stop command
program
  .command('stop')
  .description('Stop the agent daemon')
  .action(async () => {
    const pidFile = getPidFilePath();

    if (!fs.existsSync(pidFile)) {
      console.log('Zora daemon is not running.');
      return;
    }

    try {
      const pid = parseInt(fs.readFileSync(pidFile, 'utf8').trim(), 10);

      // Send SIGTERM for graceful shutdown
      process.kill(pid, 'SIGTERM');
      console.log(`Sent SIGTERM to Zora daemon (PID: ${pid}). Waiting for graceful shutdown...`);

      // Poll for process exit (up to 5 seconds), then escalate to SIGKILL
      const maxWaitMs = 5000;
      const pollIntervalMs = 200;
      let waited = 0;
      let stopped = false;

      while (waited < maxWaitMs) {
        await new Promise(r => setTimeout(r, pollIntervalMs));
        waited += pollIntervalMs;
        try {
          process.kill(pid, 0); // Check if still alive
        } catch {
          stopped = true;
          break;
        }
      }

      if (!stopped) {
        process.kill(pid, 'SIGKILL');
        console.log('Daemon did not stop gracefully, sent SIGKILL.');
      }

      try {
        fs.unlinkSync(pidFile);
      } catch {
        // Pidfile already removed by daemon
      }
      console.log('Daemon stopped.');
    } catch (err: unknown) {
      // Process doesn't exist, clean up stale pidfile
      try {
        fs.unlinkSync(pidFile);
      } catch {
        // Already removed
      }
      console.log('Daemon was not running (cleaned up stale pidfile).');
    }
  });

// Doctor command - check system dependencies
program
  .command('doctor')
  .description('Check system dependencies and configuration')
  .action(async () => {
    const result = await runDoctorChecks();

    console.log('Zora Doctor Report:');
    console.log(`  Node.js: ${result.node.found ? '✓' : '✗'} ${result.node.version}`);
    console.log(`  Claude CLI: ${result.claude.found ? '✓' : '✗'}${result.claude.path ? ` (${result.claude.path})` : ''}`);
    console.log(`  Gemini CLI: ${result.gemini.found ? '✓' : '✗'}${result.gemini.path ? ` (${result.gemini.path})` : ''}`);

    if (!result.node.found) {
      console.log('\n⚠️  Node.js 20+ is required. Please upgrade.');
    }
    if (!result.claude.found && !result.gemini.found) {
      console.log('\n⚠️  No AI provider CLIs found. Install at least one:');
      console.log('    Claude: npm install -g @anthropic-ai/claude');
      console.log('    Gemini: npm install -g @google/generative-ai-cli');
    }
  });

// Register new command groups
const configDir = path.join(os.homedir(), '.zora');
registerMemoryCommands(program, setupContext);
registerAuditCommands(program, () => path.join(configDir, 'audit.jsonl'));
registerEditCommands(program, configDir);
registerTeamCommands(program, configDir);
registerSteerCommands(program, configDir);
registerSkillCommands(program);
registerInitCommand(program);

program.parse();
