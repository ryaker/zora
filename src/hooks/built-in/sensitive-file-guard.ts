/**
 * SensitiveFileGuardHook — Hard-coded, non-bypassable protection for secrets.
 *
 * Blocks any tool call that would read or list files matching known sensitive
 * path patterns (secrets files, private keys, cloud credentials, etc.).
 *
 * WHY THIS IS IN CODE (NOT CONFIG):
 *   policy.toml's denied_paths is user-editable — an attacker who can modify
 *   config can simply remove entries from that list. This hook is registered
 *   unconditionally in the orchestrator and cannot be disabled without a code
 *   change. It acts as a second, immutable layer below the policy engine.
 *
 * COVERAGE:
 *   - File tools: Read, Glob, Grep (via file_path / path / pattern arguments)
 *   - Shell: Bash / shell / execute_bash commands that read sensitive files
 *     (cat, head, tail, less, more, strings, xxd, hexdump, base64, openssl)
 *
 * ADDING NEW PATTERNS:
 *   Add to SENSITIVE_PATH_PATTERNS (for file tools) or SENSITIVE_SHELL_PATTERNS
 *   (for Bash commands). Both lists are checked against normalized paths so
 *   tildes and path-traversal sequences are resolved before matching.
 */

import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import type { ToolHook, ToolCallContext, ToolHookResult } from '../tool-hook-runner.js';
import { createLogger } from '../../utils/logger.js';
import { toolFilterMatches, SHELL_TOOL_ALIASES } from '../../security/tool-names.js';

/**
 * Tools whose arguments name a file directly.
 *
 * SEC-24: `NotebookEdit` and `create_file` were missing — the set was written
 * before either existed, and nothing noticed because the comparison was a
 * private lowercase `Set.has()` that no test exercised with real SDK names.
 */
const FILE_TOOL_NAMES = [
  'read', 'read_file', 'grep', 'glob',
  'write', 'write_file', 'create_file',
  'edit', 'edit_file', 'multiedit', 'notebookedit',
] as const;

const log = createLogger('sensitive-file-guard');

// ─── Sensitive path patterns ────────────────────────────────────────────────
// Matched against the FULL normalized absolute path.

const SENSITIVE_FULLPATH_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  // SSH directory (with or without trailing slash)
  { pattern: /[/\\]\.ssh([/\\]|$)/i,            label: '.ssh directory' },
  // GPG / PGP
  { pattern: /[/\\]\.gnupg([/\\]|$)/i,          label: '.gnupg directory' },
  // Cloud provider credentials
  { pattern: /[/\\]\.aws[/\\]credentials$/i,     label: 'AWS credentials' },
  { pattern: /[/\\]\.aws[/\\]config$/i,          label: 'AWS config' },
  { pattern: /[/\\]\.azure([/\\]|$)/i,           label: 'Azure credentials directory' },
  { pattern: /[/\\]\.config[/\\]gcloud([/\\]|$)/i, label: 'GCloud credentials directory' },
  // macOS Keychain
  { pattern: /[/\\]Library[/\\]Keychains([/\\]|$)/i, label: 'macOS Keychain' },
  // Password manager store
  { pattern: /[/\\]\.password-store([/\\]|$)/i, label: 'pass password store' },
  // Generic secret/token file names
  { pattern: /[/\\](api[_-]?keys?|tokens?|credentials?)[/\\][^/\\]*\.(json|yaml|yml|toml)$/i,
                                                  label: 'credential config file' },
];

// ─── Sensitive basename/extension patterns ───────────────────────────────────
// Matched against the BASENAME only — catches relative paths like ".env",
// "server.pem", "id_rsa" that wouldn't have a parent-directory component.

const SENSITIVE_BASENAME_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /^secrets?\.env$/i,                label: 'secrets env file' },
  { pattern: /^\.env$/i,                        label: '.env file' },
  { pattern: /^\.env\.[^/\\]+$/i,              label: '.env variant' },
  { pattern: /^\.envrc$/i,                      label: '.envrc file' },
  { pattern: /^id_rsa$/i,                       label: 'RSA private key' },
  { pattern: /^id_ed25519$/i,                   label: 'Ed25519 private key' },
  { pattern: /^id_ecdsa$/i,                     label: 'ECDSA private key' },
  { pattern: /^id_dsa$/i,                       label: 'DSA private key' },
  { pattern: /\.pem$/i,                         label: 'PEM certificate/key file' },
  { pattern: /\.p12$/i,                         label: 'PKCS#12 keystore' },
  { pattern: /\.pfx$/i,                         label: 'PFX keystore' },
  { pattern: /\.kdbx$/i,                        label: 'KeePass database' },
  { pattern: /\.1pif$/i,                        label: '1Password export' },
];

// ─── Sensitive shell command patterns ────────────────────────────────────────
// Applied to the command string on Bash/shell tools.
// Uses the SENSITIVE_PATH_PATTERNS above so the logic stays DRY.

const SHELL_READ_COMMANDS = /\b(cat|head|tail|less|more|strings|xxd|hexdump|base64|openssl|gpg|ssh-keygen)\b/i;

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Normalize a path: expand ~, resolve relative segments, and follow symlinks. */
function normalizePath(raw: string): string {
  if (!raw) return '';
  const expanded = raw.startsWith('~')
    ? path.join(os.homedir(), raw.slice(1))
    : raw;
  // Resolve '..' sequences first (path.normalize doesn't require the file to exist)
  const normalized = path.normalize(expanded);
  // Then attempt to resolve symlinks so a symlink into a sensitive dir is caught.
  // realpathSync throws if the path doesn't exist — fall back to the normalized form.
  try {
    return fs.realpathSync(normalized);
  } catch {
    return normalized;
  }
}

/** @deprecated use extractFileTokensFromCommand */
function extractPathsFromCommand(cmd: string): string[] {
  return extractFileTokensFromCommand(cmd);
}

/** Return the label of the first matching sensitive pattern, or null. */
function matchesSensitivePath(normalizedPath: string): string | null {
  for (const { pattern, label } of SENSITIVE_FULLPATH_PATTERNS) {
    if (pattern.test(normalizedPath)) return label;
  }
  const basename = path.basename(normalizedPath);
  for (const { pattern, label } of SENSITIVE_BASENAME_PATTERNS) {
    if (pattern.test(basename)) return label;
  }
  return null;
}

/** Extract all file-like tokens from a shell command (by extension or flag). */
function extractFileTokensFromCommand(cmd: string): string[] {
  // Strip surrounding quotes from a token (handles both single and double quotes)
  const unquote = (s: string) => s.replace(/^['"]|['"]$/g, '');

  // Match path-like tokens: unquoted (~/…, /…, ../…) and quoted variants
  const pathTokens = cmd.match(
    /(?:['"](?:~\/|\/|\.\.?\/)(?:[^'"]+)['"]|~\/[^\s;|&>'"` ]+|\/[^\s;|&>'"` ]+|\.\.?\/[^\s;|&>'"` ]+)/g,
  )?.map(unquote) ?? [];

  // Also grab tokens after -in, -keyfile, -cert, -key flags (common in openssl, ssh commands)
  // Strip surrounding quotes from flag values (handles -in "~/.ssh/key.pem" and -in '~/.env')
  const flagValueTokens = [...cmd.matchAll(/(?:-in|-keyfile|-cert|-key|-f)\s+(['"]?)([^\s;|&>]+)\1/gi)]
    .map(m => m[2] ?? '');

  // Bare filenames (no directory component) adjacent to read commands — check by extension
  const bareTokens = cmd.match(/\b[\w.-]+\.(pem|p12|pfx|kdbx|1pif|env)\b/gi) ?? [];

  return [...pathTokens, ...flagValueTokens, ...bareTokens].map(normalizePath);
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export const SensitiveFileGuardHook: ToolHook = {
  name: 'sensitive-file-guard',
  phase: 'before',
  // No tools filter — applies to ALL tools so it catches Read, Grep, Glob, Bash, etc.

  async run(ctx: ToolCallContext): Promise<ToolHookResult> {
    // SEC-24: was `ctx.tool.toLowerCase()` — a fourth private normalisation.
    // Lowercasing alone happened to cover the SDK's `Read`/`Write`/`Edit`, but
    // not an MCP-qualified `mcp__zora-tools__read_file`, which slipped past the
    // guard entirely. Route through the shared normaliser like every other gate.
    if (toolFilterMatches(FILE_TOOL_NAMES, ctx.tool)) {
      // Collect candidate path arguments
      const pathArgs = [
        ctx.arguments['file_path'],
        ctx.arguments['path'],
        ctx.arguments['notebook_path'],  // SEC-24: NotebookEdit's path argument
        ctx.arguments['pattern'],   // Glob pattern may include directory
      ]
        .filter((v): v is string => typeof v === 'string')
        .map(normalizePath);

      for (const p of pathArgs) {
        const label = matchesSensitivePath(p);
        if (label) {
          log.warn(
            { tool: ctx.tool, jobId: ctx.jobId, path: p, label },
            'Sensitive file access blocked by SensitiveFileGuardHook',
          );
          return {
            allow: false,
            reason: `Access to sensitive file blocked (${label}): ${p}`,
          };
        }
      }
    }

    // ── Shell tools: Bash, shell, execute_bash ─────────────────────────────
    if (toolFilterMatches(SHELL_TOOL_ALIASES, ctx.tool)) {
      const cmd = String(ctx.arguments['command'] ?? ctx.arguments['cmd'] ?? '');

      // Only check commands that involve reading file contents
      if (SHELL_READ_COMMANDS.test(cmd)) {
        const paths = extractPathsFromCommand(cmd);
        for (const p of paths) {
          const label = matchesSensitivePath(p);
          if (label) {
            log.warn(
              { tool: ctx.tool, jobId: ctx.jobId, cmd, path: p, label },
              'Shell read of sensitive file blocked by SensitiveFileGuardHook',
            );
            return {
              allow: false,
              reason: `Shell access to sensitive file blocked (${label}): ${p}`,
            };
          }
        }
      }
    }

    return { allow: true };
  },
};
