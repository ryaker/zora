/**
 * Orchestrator — Central controller that boots, owns, and connects every component.
 *
 * Remediation Roadmap R1-R9:
 *   - Single owner that instantiates Router, FailoverController, RetryQueue,
 *     AuthMonitor, SessionManager, SteeringManager, MemoryManager,
 *     HeartbeatSystem, RoutineManager.
 *   - Exposes boot() and shutdown().
 *   - submitTask() wires routing, failover, retry, steering, session persistence,
 *     and memory context injection into a unified execution path.
 */

import crypto from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import type {
  ZoraConfig,
  ZoraPolicy,
  LLMProvider,
  CostTier,
  TaskContext,
  AgentEvent,
  DoneEventContent,
  ErrorEventContent,
} from '../types.js';
import { Router } from './router.js';
import { FailoverController } from './failover-controller.js';
import { RetryQueue } from './retry-queue.js';
import { AuthMonitor } from './auth-monitor.js';
import { SessionManager } from './session-manager.js';
import { ExecutionLoop, type CustomToolDefinition } from './execution-loop.js';
import { SteeringManager } from '../steering/steering-manager.js';
import { MemoryManager } from '../memory/memory-manager.js';
import { HeartbeatSystem } from '../routines/heartbeat.js';
import { RoutineManager } from '../routines/routine-manager.js';
import { NotificationTools } from '../tools/notifications.js';
import { PolicyEngine } from '../security/policy-engine.js';
import { IntentCapsuleManager } from '../security/intent-capsule.js';

export interface OrchestratorOptions {
  config: ZoraConfig;
  policy: ZoraPolicy;
  providers: LLMProvider[];
  baseDir?: string;
}

export interface SubmitTaskOptions {
  prompt: string;
  model?: string;
  maxCostTier?: CostTier;
  maxTurns?: number;
  jobId?: string;
  onEvent?: (event: AgentEvent) => void;
}

export class Orchestrator {
  private readonly _config: ZoraConfig;
  private readonly _policy: ZoraPolicy;
  private readonly _baseDir: string;
  private readonly _providers: LLMProvider[];

  // Core components
  private _router!: Router;
  private _failoverController!: FailoverController;
  private _retryQueue!: RetryQueue;
  private _authMonitor!: AuthMonitor;
  private _sessionManager!: SessionManager;
  private _steeringManager!: SteeringManager;
  private _memoryManager!: MemoryManager;
  private _policyEngine!: PolicyEngine;
  private _notifications!: NotificationTools;

  // Security
  private _intentCapsuleManager!: IntentCapsuleManager;

  // Background systems
  private _heartbeatSystem: HeartbeatSystem | null = null;
  private _routineManager: RoutineManager | null = null;

  // Background intervals
  private _authCheckTimeout: ReturnType<typeof setTimeout> | null = null;
  private _retryPollTimeout: ReturnType<typeof setTimeout> | null = null;

  private _booted = false;

  constructor(options: OrchestratorOptions) {
    this._config = options.config;
    this._policy = options.policy;
    this._providers = options.providers;
    this._baseDir = options.baseDir ?? path.join(os.homedir(), '.zora');
  }

  /**
   * Boots all subsystems and starts background loops.
   */
  async boot(): Promise<void> {
    if (this._booted) return;

    // Initialize core services
    this._notifications = new NotificationTools();
    this._policyEngine = new PolicyEngine(this._policy);
    this._policyEngine.startSession(`session_${Date.now()}`);

    // ASI01: Create IntentCapsuleManager with per-session signing key
    this._intentCapsuleManager = new IntentCapsuleManager(
      crypto.randomBytes(32).toString('hex'),
    );
    this._policyEngine.setIntentCapsuleManager(this._intentCapsuleManager);

    this._sessionManager = new SessionManager(this._baseDir);

    this._steeringManager = new SteeringManager(this._baseDir);
    await this._steeringManager.init();

    this._memoryManager = new MemoryManager(this._config.memory, this._baseDir);
    await this._memoryManager.init();

    // R2: Wire Router
    this._router = new Router({
      providers: this._providers,
      mode: this._config.routing.mode,
      providerOnlyName: this._config.routing.provider_only_name,
    });

    // R3: Wire FailoverController
    this._failoverController = new FailoverController(
      this._providers,
      this._router,
      this._config.failover,
    );

    // R5: Initialize RetryQueue
    this._retryQueue = new RetryQueue(this._baseDir);
    await this._retryQueue.init();

    // R4: Schedule AuthMonitor
    this._authMonitor = new AuthMonitor({
      providers: this._providers,
      notifications: this._notifications,
      preExpiryWarningHours: 2,
    });

    // R4: Schedule periodic auth checks (every 5 minutes) using self-rescheduling
    // setTimeout to avoid overlapping async executions
    const scheduleAuthCheck = () => {
      this._authCheckTimeout = setTimeout(async () => {
        try {
          await this._authMonitor.checkAll();
        } catch (err) {
          console.error('[Orchestrator] AuthMonitor check failed:', err);
        }
        scheduleAuthCheck();
      }, 5 * 60 * 1000);
    };
    scheduleAuthCheck();

    // R5: Poll RetryQueue (every 30 seconds) — remove task only after successful re-submission
    const scheduleRetryPoll = () => {
      this._retryPollTimeout = setTimeout(async () => {
        try {
          const readyTasks = this._retryQueue.getReadyTasks();
          for (const task of readyTasks) {
            try {
              await this.submitTask({ prompt: task.task, jobId: task.jobId });
              await this._retryQueue.remove(task.jobId);
            } catch (err) {
              console.error(`[Orchestrator] Retry failed for ${task.jobId}:`, err);
              // Leave task in queue for next poll cycle
            }
          }
        } catch (err) {
          console.error('[Orchestrator] RetryQueue poll failed:', err);
        }
        scheduleRetryPoll();
      }, 30 * 1000);
    };
    scheduleRetryPoll();

    // R9: Start HeartbeatSystem and RoutineManager
    const defaultLoop = new ExecutionLoop({
      systemPrompt: 'You are Zora, a helpful autonomous agent.',
      permissionMode: 'default',
      cwd: process.cwd(),
      canUseTool: this._policyEngine.createCanUseTool(),
      customTools: this._createCustomTools(),
    });

    this._heartbeatSystem = new HeartbeatSystem({
      loop: defaultLoop,
      baseDir: this._baseDir,
      intervalMinutes: this._parseIntervalMinutes(this._config.agent.heartbeat_interval),
    });
    await this._heartbeatSystem.start();

    this._routineManager = new RoutineManager(
      async (opts) => this.submitTask({
        prompt: opts.prompt,
        model: opts.model,
        maxCostTier: opts.maxCostTier,
      }),
      this._baseDir,
    );
    await this._routineManager.init();

    this._booted = true;
  }

  /**
   * Gracefully shuts down all subsystems.
   */
  async shutdown(): Promise<void> {
    if (!this._booted) return;

    // Stop background timers
    if (this._authCheckTimeout) {
      clearTimeout(this._authCheckTimeout);
      this._authCheckTimeout = null;
    }
    if (this._retryPollTimeout) {
      clearTimeout(this._retryPollTimeout);
      this._retryPollTimeout = null;
    }

    // Stop heartbeat and routines
    if (this._heartbeatSystem) {
      this._heartbeatSystem.stop();
      this._heartbeatSystem = null;
    }
    if (this._routineManager) {
      this._routineManager.stopAll();
      this._routineManager = null;
    }

    this._booted = false;
  }

  /**
   * Submits a task through the full orchestration pipeline:
   * 1. Load memory context (R6)
   * 2. Classify and route to provider (R2)
   * 3. Execute with event persistence (R8) and steering (R7)
   * 4. Handle failures with failover (R3) and retry (R5)
   */
  async submitTask(options: SubmitTaskOptions): Promise<string> {
    const jobId = options.jobId ?? `job_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

    // R6: Inject MemoryManager context systematically
    const memoryContext = await this._memoryManager.loadContext();

    // Load SOUL.md for agent identity (fixes bug: file was created but never read)
    const soulPath = this._config.agent.identity.soul_file.replace(/^~/, os.homedir());
    let soulContent = '';
    try {
      if (fs.existsSync(soulPath)) {
        soulContent = fs.readFileSync(soulPath, 'utf-8').trim();
      }
    } catch {
      // SOUL.md missing or unreadable — use default identity
    }

    // Build system prompt with policy awareness
    const systemPrompt = [
      soulContent || 'You are Zora, a helpful autonomous agent.',
      '[SECURITY] You operate under a permission policy. Before planning any task,',
      'use the check_permissions tool to verify you have access to the paths and',
      'commands you need. If access is denied, tell the user what you need and why.',
      'Do NOT attempt actions without checking first.',
      ...memoryContext,
    ].join('\n\n');

    // ASI01: Create signed intent capsule for goal drift detection
    if (this._intentCapsuleManager) {
      this._intentCapsuleManager.createCapsule(options.prompt);
    }

    // Classify task for routing
    const classification = this._router.classifyTask(options.prompt);

    // Build task context
    const taskContext: TaskContext = {
      jobId,
      task: options.prompt,
      requiredCapabilities: [],
      complexity: classification.complexity,
      resourceType: classification.resourceType,
      systemPrompt,
      memoryContext,
      history: [],
      modelPreference: options.model,
      maxCostTier: options.maxCostTier,
      maxTurns: options.maxTurns,
      canUseTool: this._policyEngine.createCanUseTool(),
    };

    // R2: Route to provider
    let selectedProvider: LLMProvider;
    try {
      selectedProvider = await this._router.selectProvider(taskContext);
    } catch (err) {
      throw new Error(`No provider available: ${err instanceof Error ? err.message : String(err)}`);
    }

    // Execute with the selected provider
    return this._executeWithProvider(selectedProvider, taskContext, options.onEvent);
  }

  /** Tracks errors that have already been through the failover path */
  private static readonly _failoverErrors = new WeakSet<Error>();

  /** Maximum depth of failover recursion to prevent unbounded re-execution */
  private static readonly MAX_FAILOVER_DEPTH = 3;

  /**
   * Executes a task with a specific provider, handling failover and event persistence.
   */
  private async _executeWithProvider(
    provider: LLMProvider,
    taskContext: TaskContext,
    onEvent?: (event: AgentEvent) => void,
    failoverDepth = 0,
  ): Promise<string> {
    let result = '';

    try {
      // Execute via the provider's async generator
      for await (const event of provider.execute(taskContext)) {
        // R8: Persist events to SessionManager
        await this._sessionManager.appendEvent(taskContext.jobId, event);

        // R7: Poll SteeringManager during execution
        if (event.type === 'text' || event.type === 'tool_result') {
          const pendingMessages = await this._steeringManager.getPendingMessages(taskContext.jobId);
          for (const msg of pendingMessages) {
            // Inject steering as an event
            const steerEvent: AgentEvent = {
              type: 'steering',
              timestamp: new Date(),
              content: { text: msg.type === 'steer' ? msg.message : `[${msg.type}]`, source: msg.source, author: msg.author },
            };
            await this._sessionManager.appendEvent(taskContext.jobId, steerEvent);
            taskContext.history.push(steerEvent);
            if (onEvent) onEvent(steerEvent);

            // Archive the processed message
            await this._steeringManager.archiveMessage(taskContext.jobId, msg.id);
          }
        }

        // Notify caller
        if (onEvent) onEvent(event);

        // Track history for failover handoff
        taskContext.history.push(event);

        // Capture result text
        if (event.type === 'done') {
          result = (event.content as DoneEventContent).text ?? '';
        }

        // Handle errors — trigger failover (R3)
        if (event.type === 'error') {
          const errorContent = event.content as ErrorEventContent;
          const error = new Error(errorContent.message ?? 'Unknown provider error');

          // Guard: skip failover if depth exceeded
          if (failoverDepth >= Orchestrator.MAX_FAILOVER_DEPTH) {
            throw error;
          }

          // R3: Connect FailoverController to error path
          const failoverResult = await this._failoverController.handleFailure(
            taskContext,
            provider,
            error,
          );

          if (failoverResult) {
            // Re-execute with the failover provider (increment depth)
            return this._executeWithProvider(failoverResult.nextProvider, taskContext, onEvent, failoverDepth + 1);
          }

          // R5: Enqueue for retry if no failover available
          try {
            await this._retryQueue.enqueue(taskContext, error.message, this._config.failover.max_retries);
          } catch {
            // Max retries exceeded or enqueue failed
          }

          // Mark so the outer catch doesn't re-trigger failover
          Orchestrator._failoverErrors.add(error);
          throw error;
        }
      }
    } catch (err) {
      // Skip failover for errors already marked by the failover path
      const isFailoverError = err instanceof Error && Orchestrator._failoverErrors.has(err);
      if (!isFailoverError && err instanceof Error && failoverDepth < Orchestrator.MAX_FAILOVER_DEPTH) {
        // R3: Try failover on execution exceptions
        const failoverResult = await this._failoverController.handleFailure(
          taskContext,
          provider,
          err,
        );

        if (failoverResult) {
          // Mark the error so downstream doesn't re-trigger failover
          Orchestrator._failoverErrors.add(err);
          return this._executeWithProvider(failoverResult.nextProvider, taskContext, onEvent, failoverDepth + 1);
        }

        // R5: Enqueue for retry
        try {
          await this._retryQueue.enqueue(taskContext, err.message, this._config.failover.max_retries);
        } catch {
          // Max retries exceeded
        }
      }
      throw err;
    }

    // Record completion in daily notes
    await this._memoryManager.appendDailyNote(`Completed task: ${taskContext.task}`);

    return result;
  }

  /**
   * Creates custom tools available to the agent during execution.
   */
  private _createCustomTools(): CustomToolDefinition[] {
    return [
      {
        name: 'check_permissions',
        description: 'Check if you have access to specific paths or commands before executing. Use this during planning to verify your boundaries.',
        input_schema: {
          type: 'object',
          properties: {
            paths: { type: 'array', items: { type: 'string' }, description: 'Filesystem paths to check access for' },
            commands: { type: 'array', items: { type: 'string' }, description: 'Shell commands to check access for' },
          },
        },
        handler: async (input: Record<string, unknown>) => {
          const paths = (input['paths'] as string[] | undefined) ?? [];
          const commands = (input['commands'] as string[] | undefined) ?? [];
          return this._policyEngine.checkAccess(paths, commands);
        },
      },
      {
        name: 'request_permissions',
        description: 'Request additional permissions from the user. Use this when check_permissions shows a path or command is denied and you need it for the current task. The user will be asked to approve.',
        input_schema: {
          type: 'object',
          properties: {
            paths: { type: 'array', items: { type: 'string' }, description: 'Filesystem paths to request access for' },
            commands: { type: 'array', items: { type: 'string' }, description: 'Shell commands to request access for' },
            reason: { type: 'string', description: 'Why you need this access (shown to user)' },
          },
          required: ['reason'],
        },
        handler: async (input: Record<string, unknown>) => {
          const paths = (input['paths'] as string[] | undefined) ?? [];
          const commands = (input['commands'] as string[] | undefined) ?? [];
          const reason = (input['reason'] as string | undefined) ?? 'No reason provided';

          // Validate against permanent deny-list before asking the user
          const deniedPaths = this._policy.filesystem.denied_paths;
          for (const p of paths) {
            const abs = path.resolve(p.replace(/^~/, os.homedir()));
            for (const denied of deniedPaths) {
              const absDenied = path.resolve(denied.replace(/^~/, os.homedir()));
              if (abs === absDenied || abs.startsWith(absDenied + path.sep)) {
                return {
                  granted: false,
                  message: `Cannot grant access to ${p} — it is in the permanent deny-list. This cannot be overridden at runtime.`,
                };
              }
            }
          }

          // The actual approval flow happens outside (CLI prompt, dashboard, etc.)
          // For now, return the request details so the caller can present them to the user.
          // In the CLI, this will be intercepted by the onEvent callback.
          return {
            granted: false,
            pending: true,
            message: `Permission request submitted. Paths: ${paths.join(', ') || 'none'}. Commands: ${commands.join(', ') || 'none'}. Reason: ${reason}`,
            request: { paths, commands, reason },
          };
        },
      },
    ];
  }

  /**
   * Parse interval strings like "30m", "1h" to minutes.
   */
  private _parseIntervalMinutes(interval: string): number {
    const match = interval.match(/^(\d+)(m|h|s)$/);
    if (!match) return 30; // default 30 minutes
    const value = parseInt(match[1]!, 10);
    switch (match[2]) {
      case 'h': return value * 60;
      case 'm': return value;
      case 's': return Math.max(1, Math.floor(value / 60));
      default: return 30;
    }
  }

  // ─── Public accessors ──────────────────────────────────────────────

  private _assertBooted(): void {
    if (!this._booted) throw new Error('Orchestrator.boot() must be called before accessing subsystems');
  }

  get isBooted(): boolean {
    return this._booted;
  }

  get router(): Router {
    this._assertBooted();
    return this._router;
  }

  get sessionManager(): SessionManager {
    this._assertBooted();
    return this._sessionManager;
  }

  get steeringManager(): SteeringManager {
    this._assertBooted();
    return this._steeringManager;
  }

  get memoryManager(): MemoryManager {
    this._assertBooted();
    return this._memoryManager;
  }

  get authMonitor(): AuthMonitor {
    this._assertBooted();
    return this._authMonitor;
  }

  get retryQueue(): RetryQueue {
    this._assertBooted();
    return this._retryQueue;
  }

  get policyEngine(): PolicyEngine {
    this._assertBooted();
    return this._policyEngine;
  }

  get config(): ZoraConfig {
    return this._config;
  }

  get providers(): LLMProvider[] {
    return this._providers;
  }
}
