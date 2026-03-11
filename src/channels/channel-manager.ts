/**
 * ChannelManager — Orchestrates the secure message pipeline for all channels.
 *
 * Single pipeline:
 *   policy gate → capability resolver → quarantine → orchestrator → response.
 *
 * Every channel (Signal, Telegram, etc.) uses this path. No bypass.
 *
 * INVARIANT-9: All channels use ChannelManager.handleMessage() — no bypass path.
 */

import { ChannelMessage } from '../types/channel.js';
import { IChannelAdapter } from './channel-adapter.js';
import { ChannelPolicyGate } from './channel-policy-gate.js';
import { CapabilityResolver } from './capability-resolver.js';
import { QuarantineProcessor } from './quarantine-processor.js';
import { ChannelAuditLog } from './channel-audit-log.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('channel-manager');

/** Interface for the Orchestrator's submitTask method used by ChannelManager */
interface TaskSubmittable {
  submitTask(options: {
    prompt: string;
    channelContext: {
      capability: any;
      channelMessage: ChannelMessage;
    };
    onEvent: (event: any) => void;
  }): Promise<string>;
}

export class ChannelManager {
  private readonly _adapters = new Map<string, IChannelAdapter>();
  private readonly _orchestrator: TaskSubmittable;
  private readonly _gate: ChannelPolicyGate;
  private readonly _resolver: CapabilityResolver;
  private readonly _quarantine: QuarantineProcessor;
  private readonly _audit: ChannelAuditLog | null;

  constructor(
    orchestrator: TaskSubmittable,
    gate: ChannelPolicyGate,
    resolver: CapabilityResolver,
    quarantine: QuarantineProcessor,
    audit: ChannelAuditLog | null = null
  ) {
    this._orchestrator = orchestrator;
    this._gate = gate;
    this._resolver = resolver;
    this._quarantine = quarantine;
    this._audit = audit;
  }

  /**
   * Register a communication adapter and start its message listener.
   */
  async registerAdapter(adapter: IChannelAdapter): Promise<void> {
    if (this._adapters.has(adapter.name)) {
      throw new Error(`Channel adapter '${adapter.name}' already registered`);
    }

    this._adapters.set(adapter.name, adapter);
    adapter.onMessage(async (msg) => {
      await this.handleMessage(adapter, msg);
    });

    log.info({ adapter: adapter.name }, 'Channel adapter registered');
  }

  /**
   * Start all registered adapters.
   */
  async start(): Promise<void> {
    for (const adapter of this._adapters.values()) {
      await adapter.start();
    }
    log.info({ count: this._adapters.size }, 'Channel manager started');
  }

  /**
   * Stop all registered adapters.
   */
  async stop(): Promise<void> {
    for (const adapter of this._adapters.values()) {
      await adapter.stop();
    }
    log.info('Channel manager stopped');
  }

  /**
   * The secure message pipeline.
   * INVARIANT-9: All channels use this path.
   */
  async handleMessage(adapter: IChannelAdapter, msg: ChannelMessage): Promise<void> {
    const sender = msg.from.phoneNumber;
    const channelId = msg.channelId;

    try {
      // 1. Policy Gate: Check if sender is allowed to trigger intake
      // INVARIANT-3: Unknown senders receive NO response
      const allowed = await this._gate.canIntake(sender, channelId);
      if (!allowed) {
        log.warn({ sender, channelId, adapter: adapter.name }, 'Intake denied by policy gate');
        await this._audit?.append({
          adapter: adapter.name,
          sender,
          channelId,
          action: 'intake_denied',
          status: 'blocked',
          metadata: { reason: 'policy_gate' }
        });
        return;
      }

      // 2. Capability Resolver: Get permissions for the sender/channel
      // INVARIANT-1: No tool execution without a valid CapabilitySet
      const capability = await this._resolver.resolve(sender, channelId);
      if (capability.role === 'denied' || capability.allowedTools.length === 0) {
        log.warn({ sender, channelId, role: capability.role }, 'Intake denied: no capability');
        await this._audit?.append({
          adapter: adapter.name,
          sender,
          channelId,
          action: 'intake_denied',
          status: 'blocked',
          metadata: { reason: 'no_capability', role: capability.role }
        });
        return;
      }

      // 3. Quarantine Processor: Extract structured intent using isolated LLM
      // INVARIANT-4: Channel message content never reaches the privileged LLM directly
      const intent = await this._quarantine.process(msg, capability);
      if (intent.suspicious) {
        log.warn({ sender, reason: intent.suspicious_reason }, 'Intake blocked: suspicious intent');
        await this._audit?.append({
          adapter: adapter.name,
          sender,
          channelId,
          action: 'quarantine_flag',
          status: 'blocked',
          metadata: { reason: intent.suspicious_reason }
        });
        await adapter.send(msg.from, channelId, `⛔ Access Denied: ${intent.suspicious_reason ?? 'security policy violation'}`, {
          quoteTimestamp: msg.timestamp.getTime(),
          quoteAuthor: sender,
        });
        return;
      }

      await this._audit?.append({
        adapter: adapter.name,
        sender,
        channelId,
        action: 'intake_allowed',
        status: 'ok',
        metadata: { goal: intent.goal, role: capability.role }
      });

      // 4. Orchestrator: Submit task with extracted goal + capability context
      log.info({ sender, goal: intent.goal, role: capability.role }, 'Executing channel-sourced task');

      const response = await this._orchestrator.submitTask({
        prompt: intent.goal,
        channelContext: { capability, channelMessage: msg },
        onEvent: (_event) => {
          // Progress updates could be sent here if desired
        },
      });

      // 5. Response Gateway: Send result back through the adapter
      if (response) {
        await adapter.send(msg.from, channelId, response, {
          quoteTimestamp: msg.timestamp.getTime(),
          quoteAuthor: sender,
        });
      } else {
        await adapter.send(msg.from, channelId, '✅ Task completed with no output.');
      }

    } catch (err) {
      log.error({ err, sender, channelId }, 'Error in channel message pipeline');
      await adapter.send(msg.from, channelId, '❌ Sorry, I encountered an internal error. Check daemon logs.');
    }
  }
}
