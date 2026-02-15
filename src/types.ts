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

/** Extended usage snapshot for dashboard display */
export interface ProviderUsage {
  totalCostUsd: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  requestCount: number;
  lastRequestAt: Date | null;
}

/** Combined provider status for the /api/quota endpoint */
export interface ProviderQuotaSnapshot {
  name: string;
  auth: AuthStatus;
  quota: QuotaStatus;
  usage: ProviderUsage;
  costTier: CostTier;
}

// ─── Agent Events ────────────────────────────────────────────────────

export type AgentEventType =
  | 'thinking'
  | 'tool_call'
  | 'tool_result'
  | 'text'
  | 'error'
  | 'done'
  | 'steering';

/** TYPE-06: Typed event payload interfaces for each event type */
export interface TextEventContent {
  text: string;
  metadata?: Record<string, unknown>;
}

export interface ThinkingEventContent {
  text: string;
}

export interface ToolCallEventContent {
  toolCallId: string;
  tool: string;
  arguments: Record<string, unknown>;
}

export interface ToolResultEventContent {
  toolCallId: string;
  result: unknown;
  error?: string;
}

export interface ErrorEventContent {
  message: string;
  code?: number | string;
  isAuthError?: boolean;
  isQuotaError?: boolean;
  subtype?: string;
  details?: Record<string, unknown>;
}

export interface DoneEventContent {
  text: string;
  duration_ms?: number;
  num_turns?: number;
  total_cost_usd?: number;
  model?: string;
  aborted?: boolean;
  [key: string]: unknown;
}

export interface SteeringEventContent {
  text: string;
  source: string;
  author: string;
}

/** Discriminated union of all typed event payloads */
export type AgentEventContent =
  | TextEventContent
  | ThinkingEventContent
  | ToolCallEventContent
  | ToolResultEventContent
  | ErrorEventContent
  | DoneEventContent
  | SteeringEventContent;

export interface AgentEvent {
  type: AgentEventType;
  timestamp: Date;
  /** LOG-04: Provider or component that emitted this event (e.g. 'claude', 'gemini', 'system') */
  source?: string;
  content: unknown;
}

/**
 * Type-safe event accessors. Use these helpers to narrow event content
 * after checking event.type via discriminated union pattern.
 */
export function isTextEvent(event: AgentEvent): event is AgentEvent & { content: TextEventContent } {
  return event.type === 'text';
}

export function isToolCallEvent(event: AgentEvent): event is AgentEvent & { content: ToolCallEventContent } {
  return event.type === 'tool_call';
}

export function isToolResultEvent(event: AgentEvent): event is AgentEvent & { content: ToolResultEventContent } {
  return event.type === 'tool_result';
}

export function isErrorEvent(event: AgentEvent): event is AgentEvent & { content: ErrorEventContent } {
  return event.type === 'error';
}

export function isDoneEvent(event: AgentEvent): event is AgentEvent & { content: DoneEventContent } {
  return event.type === 'done';
}

export function isSteeringEvent(event: AgentEvent): event is AgentEvent & { content: SteeringEventContent } {
  return event.type === 'steering';
}

export function isThinkingEvent(event: AgentEvent): event is AgentEvent & { content: ThinkingEventContent } {
  return event.type === 'thinking';
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
  modelPreference?: string; // per-routine override (provider name)
  maxCostTier?: CostTier;   // cost ceiling for routing (e.g. 'included' skips 'premium')
  maxTurns?: number;
  timeout?: number;
  /** SDK canUseTool callback — enforces policy on every tool call */
  canUseTool?: (
    toolName: string,
    input: Record<string, unknown>,
    options: { signal: AbortSignal },
  ) => Promise<{ behavior: 'allow' | 'deny'; message?: string; updatedInput?: Record<string, unknown> }>;
}

// ─── LLM Provider Interface ─────────────────────────────────────────

/**
 * TYPE-07: Known provider types for exhaustiveness checking in factory/switch code.
 * Adding a new provider? Add its config type string here so the compiler
 * flags every switch that needs updating.
 */
export type KnownProviderType = 'claude-sdk' | 'gemini-cli' | 'ollama';

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
  getUsage(): ProviderUsage;
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

/** TYPE-04: Base config shared by all providers */
export interface BaseProviderConfig {
  name: string;
  rank: number;
  capabilities: ProviderCapability[];
  cost_tier: CostTier;
  enabled: boolean;
  model?: string;
  max_turns?: number;
  max_concurrent_jobs?: number;
}

/** TYPE-04: Claude SDK provider config */
export interface ClaudeProviderConfig extends BaseProviderConfig {
  type: 'claude-sdk';
  auth_method?: 'mac_session' | 'api_key';
  api_key_env?: string;
}

/** TYPE-04: Gemini CLI provider config */
export interface GeminiProviderConfig extends BaseProviderConfig {
  type: 'gemini-cli';
  auth_method?: 'workspace_sso' | 'api_key';
  cli_path?: string;
  api_key_env?: string;
}

/** TYPE-04: Ollama local provider config */
export interface OllamaProviderConfig extends BaseProviderConfig {
  type: 'ollama';
  endpoint?: string;
}

/**
 * Flat ProviderConfig retaining all fields for backward compatibility.
 * Consumers can narrow via `config.type` discriminant when available.
 */
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

/** TYPE-04: Typed provider config discriminated union */
export type TypedProviderConfig = ClaudeProviderConfig | GeminiProviderConfig | OllamaProviderConfig;

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
  telegram?: {
    enabled: boolean;
    bot_token?: string;
    allowed_users: string[];
    rate_limit_per_min?: number;
  };
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
  mcp?: McpConfig;
}

// ─── MCP Configuration ──────────────────────────────────────────────

export interface McpServerEntry {
  type?: 'stdio' | 'sse' | 'http';
  url?: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  headers?: Record<string, string>;
}

export interface McpConfig {
  servers: Record<string, McpServerEntry>;
}

// ─── Routine Types ───────────────────────────────────────────────────

export interface RoutineTask {
  prompt: string;
}

export interface RoutineConfig {
  name: string;
  schedule: string; // Cron expression
  model_preference?: string;  // provider name (e.g. 'claude-haiku', 'gemini', 'ollama')
  max_cost_tier?: CostTier;   // cost ceiling: 'free' | 'included' | 'metered' | 'premium'
  timeout?: string;
  enabled?: boolean;
}

export interface RoutineDefinition {
  routine: RoutineConfig;
  task: RoutineTask;
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

// ─── Budget Policy (LLM06/LLM10 Mitigation) ─────────────────────────

export interface BudgetPolicy {
  /** Maximum total tool invocations per session. 0 = unlimited. */
  max_actions_per_session: number;
  /** Per-action-type caps. Keys match action categories from _classifyAction(). */
  max_actions_per_type: Record<string, number>;
  /** Maximum token spend per session. 0 = unlimited. */
  token_budget: number;
  /** What happens when budget is exceeded: 'block' halts, 'flag' asks for approval. */
  on_exceed: 'block' | 'flag';
}

// ─── Dry Run Policy (ASI02 Mitigation) ───────────────────────────────

export interface DryRunPolicy {
  /** Enable dry-run mode globally. */
  enabled: boolean;
  /** Tools to apply dry-run to. Empty = all write operations. */
  tools: string[];
  /** Log the would-be action to the audit log. */
  audit_dry_runs: boolean;
}

export interface ZoraPolicy {
  filesystem: FilesystemPolicy;
  shell: ShellPolicy;
  actions: ActionsPolicy;
  network: NetworkPolicy;
  budget?: BudgetPolicy;
  dry_run?: DryRunPolicy;
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
