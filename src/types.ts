/**
 * Zora Core Types — v0.5
 *
 * All types defined in the spec §4.2. This file is the single source of truth
 * for shared interfaces across the codebase.
 */

// ─── Provider Capabilities & Cost ────────────────────────────────────

/**
 * Provider capability tags used for task routing.
 * Users can extend with arbitrary strings.
 */
export type ProviderCapability =
  | 'reasoning'
  | 'coding'
  | 'creative'
  | 'structured-data'
  | 'large-context'
  | 'search'
  | 'fast'
  | (string & {}); // custom capabilities

/**
 * Cost classification for routing decisions.
 */
export type CostTier = 'free' | 'included' | 'metered' | 'premium';

/**
 * Routing modes controlling provider selection strategy.
 */
export type RoutingMode =
  | 'respect_ranking'
  | 'optimize_cost'
  | 'provider_only'
  | 'round_robin';

// ─── Auth & Quota ────────────────────────────────────────────────────

export interface AuthStatus {
  valid: boolean;
  expiresAt: Date | null;
  canAutoRefresh: boolean;
  requiresInteraction: boolean;
}

export interface QuotaStatus {
  isExhausted: boolean;
  remainingRequests: number | null;
  cooldownUntil: Date | null;
  healthScore: number; // 0-1
}

// ─── Agent Events ────────────────────────────────────────────────────

export type AgentEventType =
  | 'thinking'
  | 'tool_call'
  | 'tool_result'
  | 'text'
  | 'error'
  | 'done';

export interface AgentEvent {
  type: AgentEventType;
  timestamp: Date;
  content: unknown;
}

// ─── Task Context ────────────────────────────────────────────────────

/**
 * Complexity classification for routing decisions.
 * Spec §5.1: "When a new task arrives, the Router classifies it along two axes"
 */
export type TaskComplexity = 'simple' | 'moderate' | 'complex';

/**
 * Resource type classification for routing.
 */
export type TaskResourceType =
  | 'reasoning'
  | 'coding'
  | 'data'
  | 'creative'
  | 'search'
  | 'mixed';

export interface TaskContext {
  jobId: string;
  task: string;
  requiredCapabilities: ProviderCapability[];
  complexity: TaskComplexity;
  resourceType: TaskResourceType;
  systemPrompt: string;
  memoryContext: string[];
  history: AgentEvent[];
  modelPreference?: string; // per-routine override
  maxTurns?: number;
  timeout?: number;
}

// ─── LLM Provider Interface ─────────────────────────────────────────

/**
 * The core provider contract. All providers (Claude, Gemini, OpenAI, Ollama, custom)
 * implement this interface. See spec §4.2.
 */
export interface LLMProvider {
  readonly name: string;
  readonly rank: number;
  readonly capabilities: ProviderCapability[];
  readonly costTier: CostTier;

  isAvailable(): Promise<boolean>;
  checkAuth(): Promise<AuthStatus>;
  getQuotaStatus(): Promise<QuotaStatus>;
  execute(task: TaskContext): AsyncGenerator<AgentEvent>;
  abort(jobId: string): Promise<void>;
}

// ─── Handoff Bundle ──────────────────────────────────────────────────

export interface HandoffBundle {
  jobId: string;
  fromProvider: string;
  toProvider: string;
  createdAt: Date;
  task: string;
  context: {
    summary: string;
    progress: string[];
    artifacts: string[];
  };
  toolHistory: Array<{
    toolCallId: string;
    tool: string;
    arguments: Record<string, unknown>;
    result?: {
      status: 'ok' | 'error';
      output?: string;
      error?: string;
    };
  }>;
}

// ─── Audit Event ─────────────────────────────────────────────────────

export type AuditEventType =
  | 'tool_invocation'
  | 'tool_result'
  | 'policy_violation'
  | 'handoff'
  | 'auth_error'
  | 'notification';

export interface AuditEvent {
  eventId: string;
  jobId: string;
  eventType: AuditEventType;
  timestamp: Date;
  payload: Record<string, unknown>;
}

// ─── Configuration Types ─────────────────────────────────────────────

export interface ProviderConfig {
  name: string;
  type: string;
  rank: number;
  capabilities: ProviderCapability[];
  cost_tier: CostTier;
  enabled: boolean;
  auth_method?: string;
  model?: string;
  max_turns?: number;
  max_concurrent_jobs?: number;
  cli_path?: string;
  api_key_env?: string;
  endpoint?: string;
}

export interface AgentConfig {
  name: string;
  workspace: string;
  max_parallel_jobs: number;
  default_timeout: string;
  heartbeat_interval: string;
  log_level: 'debug' | 'info' | 'warn' | 'error';
  identity: {
    soul_file: string;
  };
  resources: {
    cpu_throttle_percent: number;
    memory_limit_mb: number;
    throttle_check_interval: string;
  };
}

export interface RoutingConfig {
  mode: RoutingMode;
  provider_only_name?: string;
}

export interface FailoverConfig {
  enabled: boolean;
  auto_handoff: boolean;
  max_handoff_context_tokens: number;
  retry_after_cooldown: boolean;
  max_retries: number;
  checkpoint_on_auth_failure: boolean;
  notify_on_failover: boolean;
}

export interface MemoryConfig {
  long_term_file: string;
  daily_notes_dir: string;
  items_dir: string;
  categories_dir: string;
  context_days: number;
  max_context_items: number;
  max_category_summaries: number;
  auto_extract_interval: number;
}

export interface SecurityConfig {
  policy_file: string;
  audit_log: string;
  audit_hash_chain: boolean;
  audit_single_writer: boolean;
  integrity_check: boolean;
  integrity_interval: string;
  integrity_includes_tool_registry: boolean;
  leak_detection: boolean;
  sanitize_untrusted_content: boolean;
  jit_secret_decryption: boolean;
}

export interface SteeringConfig {
  enabled: boolean;
  poll_interval: string;
  dashboard_port: number;
  notify_on_flag: boolean;
  flag_timeout: string;
  auto_approve_low_risk: boolean;
  always_flag_irreversible: boolean;
}

export interface NotificationsConfig {
  enabled: boolean;
  on_task_complete: boolean;
  on_error: boolean;
  on_failover: boolean;
  on_auth_expiry: boolean;
  on_all_providers_down: boolean;
}

/**
 * Complete Zora configuration matching config.toml structure.
 */
export interface ZoraConfig {
  agent: AgentConfig;
  providers: ProviderConfig[];
  routing: RoutingConfig;
  failover: FailoverConfig;
  memory: MemoryConfig;
  security: SecurityConfig;
  steering: SteeringConfig;
  notifications: NotificationsConfig;
}

// ─── Policy Types ────────────────────────────────────────────────────

export interface FilesystemPolicy {
  allowed_paths: string[];
  denied_paths: string[];
  resolve_symlinks: boolean;
  follow_symlinks: boolean;
}

export interface ShellPolicy {
  mode: 'allowlist' | 'denylist' | 'deny_all';
  allowed_commands: string[];
  denied_commands: string[];
  split_chained_commands: boolean;
  max_execution_time: string;
}

export interface ActionsPolicy {
  reversible: string[];
  irreversible: string[];
  always_flag: string[];
}

export interface NetworkPolicy {
  allowed_domains: string[];
  denied_domains: string[];
  max_request_size: string;
}

export interface ZoraPolicy {
  filesystem: FilesystemPolicy;
  shell: ShellPolicy;
  actions: ActionsPolicy;
  network: NetworkPolicy;
}

// ─── Worker Capability Token ─────────────────────────────────────────

export interface WorkerCapabilityToken {
  jobId: string;
  allowedPaths: string[];
  deniedPaths: string[];
  allowedCommands: string[];
  allowedTools: string[];
  maxExecutionTime: number;
  createdAt: Date;
  expiresAt: Date;
}
