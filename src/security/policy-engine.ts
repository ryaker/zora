/**
 * PolicyEngine — Enforcement of the Zora security policy.
 *
 * Spec §5.3 "Capability Policy Engine":
 *   - Path resolution (resolving ~, canonicalization)
 *   - Symlink handling (follow_symlinks check)
 *   - Command allowlist validation
 *   - Chained command splitting
 */

import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import type { ZoraPolicy, FilesystemPolicy } from '../types.js';

export interface ValidationResult {
  allowed: boolean;
  reason?: string;
  resolvedPath?: string;
}

export class PolicyEngine {
  private readonly _policy: ZoraPolicy;
  private readonly _homeDir: string;

  constructor(policy: ZoraPolicy) {
    this._policy = policy;
    this._homeDir = os.homedir();
  }

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
      // If target is a symlink and we don't follow, we must ensure the symlink 
      // target itself is also within bounds.
      try {
        const realPath = fs.realpathSync(absolutePath);
        if (!this._isWithinAllowedPaths(realPath, fsPolicy)) {
          return {
            allowed: false,
            reason: `Symlink target ${realPath} is outside allowed boundaries`,
          };
        }
      } catch (err) {
        // If file doesn't exist yet (e.g. for write_file), we skip realpath check
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

    return { allowed: true };
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
   * Splits command chains (&&, ||, ;, |)
   */
  private _splitChainedCommands(command: string): string[] {
    // This is a naive split. A robust implementation would handle quoted strings.
    // For v1, we split on common operators.
    return command.split(/[&|;]+/).map(c => c.trim()).filter(Boolean);
  }

  /**
   * Extracts the base binary name from a command string.
   * e.g. "npm install" -> "npm"
   */
  private _extractBaseCommand(command: string): string {
    const parts = command.trim().split(/\s+/);
    const cmd = parts[0] ?? '';
    // Handle relative/absolute paths to binaries (extract just the name)
    return path.basename(cmd);
  }
}
