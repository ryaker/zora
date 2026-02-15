/**
 * PolicyEngine — Enforcement of the Zora security policy.
 *
 * Spec §5.3 "Capability Policy Engine":
 *   - Path resolution (resolving ~, canonicalization)
 *   - Symlink handling (follow_symlinks check)
 *   - Command allowlist validation
 *   - Chained command splitting
 *
 * Security Hardening (Feb 2026):
 *   - Action Budgeting (LLM06/LLM10): per-session limits on tool invocations
 *   - Dry Run Mode (ASI02): preview write operations without executing
 *   - Intent Capsule integration (ASI01): goal drift detection hooks
 *
 * Shell parsing (tokenization, command splitting, base command extraction)
 * is delegated to ./shell-validator.ts.
 *
 * Policy serialization (summary, TOML persistence) is delegated to
 * ./policy-serializer.ts.
 */

import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import type { ZoraPolicy, FilesystemPolicy } from '../types.js';
import type { BudgetStatus, DryRunResult } from './security-types.js';
import type { IntentCapsuleManager } from './intent-capsule.js';
import type { AuditLogger } from './audit-logger.js';
import { isENOENT } from '../utils/errors.js';
import {
  shellTokenize,
  splitChainedCommands,
  extractBaseCommand,
  isReadOnlyCommand,
} from './shell-validator.js';
import {
  getPolicySummary as _getPolicySummary,
  writePolicyFile,
} from './policy-serializer.js';

export interface ValidationResult {
  allowed: boolean;
  reason?: string;
  resolvedPath?: string;
}

export interface AccessCheckResult {
  paths: Record<string, { allowed: boolean; reason?: string }>;
  commands: Record<string, { allowed: boolean; reason?: string }>;
  suggestion?: string;
}

/**
 * Callback for flagged actions. Return true to allow, false to deny.
 * Used when always_flag is configured in policy.
 */
export type FlagCallback = (action: string, detail: string) => Promise<boolean>;

/**
 * Request to expand the policy at runtime.
 */
export interface PolicyExpansionRequest {
  paths?: string[];
  commands?: string[];
}

export class PolicyEngine {
  private _policy: ZoraPolicy;
  private readonly _homeDir: string;
  private _flagCallback?: FlagCallback;
  private _policyFilePath?: string;

  // ─── Budget Tracking (LLM06/LLM10) ──────────────────────────────
  private _actionCounts: Map<string, number> = new Map();
  private _totalActions = 0;
  private _tokensUsed = 0;
  private _sessionId: string | null = null;

  // ─── Dry Run (ASI02) ────────────────────────────────────────────
  private _dryRunLog: DryRunResult[] = [];

  private static readonly WRITE_TOOLS = new Set(['Write', 'Edit', 'Bash']);

  // ─── Intent Capsule (ASI01) ─────────────────────────────────────
  private _intentCapsuleManager?: IntentCapsuleManager;
  private _auditLogger?: AuditLogger;

  constructor(policy: ZoraPolicy, flagCallback?: FlagCallback) {
    this._policy = policy;
    this._homeDir = os.homedir();
    this._flagCallback = flagCallback;
  }

  /**
   * Sets the path to the policy.toml file for runtime persistence.
   */
  setPolicyFilePath(filePath: string): void {
    this._policyFilePath = filePath;
  }

  /**
   * Sets the flag callback for always_flag enforcement.
   */
  setFlagCallback(callback: FlagCallback): void {
    this._flagCallback = callback;
  }

  /**
   * Sets an optional AuditLogger for dry-run and budget event logging.
   */
  setAuditLogger(logger: AuditLogger): void {
    this._auditLogger = logger;
  }

  /**
   * Sets an optional IntentCapsuleManager for goal drift detection.
   */
  setIntentCapsuleManager(manager: IntentCapsuleManager): void {
    this._intentCapsuleManager = manager;
  }

  // ─── Budget Management (LLM06/LLM10) ─────────────────────────────

  /**
   * Initialize a new session's budget tracking.
   */
  startSession(sessionId: string): void {
    this._sessionId = sessionId;
    this.resetBudget();
  }

  /**
   * Record an action against the budget. Returns whether the action is allowed.
   */
  recordAction(actionType: string): ValidationResult {
    const budget = this._policy.budget;
    if (!budget) return { allowed: true };

    this._totalActions++;
    this._actionCounts.set(actionType, (this._actionCounts.get(actionType) ?? 0) + 1);

    // Check total session limit
    if (budget.max_actions_per_session > 0 && this._totalActions > budget.max_actions_per_session) {
      return {
        allowed: false,
        reason: `Session action budget exceeded: ${this._totalActions}/${budget.max_actions_per_session} total actions used`,
      };
    }

    // Check per-type limit
    const typeLimit = budget.max_actions_per_type[actionType];
    if (typeLimit !== undefined && typeLimit > 0) {
      const typeCount = this._actionCounts.get(actionType) ?? 0;
      if (typeCount > typeLimit) {
        return {
          allowed: false,
          reason: `Action type '${actionType}' budget exceeded: ${typeCount}/${typeLimit}`,
        };
      }
    }

    return { allowed: true };
  }

  /**
   * Record token usage. Returns whether the token budget is still within limits.
   */
  recordTokenUsage(tokens: number): ValidationResult {
    const budget = this._policy.budget;
    if (!budget) return { allowed: true };

    this._tokensUsed += tokens;

    if (budget.token_budget > 0 && this._tokensUsed > budget.token_budget) {
      return {
        allowed: false,
        reason: `Token budget exceeded: ${this._tokensUsed}/${budget.token_budget} tokens used`,
      };
    }

    return { allowed: true };
  }

  /**
   * Query current budget status.
   */
  getBudgetStatus(): BudgetStatus {
    const budget = this._policy.budget;
    const exceededCategories: string[] = [];

    if (budget) {
      if (budget.max_actions_per_session > 0 && this._totalActions > budget.max_actions_per_session) {
        exceededCategories.push('total_actions');
      }
      if (budget.token_budget > 0 && this._tokensUsed > budget.token_budget) {
        exceededCategories.push('tokens');
      }
      for (const [type, limit] of Object.entries(budget.max_actions_per_type)) {
        if (limit > 0 && (this._actionCounts.get(type) ?? 0) > limit) {
          exceededCategories.push(type);
        }
      }
    }

    const actionsPerType: Record<string, { used: number; limit: number }> = {};
    if (budget) {
      for (const [type, limit] of Object.entries(budget.max_actions_per_type)) {
        actionsPerType[type] = { used: this._actionCounts.get(type) ?? 0, limit };
      }
    }
    // Also include types that have been used but aren't in the limit config
    for (const [type, count] of this._actionCounts) {
      if (!(type in actionsPerType)) {
        actionsPerType[type] = { used: count, limit: 0 };
      }
    }

    return {
      totalActionsUsed: this._totalActions,
      totalActionsLimit: budget?.max_actions_per_session ?? 0,
      actionsPerType,
      tokensUsed: this._tokensUsed,
      tokenLimit: budget?.token_budget ?? 0,
      exceeded: exceededCategories.length > 0,
      exceededCategories,
    };
  }

  /**
   * Reset budget counters (e.g., for a new session).
   */
  resetBudget(): void {
    this._actionCounts = new Map();
    this._totalActions = 0;
    this._tokensUsed = 0;
  }

  // ─── Dry Run (ASI02) ─────────────────────────────────────────────

  /**
   * Get all dry-run interceptions for the current session.
   */
  getDryRunLog(): DryRunResult[] {
    return [...this._dryRunLog];
  }

  /**
   * Clear the dry-run log.
   */
  clearDryRunLog(): void {
    this._dryRunLog = [];
  }

  /**
   * Check if a tool invocation should be intercepted for dry-run.
   *
   * Dry-run interception follows a three-stage filter:
   *  1. If `dry_run.tools` is non-empty, only intercept those specific tools.
   *  2. If `dry_run.tools` is empty, intercept all tools in WRITE_TOOLS (Write, Edit, Bash).
   *  3. For Bash specifically, skip read-only commands (ls, cat, git status, etc.)
   *     so they execute normally even in dry-run mode.
   *
   * @returns A DryRunResult if intercepted, null if the tool should execute normally.
   */
  private _checkDryRun(toolName: string, input: Record<string, unknown>): DryRunResult | null {
    const dryRun = this._policy.dry_run;
    if (!dryRun?.enabled) return null;

    // If specific tools listed, only intercept those
    if (dryRun.tools.length > 0 && !dryRun.tools.includes(toolName)) return null;

    // If no specific tools listed, intercept all write operations
    if (dryRun.tools.length === 0 && !PolicyEngine.WRITE_TOOLS.has(toolName)) return null;

    // For Bash: only intercept if command modifies state (not read-only commands)
    if (toolName === 'Bash') {
      const command = (input['command'] as string) ?? '';
      if (isReadOnlyCommand(command)) return null;
    }

    const wouldExecute = this._describeAction(toolName, input);
    const result: DryRunResult = {
      intercepted: true,
      toolName,
      input,
      wouldExecute,
      timestamp: new Date().toISOString(),
    };
    this._dryRunLog.push(result);

    // Audit log if configured
    if (dryRun.audit_dry_runs && this._auditLogger) {
      this._auditLogger.log({
        jobId: this._sessionId ?? 'unknown',
        eventType: 'dry_run',
        timestamp: new Date().toISOString(),
        provider: 'policy-engine',
        toolName,
        parameters: input,
        result: { dry_run: true, would_execute: wouldExecute },
      });
    }

    return result;
  }

  /**
   * Human-readable description of what a tool would do.
   */
  private _describeAction(toolName: string, input: Record<string, unknown>): string {
    switch (toolName) {
      case 'Write':
        return `Would write to file: ${input['file_path']}`;
      case 'Edit':
        return `Would edit file: ${input['file_path']}`;
      case 'Bash':
        return `Would execute shell command: ${input['command']}`;
      default:
        return `Would invoke ${toolName} with: ${JSON.stringify(input).slice(0, 200)}`;
    }
  }

  // ─── Path Validation ──────────────────────────────────────────────

  /**
   * Validates if a filesystem path is allowed according to policy.
   *
   * Evaluation order (short-circuits on first denial):
   *  1. Resolve ~ and make the path absolute.
   *  2. If path is a symlink and follow_symlinks is false, resolve the real target
   *     and check it against both denied and allowed paths.
   *  3. Check denied_paths (deny always wins over allow).
   *  4. Check allowed_paths.
   */
  validatePath(targetPath: string): ValidationResult {
    const fsPolicy = this._policy.filesystem;

    // 1. Resolve path (expand ~ and make absolute)
    let absolutePath = this._resolveHome(targetPath);
    absolutePath = path.resolve(absolutePath);

    // 2. Symlink check (Spec §5.3: "Don't follow symlinks outside allowed boundaries")
    if (!fsPolicy.follow_symlinks && this._isSymlink(absolutePath)) {
      try {
        const realPath = fs.realpathSync(absolutePath);

        // Deny symlinks that resolve into explicitly denied paths
        if (this._isWithinDeniedPaths(realPath, fsPolicy)) {
          return {
            allowed: false,
            reason: `Symlink target ${realPath} is explicitly denied by security policy`,
          };
        }

        if (!this._isWithinAllowedPaths(realPath, fsPolicy)) {
          return {
            allowed: false,
            reason: `Symlink target ${realPath} is outside allowed boundaries`,
          };
        }
      } catch (err: unknown) {
        // If file doesn't exist yet (e.g. for write_file), we skip realpath check,
        // but other errors should lead to failure.
        if (!isENOENT(err)) {
          return {
            allowed: false,
            reason: `Error resolving symlink ${targetPath}: ${err instanceof Error ? err.message : String(err)}`,
          };
        }
      }
    }

    // 3. Deny takes precedence
    if (this._isWithinDeniedPaths(absolutePath, fsPolicy)) {
      return {
        allowed: false,
        reason: `Access to ${targetPath} is explicitly denied by security policy`,
      };
    }

    // 4. Check allowlist
    if (!this._isWithinAllowedPaths(absolutePath, fsPolicy)) {
      return {
        allowed: false,
        reason: `Access to ${targetPath} is not permitted by current capability policy`,
      };
    }

    return { allowed: true, resolvedPath: absolutePath };
  }

  /**
   * Validates if a shell command is allowed.
   * Splits chained commands if configured and validates each component.
   */
  validateCommand(command: string): ValidationResult {
    const shellPolicy = this._policy.shell;

    // In deny_all mode, no shell commands should be executed at all.
    if (shellPolicy.mode === 'deny_all') {
      return {
        allowed: false,
        reason: 'Shell command execution is disabled by security policy',
      };
    }

    if (shellPolicy.mode === 'allowlist') {
      const commandsToValidate = shellPolicy.split_chained_commands
        ? splitChainedCommands(command)
        : [command];

      for (const cmd of commandsToValidate) {
        const baseCommand = extractBaseCommand(cmd);

        // Check denied list first
        if (shellPolicy.denied_commands.includes(baseCommand)) {
          return {
            allowed: false,
            reason: `Command '${baseCommand}' is explicitly forbidden by security policy`,
          };
        }

        // Check allowlist
        if (!shellPolicy.allowed_commands.includes(baseCommand)) {
          return {
            allowed: false,
            reason: `Command '${baseCommand}' is not in the allowlist. Only pre-approved commands are permitted.`,
          };
        }
      }
    } else {
      // Denylist mode (less secure, but supported)
      const baseCommand = extractBaseCommand(command);
      if (shellPolicy.denied_commands.includes(baseCommand)) {
        return {
          allowed: false,
          reason: `Command '${baseCommand}' is forbidden by security policy`,
        };
      }
    }

    // Check command arguments against denied filesystem paths
    const pathCheckResult = this._checkCommandPaths(command);
    if (!pathCheckResult.allowed) {
      return pathCheckResult;
    }

    return { allowed: true };
  }

  /**
   * Extracts path-like arguments from a shell command and validates
   * them against the filesystem policy (denied_paths).
   */
  private _checkCommandPaths(command: string): ValidationResult {
    const fsPolicy = this._policy.filesystem;
    if (!fsPolicy || fsPolicy.denied_paths.length === 0) {
      return { allowed: true };
    }

    // Use proper shell tokenizer to extract arguments
    const tokens = shellTokenize(command);
    for (const token of tokens.slice(1)) { // skip the command itself
      if (token.startsWith('/') || token.startsWith('~') || token.startsWith('./') || token.startsWith('../')) {
        const resolved = path.resolve(this._resolveHome(token));
        if (this._isWithinDeniedPaths(resolved, fsPolicy)) {
          return {
            allowed: false,
            reason: `Path '${token}' is within a denied directory — access blocked by security policy`,
          };
        }
      }
    }
    return { allowed: true };
  }

  // ─── SDK Integration ──────────────────────────────────────────────

  /**
   * Creates a canUseTool callback compatible with the Claude Agent SDK.
   * Maps Zora's policy validation to SDK permission decisions.
   *
   * The SDK calls this before every tool execution. Return:
   *   { behavior: 'allow', updatedInput } to permit
   *   { behavior: 'deny', message } to block
   *
   * Enforcement order within the callback:
   *  1. Tool-specific validation (Bash -> validateCommand, Read/Write/Edit -> validatePath, etc.)
   *  2. Budget enforcement -- record the action and check session/type limits.
   *  3. always_flag check -- prompt user for approval if the action category is flagged.
   *  4. Intent capsule drift check -- detect if the action diverges from the original task goal.
   *  5. Dry-run interception -- if enabled, deny with a preview message instead of executing.
   */
  createCanUseTool(): (
    toolName: string,
    input: Record<string, unknown>,
    options: { signal: AbortSignal },
  ) => Promise<
    | { behavior: 'allow'; updatedInput: Record<string, unknown> }
    | { behavior: 'deny'; message: string }
  > {
    return async (
      toolName: string,
      input: Record<string, unknown>,
      _options: { signal: AbortSignal },
    ) => {
      // Bash / shell commands
      if (toolName === 'Bash') {
        const command = input['command'] as string | undefined;
        if (!command) {
          return {
            behavior: 'deny' as const,
            message: 'Bash tool invoked without a command — denied by policy',
          };
        }
        const result = this.validateCommand(command);
        if (!result.allowed) {
          return {
            behavior: 'deny' as const,
            message: result.reason ?? 'Command denied by policy',
          };
        }
      }

      // File operations: Read, Write, Edit
      if (toolName === 'Read' || toolName === 'Write' || toolName === 'Edit') {
        const filePath = input['file_path'] as string | undefined;
        if (!filePath) {
          return {
            behavior: 'deny' as const,
            message: `${toolName} tool invoked without a file_path — denied by policy`,
          };
        }
        const result = this.validatePath(filePath);
        if (!result.allowed) {
          return {
            behavior: 'deny' as const,
            message: result.reason ?? 'Path denied by policy',
          };
        }
      }

      // Glob — validate the search path if provided
      if (toolName === 'Glob') {
        const globPath = input['path'] as string | undefined;
        if (!globPath) {
          return {
            behavior: 'deny' as const,
            message: 'Glob tool invoked without a path — denied by policy',
          };
        }
        const result = this.validatePath(globPath);
        if (!result.allowed) {
          return {
            behavior: 'deny' as const,
            message: result.reason ?? 'Path denied by policy',
          };
        }
      }

      // Grep — validate the search path if provided
      if (toolName === 'Grep') {
        const grepPath = input['path'] as string | undefined;
        if (!grepPath) {
          return {
            behavior: 'deny' as const,
            message: 'Grep tool invoked without a path — denied by policy',
          };
        }
        const result = this.validatePath(grepPath);
        if (!result.allowed) {
          return {
            behavior: 'deny' as const,
            message: result.reason ?? 'Path denied by policy',
          };
        }
      }

      // ─── Budget enforcement (LLM06/LLM10) ─────────────────────────
      if (this._policy.budget) {
        const actionType = this._classifyAction(toolName, input) ?? 'unknown';
        const budgetResult = this.recordAction(actionType);
        if (!budgetResult.allowed) {
          if (this._policy.budget.on_exceed === 'flag' && this._flagCallback) {
            const approved = await this._flagCallback('budget_exceeded', budgetResult.reason!);
            if (!approved) {
              return { behavior: 'deny' as const, message: budgetResult.reason! };
            }
          } else {
            return { behavior: 'deny' as const, message: budgetResult.reason! };
          }
        }
      }

      // Check always_flag for actions that require approval
      const action = this._classifyAction(toolName, input);
      if (action && this._shouldFlag(action)) {
        if (this._flagCallback) {
          const detail = toolName === 'Bash'
            ? `Command: ${input['command']}`
            : `${toolName}: ${input['file_path'] ?? JSON.stringify(input)}`;

          const approved = await this._flagCallback(action, detail);
          if (!approved) {
            return {
              behavior: 'deny' as const,
              message: `Action '${action}' was flagged for approval and denied by user`,
            };
          }
        }
        // No callback = no enforcement (graceful: config parsed but not blocked)
      }

      // ─── Intent capsule drift check (ASI01) ────────────────────────
      if (this._intentCapsuleManager) {
        const driftAction = this._classifyAction(toolName, input) ?? 'unknown';
        const detail = toolName === 'Bash'
          ? (input['command'] as string) ?? ''
          : `${toolName}: ${input['file_path'] ?? JSON.stringify(input)}`;
        const driftResult = this._intentCapsuleManager.checkDrift(driftAction, detail);

        if (!driftResult.consistent) {
          // Flag for human review rather than blocking outright
          if (this._flagCallback) {
            const approved = await this._flagCallback(
              'goal_drift',
              `Potential goal drift detected: ${driftResult.reason}. Action: ${detail}`,
            );
            if (!approved) {
              return { behavior: 'deny' as const, message: `Goal drift detected: ${driftResult.reason}` };
            }
          }
          // If no flag callback, log but allow (to avoid breaking non-interactive flows)
        }
      }

      // ─── Dry-run interception (ASI02) ──────────────────────────────
      const dryRunResult = this._checkDryRun(toolName, input);
      if (dryRunResult) {
        return {
          behavior: 'deny' as const,
          message: `[DRY RUN] ${dryRunResult.wouldExecute}`,
        };
      }

      // Default: allow the tool call
      return { behavior: 'allow' as const, updatedInput: input };
    };
  }

  /**
   * Maps a tool call to an action category for always_flag matching.
   */
  private _classifyAction(toolName: string, input: Record<string, unknown>): string | null {
    if (toolName === 'Bash') {
      const command = (input['command'] as string | undefined) ?? '';
      const base = extractBaseCommand(command);

      // Map common commands to action categories
      if (base === 'git') {
        const args = command.trim().split(/\s+/);
        if (args.includes('push')) return 'git_push';
        if (args.includes('reset') && args.includes('--hard')) return 'shell_exec_destructive';
        return 'git_operation';
      }
      if (['rm', 'rmdir'].includes(base)) return 'shell_exec_destructive';
      if (['chmod', 'chown'].includes(base)) return 'shell_exec_destructive';
      return 'shell_exec';
    }

    if (toolName === 'Write') return 'write_file';
    if (toolName === 'Edit') return 'edit_file';

    return null;
  }

  /**
   * Checks if an action matches any entry in the always_flag list.
   */
  private _shouldFlag(action: string): boolean {
    const flagList = this._policy.actions.always_flag;
    if (flagList.length === 0) return false;
    return flagList.includes('*') || flagList.includes(action);
  }

  // ─── Policy Inspection ──────────────────────────────────────────────

  /**
   * Checks access for multiple paths and commands at once.
   * Used by the check_permissions tool so the agent can plan around its boundaries.
   */
  checkAccess(paths: string[], commands: string[]): AccessCheckResult {
    const pathResults: Record<string, { allowed: boolean; reason?: string }> = {};
    for (const p of paths) {
      const v = this.validatePath(p);
      pathResults[p] = { allowed: v.allowed, ...(v.reason ? { reason: v.reason } : {}) };
    }

    const commandResults: Record<string, { allowed: boolean; reason?: string }> = {};
    for (const c of commands) {
      const v = this.validateCommand(c);
      commandResults[c] = { allowed: v.allowed, ...(v.reason ? { reason: v.reason } : {}) };
    }

    const denied = [
      ...Object.entries(pathResults).filter(([, v]) => !v.allowed).map(([k]) => k),
      ...Object.entries(commandResults).filter(([, v]) => !v.allowed).map(([k]) => k),
    ];

    return {
      paths: pathResults,
      commands: commandResults,
      ...(denied.length > 0 ? { suggestion: 'To access denied resources, ask the user to grant access via `zora init --force` or by editing ~/.zora/policy.toml.' } : {}),
    };
  }

  /**
   * Returns a short text summary of the current policy for system prompt injection.
   * Intentionally terse to minimize context usage.
   */
  getPolicySummary(): string {
    return _getPolicySummary(this._policy);
  }

  /**
   * Returns the raw policy object (read-only access for serialization).
   */
  get policy(): ZoraPolicy {
    return this._policy;
  }

  // ─── Runtime Policy Expansion ──────────────────────────────────────

  /**
   * Expands the policy at runtime. Validates against permanent deny-list.
   * Persists changes to policy.toml if a file path is configured.
   */
  expandPolicy(request: PolicyExpansionRequest): void {
    // Validate: requested paths must not be in permanent deny-list
    if (request.paths) {
      for (const p of request.paths) {
        const abs = path.resolve(this._resolveHome(p));
        if (this._isWithinDeniedPaths(abs, this._policy.filesystem)) {
          throw new Error(`Cannot grant access to ${p} — permanently denied by policy`);
        }
      }

      // Add new paths (deduplicate)
      const existing = new Set(this._policy.filesystem.allowed_paths);
      for (const p of request.paths) {
        existing.add(p);
      }
      this._policy.filesystem.allowed_paths = [...existing];
    }

    // Expand shell commands
    if (request.commands) {
      const existing = new Set(this._policy.shell.allowed_commands);
      for (const c of request.commands) {
        // Don't allow adding denied commands
        if (this._policy.shell.denied_commands.includes(c)) {
          throw new Error(`Cannot allow command '${c}' — permanently denied by policy`);
        }
        existing.add(c);
      }
      this._policy.shell.allowed_commands = [...existing];

      // If we're adding commands and mode was deny_all, switch to allowlist
      if (this._policy.shell.mode === 'deny_all') {
        this._policy.shell.mode = 'allowlist';
      }
    }

    // Persist if we have a file path
    if (this._policyFilePath) {
      writePolicyFile(this._policy, this._policyFilePath);
    }
  }

  // ─── Private Helpers ──────────────────────────────────────────────

  private _resolveHome(p: string): string {
    if (p === '~') return this._homeDir;
    if (p.startsWith('~/')) return path.join(this._homeDir, p.slice(2));
    return p;
  }

  private _isSymlink(p: string): boolean {
    try {
      const stats = fs.lstatSync(p);
      return stats.isSymbolicLink();
    } catch {
      return false;
    }
  }

  private _isWithinAllowedPaths(p: string, policy: FilesystemPolicy): boolean {
    return policy.allowed_paths.some(allowed => {
      const absAllowed = path.resolve(this._resolveHome(allowed));
      return p === absAllowed || p.startsWith(absAllowed + path.sep);
    });
  }

  private _isWithinDeniedPaths(p: string, policy: FilesystemPolicy): boolean {
    return policy.denied_paths.some(denied => {
      const absDenied = path.resolve(this._resolveHome(denied));
      return p === absDenied || p.startsWith(absDenied + path.sep);
    });
  }
}
