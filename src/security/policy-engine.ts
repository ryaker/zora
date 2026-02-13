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
        if (command) {
          const result = this.validateCommand(command);
          if (!result.allowed) {
            return {
              behavior: 'deny' as const,
              message: result.reason ?? 'Command denied by policy',
            };
          }
        }
      }

      // File operations: Read, Write, Edit
      if (toolName === 'Read' || toolName === 'Write' || toolName === 'Edit') {
        const filePath = input['file_path'] as string | undefined;
        if (filePath) {
          const result = this.validatePath(filePath);
          if (!result.allowed) {
            return {
              behavior: 'deny' as const,
              message: result.reason ?? 'Path denied by policy',
            };
          }
        }
      }

      // Glob — validate the search path if provided
      if (toolName === 'Glob') {
        const globPath = input['path'] as string | undefined;
        if (globPath) {
          const result = this.validatePath(globPath);
          if (!result.allowed) {
            return {
              behavior: 'deny' as const,
              message: result.reason ?? 'Path denied by policy',
            };
          }
        }
      }

      // Grep — validate the search path if provided
      if (toolName === 'Grep') {
        const grepPath = input['path'] as string | undefined;
        if (grepPath) {
          const result = this.validatePath(grepPath);
          if (!result.allowed) {
            return {
              behavior: 'deny' as const,
              message: result.reason ?? 'Path denied by policy',
            };
          }
        }
      }

      // Default: allow the tool call
      return { behavior: 'allow' as const, updatedInput: input };
    };
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
   * Splits command chains (&&, ||, ;, |) while respecting quoted strings.
   */
  private _splitChainedCommands(command: string): string[] {
    // Simple but more robust parser that respects quotes
    const commands: string[] = [];
    let current = '';
    let inQuote: string | null = null;

    for (let i = 0; i < command.length; i++) {
      const char = command[i]!;
      const nextChar = command[i + 1];

      if ((char === '"' || char === "'") && command[i - 1] !== '\\') {
        if (inQuote === char) {
          inQuote = null;
        } else if (!inQuote) {
          inQuote = char;
        }
        current += char;
      } else if (!inQuote && (char === ';' || (char === '&' && nextChar === '&') || (char === '|' && nextChar === '|'))) {
        if (current.trim()) commands.push(current.trim());
        current = '';
        if (char !== ';') i++; // Skip the second char of && or ||
      } else if (!inQuote && char === '|') {
        if (current.trim()) commands.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }

    if (current.trim()) commands.push(current.trim());
    return commands;
  }

  /**
   * Extracts the base binary name from a command string, respecting quotes.
   */
  private _extractBaseCommand(command: string): string {
    const trimmed = command.trim();
    let firstPart = '';
    let inQuote: string | null = null;

    for (let i = 0; i < trimmed.length; i++) {
      const char = trimmed[i]!;
      if ((char === '"' || char === "'") && trimmed[i - 1] !== '\\') {
        if (inQuote === char) {
          inQuote = null;
        } else if (!inQuote) {
          inQuote = char;
        }
      } else if (!inQuote && /\s/.test(char)) {
        break;
      } else {
        firstPart += char;
      }
    }

    // Remove surrounding quotes from the binary path if they exist
    const binaryPath = firstPart.replace(/^["']|["']$/g, '');
    return path.basename(binaryPath);
  }
}
