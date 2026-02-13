#!/usr/bin/env node
/**
 * Zora Daemon — Background process that runs the Orchestrator and Dashboard.
 *
 * Launched by `zora start` via child_process.fork().
 * Handles SIGTERM/SIGINT for graceful shutdown.
 */

import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { loadConfig } from '../config/loader.js';
import { Orchestrator } from '../orchestrator/orchestrator.js';
import { DashboardServer } from '../dashboard/server.js';
import { ClaudeProvider } from '../providers/claude-provider.js';
import { GeminiProvider } from '../providers/gemini-provider.js';
import type { ZoraPolicy, ZoraConfig, LLMProvider } from '../types.js';

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
    }
  }
  return providers;
}

async function main() {
  const configDir = path.join(os.homedir(), '.zora');
  const configPath = path.join(configDir, 'config.toml');
  const policyPath = path.join(configDir, 'policy.toml');

  if (!fs.existsSync(configPath)) {
    console.error('Config not found. Run `zora init` first.');
    process.exit(1);
  }

  const config = await loadConfig(configPath);

  // Load or create default policy
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

  const providers = createProviders(config);
  const orchestrator = new Orchestrator({ config, policy, providers });
  await orchestrator.boot();

  // Start dashboard server
  const dashboard = new DashboardServer({
    // loop is optional — the Orchestrator owns the execution loop directly
    sessionManager: orchestrator.sessionManager,
    steeringManager: orchestrator.steeringManager,
    authMonitor: orchestrator.authMonitor,
    port: config.steering.dashboard_port ?? 7070,
    host: process.env.ZORA_BIND_HOST,
  });
  await dashboard.start();

  console.log('[Daemon] Zora daemon is running.');

  // Graceful shutdown handler
  const shutdown = async (signal: string) => {
    console.log(`[Daemon] Received ${signal}, shutting down...`);
    try {
      await dashboard.stop();
      await orchestrator.shutdown();
    } catch (err) {
      console.error(`[Daemon] Error during shutdown:`, err instanceof Error ? err.message : String(err));
    }

    // Remove pidfile
    const pidFile = path.join(configDir, 'state', 'daemon.pid');
    try {
      fs.unlinkSync(pidFile);
    } catch {
      // Already removed
    }

    process.exit(0);
  };

  process.on('SIGTERM', () => { shutdown('SIGTERM').catch(err => { console.error('[Daemon] Shutdown error:', err); process.exit(1); }); });
  process.on('SIGINT', () => { shutdown('SIGINT').catch(err => { console.error('[Daemon] Shutdown error:', err); process.exit(1); }); });
}

main().catch((err) => {
  console.error('[Daemon] Fatal error:', err);
  process.exit(1);
});
