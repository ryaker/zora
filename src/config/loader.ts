/**
 * Config Loader — reads config.toml, merges with defaults, validates.
 *
 * Spec §4.2: Config system — TOML parser, defaults, validation.
 * Uses smol-toml for zero-dependency TOML parsing.
 */

import { readFile } from 'node:fs/promises';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { parse as parseTOML } from 'smol-toml';
import type { ZoraConfig, ProviderConfig, McpServerEntry, HookEventName } from '../types.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('config-loader');
import { DEFAULT_CONFIG, validateConfig } from './defaults.js';

export class ConfigError extends Error {
  constructor(
    message: string,
    public readonly errors: string[],
  ) {
    super(message);
    this.name = 'ConfigError';
  }
}

/**
 * Deep merge two objects. Arrays are replaced, not merged.
 * Source values override target values.
 */
export function deepMerge<T extends Record<string, unknown>>(
  target: T,
  source: Record<string, unknown>,
): T {
  const result = { ...target };

  for (const key of Object.keys(source)) {
    const sourceVal = source[key];
    const targetVal = (result as Record<string, unknown>)[key];

    if (
      sourceVal !== null &&
      typeof sourceVal === 'object' &&
      !Array.isArray(sourceVal) &&
      targetVal !== null &&
      typeof targetVal === 'object' &&
      !Array.isArray(targetVal)
    ) {
      (result as Record<string, unknown>)[key] = deepMerge(
        targetVal as Record<string, unknown>,
        sourceVal as Record<string, unknown>,
      );
    } else {
      (result as Record<string, unknown>)[key] = sourceVal;
    }
  }

  return result;
}

/**
 * Parse raw TOML data into a ZoraConfig, applying defaults for missing fields.
 */
export function parseConfig(raw: Record<string, unknown>): ZoraConfig {
  // Start with defaults
  const config = deepMerge(
    DEFAULT_CONFIG as unknown as Record<string, unknown>,
    raw,
  ) as unknown as ZoraConfig;

  // Providers are an array in TOML ([[providers]]), need special handling
  if (Array.isArray(raw['providers'])) {
    config.providers = (raw['providers'] as Record<string, unknown>[]).map(
      (p) => ({
        name: '',
        type: '',
        rank: 0,
        capabilities: [],
        cost_tier: 'metered' as const,
        enabled: true,
        ...p,
      }) as ProviderConfig,
    );
  }

  // Handle MCP config
  if (raw['mcp'] && typeof raw['mcp'] === 'object') {
    const mcpRaw = raw['mcp'] as Record<string, unknown>;
    if (mcpRaw['servers'] && typeof mcpRaw['servers'] === 'object') {
      config.mcp = {
        servers: mcpRaw['servers'] as Record<string, McpServerEntry>,
      };
    }
  }

  // Sanitize project config — non-fatal, fall back to defaults on invalid values
  if (config.project) {
    if (config.project.color && !/^#[0-9A-Fa-f]{6}$/.test(config.project.color)) {
      log.warn({ color: config.project.color }, 'project.color must be a 6-digit hex color (e.g. #ff6b6b) — ignoring');
      config.project.color = undefined;
    }
    if (config.project.name != null && typeof config.project.name !== 'string') {
      log.warn({ name: config.project.name }, 'project.name must be a string — ignoring');
      config.project.name = undefined;
    } else if (typeof config.project.name === 'string' && config.project.name.length > 40) {
      log.warn('project.name exceeds 40 characters — truncating');
      config.project.name = config.project.name.slice(0, 40);
    }
  }

  // ORCH-12: Handle [[hooks]] config
  const VALID_HOOK_EVENTS = new Set<string>(['onTaskStart', 'beforeToolExecute', 'afterToolExecute', 'onTaskEnd']);
  if (Array.isArray(raw['hooks'])) {
    config.hooks = (raw['hooks'] as Record<string, unknown>[])
      .filter((h) => {
        const event = h['event'] as string | undefined;
        if (!event || !VALID_HOOK_EVENTS.has(event)) {
          log.warn({ event }, 'Skipping hook with invalid event name');
          return false;
        }
        return true;
      })
      .map((h) => ({
        event: h['event'] as HookEventName,
        match: h['match'] as string | undefined,
        script: h['script'] as string | undefined,
      }));
  }

  return config;
}

/**
 * Load config from a TOML file path. Merges with defaults and validates.
 * Throws ConfigError if validation fails.
 */
export async function loadConfig(configPath: string): Promise<ZoraConfig> {
  const content = await readFile(configPath, 'utf-8');
  const raw = parseTOML(content) as Record<string, unknown>;
  const config = parseConfig(raw);

  const errors = validateConfig(config);
  if (errors.length > 0) {
    throw new ConfigError(
      `Invalid configuration (${errors.length} error${errors.length > 1 ? 's' : ''})`,
      errors,
    );
  }

  return config;
}

/**
 * Load config from a TOML string. Useful for testing.
 */
export function loadConfigFromString(toml: string): ZoraConfig {
  const raw = parseTOML(toml) as Record<string, unknown>;
  const config = parseConfig(raw);

  const errors = validateConfig(config);
  if (errors.length > 0) {
    throw new ConfigError(
      `Invalid configuration (${errors.length} error${errors.length > 1 ? 's' : ''})`,
      errors,
    );
  }

  return config;
}

/**
 * Resolve config via three-layer merge: defaults → global → project.
 *
 * Resolution order:
 *   1. Built-in defaults (DEFAULT_CONFIG)
 *   2. ~/.zora/config.toml (global user config)
 *   3. Project config, resolved as:
 *      - <configDir>/config.toml if `configDir` option or ZORA_CONFIG_DIR env var is set
 *      - <projectDir>/.zora/config.toml otherwise
 *
 * Arrays (providers, hooks) are replaced, not merged — a project that
 * defines [[providers]] gets ONLY those providers.
 */
export async function resolveConfig(options?: {
  cwd?: string;
  projectDir?: string;
  /** Directly specify a config directory (contains config.toml). Also reads ZORA_CONFIG_DIR env var. */
  configDir?: string;
}): Promise<{ config: ZoraConfig; sources: string[] }> {
  const globalPath = path.join(os.homedir(), '.zora', 'config.toml');
  const projectBase = options?.projectDir ?? options?.cwd ?? process.cwd();

  // configDir: explicit option > ZORA_CONFIG_DIR env var > derived from projectDir.
  // projectDir and configDir are orthogonal: projectDir says WHERE the project lives,
  // configDir says WHERE to read config from. ZORA_CONFIG_DIR is only suppressed when
  // the caller explicitly passes options.configDir (not projectDir/cwd), so that the
  // daemon can set ZORA_PROJECT_DIR + ZORA_CONFIG_DIR independently.
  // Guard against empty string (e.g. ZORA_CONFIG_DIR="" set but blank).
  // Normalize: trim whitespace and treat blank strings as absent so that
  // ZORA_CONFIG_DIR="  " or options.configDir="" don't silently override derived paths.
  const normalizeDir = (v?: string): string | undefined => v?.trim() || undefined;
  const envConfigDir = !options?.configDir ? normalizeDir(process.env['ZORA_CONFIG_DIR']) : undefined;
  const explicitConfigDir = normalizeDir(options?.configDir) || envConfigDir || undefined;
  const projectPath = explicitConfigDir
    ? path.join(explicitConfigDir.replace(/^~/, os.homedir()), 'config.toml')
    : path.join(projectBase, '.zora', 'config.toml');

  // Layer 1: defaults
  let merged = { ...DEFAULT_CONFIG } as unknown as Record<string, unknown>;
  const sources: string[] = ['defaults'];

  // Layer 2: global
  if (fs.existsSync(globalPath)) {
    const globalRaw = parseTOML(await readFile(globalPath, 'utf-8')) as Record<string, unknown>;
    merged = deepMerge(merged, globalRaw);
    sources.push(globalPath);
  }

  // Layer 3: project (if exists and different from global)
  if (
    fs.existsSync(projectPath) &&
    path.resolve(projectPath) !== path.resolve(globalPath)
  ) {
    const projectRaw = parseTOML(await readFile(projectPath, 'utf-8')) as Record<string, unknown>;
    merged = deepMerge(merged, projectRaw);
    sources.push(projectPath);
  }

  const config = parseConfig(merged);
  const errors = validateConfig(config);
  if (errors.length > 0) {
    throw new ConfigError(
      `Invalid configuration (${errors.length} error${errors.length > 1 ? 's' : ''})`,
      errors,
    );
  }

  return { config, sources };
}

/**
 * Converts Zora MCP server config to the SDK's McpServerConfig format.
 * SDK types: McpStdioServerConfig | McpSSEServerConfig | McpHttpServerConfig
 */
export function toSdkMcpServers(
  servers: Record<string, McpServerEntry>,
): Record<string, Record<string, unknown>> {
  const result: Record<string, Record<string, unknown>> = {};

  for (const [name, server] of Object.entries(servers)) {
    if (server.type === 'stdio' || (!server.type && server.command)) {
      // stdio transport
      if (!server.command) {
        log.warn({ server: name }, 'Skipping MCP server: stdio transport requires a command');
        continue;
      }
      result[name] = {
        command: server.command,
        ...(server.args && { args: server.args }),
        ...(server.env && { env: server.env }),
      };
    } else {
      // HTTP or SSE transport
      if (!server.url) {
        log.warn({ server: name }, 'Skipping MCP server: http/sse transport requires a url');
        continue;
      }
      result[name] = {
        type: server.type ?? 'http',
        url: server.url,
        ...(server.headers && { headers: server.headers }),
      };
    }
  }

  return result;
}
