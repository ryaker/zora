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
 */

import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import type { ZoraPolicy, FilesystemPolicy } from '../types.js';
import type { BudgetStatus, DryRunResult } from './security-types.js';
import type { IntentCapsuleManager } from './intent-capsule.js';
import type { AuditLogger } from './audit-logger.js';

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
  private static readonly READ_ONLY_COMMANDS = new Set([
    'ls', 'cat', 'head', 'tail', 'grep', 'rg', 'find', 'which', 'pwd',
    'wc', 'diff', 'file', 'stat', 'echo', 'env', 'printenv', 'date', 'whoami',
  ]);

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
      if (this._isReadOnlyCommand(command)) return null;
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
   * Determine if a bash command is read-only.
   */
  private _isReadOnlyCommand(command: string): boolean {
    const base = this._extractBaseCommand(command);
    if (PolicyEngine.READ_ONLY_COMMANDS.has(base)) return true;
    // git status, git log, git diff are read-only
    if (base === 'git') {
      const parts = command.trim().split(/\s+/);
      const subCommand = parts[1] ?? '';
      if (['status', 'log', 'diff', 'show', 'branch', 'remote', 'tag'].includes(subCommand)) {
        return true;
      }
    }
    return false;
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
        if (!(err instanceof Error && 'code' in err && (err as any).code === 'ENOENT')) {
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
        ? this._splitChainedCommands(command)
        : [command];

      for (const cmd of commandsToValidate) {
        const baseCommand = this._extractBaseCommand(cmd);

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
      const baseCommand = this._extractBaseCommand(command);
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
    const tokens = this._shellTokenize(command);
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
      const base = this._extractBaseCommand(command);

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
    const fs = this._policy.filesystem;
    const sh = this._policy.shell;
    const lines: string[] = [];

    if (fs.allowed_paths.length === 0) {
      lines.push('Filesystem: LOCKED (no paths allowed)');
    } else {
      lines.push(`Filesystem: ${fs.allowed_paths.join(', ')}`);
    }

    if (fs.denied_paths.length > 0) {
      lines.push(`Denied: ${fs.denied_paths.join(', ')}`);
    }

    if (sh.mode === 'deny_all') {
      lines.push('Shell: DISABLED (no commands allowed)');
    } else if (sh.mode === 'allowlist') {
      lines.push(`Shell: ${sh.allowed_commands.join(', ')}`);
    } else {
      lines.push('Shell: denylist mode');
    }

    if (this._policy.budget) {
      const b = this._policy.budget;
      lines.push(`Budget: ${b.max_actions_per_session || 'unlimited'} actions/session, ${b.token_budget || 'unlimited'} tokens`);
    }

    if (this._policy.dry_run?.enabled) {
      lines.push('Dry Run: ENABLED (write operations will be previewed only)');
    }

    return lines.join('\n');
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
      this._writePolicyFile();
    }
  }

  /**
   * Writes the current policy state to the TOML file.
   */
  private _writePolicyFile(): void {
    if (!this._policyFilePath) return;

    try {
      // Dynamic import would be async; since we store the import at module level, use sync write
      // Build TOML manually for simplicity (avoids needing smol-toml at runtime here)
      const lines: string[] = [
        '# Zora Security Policy — auto-generated (runtime expansion applied)',
        '',
        '[filesystem]',
        `allowed_paths = ${JSON.stringify(this._policy.filesystem.allowed_paths)}`,
        `denied_paths = ${JSON.stringify(this._policy.filesystem.denied_paths)}`,
        `resolve_symlinks = ${this._policy.filesystem.resolve_symlinks}`,
        `follow_symlinks = ${this._policy.filesystem.follow_symlinks}`,
        '',
        '[shell]',
        `mode = "${this._policy.shell.mode}"`,
        `allowed_commands = ${JSON.stringify(this._policy.shell.allowed_commands)}`,
        `denied_commands = ${JSON.stringify(this._policy.shell.denied_commands)}`,
        `split_chained_commands = ${this._policy.shell.split_chained_commands}`,
        `max_execution_time = "${this._policy.shell.max_execution_time}"`,
        '',
        '[actions]',
        `reversible = ${JSON.stringify(this._policy.actions.reversible)}`,
        `irreversible = ${JSON.stringify(this._policy.actions.irreversible)}`,
        `always_flag = ${JSON.stringify(this._policy.actions.always_flag)}`,
        '',
        '[network]',
        `allowed_domains = ${JSON.stringify(this._policy.network.allowed_domains)}`,
        `denied_domains = ${JSON.stringify(this._policy.network.denied_domains)}`,
        `max_request_size = "${this._policy.network.max_request_size}"`,
        '',
      ];

      // Serialize budget section if present
      if (this._policy.budget) {
        const b = this._policy.budget;
        lines.push(
          '[budget]',
          `max_actions_per_session = ${b.max_actions_per_session}`,
          `token_budget = ${b.token_budget}`,
          `on_exceed = "${b.on_exceed}"`,
          '',
          '[budget.max_actions_per_type]',
        );
        for (const [type, limit] of Object.entries(b.max_actions_per_type)) {
          lines.push(`${type} = ${limit}`);
        }
        lines.push('');
      }

      // Serialize dry_run section if present
      if (this._policy.dry_run) {
        const dr = this._policy.dry_run;
        lines.push(
          '[dry_run]',
          `enabled = ${dr.enabled}`,
          `tools = ${JSON.stringify(dr.tools)}`,
          `audit_dry_runs = ${dr.audit_dry_runs}`,
          '',
        );
      }

      fs.writeFileSync(this._policyFilePath, lines.join('\n'), 'utf-8');
    } catch (err) {
      console.error('[PolicyEngine] Failed to persist policy expansion:', err instanceof Error ? err.message : String(err));
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

  /**
   * Tokenize a shell command string, handling:
   * - Double quotes with escape sequences (\" \\ \$ \`)
   * - Single quotes (literal, no escapes except '')
   * - Backslash escaping outside quotes
   * - Empty strings ("" and '')
   * Returns the unquoted token values.
   */
  private _shellTokenize(input: string): string[] {
    const tokens: string[] = [];
    let current = '';
    let inToken = false;
    let i = 0;

    const finishToken = () => {
      if (inToken) {
        tokens.push(current);
        current = '';
        inToken = false;
      }
    };

    while (i < input.length) {
      const ch = input[i]!;

      // Whitespace outside quotes ends the current token
      if (/\s/.test(ch)) {
        finishToken();
        i++;
        continue;
      }

      inToken = true;

      if (ch === '\\' && i + 1 < input.length) {
        // Backslash escape outside quotes: take next char literally
        current += input[i + 1];
        i += 2;
        continue;
      }

      if (ch === '"') {
        // Double-quoted string: handle \", \\, \$, \`
        i++; // skip opening "
        while (i < input.length && input[i] !== '"') {
          if (input[i] === '\\' && i + 1 < input.length) {
            const next = input[i + 1]!;
            if (next === '"' || next === '\\' || next === '$' || next === '`') {
              current += next;
              i += 2;
              continue;
            }
          }
          current += input[i];
          i++;
        }
        i++; // skip closing "
        continue;
      }

      if (ch === "'") {
        // Single-quoted string: everything is literal, no escape sequences
        i++; // skip opening '
        while (i < input.length && input[i] !== "'") {
          current += input[i];
          i++;
        }
        i++; // skip closing '
        continue;
      }

      // Regular character
      current += ch;
      i++;
    }

    finishToken();
    return tokens;
  }

  /**
   * Splits command chains (&&, ||, ;, |) while respecting quoted strings,
   * escape sequences, and command substitution ($(...) and backticks).
   */
  private _splitChainedCommands(command: string): string[] {
    const commands: string[] = [];
    let current = '';
    let inQuote: string | null = null;
    let parenDepth = 0; // Track $(...) nesting
    let backtickDepth = 0;

    for (let i = 0; i < command.length; i++) {
      const char = command[i]!;
      const nextChar = command[i + 1];

      // Handle escape sequences
      if (char === '\\' && !inQuote && i + 1 < command.length) {
        current += char + (nextChar ?? '');
        i++;
        continue;
      }
      if (char === '\\' && inQuote === '"' && i + 1 < command.length) {
        const next = nextChar ?? '';
        if (next === '"' || next === '\\' || next === '$' || next === '`') {
          current += char + next;
          i++;
          continue;
        }
      }

      // Track quote state
      if (char === '"' && inQuote !== "'") {
        inQuote = inQuote === '"' ? null : '"';
        current += char;
        continue;
      }
      if (char === "'" && inQuote !== '"') {
        inQuote = inQuote === "'" ? null : "'";
        current += char;
        continue;
      }

      // Track command substitution: $( ... )
      if (!inQuote && char === '$' && nextChar === '(') {
        // Enter command substitution and consume both "$("
        parenDepth++;
        current += '$(';
        i++;
        continue;
      }
      if (!inQuote && parenDepth > 0 && char === '(') {
        // Nested parentheses inside $(...) - increment depth
        parenDepth++;
        current += char;
        continue;
      }
      if (!inQuote && char === ')' && parenDepth > 0) {
        parenDepth--;
        current += char;
        continue;
      }

      // Track backtick command substitution
      if (!inQuote && char === '`') {
        backtickDepth = backtickDepth > 0 ? 0 : 1;
        current += char;
        continue;
      }

      // Only split on operators when not inside quotes or substitutions
      if (!inQuote && parenDepth === 0 && backtickDepth === 0) {
        if (char === ';') {
          if (current.trim()) commands.push(current.trim());
          current = '';
          continue;
        }
        if (char === '&' && nextChar === '&') {
          if (current.trim()) commands.push(current.trim());
          current = '';
          i++; // Skip second &
          continue;
        }
        if (char === '|' && nextChar === '|') {
          if (current.trim()) commands.push(current.trim());
          current = '';
          i++; // Skip second |
          continue;
        }
        if (char === '|') {
          if (current.trim()) commands.push(current.trim());
          current = '';
          continue;
        }
      }

      current += char;
    }

    if (current.trim()) commands.push(current.trim());
    return commands;
  }

  /**
   * Extracts the base binary name from a command string, respecting quotes
   * and escape sequences.
   */
  private _extractBaseCommand(command: string): string {
    const tokens = this._shellTokenize(command.trim());
    if (tokens.length === 0) return '';

    // Skip common variable assignments (e.g., "FOO=bar cmd")
    let cmdToken = tokens[0]!;
    let idx = 0;
    while (idx < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[idx]!)) {
      idx++;
    }
    if (idx < tokens.length) {
      cmdToken = tokens[idx]!;
    }

    return path.basename(cmdToken);
  }
}
