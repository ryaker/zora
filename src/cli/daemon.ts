#!/usr/bin/env node
/**
 * Zora Daemon — Background process that runs the Orchestrator and Dashboard.
 *
 * Launched by `zora-agent start` via child_process.fork().
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
import { createLogger } from '../utils/logger.js';
import { TelegramGateway } from '../steering/telegram-gateway.js';
import type { TelegramConfig } from '../steering/telegram-gateway.js';

const log = createLogger('daemon');

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
    log.error('Config not found. Run `zora-agent init` first.');
    process.exit(1);
  }

  const config = await loadConfig(configPath);

  // Load policy from TOML using centralized loader
  const { loadPolicy } = await import('../config/policy-loader.js');
  let policy: ZoraPolicy;
  try {
    policy = await loadPolicy(policyPath);
  } catch {
    log.error('Policy not found at ~/.zora/policy.toml. Run `zora-agent init` first.');
    process.exit(1);
  }

  const providers = createProviders(config);
  const orchestrator = new Orchestrator({ config, policy, providers });
  await orchestrator.boot();

  // Start dashboard server
  const dashboard = new DashboardServer({
    providers,
    sessionManager: orchestrator.sessionManager,
    steeringManager: orchestrator.steeringManager,
    authMonitor: orchestrator.authMonitor,
    submitTask: async (prompt: string) => {
      // Generate jobId immediately and kick off task in background (don't await)
      const jobId = `job_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
      orchestrator.submitTask({ prompt, jobId, onEvent: (event) => {
        dashboard.broadcastEvent({ type: event.type, data: event.content });
      } }).catch(err => {
        log.error({ jobId, err }, 'Task failed');
        dashboard.broadcastEvent({ type: 'job_failed', data: { jobId, error: err instanceof Error ? err.message : String(err) } });
      });
      return jobId;
    },
    port: config.steering.dashboard_port ?? 8070,
    host: process.env.ZORA_BIND_HOST,
  });
  await dashboard.start();

  // Initialize Telegram gateway if enabled and configured
  let telegramGateway: TelegramGateway | undefined;
  const telegramConfig = config.steering.telegram;
  if (telegramConfig?.enabled) {
    const token = telegramConfig.bot_token || process.env.TELEGRAM_BOT_TOKEN;
    if (!token) {
      log.warn('Telegram enabled but no bot_token configured and TELEGRAM_BOT_TOKEN not set. Skipping.');
    } else {
      log.warn(
        'Telegram: Ensure you are using a dedicated bot token for this Zora instance. ' +
        'Sharing a bot token across multiple processes causes polling conflicts and lost messages.'
      );
      try {
        const fullTelegramConfig: TelegramConfig = {
          ...config.steering,
          ...telegramConfig,
          bot_token: token,
        };
        telegramGateway = await TelegramGateway.create(
          fullTelegramConfig,
          orchestrator.steeringManager,
        );
        log.info({ mode: telegramConfig.mode ?? 'polling' }, 'Telegram gateway started');
      } catch (err) {
        log.error({ err }, 'Failed to start Telegram gateway');
      }
    }
  }

  log.info('Zora daemon is running');

  // Graceful shutdown handler
  const shutdown = async (signal: string) => {
    log.info({ signal }, 'Received signal, shutting down');
    try {
      if (telegramGateway) {
        await telegramGateway.stop();
      }
      await dashboard.stop();
      await orchestrator.shutdown();
    } catch (err) {
      log.error({ err: err instanceof Error ? err.message : String(err) }, 'Error during shutdown');
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

  process.on('SIGTERM', () => { shutdown('SIGTERM').catch(err => { log.error({ err }, 'Shutdown error'); process.exit(1); }); });
  process.on('SIGINT', () => { shutdown('SIGINT').catch(err => { log.error({ err }, 'Shutdown error'); process.exit(1); }); });
}

main().catch((err) => {
  log.fatal({ err }, 'Fatal error');
  process.exit(1);
});
