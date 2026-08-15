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
import { EchoProvider } from '../providers/echo-provider.js';
import type { ZoraPolicy, ZoraConfig, LLMProvider } from '../types.js';
import { createLogger, initLogger } from '../utils/logger.js';
import { expandHome } from '../utils/fs.js';
import { ChannelIdentityRegistry } from '../channels/channel-identity-registry.js';
import { ChannelPolicyGate } from '../channels/channel-policy-gate.js';
import { CapabilityResolver } from '../channels/capability-resolver.js';
import { QuarantineProcessor } from '../channels/quarantine-processor.js';
import { ChannelAuditLog } from '../channels/channel-audit-log.js';
import { ChannelManager } from '../channels/channel-manager.js';
import { WebhookServer } from '../channels/webhook-server.js';
import { MailboxChannelAdapter } from '../channels/team/mailbox-channel-adapter.js';
import { TeamManager } from '../teams/team-manager.js';
import { BridgeWatchdog } from '../teams/bridge-watchdog.js';
import { Mailbox } from '../teams/mailbox.js';
import { WebhookValidatorRegistry, createTelegramValidator } from '../channels/webhook-signatures.js';
import { SignalIntakeAdapter } from '../channels/signal/signal-intake-adapter.js';
import { SignalAdapter } from '../channels/signal/signal-adapter.js';
import { TelegramAdapter } from '../channels/telegram/telegram-adapter.js';
import { AgentBusClient } from '../integrations/agentbus/agentbus-client.js';
import { ApprovalQueue, approvalConfigFrom } from '../core/approval-queue.js';
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

/**
 * SEC-23: `policy` is required — see the matching comment in cli/index.ts. It
 * is the source of the static `disallowedTools` ban that sits ahead of the
 * dynamic gates.
 */
function createProviders(config: ZoraConfig, policy: ZoraPolicy): LLMProvider[] {
  const providers: LLMProvider[] = [];
  // PROV-10: see the matching comment in cli/index.ts. The daemon is the worse
  // case — it is typically started from whatever shell the user happened to be
  // in, or from a service manager's root directory.
  const workspace = expandHome(config.agent.workspace);
  for (const pConfig of config.providers) {
    if (!pConfig.enabled) continue;
    switch (pConfig.type) {
      case 'claude-sdk':
        // SEC-20 / SEC-23: explicit — see the matching comment in cli/index.ts.
        providers.push(new ClaudeProvider({ config: pConfig, permissionMode: 'default', cwd: workspace, policy }));
        break;
      case 'gemini-cli':
        providers.push(new GeminiProvider({ config: pConfig, cwd: workspace }));
        break;
      case 'ollama':
        providers.push(new OllamaProvider({ config: pConfig }));
        break;
      case 'echo':
        providers.push(new EchoProvider({ config: pConfig }));
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

  // Wire agent.log_level early so all subsequent log calls use the correct level
  initLogger({ level: config.agent.log_level }, /* force= */ true);

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

  // SEC-29: AgentCooldown and MemoryRiskForecaster are initialized in
  // Orchestrator.boot() now, not here. Configuring a process-global singleton
  // from one entry point is how `zora-agent ask` ended up without either of
  // them while the daemon had both.

  // Initialize ApprovalQueue BEFORE orchestrator boot so the send handler
  // is in place if any actions arrive during the startup window.
  // SEC-27: the parsing of this block, and the steering.auto_approve_low_risk
  // blanket-allow that used to follow it here, both moved to
  // `Orchestrator.boot()` so the `zora-agent ask` path gets the same gate. The
  // daemon still constructs its own queue because it has something the ask path
  // does not — a Telegram send handler to deliver approval requests through —
  // and it must exist before boot() so that handler is wired for any action
  // arriving in the startup window.
  const approvalQueue = new ApprovalQueue(
    approvalConfigFrom((config as unknown as Record<string, unknown>)['approval']),
  );

  const providers = createProviders(config, policy);
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
  // INVARIANT-10: only constructed when a platform delivers by webhook AND has
  // a signature validator to authenticate it.
  let webhookServer: WebhookServer | undefined;
  // ERR-21: one per team mailbox channel, stopped on shutdown.
  const teamWatchdogs: BridgeWatchdog[] = [];

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
      // INVARIANT-10: webhook mode needs a secret token to authenticate
      // deliveries. Resolved before the adapter is built so a misconfigured
      // webhook setup fails at boot instead of starting a bot whose updates
      // can never arrive.
      const telegramWebhookMode = telegramConfig?.mode === 'webhook';
      const telegramWebhookSecret =
        telegramConfig?.webhook_secret || process.env['TELEGRAM_WEBHOOK_SECRET_TOKEN'];
      if (telegramWebhookMode && !telegramWebhookSecret) {
        // INVARIANT-10 (review finding): this must not be a `throw`. It sits
        // inside the try that wraps channel initialisation, whose catch logs
        // and lets startup continue — so a throw here silently disabled Signal,
        // Telegram and every team channel while the operator was told the
        // daemon "refuses to start". Fail-closed held by luck (webhookServer is
        // constructed later and never reached); the failure mode was wrong.
        // Exit, which is what the documentation promises.
        log.fatal(
          'steering.telegram.mode = "webhook" requires steering.telegram.webhook_secret ' +
            '(or TELEGRAM_WEBHOOK_SECRET_TOKEN). Without it the webhook endpoint cannot tell a ' +
            'genuine Telegram delivery from anyone who finds the URL, so Zora will not open one. ' +
            'Use the same value in setWebhook. Set mode = "polling" if you do not want a webhook.',
        );
        process.exit(1);
      }

      if (telegramConfig?.enabled) {
        const token = telegramConfig.bot_token || process.env.TELEGRAM_BOT_TOKEN;
        if (token) {
          const telegramAdapter = new TelegramAdapter(token, {
            mode: telegramWebhookMode ? 'webhook' : 'polling',
          });
          await channelManager.registerAdapter(telegramAdapter);
          telegramRegistered = true;
        } else {
          log.warn('Telegram enabled but no bot_token found. Skipping adapter.');
        }
      }

      // 3. Team mailboxes — INVARIANT-9.
      // A task in an agent's inbox is untrusted input from a third party that
      // makes Zora act, so it goes through the same pipeline as Signal and
      // Telegram rather than being run directly the way GeminiBridge did.
      //
      // Which inbox is "ours" is decided by membership, not by new config:
      // Zora drains the inbox of the agent bearing its own name, in every team
      // that lists it as an active member. Draining another member's inbox
      // would mean acting as that agent.
      const teamAdapterNames: string[] = [];
      try {
        const teamManager = new TeamManager(configDir);
        for (const team of await teamManager.listTeams()) {
          if (!team.members.some((m) => m.name === config.agent.name && m.isActive)) continue;
          const teamAdapter = new MailboxChannelAdapter({
            teamName: team.name,
            agentName: config.agent.name,
            mailbox: new Mailbox(teamManager.teamsDir, config.agent.name),
          });
          await channelManager.registerAdapter(teamAdapter);
          teamAdapterNames.push(teamAdapter.name);

          // ERR-21: supervise the poller. A team inbox that silently stops
          // draining looks exactly like an idle team, so nothing would report
          // it. The health file is per team, since one process may drain
          // several and a shared file would let one team's heartbeat vouch for
          // another's.
          const watchdog = new BridgeWatchdog(teamAdapter, {
            healthCheckIntervalMs: 30_000,
            maxStaleMs: 120_000,
            maxRestarts: 5,
            stateDir: path.join(configDir, 'state', 'teams', team.name),
          });
          await watchdog.start();
          teamWatchdogs.push(watchdog);
        }
      } catch (err) {
        // A broken teams directory must not stop Signal and Telegram starting.
        log.error({ err }, 'Failed to register team mailbox channels');
      }

      await channelManager.start();

      // 4. Webhook listener — INVARIANT-10.
      // Started only for platforms that both deliver by webhook and have a
      // signature validator. Registering a validator is what authorises a
      // platform's route, so the server is never running with a route it
      // cannot authenticate.
      if (telegramRegistered && telegramWebhookMode) {
        const validators = new WebhookValidatorRegistry();
        validators.register(createTelegramValidator(telegramWebhookSecret!));
        webhookServer = new WebhookServer(
          channelManager,
          validators,
          telegramConfig?.webhook_port ?? 8080,
        );
        await webhookServer.start();
      }
      const activeAdapters = [];
      if (signalPhone) activeAdapters.push('signal');
      if (telegramRegistered) activeAdapters.push('telegram');
      activeAdapters.push(...teamAdapterNames);
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
        for (const watchdog of teamWatchdogs) {
          watchdog.stop();
        }
        if (webhookServer) {
          await webhookServer.stop();
        }
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
