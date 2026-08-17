# Configuration Reference

Zora uses two TOML files for configuration:

- **`config.toml`** -- Agent behavior, providers, routing, memory, steering, and notifications.
- **`policy.toml`** -- Security policy: filesystem access, shell commands, network, budgets, and dry-run mode.

Both files live in `~/.zora/` by default and are created by `zora-agent init`.

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
| `type` | string | yes | Provider type: `"claude-sdk"`, `"gemini-cli"`, `"ollama"`, or `"echo"` (a deterministic stub used by the e2e harness — not for production). |
| `rank` | integer | yes | Priority for routing. Lower rank = preferred. |
| `capabilities` | string[] | yes | Tags for task routing: `"reasoning"`, `"coding"`, `"creative"`, `"structured-data"`, `"large-context"`, `"search"`, `"fast"`, or any custom string. |
| `cost_tier` | string | yes | Cost classification: `"free"`, `"included"`, `"metered"`, `"premium"`. |
| `enabled` | boolean | yes | Whether this provider is active. |
| `model` | string | no | Model identifier (e.g. `"claude-opus-5"`, `"gemini-2.5-pro"`). Provider-specific default if omitted -- `claude-opus-5` for `claude-sdk`. `zora-agent init` writes `gemini-2.5-pro` for `gemini-cli`. |
| `effort` | string | no | Reasoning effort: `"low"`, `"medium"`, `"high"`, `"xhigh"`, `"max"`. The main intelligence/latency/cost dial. Left unset by default so the SDK's own default applies. `"xhigh"` requires Opus 4.7+ / Sonnet 5; `"max"` requires Opus 4.6+ / Sonnet 4.6+. Claude only. |
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
model = "claude-opus-5"
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

Persistent memory system for context across sessions. Zora's memory operates in three tiers:

- **Tier 1: Long-term knowledge** (`MEMORY.md`) — Human-curated, loaded into every session.
- **Tier 2: Daily notes** (`daily/YYYY-MM-DD.md`) — Agent-written session logs, rolling window.
- **Tier 3: Structured items** (`items/*.json`) — Individual facts with salience scoring and category organization.

#### Storage paths

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `long_term_file` | string | `"~/.zora/memory/MEMORY.md"` | Path to the long-term memory file (Tier 1). Loaded into every session's system prompt. Only editable by humans via `zora-agent memory edit`. |
| `daily_notes_dir` | string | `"~/.zora/memory/daily"` | Directory for daily note files (Tier 2). Each day produces a `YYYY-MM-DD.md` file. |
| `items_dir` | string | `"~/.zora/memory/items"` | Directory for structured memory items (Tier 3). Each item stored as a JSON file. |
| `categories_dir` | string | `"~/.zora/memory/categories"` | Directory for category summary files. Auto-generated from item categories. |

#### Context loading

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `context_days` | integer | `7` | Number of recent days of daily notes to include in task context. Older notes are still on disk but not injected. |
| `max_context_items` | integer | `20` | Maximum Tier 3 memory items injected into task context, ranked by salience score. |
| `max_category_summaries` | integer | `5` | Maximum category summaries injected into context. Categories are selected by relevance to the current task. |

#### Extraction and salience

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `auto_extract` | boolean | `true` | Enable automatic memory extraction after task completion. When enabled, the agent is prompted to extract key facts from completed work. |
| `auto_extract_interval` | integer | `10` | **Minutes** between interval-based extraction runs — the orchestrator multiplies this by 60,000 ms. Only applies when `auto_extract = true`; a value of `0` or less disables the interval schedule. |

Salience scoring itself is not configurable. `SalienceScorer`
(`src/memory/salience-scorer.ts`) is constructed with no arguments by
`MemoryManager`, so its recency half-life is fixed at 14 days, and the frequency
term is a fixed function of `access_count` rather than a weighted one. Keys for
tuning either of those are not read by anything — setting them in `config.toml`
has no effect.

#### Example

```toml
[memory]
long_term_file = "~/.zora/memory/MEMORY.md"
daily_notes_dir = "~/.zora/memory/daily"
items_dir = "~/.zora/memory/items"
categories_dir = "~/.zora/memory/categories"
context_days = 3
max_context_items = 5
max_category_summaries = 3
auto_extract = true
auto_extract_interval = 10
```

Paths support `~` expansion. Relative paths resolve from `~/.zora/`. All directories are created automatically by `zora-agent init`.

#### Graph memory (experimental, off by default)

The graph tier is the one memory setting that is **not** in `config.toml` — it is
env-gated, because it is experimental and depends on an optional native module.

| Variable | Effect |
|---|---|
| `ZORA_GRAPH_MEMORY` | `1`, `true`, `on` or `yes` starts the tier. Anything else, including unset, leaves it off. |
| `ZORA_GRAPH_MEMORY_PATH` | Database location. Default `~/.zora/memory/graph.db`. |

When it is on, the agent gains a `graph_recall` tool alongside `memory_search`.
The two answer different questions: `memory_search` is BM25 over item summaries
and finds a memory by its *wording*; `graph_recall` traverses *relationships*
— what else involved this project, what earlier work touched the same entities
as the current job, what a decision superseded, whether a tool has failed this
way before. The two-hop case is the one lexical search cannot reach at all,
since the summaries need share no words.

The tier degrades to nothing rather than failing. A missing `sparrowdb` module,
an unsupported platform, an unopenable database, a database another process is
already holding, a failed worker spawn or a startup timeout each produce one
warning and an inert client, and `graph_recall` is simply not registered — the
agent keeps running with lexical memory alone. It runs on a worker thread, so
the native calls do not block the main loop.

Prebuilt binaries exist for **linux-x64 (glibc) and darwin-arm64 only**. On any
other platform — Windows, linux-arm64, Intel macOS, musl/Alpine — the tier stays
inert and everything else works unchanged.

#### One process per graph database

SparrowDB allows a single writer per database root. Two processes that opened
the same root concurrently used to corrupt its catalog *permanently*, leaving a
database that could not be opened at all — upstream measured 4 of 5 concurrent
runs doing exactly that
([SparrowDB #524](https://github.com/ryaker/SparrowDB/issues/524)). That was
easy to reach by accident: `zora-agent daemon` holds the graph for its whole
lifetime, and every other `zora-agent` command boots its own agent against the
same path.

`sparrowdb@0.1.27` closed it. `open()` now takes an exclusive lock on
`db.lock` inside the database directory and refuses a second process outright,
so the corruption is no longer reachable — by Zora or by anything else, the
`sparrowdb` CLI and the SparrowDB MCP server included. Zora requires `^0.1.27`,
so this is always in force. The kernel releases the lock when the holding
process exits, including on a crash, so there is nothing to clean up by hand.

Zora adds a second lock file of its own (`.zora-graph.lock`) recording the
holding pid. It is a backstop for filesystems where OS-level locking is
unreliable — an NFS-mounted home directory, most plausibly — and it lets the
warning name the process holding the database rather than just the path.

Either way, a second Zora process finds the tier inert with a warning, and
everything else keeps working. If you want two Zora processes with graph memory
at once, give each its own `ZORA_GRAPH_MEMORY_PATH`; they are separate graphs,
not a shared one.

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
| `bot_token` | string | -- | Telegram bot token (from BotFather). Use `"env:VAR"` to read it from the environment instead of storing it here — see [Secrets in config](#secrets-in-config). |
| `allowed_users` | string[] | `[]` | Telegram usernames allowed to steer the agent. |
| `rate_limit_per_min` | integer | `30` | Maximum messages per minute from Telegram. |
| `mode` | `"polling"` \| `"webhook"` | `"polling"` | How updates arrive. Telegram delivers each update once, to whichever transport is active, so the two are mutually exclusive — `polling` needs no inbound port and is the right default for a laptop or anything behind NAT. |
| `webhook_secret` | string | -- | **Required when `mode = "webhook"`.** The secret token Telegram echoes in `X-Telegram-Bot-Api-Secret-Token` on every delivery. 1–256 characters of `A-Z`, `a-z`, `0-9`, `_` or `-`. Falls back to `TELEGRAM_WEBHOOK_SECRET_TOKEN`. |
| `webhook_port` | integer | `8080` | Port the inbound webhook listener binds, when `mode = "webhook"`. |

##### Webhook mode

In `webhook` mode Zora runs an HTTP listener and Telegram posts updates to
`POST /webhooks/telegram`. Every request is authenticated before it reaches the
adapter (INVARIANT-10): the secret token is compared in constant time, and a
request that fails — or a platform with no validator registered — is refused
without being dispatched.

`webhook_secret` is not optional. The daemon refuses to start in webhook mode
without one, because the endpoint would have no way to tell a genuine Telegram
delivery from anyone who found the URL. Pass the same value to Telegram when
registering the webhook, or it will reject your `setWebhook` call:

```bash
curl -X POST "https://api.telegram.org/bot<BOT_TOKEN>/setWebhook" \
  -d "url=https://your-host.example/webhooks/telegram" \
  -d "secret_token=$TELEGRAM_WEBHOOK_SECRET_TOKEN"
```

Terminate TLS in front of Zora — the listener speaks plain HTTP, and the secret
token travels in a header on every request.

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

## Secrets in config

Any credential-bearing field may hold `"env:NAME"` instead of the credential
itself. The reference is resolved once, when config is loaded
(`src/config/env-resolver.ts`), so every consumer sees the real value and none
of them has to remember to do the lookup.

```toml
[steering.telegram]
bot_token = "env:ZORA_TELEGRAM_TOKEN"

[mcp.servers.mem0]
env = { MEM0_API_KEY = "env:MEM0_API_KEY" }
```

**Which fields.** Any field whose key ends in `token`, `secret`, `password`,
`passwd`, `pwd`, `api_key`, `apikey`, `access_key`, `private_key`, `credential`,
`credentials` or `authorization` — plus every value under
`[mcp.servers.<name>.env]` and `[mcp.servers.<name>.headers]`, which is where
API keys live regardless of what the key is called. The `${env:NAME}` spelling
works as well as `env:NAME`.

**A missing variable stops startup.** If the named variable is unset or set to
an empty string, config loading fails with an error naming both the variable and
the field. Zora never falls back to the literal `"env:NAME"` string and never
substitutes an empty credential — silently doing either is what made this
mechanism worth nothing before v0.12.0.

**Not resolved:** `api_key_env` on a provider. That field is *defined* as the
name of an environment variable; the provider reads the variable itself.
Resolving it would put a secret where a name is expected.

**Not covered:** an `env:` reference in a non-credential field is left as the
literal string, and a warning naming the field is logged. Nothing else in the
TOML is substituted.

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
