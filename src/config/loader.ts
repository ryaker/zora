/**
 * Config Loader — reads config.toml, merges with defaults, validates.
 *
 * Spec §4.2: Config system — TOML parser, defaults, validation.
 * Uses smol-toml for zero-dependency TOML parsing.
 */

import { readFile } from 'node:fs/promises';
import { parse as parseTOML } from 'smol-toml';
import type { ZoraConfig, ProviderConfig, McpServerEntry } from '../types.js';
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
function deepMerge<T extends Record<string, unknown>>(
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
        console.warn(`Skipping MCP server "${name}": stdio transport requires a command`);
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
        console.warn(`Skipping MCP server "${name}": http/sse transport requires a url`);
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
