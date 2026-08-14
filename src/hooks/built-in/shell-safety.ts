/**
 * ShellSafetyHook — Blocks dangerous shell command patterns.
 * Applies to the 'bash' tool (and any alias: 'shell', 'run_command').
 */

import type { ToolHook, ToolCallContext, ToolHookResult } from '../tool-hook-runner.js';
import { SHELL_TOOL_ALIASES } from '../../security/tool-names.js';

const BLOCKED_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /rm\s+-[a-z]*r[a-z]*\s+\/(?!\s*tmp)/i, reason: 'rm -rf on non-tmp path' },
  { pattern: /:\s*\(\s*\)\s*\{.*\}/,                  reason: 'fork bomb pattern' },
  { pattern: /\|\s*bash\b|\|\s*sh\b/i,                reason: 'pipe-to-shell' },
  { pattern: /curl\s+.*\|\s*(bash|sh)\b/i,             reason: 'curl-pipe-to-shell' },
  { pattern: /wget\s+.*\|\s*(bash|sh)\b/i,             reason: 'wget-pipe-to-shell' },
  { pattern: /chmod\s+777\s+\//i,                      reason: 'chmod 777 on root path' },
  { pattern: /mkfs\b/i,                                reason: 'filesystem format command' },
  { pattern: />\s*\/dev\/sd[a-z]/i,                    reason: 'write to block device' },
];

export const ShellSafetyHook: ToolHook = {
  name: 'shell-safety',
  phase: 'before',
  // SEC-23 made ToolHookRunner match this filter case-insensitively so `Bash`
  // reaches it at all. SEC-24 points it at the shared alias list so the filter
  // and every other shell gate in the codebase name the same set of tools.
  tools: [...SHELL_TOOL_ALIASES],

  async run(ctx: ToolCallContext): Promise<ToolHookResult> {
    const rawCmd = String(ctx.arguments['command'] ?? ctx.arguments['cmd'] ?? '');
    // Normalize path traversal segments (e.g. /tmp/../home → /home) before
    // pattern matching so that directory-traversal bypasses are caught.
    const cmd = rawCmd
      .replace(/\/[^/\s]+\/\.\.\//g, '/')
      .replace(/\/\.\.\//g, '/');

    for (const { pattern, reason } of BLOCKED_PATTERNS) {
      if (pattern.test(cmd)) {
        return { allow: false, reason: `Blocked shell command: ${reason}` };
      }
    }

    return { allow: true };
  },
};
