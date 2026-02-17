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
import { resolveConfig } from '../config/loader.js';
import { resolvePolicy } from '../config/policy-loader.js';
import { PolicyEngine } from '../security/policy-engine.js';
import { SessionManager } from '../orchestrator/session-manager.js';
import { SteeringManager } from '../steering/steering-manager.js';
import { MemoryManager } from '../memory/memory-manager.js';
import { Orchestrator } from '../orchestrator/orchestrator.js';
import { ClaudeProvider } from '../providers/claude-provider.js';
import { GeminiProvider } from '../providers/gemini-provider.js';
import { OllamaProvider } from '../providers/ollama-provider.js';
import type { ZoraPolicy, ZoraConfig, LLMProvider, KnownProviderType } from '../types.js';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { registerMemoryCommands } from './memory-commands.js';
import { registerAuditCommands } from './audit-commands.js';
import { registerEditCommands } from './edit-commands.js';
import { registerTeamCommands } from './team-commands.js';
import { registerSteerCommands } from './steer-commands.js';
import { registerSkillCommands } from './skill-commands.js';
import { registerHookCommands } from './hook-commands.js';
import { registerInitCommand } from './init-command.js';
import { runDoctorChecks } from './doctor.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('cli');
const program = new Command();

program
  .name('zora-agent')
  .description('Long-running autonomous personal AI agent')
  .version('0.9.4');

/**
 * Creates LLMProvider instances from config.
 */
function createProviders(config: ZoraConfig): LLMProvider[] {
  const providers: LLMProvider[] = [];

  for (const pConfig of config.providers) {
    if (!pConfig.enabled) continue;

    // TYPE-07: Cast to KnownProviderType for exhaustiveness checking.
    // If a new provider type is added to KnownProviderType, TypeScript
    // will flag the missing case via the `never` check in the default branch.
    const providerType = pConfig.type as KnownProviderType;

    switch (providerType) {
      case 'claude-sdk':
        providers.push(new ClaudeProvider({ config: pConfig }));
        break;
      case 'gemini-cli':
        providers.push(new GeminiProvider({ config: pConfig }));
        break;
      case 'ollama':
        providers.push(new OllamaProvider({ config: pConfig }));
        break;
      default: {
        // Exhaustiveness check: if KnownProviderType gains a new member
        // and we don't add a case, TypeScript reports an error here.
        const _exhaustive: never = providerType;
        log.warn({ type: pConfig.type, name: pConfig.name }, 'Unknown provider type, skipping');
        void _exhaustive;
      }
    }
  }

  return providers;
}

/**
 * Returns the path to the daemon PID file.
 * Uses project .zora/ if it exists in the given dir, else global.
 */
function getPidFilePath(projectDir?: string): string {
  if (projectDir) {
    const projectZora = path.join(projectDir, '.zora');
    if (fs.existsSync(projectZora)) {
      return path.join(projectZora, 'state', 'daemon.pid');
    }
  }
  return path.join(os.homedir(), '.zora', 'state', 'daemon.pid');
}

/**
 * Common setup for commands that need config and services.
 * Uses three-layer config resolution: defaults → global → project.
 */
async function setupContext(projectDir?: string) {
  const cwd = projectDir ?? process.cwd();

  // Three-layer config resolution
  let config: ZoraConfig;
  let sources: string[];
  try {
    const resolved = await resolveConfig({ projectDir: cwd });
    config = resolved.config;
    sources = resolved.sources;
  } catch (err) {
    // If no config at all, give a friendly message
    const globalPath = path.join(os.homedir(), '.zora', 'config.toml');
    if (!fs.existsSync(globalPath)) {
      log.error("Zora isn't configured yet. Run 'zora-agent init' to set up in 2 minutes.");
    } else {
      log.error({ err }, 'Config resolution failed.');
    }
    process.exit(1);
  }

  // Two-layer policy resolution
  let policy: ZoraPolicy;
  try {
    policy = await resolvePolicy({ projectDir: cwd });
  } catch {
    log.error('Policy not found at ~/.zora/policy.toml. Run `zora-agent init` first.');
    process.exit(1);
  }

  // Determine baseDir: project .zora/ if it exists, else global
  const projectZora = path.join(cwd, '.zora');
  const configDir = fs.existsSync(projectZora) ? projectZora : path.join(os.homedir(), '.zora');

  const engine = new PolicyEngine(policy);
  const sessionManager = new SessionManager(configDir);
  const steeringManager = new SteeringManager(configDir);
  await steeringManager.init();

  const memoryManager = new MemoryManager(config.memory, configDir);
  await memoryManager.init();

  return { config, policy, engine, sessionManager, steeringManager, memoryManager, configDir, sources };
}

// R10: Refactored `ask` command to use Orchestrator
program
  .command('ask')
  .description('Send a task to the agent and wait for completion')
  .argument('<prompt>', 'The task or question for the agent')
  .option('-m, --model <model>', 'Provider name to use (e.g., claude-haiku, gemini, ollama)')
  .option('--max-cost-tier <tier>', 'Maximum cost tier: free, included, metered, premium')
  .option('--max-turns <n>', 'Maximum turns', parseInt)
  .action(async (prompt, opts) => {
    const { config, policy } = await setupContext();

    const providers = createProviders(config);
    if (providers.length === 0) {
      log.error('No enabled providers found in config.');
      process.exit(1);
    }

    const orchestrator = new Orchestrator({ config, policy, providers });
    await orchestrator.boot();

    try {
      let spinnerActive = true;
      let streamedText = false;
      const spinner = clack.spinner();
      spinner.start('Running task...');

      const result = await orchestrator.submitTask({
        prompt,
        model: opts.model,
        maxCostTier: opts.maxCostTier,
        maxTurns: opts.maxTurns,
        onEvent: (event) => {
          // Stop spinner on first substantive event so streaming output is visible
          if (spinnerActive && (event.type === 'text' || event.type === 'tool_call' || event.type === 'error')) {
            spinner.stop('Working...');
            spinnerActive = false;
          }

          switch (event.type) {
            case 'text':
              streamedText = true;
              console.log((event.content as { text: string }).text);
              break;
            case 'tool_call': {
              const c = event.content as { tool: string };
              console.log(`\x1b[2m  ▸ ${c.tool}()\x1b[0m`);
              break;
            }
            case 'error':
              log.error({ message: (event.content as { message: string }).message }, 'Task error');
              break;
          }
        },
      });

      if (spinnerActive) {
        spinner.stop('Task complete.');
      }

      // Only print final result if we didn't already stream it
      if (result && !streamedText) {
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
      console.log("Zora isn't set up yet. Run `zora-agent init` to get started in under 2 minutes.");
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

/**
 * Shared daemon start logic — used by both `zora-agent start` and `zora-agent daemon start`.
 */
async function startDaemon(opts: { open?: boolean; project?: string }): Promise<void> {
  const projectDir = opts.project ?? process.cwd();
  const pidFile = getPidFilePath(projectDir);

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
  const { fork, exec } = await import('node:child_process');
  const { fileURLToPath } = await import('node:url');
  const daemonScript = path.join(path.dirname(fileURLToPath(import.meta.url)), 'daemon.js');

  const child = fork(daemonScript, [], {
    detached: true,
    stdio: 'ignore',
    env: { ...process.env, ZORA_PROJECT_DIR: projectDir },
  });

  if (child.pid) {
    fs.writeFileSync(pidFile, String(child.pid), { mode: 0o600 });
    child.unref();
    console.log(`Zora daemon started (PID: ${child.pid}).`);

    // Read dashboard port from resolved config, falling back to 8070
    let dashboardPort = 8070;
    try {
      const { config: resolvedConfig } = await resolveConfig({ projectDir });
      dashboardPort = resolvedConfig.steering.dashboard_port ?? 8070;
    } catch {
      // Use default port if config can't be read
    }
    const dashboardUrl = `http://localhost:${dashboardPort}`;
    console.log(`Dashboard: ${dashboardUrl}`);

    if (opts.open !== false) {
      const openCmd = process.platform === 'darwin' ? `open ${dashboardUrl}` :
                      process.platform === 'win32' ? `start "" ${dashboardUrl}` :
                      `xdg-open ${dashboardUrl}`;
      exec(openCmd, () => {});
    }
  } else {
    log.error('Failed to start daemon');
  }
}

/**
 * Shared daemon stop logic — used by both `zora-agent stop` and `zora-agent daemon stop`.
 */
async function stopDaemon(): Promise<void> {
  const pidFile = getPidFilePath();

  if (!fs.existsSync(pidFile)) {
    console.log('Zora daemon is not running.');
    return;
  }

  try {
    const pid = parseInt(fs.readFileSync(pidFile, 'utf8').trim(), 10);

    process.kill(pid, 'SIGTERM');
    console.log(`Sent SIGTERM to Zora daemon (PID: ${pid}). Waiting for graceful shutdown...`);

    const maxWaitMs = 5000;
    const pollIntervalMs = 200;
    let waited = 0;
    let stopped = false;

    while (waited < maxWaitMs) {
      await new Promise(r => setTimeout(r, pollIntervalMs));
      waited += pollIntervalMs;
      try {
        process.kill(pid, 0);
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
    try {
      fs.unlinkSync(pidFile);
    } catch {
      // Already removed
    }
    console.log('Daemon was not running (cleaned up stale pidfile).');
  }
}

// R11: Real start command
program
  .command('start')
  .description('Start the agent daemon')
  .option('--project <dir>', 'Project directory with .zora/ config')
  .option('--no-open', 'Do not auto-open the dashboard in browser')
  .action(async (opts) => startDaemon(opts));

// R12: Real stop command
program
  .command('stop')
  .description('Stop the agent daemon')
  .action(async () => stopDaemon());

// Daemon command group — `daemon start`, `daemon stop`, `daemon status`
const daemonCmd = program
  .command('daemon')
  .description('Manage the agent daemon');

daemonCmd
  .command('start')
  .description('Start the agent daemon')
  .option('--project <dir>', 'Project directory with .zora/ config')
  .option('--no-open', 'Do not auto-open the dashboard in browser')
  .action(async (opts) => startDaemon(opts));

daemonCmd
  .command('stop')
  .description('Stop the agent daemon')
  .action(async () => stopDaemon());

daemonCmd
  .command('status')
  .description('Check daemon status')
  .action(async () => {
    await program.commands.find(c => c.name() === 'status')!.parseAsync([], { from: 'user' });
  });

// Doctor command - check system dependencies
program
  .command('doctor')
  .description('Check system dependencies and configuration')
  .option('--project <dir>', 'Project directory to check')
  .action(async (opts) => {
    const result = await runDoctorChecks();

    console.log('Zora Doctor Report:');
    console.log('');
    console.log('Dependencies:');
    console.log(`  Node.js: ${result.node.found ? '✓' : '✗'} ${result.node.version}`);
    console.log(`  Claude CLI: ${result.claude.found ? '✓' : '✗'}${result.claude.path ? ` (${result.claude.path})` : ''}`);
    console.log(`  Gemini CLI: ${result.gemini.found ? '✓' : '✗'}${result.gemini.path ? ` (${result.gemini.path})` : ''}`);

    // Config resolution — show which files are loaded
    console.log('');
    console.log('Config sources:');
    try {
      const projectDir = opts.project ?? process.cwd();
      const { sources } = await resolveConfig({ projectDir });
      sources.forEach((src, i) => {
        const label = src === 'defaults' ? 'defaults (built-in)' : src;
        console.log(`  ${i + 1}. ${label}`);
      });
    } catch {
      console.log('  (unable to resolve config — run `zora-agent init` first)');
    }

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
registerHookCommands(program, configDir);
registerInitCommand(program);

program.parse();
