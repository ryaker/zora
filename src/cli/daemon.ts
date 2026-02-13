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
import { OllamaProvider } from '../providers/ollama-provider.js';
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
      case 'ollama':
        providers.push(new OllamaProvider({ config: pConfig }));
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

  // Load policy from TOML using centralized loader
  const { loadPolicy } = await import('../config/policy-loader.js');
  let policy: ZoraPolicy;
  try {
    policy = await loadPolicy(policyPath);
  } catch {
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
    submitTask: async (prompt: string) => {
      // Generate jobId immediately and kick off task in background (don't await)
      const jobId = `job_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
      orchestrator.submitTask({ prompt, jobId, onEvent: (event) => {
        dashboard.broadcastEvent({ type: event.type, data: event.content });
      } }).catch(err => {
        console.error(`[Daemon] Task ${jobId} failed:`, err);
        dashboard.broadcastEvent({ type: 'job_failed', data: { jobId, error: err instanceof Error ? err.message : String(err) } });
      });
      return jobId;
    },
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
