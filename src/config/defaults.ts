/**
 * Default configuration values for Zora.
 * These are applied when config.toml doesn't specify a value.
 * Matches the spec §7 configuration reference and docs/CONFIGURATION.md.
 */

import type {
  ZoraConfig,
  AgentConfig,
  RoutingConfig,
  FailoverConfig,
  MemoryConfig,
  SecurityConfig,
  SteeringConfig,
  NotificationsConfig,
  ProviderConfig,
  McpConfig,
} from '../types.js';

export const DEFAULT_AGENT: AgentConfig = {
  name: 'zora-agent',
  workspace: '~/.zora/workspace',
  max_parallel_jobs: 3,
  default_timeout: '2h',
  heartbeat_interval: '30m',
  log_level: 'info',
  identity: {
    soul_file: '~/.zora/workspace/SOUL.md',
  },
  resources: {
    cpu_throttle_percent: 80,
    memory_limit_mb: 4096,
    throttle_check_interval: '10s',
  },
};

export const DEFAULT_ROUTING: RoutingConfig = {
  mode: 'respect_ranking',
};

export const DEFAULT_FAILOVER: FailoverConfig = {
  enabled: true,
  auto_handoff: true,
  max_handoff_context_tokens: 50_000,
  retry_after_cooldown: true,
  max_retries: 3,
  checkpoint_on_auth_failure: true,
  notify_on_failover: true,
};

export const DEFAULT_MEMORY: MemoryConfig = {
  long_term_file: '~/.zora/memory/MEMORY.md',
  daily_notes_dir: '~/.zora/memory/daily',
  items_dir: '~/.zora/memory/items',
  categories_dir: '~/.zora/memory/categories',
  context_days: 7,
  max_context_items: 20,
  max_category_summaries: 5,
  auto_extract_interval: 10,
};

export const DEFAULT_SECURITY: SecurityConfig = {
  policy_file: '~/.zora/policy.toml',
  audit_log: '~/.zora/audit/audit.jsonl',
  audit_hash_chain: true,
  audit_single_writer: true,
  integrity_check: true,
  integrity_interval: '30m',
  integrity_includes_tool_registry: true,
  leak_detection: true,
  sanitize_untrusted_content: true,
  jit_secret_decryption: true,
};

export const DEFAULT_STEERING: SteeringConfig = {
  enabled: true,
  poll_interval: '5s',
  dashboard_port: 8070,
  notify_on_flag: true,
  flag_timeout: '10m',
  auto_approve_low_risk: true,
  always_flag_irreversible: true,
  telegram: {
    enabled: false,
    allowed_users: [],
    rate_limit_per_min: 20
  }
};

export const DEFAULT_NOTIFICATIONS: NotificationsConfig = {
  enabled: true,
  on_task_complete: true,
  on_error: true,
  on_failover: true,
  on_auth_expiry: true,
  on_all_providers_down: true,
};

export const DEFAULT_MCP: McpConfig = {
  servers: {},
};

export const DEFAULT_CONFIG: ZoraConfig = {
  agent: DEFAULT_AGENT,
  providers: [],
  routing: DEFAULT_ROUTING,
  failover: DEFAULT_FAILOVER,
  memory: DEFAULT_MEMORY,
  security: DEFAULT_SECURITY,
  steering: DEFAULT_STEERING,
  notifications: DEFAULT_NOTIFICATIONS,
  mcp: DEFAULT_MCP,
};

/**
 * Validates a provider config entry has all required fields and valid values.
 * Returns an array of error messages (empty = valid).
 */
export function validateProviderConfig(p: Partial<ProviderConfig>, index: number): string[] {
  const errors: string[] = [];
  const prefix = `providers[${index}]`;

  if (!p.name || typeof p.name !== 'string') {
    errors.push(`${prefix}.name is required and must be a string`);
  }
  if (!p.type || typeof p.type !== 'string') {
    errors.push(`${prefix}.type is required and must be a string`);
  }
  if (p.rank == null || typeof p.rank !== 'number' || p.rank < 1) {
    errors.push(`${prefix}.rank is required and must be a positive integer`);
  }
  if (!Array.isArray(p.capabilities) || p.capabilities.length === 0) {
    errors.push(`${prefix}.capabilities must be a non-empty array of strings`);
  }
  const validCostTiers = ['free', 'included', 'metered', 'premium'];
  if (!p.cost_tier || !validCostTiers.includes(p.cost_tier)) {
    errors.push(`${prefix}.cost_tier must be one of: ${validCostTiers.join(', ')}`);
  }

  return errors;
}

/**
 * Validates the full ZoraConfig.
 * Returns an array of error messages (empty = valid).
 */
export function validateConfig(config: ZoraConfig): string[] {
  const errors: string[] = [];

  // Agent validation
  if (!config.agent.name) {
    errors.push('agent.name is required');
  }
  if (config.agent.max_parallel_jobs < 1) {
    errors.push('agent.max_parallel_jobs must be >= 1');
  }
  if (config.agent.resources.cpu_throttle_percent < 1 || config.agent.resources.cpu_throttle_percent > 100) {
    errors.push('agent.resources.cpu_throttle_percent must be 1-100');
  }
  if (config.agent.resources.memory_limit_mb < 256) {
    errors.push('agent.resources.memory_limit_mb must be >= 256');
  }

  // Routing validation
  const validModes = ['respect_ranking', 'optimize_cost', 'provider_only', 'round_robin'];
  if (!validModes.includes(config.routing.mode)) {
    errors.push(`routing.mode must be one of: ${validModes.join(', ')}`);
  }
  if (config.routing.mode === 'provider_only' && !config.routing.provider_only_name) {
    errors.push('routing.provider_only_name is required when mode is provider_only');
  }

  // Provider validation
  for (let i = 0; i < config.providers.length; i++) {
    errors.push(...validateProviderConfig(config.providers[i]!, i));
  }

  // Check for duplicate provider names
  const names = config.providers.map((p) => p.name);
  const dupes = names.filter((n, i) => names.indexOf(n) !== i);
  if (dupes.length > 0) {
    errors.push(`Duplicate provider names: ${[...new Set(dupes)].join(', ')}`);
  }

  // Check for duplicate ranks
  const ranks = config.providers.filter((p) => p.enabled).map((p) => p.rank);
  const dupeRanks = ranks.filter((r, i) => ranks.indexOf(r) !== i);
  if (dupeRanks.length > 0) {
    errors.push(`Duplicate provider ranks among enabled providers: ${[...new Set(dupeRanks)].join(', ')}`);
  }

  // Failover validation
  if (config.failover.max_retries < 0) {
    errors.push('failover.max_retries must be >= 0');
  }
  if (config.failover.max_handoff_context_tokens < 1000) {
    errors.push('failover.max_handoff_context_tokens must be >= 1000');
  }

  // Steering validation
  if (config.steering.dashboard_port < 1 || config.steering.dashboard_port > 65535) {
    errors.push('steering.dashboard_port must be 1-65535');
  }

  return errors;
}
