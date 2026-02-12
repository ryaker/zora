/**
 * Capability Tokens — Worker capability enforcement.
 *
 * Spec §5.3 (WorkerCapabilityToken):
 *   - Create scoped tokens from policy
 *   - Enforce actions against token capabilities
 *   - Expiration checks
 */

import type { WorkerCapabilityToken, ZoraPolicy } from '../types.js';

const DEFAULT_EXPIRATION_MS = 30 * 60 * 1000; // 30 minutes

export interface CapabilityAction {
  type: 'path' | 'command' | 'tool';
  target: string;
}

export interface EnforcementResult {
  allowed: boolean;
  reason?: string;
}

/**
 * Create a capability token scoped from policy for a specific job.
 */
export function createCapabilityToken(
  jobId: string,
  policy: ZoraPolicy,
  overrides?: Partial<Pick<WorkerCapabilityToken, 'allowedPaths' | 'deniedPaths' | 'allowedCommands' | 'allowedTools' | 'maxExecutionTime'>>,
): WorkerCapabilityToken {
  const now = new Date();
  const maxExecTime = overrides?.maxExecutionTime ?? parseTimeToMs(policy.shell.max_execution_time);

  return {
    jobId,
    allowedPaths: overrides?.allowedPaths ?? [...policy.filesystem.allowed_paths],
    deniedPaths: overrides?.deniedPaths ?? [...policy.filesystem.denied_paths],
    allowedCommands: overrides?.allowedCommands ?? [...policy.shell.allowed_commands],
    allowedTools: overrides?.allowedTools ?? [],
    maxExecutionTime: maxExecTime,
    createdAt: now,
    expiresAt: new Date(now.getTime() + DEFAULT_EXPIRATION_MS),
  };
}

/**
 * Check if an action is within the scope of a capability token.
 */
export function enforceCapability(
  token: WorkerCapabilityToken,
  action: CapabilityAction,
): EnforcementResult {
  // Check expiration first
  if (isTokenExpired(token)) {
    return { allowed: false, reason: 'Token has expired' };
  }

  switch (action.type) {
    case 'path':
      return _enforcePath(token, action.target);
    case 'command':
      return _enforceCommand(token, action.target);
    case 'tool':
      return _enforceTool(token, action.target);
    default:
      return { allowed: false, reason: `Unknown action type: ${String(action.type)}` };
  }
}

/**
 * Check if a token has expired.
 */
export function isTokenExpired(token: WorkerCapabilityToken): boolean {
  return new Date() > token.expiresAt;
}

// ─── Private Helpers ──────────────────────────────────────────────

function _enforcePath(token: WorkerCapabilityToken, targetPath: string): EnforcementResult {
  // Check denied paths first
  for (const denied of token.deniedPaths) {
    if (targetPath === denied || targetPath.startsWith(denied + '/')) {
      return { allowed: false, reason: `Path ${targetPath} is denied by capability token` };
    }
  }

  // Check allowed paths
  for (const allowed of token.allowedPaths) {
    if (targetPath === allowed || targetPath.startsWith(allowed + '/')) {
      return { allowed: true };
    }
  }

  return { allowed: false, reason: `Path ${targetPath} is not in token's allowed paths` };
}

function _enforceCommand(token: WorkerCapabilityToken, command: string): EnforcementResult {
  const baseCommand = command.trim().split(/\s+/)[0] ?? '';

  if (token.allowedCommands.length === 0) {
    return { allowed: false, reason: 'No commands are allowed by this capability token' };
  }

  if (!token.allowedCommands.includes(baseCommand)) {
    return { allowed: false, reason: `Command '${baseCommand}' is not in token's allowed commands` };
  }

  return { allowed: true };
}

function _enforceTool(token: WorkerCapabilityToken, toolName: string): EnforcementResult {
  if (token.allowedTools.length === 0) {
    // If no tools are specified, all tools are allowed (open policy)
    return { allowed: true };
  }

  if (!token.allowedTools.includes(toolName)) {
    return { allowed: false, reason: `Tool '${toolName}' is not in token's allowed tools` };
  }

  return { allowed: true };
}

/**
 * Parse a time string like "1m", "30s", "2h" into milliseconds.
 */
function parseTimeToMs(timeStr: string): number {
  const match = /^(\d+)\s*(ms|s|m|h)$/.exec(timeStr);
  if (!match) return 60_000; // default 1 minute

  const value = parseInt(match[1]!, 10);
  const unit = match[2]!;

  switch (unit) {
    case 'ms': return value;
    case 's': return value * 1000;
    case 'm': return value * 60_000;
    case 'h': return value * 3_600_000;
    default: return 60_000;
  }
}
