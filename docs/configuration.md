# Configuration Reference

Zora uses two TOML files for configuration:

- **`config.toml`** -- Agent behavior, providers, routing, memory, steering, and notifications.
- **`policy.toml`** -- Security policy: filesystem access, shell commands, network, budgets, and dry-run mode.

Both files live in `~/.zora/` by default and are created by `zora init`.

---

## config.toml

### `[agent]`

Top-level agent identity and resource settings.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `name` | string | `"zora"` | Agent display name. |
| `workspace` | string | `"~/.zora/workspace"` | Root directory for agent workspace files. |
| `max_parallel_jobs` | integer | `2` | Maximum concurrent task executions. |
| `default_timeout` | string | `"1h"` | Default timeout for tasks (e.g. `"30m"`, `"2h"`). |
| `heartbeat_interval` | string | `"15m"` | Interval between heartbeat checks (e.g. `"5m"`, `"1h"`). |
| `log_level` | string | `"info"` | Log verbosity: `"debug"`, `"info"`, `"warn"`, `"error"`. |

#### `[agent.identity]`

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `soul_file` | string | `"~/.zora/workspace/SOUL.md"` | Path to the agent's identity/personality file. Injected into the system prompt on every task. |

#### `[agent.resources]`

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `cpu_throttle_percent` | integer | `80` | CPU usage ceiling (percentage). The agent throttles when usage exceeds this. |
| `memory_limit_mb` | integer | `512` | Memory usage ceiling in MB. |
| `throttle_check_interval` | string | `"30s"` | How often to check resource usage. |

### `[[providers]]`

Provider entries are defined as a TOML array of tables. Each entry configures one LLM backend.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | yes | Unique identifier (e.g. `"claude"`, `"gemini"`, `"ollama"`). |
| `type` | string | yes | Provider type: `"claude-sdk"`, `"gemini-cli"`, or `"ollama"`. |
| `rank` | integer | yes | Priority for routing. Lower rank = preferred. |
| `capabilities` | string[] | yes | Tags for task routing: `"reasoning"`, `"coding"`, `"creative"`, `"structured-data"`, `"large-context"`, `"search"`, `"fast"`, or any custom string. |
| `cost_tier` | string | yes | Cost classification: `"free"`, `"included"`, `"metered"`, `"premium"`. |
| `enabled` | boolean | yes | Whether this provider is active. |
| `model` | string | no | Model identifier (e.g. `"claude-sonnet-4-5"`, `"gemini-2.5-flash"`). Provider-specific default if omitted. |
| `max_turns` | integer | no | Maximum conversation turns per task. Default: `200`. |
| `max_concurrent_jobs` | integer | no | Concurrency limit for this provider. |

#### Claude-specific fields (`type = "claude-sdk"`)

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `auth_method` | string | `"mac_session"` | Authentication: `"mac_session"` (no API key needed) or `"api_key"`. |
| `api_key_env` | string | -- | Environment variable containing the API key (when `auth_method = "api_key"`). |

#### Gemini-specific fields (`type = "gemini-cli"`)

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `auth_method` | string | `"workspace_sso"` | Authentication: `"workspace_sso"` or `"api_key"`. |
| `cli_path` | string | -- | Path to the Gemini CLI binary. Auto-detected if omitted. |
| `api_key_env` | string | -- | Environment variable containing the API key. |

#### Ollama-specific fields (`type = "ollama"`)

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `endpoint` | string | `"http://localhost:11434"` | Ollama API endpoint URL. |

**Example:**

```toml
[[providers]]
name = "claude"
type = "claude-sdk"
rank = 1
capabilities = ["reasoning", "coding", "creative"]
cost_tier = "included"
enabled = true
model = "claude-sonnet-4-5"
auth_method = "mac_session"

[[providers]]
name = "gemini"
type = "gemini-cli"
rank = 2
capabilities = ["search", "structured-data", "large-context"]
cost_tier = "included"
enabled = true

[[providers]]
name = "ollama"
type = "ollama"
rank = 3
capabilities = ["coding", "fast"]
cost_tier = "free"
enabled = false
endpoint = "http://localhost:11434"
```

### `[routing]`

Controls how Zora selects a provider for each task.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `mode` | string | `"respect_ranking"` | Routing strategy. See modes below. |
| `provider_only_name` | string | -- | Required when `mode = "provider_only"`. Routes all tasks to this provider. |

**Routing modes:**

| Mode | Behavior |
|------|----------|
| `respect_ranking` | Use the lowest-rank provider whose capabilities match the task. |
| `optimize_cost` | Prefer the cheapest capable provider (lowest `cost_tier`). |
| `provider_only` | Always use the provider named in `provider_only_name`. |
| `round_robin` | Rotate across available providers. |

### `[failover]`

Controls automatic failover when a provider fails.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | boolean | `true` | Enable automatic failover. |
| `auto_handoff` | boolean | `true` | Automatically hand off context to the next provider on failure. |
| `max_handoff_context_tokens` | integer | `4096` | Maximum tokens of context to include in a handoff bundle. |
| `retry_after_cooldown` | boolean | `true` | Re-try the failed provider after its cooldown period. |
| `max_retries` | integer | `3` | Maximum retry attempts before giving up. |
| `checkpoint_on_auth_failure` | boolean | `true` | Save task state on auth failures for later resumption. |
| `notify_on_failover` | boolean | `true` | Send a notification when failover occurs. |

### `[memory]`

Persistent memory system for context across sessions.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `long_term_file` | string | `"~/.zora/memory/MEMORY.md"` | Path to the long-term memory file. |
| `daily_notes_dir` | string | `"~/.zora/memory/daily"` | Directory for daily note files. |
| `items_dir` | string | `"~/.zora/memory/items"` | Directory for individual memory items. |
| `categories_dir` | string | `"~/.zora/memory/categories"` | Directory for category summaries. |
| `context_days` | integer | `7` | Number of recent days of notes to include in context. |
| `max_context_items` | integer | `20` | Maximum memory items injected into task context. |
| `max_category_summaries` | integer | `5` | Maximum category summaries injected into context. |
| `auto_extract_interval` | integer | `10` | Number of tasks between automatic memory extraction. |

### `[security]`

Security and audit settings.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `policy_file` | string | `"~/.zora/policy.toml"` | Path to the policy file. |
| `audit_log` | string | `"~/.zora/audit/audit.jsonl"` | Path to the JSONL audit log. |
| `audit_hash_chain` | boolean | `true` | Enable hash-chain integrity on audit log entries. Each entry includes a hash of the previous entry. |
| `audit_single_writer` | boolean | `true` | Enforce single-writer access to the audit log. |
| `integrity_check` | boolean | `true` | Enable periodic integrity checks. |
| `integrity_interval` | string | `"1h"` | How often to run integrity checks. |
| `integrity_includes_tool_registry` | boolean | `true` | Include tool registry in integrity checks. |
| `leak_detection` | boolean | `true` | Scan agent output for potential secret leaks. |
| `sanitize_untrusted_content` | boolean | `true` | Sanitize content from untrusted sources before processing. |
| `jit_secret_decryption` | boolean | `true` | Decrypt secrets just-in-time rather than loading all at startup. |

### `[steering]`

Human-in-the-loop steering controls.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | boolean | `true` | Enable the steering system. |
| `poll_interval` | string | `"5s"` | How often the agent checks for steering messages during execution. |
| `dashboard_port` | integer | `7070` | Port for the dashboard web server. |
| `notify_on_flag` | boolean | `true` | Notify when an action is flagged for approval. |
| `flag_timeout` | string | `"5m"` | How long to wait for approval before auto-denying. |
| `auto_approve_low_risk` | boolean | `true` | Automatically approve low-risk flagged actions. |
| `always_flag_irreversible` | boolean | `true` | Always require approval for irreversible actions. |

#### `[steering.telegram]`

Optional Telegram bot integration for remote steering.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | boolean | `false` | Enable the Telegram gateway. |
| `bot_token` | string | -- | Telegram bot token (from BotFather). |
| `allowed_users` | string[] | `[]` | Telegram usernames allowed to steer the agent. |
| `rate_limit_per_min` | integer | `30` | Maximum messages per minute from Telegram. |

### `[notifications]`

Notification preferences.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | boolean | `true` | Enable notifications. |
| `on_task_complete` | boolean | `true` | Notify when a task completes. |
| `on_error` | boolean | `true` | Notify on errors. |
| `on_failover` | boolean | `true` | Notify when failover occurs. |
| `on_auth_expiry` | boolean | `true` | Notify when authentication is about to expire. |
| `on_all_providers_down` | boolean | `true` | Notify when no providers are available. |

### `[mcp]`

Optional MCP (Model Context Protocol) server configuration.

#### `[mcp.servers.<name>]`

Each key under `mcp.servers` defines an MCP server connection.

| Field | Type | Description |
|-------|------|-------------|
| `type` | string | Transport type: `"stdio"`, `"sse"`, or `"http"`. |
| `url` | string | Server URL (for `sse` and `http` transports). |
| `command` | string | Command to launch the server (for `stdio` transport). |
| `args` | string[] | Command arguments (for `stdio` transport). |
| `env` | object | Environment variables to pass to the server. |
| `headers` | object | HTTP headers for server connections. |

---

## policy.toml

The policy file controls what the agent is allowed to do. It is enforced by the PolicyEngine on every tool call.

### `[filesystem]`

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `allowed_paths` | string[] | `["~/.zora"]` | Directories the agent can read/write. Supports `~` expansion. |
| `denied_paths` | string[] | `[]` | Directories that are always denied, even if they match `allowed_paths`. Deny takes precedence. |
| `resolve_symlinks` | boolean | `true` | Resolve `~` and make paths absolute before checking. |
| `follow_symlinks` | boolean | `false` | If `false`, symlinks that resolve outside `allowed_paths` are denied. |

### `[shell]`

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `mode` | string | `"allowlist"` | Enforcement mode: `"allowlist"` (only listed commands), `"denylist"` (everything except listed), `"deny_all"` (no shell access). |
| `allowed_commands` | string[] | `[]` | Commands permitted in `allowlist` mode. |
| `denied_commands` | string[] | `[]` | Commands blocked in both `allowlist` and `denylist` modes. |
| `split_chained_commands` | boolean | `true` | Split `&&`, `||`, `;`, `|` chains and validate each command individually. |
| `max_execution_time` | string | `"30s"` | Maximum wall-clock time for any single command. |

### `[actions]`

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `reversible` | string[] | `[]` | Action categories considered reversible (informational). |
| `irreversible` | string[] | `[]` | Action categories considered irreversible (informational). |
| `always_flag` | string[] | `[]` | Action categories that always require human approval. Use `"*"` to flag everything. |

**Action categories** (auto-classified by the PolicyEngine):

| Category | Trigger |
|----------|---------|
| `write_file` | Write tool |
| `edit_file` | Edit tool |
| `shell_exec` | Bash tool (non-destructive) |
| `shell_exec_destructive` | `rm`, `rmdir`, `chmod`, `chown`, `git reset --hard` |
| `git_push` | `git push` |
| `git_operation` | Other git commands |

### `[network]`

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `allowed_domains` | string[] | `["*"]` | Domains the agent can make HTTP requests to. `"*"` allows all. |
| `denied_domains` | string[] | `[]` | Domains that are always blocked. |
| `max_request_size` | string | `"10MB"` | Maximum size for outgoing HTTP requests. |

### `[budget]`

Optional. Controls per-session action and token budgets (LLM06/LLM10 mitigation).

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `max_actions_per_session` | integer | `0` | Maximum total tool invocations per session. `0` = unlimited. |
| `token_budget` | integer | `0` | Maximum token spend per session. `0` = unlimited. |
| `on_exceed` | string | `"block"` | What happens when budget is exceeded: `"block"` halts the action, `"flag"` asks for approval. |

#### `[budget.max_actions_per_type]`

Per-action-type caps. Keys match the action categories listed above.

```toml
[budget.max_actions_per_type]
shell_exec = 50
write_file = 100
shell_exec_destructive = 5
```

### `[dry_run]`

Optional. Preview write operations without executing them (ASI02 mitigation).

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | boolean | `false` | Enable dry-run mode globally. |
| `tools` | string[] | `[]` | Tools to apply dry-run to. Empty = all write operations (`Write`, `Edit`, `Bash`). |
| `audit_dry_runs` | boolean | `true` | Log intercepted actions to the audit log. |

---

## Complete Example

### config.toml

```toml
[agent]
name = "zora"
workspace = "~/.zora/workspace"
max_parallel_jobs = 2
default_timeout = "1h"
heartbeat_interval = "15m"
log_level = "info"

[agent.identity]
soul_file = "~/.zora/workspace/SOUL.md"

[agent.resources]
cpu_throttle_percent = 80
memory_limit_mb = 512

[[providers]]
name = "claude"
type = "claude-sdk"
rank = 1
capabilities = ["reasoning", "coding", "creative"]
cost_tier = "included"
enabled = true

[[providers]]
name = "gemini"
type = "gemini-cli"
rank = 2
capabilities = ["search", "structured-data"]
cost_tier = "included"
enabled = true

[routing]
mode = "respect_ranking"

[failover]
enabled = true
auto_handoff = true
max_retries = 3

[memory]
long_term_file = "~/.zora/memory/MEMORY.md"
daily_notes_dir = "~/.zora/memory/daily"
items_dir = "~/.zora/memory/items"
categories_dir = "~/.zora/memory/categories"

[security]
policy_file = "~/.zora/policy.toml"
audit_log = "~/.zora/audit/audit.jsonl"
audit_hash_chain = true
leak_detection = true

[steering]
enabled = true
dashboard_port = 7070
poll_interval = "5s"

[notifications]
enabled = true
```

### policy.toml

```toml
[filesystem]
allowed_paths = ["~/.zora", "~/projects/my-app"]
denied_paths = ["~/.ssh", "~/.gnupg"]
resolve_symlinks = true
follow_symlinks = false

[shell]
mode = "allowlist"
allowed_commands = ["ls", "cat", "echo", "git", "npm", "node", "python3"]
denied_commands = ["rm", "sudo", "curl"]
split_chained_commands = true
max_execution_time = "30s"

[actions]
reversible = ["write_file", "edit_file"]
irreversible = ["shell_exec_destructive", "git_push"]
always_flag = ["shell_exec_destructive", "git_push"]

[network]
allowed_domains = ["api.github.com", "registry.npmjs.org"]
denied_domains = []
max_request_size = "10MB"

[budget]
max_actions_per_session = 200
token_budget = 500000
on_exceed = "flag"

[budget.max_actions_per_type]
shell_exec = 50
write_file = 100
shell_exec_destructive = 5

[dry_run]
enabled = false
tools = []
audit_dry_runs = true
```
