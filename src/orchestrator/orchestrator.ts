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
  TextEventContent,
  ToolResultEventContent,
  ToolCallEventContent,
} from '../types.js';
import { HookRunner } from '../hooks/hook-runner.js';
import { Router } from './router.js';
import { FailoverController } from './failover-controller.js';
import { RetryQueue } from './retry-queue.js';
import { AuthMonitor } from './auth-monitor.js';
import { SessionManager, BufferedSessionWriter } from './session-manager.js';
import { ExecutionLoop, type CustomToolDefinition } from './execution-loop.js';
import { SteeringManager } from '../steering/steering-manager.js';
import { MemoryManager } from '../memory/memory-manager.js';
import { ExtractionPipeline } from '../memory/extraction-pipeline.js';
import { createMemoryTools } from '../tools/memory-tools.js';
import { ValidationPipeline } from '../memory/validation-pipeline.js';
import { HeartbeatSystem } from '../routines/heartbeat.js';
import { RoutineManager } from '../routines/routine-manager.js';
import { NotificationTools } from '../tools/notifications.js';
import { PolicyEngine } from '../security/policy-engine.js';
import { IntentCapsuleManager } from '../security/intent-capsule.js';
import { LeakDetector } from '../security/leak-detector.js';
import { sanitizeInput } from '../security/prompt-defense.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('orchestrator');

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
  private _leakDetector!: LeakDetector;

  // Background systems
  private _heartbeatSystem: HeartbeatSystem | null = null;
  private _routineManager: RoutineManager | null = null;

  // Memory tools
  private _validationPipeline!: ValidationPipeline;

  // ORCH-12: Lifecycle hooks
  private _hookRunner: HookRunner = new HookRunner();

  // Background intervals
  private _authCheckTimeout: ReturnType<typeof setTimeout> | null = null;
  private _retryPollTimeout: ReturnType<typeof setTimeout> | null = null;
  private _consolidationTimeout: ReturnType<typeof setTimeout> | null = null;

  private _booted = false;

  constructor(options: OrchestratorOptions) {
    this._config = options.config;
    this._policy = options.policy;
    this._providers = options.providers;
    this._baseDir = options.baseDir ?? path.join(os.homedir(), '.zora');
  }

  /**
   * Boots all subsystems and starts background loops.
   *
   * Initialization order:
   *  1. PolicyEngine + IntentCapsuleManager (security layer).
   *  2. SessionManager (event persistence).
   *  3. SteeringManager (human-in-the-loop).
   *  4. MemoryManager (context injection).
   *  5. Router (provider selection).
   *  6. FailoverController (error recovery).
   *  7. RetryQueue (deferred retry).
   *  8. AuthMonitor (periodic auth checks every 5 min).
   *  9. HeartbeatSystem + RoutineManager (scheduled tasks).
   *
   * Background loops use self-rescheduling setTimeout (not setInterval)
   * to avoid overlapping async executions.
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

    // SEC-03: Wire LeakDetector for scanning tool outputs
    this._leakDetector = new LeakDetector();

    this._sessionManager = new SessionManager(this._baseDir);

    this._steeringManager = new SteeringManager(this._baseDir);
    await this._steeringManager.init();

    this._memoryManager = new MemoryManager(this._config.memory, this._baseDir);
    await this._memoryManager.init();
    this._validationPipeline = new ValidationPipeline();

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
          log.error({ err }, 'AuthMonitor check failed');
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
              log.error({ jobId: task.jobId, err }, 'Retry failed');
              // Leave task in queue for next poll cycle
            }
          }
        } catch (err) {
          log.error({ err }, 'RetryQueue poll failed');
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

    // Schedule daily note consolidation (check once per day)
    const scheduleConsolidation = () => {
      this._consolidationTimeout = setTimeout(async () => {
        try {
          const count = await this._memoryManager.consolidateDailyNotes(7);
          if (count > 0) {
            log.info({ consolidated: count }, 'Daily notes consolidated');
          }
        } catch (err) {
          log.warn({ err }, 'Daily note consolidation failed');
        }
        scheduleConsolidation();
      }, 24 * 60 * 60 * 1000); // 24 hours
    };
    // Run first check shortly after boot (30 seconds), then daily
    this._consolidationTimeout = setTimeout(async () => {
      try {
        await this._memoryManager.consolidateDailyNotes(7);
      } catch (err) {
        log.warn({ err }, 'Initial daily note consolidation failed');
      }
      scheduleConsolidation();
    }, 30 * 1000);

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
    if (this._consolidationTimeout) {
      clearTimeout(this._consolidationTimeout);
      this._consolidationTimeout = null;
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
   * Submits a task through the full orchestration pipeline.
   *
   * Pipeline stages:
   *  1. Load memory context from MemoryManager (daily notes, long-term items).
   *  2. Load SOUL.md identity file and build the system prompt with policy awareness hints.
   *  3. Create a signed intent capsule for goal drift detection (ASI01).
   *  4. Classify the task by complexity and resource type for routing.
   *  5. Route to the best available provider via the Router.
   *  6. Execute via _executeWithProvider, which handles event persistence,
   *     steering injection, failover, and retry queueing.
   *
   * @returns The final text result from the provider's 'done' event.
   * @throws If no provider is available or all failover attempts fail.
   */
  async submitTask(options: SubmitTaskOptions): Promise<string> {
    const jobId = options.jobId ?? `job_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

    // Reset per-task state: ValidationPipeline rate limit is per-session, not per-orchestrator-lifetime.
    // Without this, after MAX_SAVES_PER_SESSION saves across all tasks, memory_save permanently blocks.
    this._validationPipeline.resetSession();

    // MEM-05 / ORCH-07: Progressive memory context — lightweight index, not full dump.
    // The LLM uses memory_search / recall_context tools for on-demand retrieval.
    let memoryContext: string[] = [];
    try {
      memoryContext = await this._memoryManager.loadContext();
    } catch (err) {
      log.warn({ err, jobId }, 'Memory context injection failed, continuing without memory');
    }

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

    // SEC-03: Scan user prompt for injection patterns (warn but don't block by default)
    const sanitizedPrompt = sanitizeInput(options.prompt);
    if (sanitizedPrompt !== options.prompt) {
      log.warn({ jobId }, 'Prompt injection pattern detected in user input — sanitized');
    }

    // ASI01: Create signed intent capsule for goal drift detection
    if (this._intentCapsuleManager) {
      this._intentCapsuleManager.createCapsule(sanitizedPrompt);
    }

    // Classify task for routing
    const classification = this._router.classifyTask(sanitizedPrompt);

    // Build custom tools (permissions + memory tools + recall_context)
    const customTools = this._createCustomTools();

    // Build task context
    const taskContext: TaskContext = {
      jobId,
      task: sanitizedPrompt,
      requiredCapabilities: [],
      complexity: classification.complexity,
      resourceType: classification.resourceType,
      systemPrompt,
      memoryContext,
      history: [],
      modelPreference: options.model,
      maxCostTier: options.maxCostTier,
      maxTurns: options.maxTurns,
      customTools,
      canUseTool: this._policyEngine.createCanUseTool(),
    };

    // ORCH-12: Run onTaskStart hooks (can modify context before routing)
    const hookedContext = await this._hookRunner.runOnTaskStart(taskContext);

    // R2: Route to provider
    let selectedProvider: LLMProvider;
    try {
      selectedProvider = await this._router.selectProvider(hookedContext);
    } catch (err) {
      throw new Error(`No provider available: ${err instanceof Error ? err.message : String(err)}`);
    }

    // Execute with the selected provider
    return this._executeWithProvider(selectedProvider, hookedContext, options.onEvent);
  }

  /** Tracks errors that have already been through the failover path */
  private static readonly _failoverErrors = new WeakSet<Error>();

  /** Maximum depth of failover recursion to prevent unbounded re-execution */
  private static readonly MAX_FAILOVER_DEPTH = 3;

  /**
   * Executes a task with a specific provider, handling failover and event persistence.
   *
   * During execution, this method:
   * - Persists every event to the SessionManager for crash recovery.
   * - Polls SteeringManager after text/tool_result events, injecting any pending
   *   human steering messages into the event stream.
   * - On error events: attempts failover via FailoverController. If failover
   *   succeeds, recurses with the new provider (incrementing failoverDepth).
   *   If failover fails, enqueues the task in the RetryQueue.
   * - failoverDepth is capped at MAX_FAILOVER_DEPTH (3) to prevent unbounded recursion.
   * - The _failoverErrors WeakSet prevents double-failover: errors already processed
   *   by the failover path are not re-triggered in the outer catch block.
   */
  private async _executeWithProvider(
    provider: LLMProvider,
    taskContext: TaskContext,
    onEvent?: (event: AgentEvent) => void,
    failoverDepth = 0,
  ): Promise<string> {
    let result = '';

    // Event batching: buffer session writes, flush every 500ms or on done/error.
    // Wrapped in try/finally to ensure close() runs on ALL exit paths including failover.
    const bufferedWriter = new BufferedSessionWriter(this._sessionManager, taskContext.jobId, 500);

    try {
      try {
        // Execute via the provider's async generator
        for await (const event of provider.execute(taskContext)) {
          // R8: Persist events via buffered writer (batched disk I/O)
          bufferedWriter.append(event);

          // SEC-03: Scan tool outputs for leaked secrets (warn, don't strip)
          if (event.type === 'tool_result') {
            const toolResultContent = event.content as ToolResultEventContent;
            const resultText = typeof toolResultContent.result === 'string'
              ? toolResultContent.result
              : JSON.stringify(toolResultContent.result ?? '');
            const leaks = this._leakDetector.scan(resultText);
            if (leaks.length > 0) {
              log.warn(
                { jobId: taskContext.jobId, toolCallId: toolResultContent.toolCallId, leaks: leaks.map(l => ({ pattern: l.pattern, severity: l.severity })) },
                'Potential secret leak detected in tool output',
              );
            }
          }

          // SEC-03: Scan tool call arguments for leaked secrets
          if (event.type === 'tool_call') {
            const toolCallContent = event.content as ToolCallEventContent;
            const argsText = JSON.stringify(toolCallContent.arguments ?? {});
            const leaks = this._leakDetector.scan(argsText);
            if (leaks.length > 0) {
              log.warn(
                { jobId: taskContext.jobId, tool: toolCallContent.tool, leaks: leaks.map(l => ({ pattern: l.pattern, severity: l.severity })) },
                'Potential secret leak detected in tool call arguments',
              );
            }
          }

          // R7: Poll SteeringManager with debouncing (max once per 2 seconds)
          if (event.type === 'text' || event.type === 'tool_result') {
            const pendingMessages = await this._steeringManager.cachedGetPendingMessages(taskContext.jobId, 2000);
            for (const msg of pendingMessages) {
              // Inject steering as an event
              const steerEvent: AgentEvent = {
                type: 'steering',
                timestamp: new Date(),
                content: { text: msg.type === 'steer' ? msg.message : `[${msg.type}]`, source: msg.source, author: msg.author },
              };
              bufferedWriter.append(steerEvent);
              taskContext.history.push(steerEvent);
              if (onEvent) onEvent(steerEvent);

              // Archive the processed message and invalidate cache
              await this._steeringManager.archiveMessage(taskContext.jobId, msg.id);
              this._steeringManager.invalidatePendingCache(taskContext.jobId);
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
    } finally {
      // Always close the buffered writer — flushes remaining events and stops the timer.
      // This runs on all exit paths: success, throw, and failover returns.
      await bufferedWriter.close();
    }

    // Record completion in daily notes
    await this._memoryManager.appendDailyNote(`Completed task: ${taskContext.task}`);

    // MEM-09: Async memory extraction after successful job completion
    if (this._config.memory.auto_extract) {
      this._runExtractionAsync(taskContext).catch(err => {
        log.warn({ err, jobId: taskContext.jobId }, 'Post-job memory extraction failed');
      });
    }

    // ORCH-12: Run onTaskEnd hooks (can inspect result, optionally trigger follow-up)
    const endResult = await this._hookRunner.runOnTaskEnd(taskContext, result);
    if (endResult.followUp) {
      log.info({ jobId: taskContext.jobId }, 'onTaskEnd hook triggered follow-up task');
      return this.submitTask({ prompt: endResult.followUp, onEvent });
    }

    return result;
  }

  /**
   * MEM-09: Runs memory extraction asynchronously after job completion.
   *
   * Collects text events from the job history, passes them through
   * ExtractionPipeline, deduplicates against existing items, and
   * persists new items via StructuredMemory. Appends a daily note
   * summarizing what was extracted.
   *
   * Runs fire-and-forget — errors are caught by the caller.
   */
  private async _runExtractionAsync(taskContext: TaskContext): Promise<void> {
    // Collect conversation text from job history
    const messages = taskContext.history
      .filter(e => e.type === 'text' || e.type === 'done')
      .map(e => {
        const content = e.content as TextEventContent | DoneEventContent;
        return content.text;
      })
      .filter(Boolean);

    if (messages.length === 0) {
      return; // Nothing to extract from
    }

    // Get existing categories for context
    const categories = await this._memoryManager.getCategories();
    const categoryNames = categories.map(c => c.category);

    // Create extraction pipeline using the first available provider as the LLM
    const extractFn = async (prompt: string): Promise<string> => {
      const extractLoop = new ExecutionLoop({
        systemPrompt: 'You extract structured memory items from conversations. Respond with ONLY a JSON array.',
        permissionMode: 'default',
        cwd: process.cwd(),
        maxTurns: 1,
      });
      return extractLoop.run(prompt);
    };

    const pipeline = new ExtractionPipeline(extractFn);
    const result = await pipeline.extract(messages, categoryNames);

    if (result.errors.length > 0) {
      log.debug({ errors: result.errors, jobId: taskContext.jobId }, 'Extraction had errors');
    }

    if (result.items.length === 0) {
      return;
    }

    // Deduplicate against existing items
    const existingItems = await this._memoryManager.structuredMemory.listItems();
    const uniqueItems = pipeline.deduplicateItems(result.items, existingItems);

    // Persist each new item
    let savedCount = 0;
    for (const item of uniqueItems) {
      try {
        await this._memoryManager.structuredMemory.createItem({
          type: item.type,
          summary: item.summary,
          source: item.source || taskContext.jobId,
          source_type: item.source_type,
          tags: item.tags,
          category: item.category,
        });
        savedCount++;
      } catch (err) {
        log.debug({ err, item: item.summary }, 'Failed to save extracted memory item');
      }
    }

    // Append daily note summarizing extraction
    if (savedCount > 0) {
      await this._memoryManager.appendDailyNote(
        `Extracted ${savedCount} memory item(s) from job ${taskContext.jobId}`,
      );
    }

    log.info(
      { jobId: taskContext.jobId, extracted: result.items.length, saved: savedCount },
      'Memory extraction complete',
    );
  }

  /**
   * Creates custom tools available to the agent during execution.
   * Includes: permission tools, memory tools (search/save/forget), recall_context.
   */
  private _createCustomTools(): CustomToolDefinition[] {
    const permissionTools: CustomToolDefinition[] = [
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

          return {
            granted: false,
            pending: true,
            message: `Permission request submitted. Paths: ${paths.join(', ') || 'none'}. Commands: ${commands.join(', ') || 'none'}. Reason: ${reason}`,
            request: { paths, commands, reason },
          };
        },
      },
    ];

    // Wire existing memory tools (memory_search, memory_save, memory_forget)
    const memoryTools = createMemoryTools(this._memoryManager, this._validationPipeline);

    // Add recall_context tool for daily notes retrieval
    const recallContextTool: CustomToolDefinition = {
      name: 'recall_context',
      description:
        'Retrieve recent daily notes (rolling conversation summaries). ' +
        'Use this to get context from the past few days of agent activity.',
      input_schema: {
        type: 'object',
        properties: {
          days: {
            type: 'number',
            description: 'Number of recent days to retrieve (default: 3, max: 14).',
            default: 3,
          },
        },
      },
      handler: async (input: Record<string, unknown>): Promise<unknown> => {
        const days = Math.min(Math.max((input.days as number) ?? 3, 1), 14);
        const notes = await this._memoryManager.recallDailyNotes(days);

        if (notes.length === 0) {
          return { notes: [], message: 'No daily notes found for the requested period.' };
        }

        return { notes, count: notes.length, days };
      },
    };

    return [...permissionTools, ...memoryTools, recallContextTool];
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

  /** ORCH-12: Access the hook runner for registering lifecycle hooks */
  get hookRunner(): HookRunner {
    return this._hookRunner;
  }

  get config(): ZoraConfig {
    return this._config;
  }

  get providers(): LLMProvider[] {
    return this._providers;
  }
}
