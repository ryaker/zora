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
import crypto from 'node:crypto';
import { resolveConfig } from '../config/loader.js';
import { resolvePolicy } from '../config/policy-loader.js';
import { Orchestrator } from '../orchestrator/orchestrator.js';
import { DashboardServer } from '../dashboard/server.js';
import { ClaudeProvider } from '../providers/claude-provider.js';
import { GeminiProvider } from '../providers/gemini-provider.js';
import { OllamaProvider } from '../providers/ollama-provider.js';
import type { ZoraPolicy, ZoraConfig, LLMProvider } from '../types.js';
import { createLogger } from '../utils/logger.js';
import { ChannelIdentityRegistry } from '../channels/channel-identity-registry.js';
import { ChannelPolicyGate } from '../channels/channel-policy-gate.js';
import { CapabilityResolver } from '../channels/capability-resolver.js';
import { QuarantineProcessor } from '../channels/quarantine-processor.js';
import { ChannelAuditLog } from '../channels/channel-audit-log.js';
import { ChannelManager } from '../channels/channel-manager.js';
import { SignalIntakeAdapter } from '../channels/signal/signal-intake-adapter.js';
import { SignalAdapter } from '../channels/signal/signal-adapter.js';
import { TelegramAdapter } from '../channels/telegram/telegram-adapter.js';
import { AgentBusClient } from '../integrations/agentbus/agentbus-client.js';
import { ApprovalQueue, DEFAULT_APPROVAL_CONFIG } from '../core/approval-queue.js';
import { initGlobalCooldown, DEFAULT_COOLDOWN_CONFIG } from '../core/agent-cooldown.js';
import { initGlobalForecaster, DEFAULT_FORECASTER_CONFIG } from '../core/memory-risk-forecaster.js';
import { runSecurityAuditSilent } from './security-commands.js';
import { TelegramGateway, type TelegramConfig } from '../steering/telegram-gateway.js';

// Allow claude CLI to run as a subprocess even when launched from a Claude Code session.
// Claude Code sets CLAUDECODE to prevent nesting, but the Zora daemon legitimately
// needs to invoke claude as a provider subprocess.
delete process.env['CLAUDECODE'];
delete process.env['CLAUDE_CODE_ENTRYPOINT'];
delete process.env['CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS'];

// Prevent EPIPE from crashing the process (e.g. broken pipe to signal-cli stdin/stdout).
// Log and continue — the intake adapter's reconnect logic handles the actual recovery.
// Note: log is not yet initialized here — use console to avoid silent crash.
process.on('uncaughtException', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EPIPE') {
    console.warn('[daemon] EPIPE — signal-cli pipe broken; reconnect will handle it');
  } else {
    console.error('[daemon] Uncaught exception:', err);
    process.exit(1);
  }
});

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
  // Resolve project directory from env (set by CLI start command) or cwd.
  // path.resolve() normalizes relative paths (e.g. ZORA_PROJECT_DIR=".") to absolute.
  const projectDir = path.resolve(process.env.ZORA_PROJECT_DIR ?? process.cwd());

  // Three-layer config resolution: defaults → global → project
  // ZORA_CONFIG_DIR env var is read directly by resolveConfig (no need to pass explicitly)
  let config: ZoraConfig;
  let sources: string[];
  try {
    const resolved = await resolveConfig({ projectDir });
    config = resolved.config;
    sources = resolved.sources;
  } catch (err) {
    log.error({ err }, 'Config resolution failed. Run `zora-agent init` first.');
    process.exit(1);
  }
  log.info({ sources }, 'Config resolved');

  // Two-layer policy resolution: global → project
  let policy: ZoraPolicy;
  try {
    policy = await resolvePolicy({ projectDir });
  } catch {
    log.error('Policy not found at ~/.zora/policy.toml. Run `zora-agent init` first.');
    process.exit(1);
  }

  // Determine baseDir: project .zora/ if it exists, else global
  const projectZora = path.join(projectDir, '.zora');
  const configDir = fs.existsSync(projectZora) ? projectZora : path.join(os.homedir(), '.zora');

  // Security audit gate — block on FAILs unless explicitly skipped
  const skipAudit = process.env['ZORA_SKIP_SECURITY_AUDIT'] === '1';
  if (skipAudit) {
    log.warn('Security audit skipped (ZORA_SKIP_SECURITY_AUDIT=1) — running with potentially unsafe configuration');
  } else {
    const { exitCode: auditExitCode, report: auditReport } = await runSecurityAuditSilent({ zoraDir: configDir });
    const failItems = auditReport.checks.filter(c => c.severity === 'FAIL');
    const warnItems = auditReport.checks.filter(c => c.severity === 'WARN');

    if (warnItems.length > 0) {
      for (const w of warnItems) {
        const loc = w.location ? ` (${w.location})` : '';
        log.warn({ checkId: w.id }, `Security WARN: ${w.message}${loc}`);
      }
    }

    if (auditExitCode === 1) {
      for (const f of failItems) {
        const loc = f.location ? ` (${f.location})` : '';
        log.fatal({ checkId: f.id }, `Security FAIL: ${f.message}${loc}`);
      }
      log.fatal(
        { failCount: failItems.length },
        'Daemon startup blocked: security audit found critical issues. ' +
        'Fix them with `zora-agent security --fix` or set ZORA_SKIP_SECURITY_AUDIT=1 to bypass (unsafe).'
      );
      process.exit(1);
    }

    log.info({ passCount: auditReport.passCount, warnCount: auditReport.warnCount }, 'Security audit passed');
  }

  // Initialize AgentCooldown singleton before orchestrator so subagent-tool can pick it up
  const cooldownConfig = (config as unknown as Record<string, unknown>)['cooldown'] as Record<string, unknown> | undefined;
  initGlobalCooldown({
    ...DEFAULT_COOLDOWN_CONFIG,
    ...(cooldownConfig ? {
      enabled: (cooldownConfig['enabled'] as boolean) ?? false,
      level1Threshold: (typeof cooldownConfig['level1_threshold'] === 'number' && Number.isFinite(cooldownConfig['level1_threshold']))
        ? cooldownConfig['level1_threshold'] : 3,
      level2Threshold: (typeof cooldownConfig['level2_threshold'] === 'number' && Number.isFinite(cooldownConfig['level2_threshold']))
        ? cooldownConfig['level2_threshold'] : 6,
      shutdownThreshold: (typeof cooldownConfig['shutdown_threshold'] === 'number' && Number.isFinite(cooldownConfig['shutdown_threshold']))
        ? cooldownConfig['shutdown_threshold'] : 10,
      resetAfterHours: (typeof cooldownConfig['reset_after_hours'] === 'number' && Number.isFinite(cooldownConfig['reset_after_hours']))
        ? cooldownConfig['reset_after_hours'] : 24,
      level1DelayMs: (typeof cooldownConfig['level1_delay_ms'] === 'number' && Number.isFinite(cooldownConfig['level1_delay_ms']))
        ? cooldownConfig['level1_delay_ms'] : 2000,
    } : {}),
  });

  // Initialize MemoryRiskForecaster singleton before orchestrator
  const forecasterConfig = (config as unknown as Record<string, unknown>)['risk_forecaster'] as Record<string, unknown> | undefined;
  initGlobalForecaster({
    ...DEFAULT_FORECASTER_CONFIG,
    ...(forecasterConfig ? {
      enabled: (forecasterConfig['enabled'] as boolean) ?? false,
      interceptThreshold: (typeof forecasterConfig['intercept_threshold'] === 'number' && Number.isFinite(forecasterConfig['intercept_threshold']))
        ? forecasterConfig['intercept_threshold']
        : 72,
      autoDenyThreshold: (typeof forecasterConfig['auto_deny_threshold'] === 'number' && Number.isFinite(forecasterConfig['auto_deny_threshold']))
        ? forecasterConfig['auto_deny_threshold']
        : 88,
      maxEvents: (typeof forecasterConfig['max_events'] === 'number' && Number.isFinite(forecasterConfig['max_events']))
        ? forecasterConfig['max_events']
        : 50,
    } : {}),
  });

  // Initialize ApprovalQueue BEFORE orchestrator boot so the send handler
  // is in place if any actions arrive during the startup window.
  const approvalConfig = (config as unknown as Record<string, unknown>)['approval'] as Record<string, unknown> | undefined;
  const approvalQueue = new ApprovalQueue({
    ...DEFAULT_APPROVAL_CONFIG,
    ...(approvalConfig ? {
      enabled: (approvalConfig['enabled'] as boolean) ?? false,
      timeoutMs: (() => {
        const raw = approvalConfig['timeout_s'] as number | undefined;
        const s = typeof raw === 'number' && Number.isFinite(raw) && raw > 0 ? raw : 300;
        return s * 1000;
      })(),
    } : {}),
  });

  const providers = createProviders(config);
  const orchestrator = new Orchestrator({ config, policy, providers, baseDir: configDir });

  // SEC-FIX-2: Register ApprovalQueue before boot() so PolicyEngine has an enforcement
  // path for always_flag actions even when no flagCallback is wired.
  orchestrator.setApprovalQueue(approvalQueue);

  // Wire ApprovalQueue into SkillSynthesizer BEFORE boot() so any skill synthesized
  // during the startup window already has a queue in place. Moving this after boot()
  // would leave a race window where a completing task silently drops the skill.
  orchestrator.skillSynthesizer.setApprovalQueue(approvalQueue);

  await orchestrator.boot();

  // Register with AgentBus (best-effort — failure doesn't block startup)
  const agentBusClient = new AgentBusClient({
    project: config.project?.name ?? config.agent.name,
    folderPath: projectDir,
  });
  agentBusClient.register(); // non-blocking — failure never delays startup

  // Wire TelegramGateway into the steering subsystem (HITL /steer, /status, /approve).
  // This is separate from TelegramAdapter (ChannelManager general messaging).
  // Runs daemon-only; skipped in one-shot `ask` mode via the enabled guard.
  // Skip if channel-policy.toml is present — TelegramAdapter (via ChannelManager) will
  // handle Telegram in that case; starting both would cause dual long-poll on the same token.
  const channelPolicyExistsForGateway = fs.existsSync(path.join(configDir, 'config', 'channel-policy.toml'));
  let telegramGateway: TelegramGateway | undefined;
  const telegramCfg = config.steering.telegram;
  if (telegramCfg?.enabled && !channelPolicyExistsForGateway) {
    const token = telegramCfg.bot_token || process.env['TELEGRAM_BOT_TOKEN'];
    if (!token) {
      log.warn('steering.telegram.enabled=true but TELEGRAM_BOT_TOKEN is not set — TelegramGateway disabled');
    } else {
      try {
        const gatewayConfig: TelegramConfig = {
          ...config.steering,
          bot_token: token,
          allowed_users: telegramCfg.allowed_users,
          enabled: true,
          mode: telegramCfg.mode ?? 'polling',
          project_dir: projectDir,
        };
        telegramGateway = await TelegramGateway.create(
          gatewayConfig,
          orchestrator.steeringManager,
          orchestrator.sessionManager,
        );
        // Connect ApprovalQueue so /approve commands reach the gate
        if (approvalQueue.isEnabled()) {
          telegramGateway.connectApprovalQueue(approvalQueue);
          log.info('ApprovalQueue wired to TelegramGateway');
        }
        log.info({ allowedUsers: (telegramCfg.allowed_users?.length ?? 0) }, 'TelegramGateway online (steering HITL)');
      } catch (err) {
        log.error({ err: err instanceof Error ? err.message : String(err) }, 'TelegramGateway failed to start — continuing without it');
        telegramGateway = undefined;
      }
    }
  }

  // Start dashboard server
  const dashboard = new DashboardServer({
    providers,
    sessionManager: orchestrator.sessionManager,
    steeringManager: orchestrator.steeringManager,
    authMonitor: orchestrator.authMonitor,
    costTracker: orchestrator.getTLCICostTracker?.(),
    policy,
    submitTask: async (prompt: string) => {
      // Generate jobId immediately and kick off task in background (don't await)
      const jobId = `job_${crypto.randomUUID()}`;
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
    projectConfig: config.project,
    agentName: config.agent.name,
  });
  await dashboard.start();

  // Multi-channel secure architecture (IChannelAdapter + ChannelManager + Quarantine)
  let channelManager: ChannelManager | undefined;

  const channelPolicyPath = path.join(configDir, 'config', 'channel-policy.toml');
  if (fs.existsSync(channelPolicyPath)) {
    try {
      const registry = await ChannelIdentityRegistry.load(channelPolicyPath);
      registry.listenForReload();

      const casbinModelPath = path.join(configDir, 'config', 'casbin', 'model.conf');
      const gate = new ChannelPolicyGate(registry, casbinModelPath);
      await gate.init();

      const resolver = new CapabilityResolver(registry, gate);
      const quarantine = new QuarantineProcessor(registry.getQuarantineModel());
      const audit = new ChannelAuditLog(configDir);

      channelManager = new ChannelManager(orchestrator, gate, resolver, quarantine, audit);

      // 1. Signal
      const signalConfig = registry.getSignalConfig();
      const signalPhone = signalConfig?.phone_number ?? process.env['ZORA_SIGNAL_PHONE'];
      if (signalPhone) {
        const rawCliPath = signalConfig?.signal_cli_path;
        const cliPath = rawCliPath ? rawCliPath.replace(/^~/, os.homedir()) : undefined;
        const intake = new SignalIntakeAdapter(signalPhone, cliPath);
        const signalAdapter = new SignalAdapter(intake);
        await channelManager.registerAdapter(signalAdapter);
      }

      // 2. Telegram
      let telegramRegistered = false;
      const telegramConfig = config.steering.telegram;
      if (telegramConfig?.enabled) {
        const token = telegramConfig.bot_token || process.env.TELEGRAM_BOT_TOKEN;
        if (token) {
          const telegramAdapter = new TelegramAdapter(token);
          await channelManager.registerAdapter(telegramAdapter);
          telegramRegistered = true;
        } else {
          log.warn('Telegram enabled but no bot_token found. Skipping adapter.');
        }
      }

      await channelManager.start();
      const activeAdapters = [];
      if (signalPhone) activeAdapters.push('signal');
      if (telegramRegistered) activeAdapters.push('telegram');
      log.info({ adapters: activeAdapters.join(', ') }, 'Multi-channel architecture online');

      // ApprovalQueue is wired into PolicyEngine via orchestrator.setApprovalQueue() above.
      // The send-handler transport (ChannelManager → ApprovalQueue) is not yet implemented.
      // IMPORTANT: Until a send-handler is registered, ApprovalQueue.request() operates in
      // deny-by-default mode — all always_flag actions will be auto-denied immediately.
      // Wire the ChannelManager send-handler before deploying to production to enable
      // interactive approval. Operators who need the previous warn+allow behavior can
      // temporarily remove the always_flag entries from channel-policy.toml.
      if (approvalQueue.isEnabled()) {
        log.warn(
          'ApprovalQueue enabled (deny-by-default) — always_flag actions will be auto-denied until ChannelManager send-handler is registered',
        );
      }
    } catch (err) {
      log.error({ err }, 'Failed to initialize multi-channel architecture');
    }
  } else {
    log.info('No channel-policy.toml found — multi-channel architecture disabled');
  }

  log.info('Zora daemon is running');

  // Graceful shutdown handler with 30-second timeout
  const SHUTDOWN_TIMEOUT_MS = 30_000;

  const cleanupPidFile = () => {
    const pidFile = path.join(configDir, 'state', 'daemon.pid');
    try {
      fs.unlinkSync(pidFile);
    } catch {
      // Already removed
    }
  };

  const shutdown = async (signal: string) => {
    log.info({ signal }, 'Received signal, shutting down');

    const graceful = async () => {
      if (telegramGateway) {
        try { await telegramGateway.stop(); } catch (err) { log.warn({ err }, 'Telegram gateway stop error'); }
        telegramGateway = undefined;
      }
      try {
        if (channelManager) {
          await channelManager.stop();
        }
        await agentBusClient.deregister();
        await dashboard.stop();
        await orchestrator.shutdown();
      } catch (err) {
        log.error({ err: err instanceof Error ? err.message : String(err) }, 'Error during shutdown');
      }
    };

    const timeout = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Shutdown timed out after 30 seconds')), SHUTDOWN_TIMEOUT_MS);
    });

    try {
      await Promise.race([graceful(), timeout]);
    } catch (err) {
      log.error({ err: err instanceof Error ? err.message : String(err) }, 'Shutdown timeout — forcing exit');
      cleanupPidFile();
      process.exit(1);
    }

    cleanupPidFile();
    process.exit(0);
  };

  process.on('SIGTERM', () => { shutdown('SIGTERM').catch(err => { log.error({ err }, 'Shutdown error'); process.exit(1); }); });
  process.on('SIGINT', () => { shutdown('SIGINT').catch(err => { log.error({ err }, 'Shutdown error'); process.exit(1); }); });
}

main().catch((err) => {
  log.fatal({ err }, 'Fatal error');
  process.exit(1);
});
