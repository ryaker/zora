/**
 * Shell Tools — Execute shell commands with policy enforcement.
 *
 * Spec §5.3 "Built-in Tools":
 *   - shell_exec
 */

import { execSync } from 'node:child_process';
import { PolicyEngine } from '../security/policy-engine.js';

export interface ShellResult {
  success: boolean;
  stdout?: string;
  stderr?: string;
  error?: string;
  exitCode?: number;
}

export class ShellTools {
  private readonly _engine: PolicyEngine;
  private readonly _cwd: string;

  constructor(engine: PolicyEngine, cwd: string = process.cwd()) {
    this._engine = engine;
    this._cwd = cwd;
  }

  /**
   * Executes a shell command if allowed by policy.
   */
  execute(command: string): ShellResult {
    // Prevent shell command-substitution constructs from bypassing the allowlist,
    // e.g. "npm $(rm -rf /)" or "npm `rm -rf /`" would otherwise be seen as just "npm".
    if (/`/.test(command) || /\$\(/.test(command)) {
      return {
        success: false,
        error: 'Command substitution syntax (`..` or $()) is not allowed by security policy',
      };
    }

    const validation = this._engine.validateCommand(command);
    if (!validation.allowed) {
      return { success: false, error: validation.reason };
    }

    try {
      // For v1 we use execSync for simplicity in the tool layer.
      // The orchestrator will eventually handle async/timeout logic.
      const stdout = execSync(command, {
        cwd: this._cwd,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      return {
        success: true,
        stdout: stdout.trim(),
        exitCode: 0,
      };
    } catch (err: unknown) {
      const e = err as any; // Still need to access stdout/stderr/status
      return {
        success: false,
        stdout: e.stdout?.toString().trim(),
        stderr: e.stderr?.toString().trim(),
        error: e.message || String(err),
        exitCode: e.status ?? 1,
      };
    }
  }
}
