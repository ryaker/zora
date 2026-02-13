# config.toml Full Reference

Complete field reference for `~/.zora/config.toml`.

## [agent]

```toml
[agent]
name = "zora"                    # Agent name (string)
workspace = "~/.zora/workspace"  # Working directory
max_parallel_jobs = 3            # Max concurrent tasks (1-10)
default_timeout = "2h"           # Default task timeout
heartbeat_interval = "30m"       # Health check frequency
log_level = "info"               # debug | info | warn | error

[agent.identity]
soul_file = "~/.zora/SOUL.md"   # Personality/identity file

[agent.resources]
cpu_throttle_percent = 80        # CPU usage cap (1-100)
memory_limit_mb = 4096           # Memory cap (min 256)
throttle_check_interval = "10s"  # How often to check resources
```

## [[providers]]

Array of provider configs. Each entry:

```toml
[[providers]]
name = "claude"                           # Unique ID (required)
type = "claude-sdk"                       # Integration type (required)
rank = 1                                  # Priority, lower = higher (required)
capabilities = ["reasoning", "coding"]    # Routing tags (required)
cost_tier = "included"                    # free | included | metered | premium (required)
enabled = true                            # Active flag (required)
auth_method = "mac_session"               # How auth works (optional)
model = "claude-sonnet-4-5"               # Default model (optional)
max_turns = 200                           # Turn limit per task (optional)
max_concurrent_jobs = 3                   # Parallelism limit (optional)
cli_path = "gemini"                       # CLI binary path (optional, for CLI providers)
api_key_env = "OPENAI_API_KEY"            # Env var for API key (optional)
endpoint = "http://localhost:11434"        # API base URL (optional)
```

### Provider types

| type | Backend | Auth |
|------|---------|------|
| `claude-sdk` | Anthropic Claude Agent SDK | Mac session |
| `gemini-cli` | Google Gemini CLI | Workspace SSO |
| `openai-api` | OpenAI API | API key |
| `ollama` | Ollama local | None |

### Capability tags

`reasoning`, `coding`, `creative`, `structured-data`, `large-context`, `search`, `fast`, or any custom string.

## [routing]

```toml
[routing]
mode = "respect_ranking"   # respect_ranking | optimize_cost | provider_only | round_robin
# provider_only_name = "claude"  # Required when mode = provider_only
```

## [failover]

```toml
[failover]
enabled = true
auto_handoff = true
max_handoff_context_tokens = 50000
retry_after_cooldown = true
max_retries = 3
checkpoint_on_auth_failure = true
notify_on_failover = true
```

## [memory]

```toml
[memory]
long_term_file = "~/.zora/memory/MEMORY.md"
daily_notes_dir = "~/.zora/memory/daily"
items_dir = "~/.zora/memory/items"
categories_dir = "~/.zora/memory/categories"
context_days = 7              # Days of daily notes to load
max_context_items = 20        # Max memory items per task
max_category_summaries = 5    # Max category summaries
auto_extract_interval = 10    # Extract every N turns
```

## [security]

```toml
[security]
policy_file = "~/.zora/policy.toml"
audit_log = "~/.zora/audit/audit.jsonl"
audit_hash_chain = true
audit_single_writer = true
integrity_check = true
integrity_interval = "30m"
integrity_includes_tool_registry = true
leak_detection = true
sanitize_untrusted_content = true
jit_secret_decryption = true
```

## [steering]

```toml
[steering]
enabled = true
poll_interval = "5s"
dashboard_port = 7070
notify_on_flag = true
flag_timeout = "10m"
auto_approve_low_risk = true
always_flag_irreversible = true
```

## [notifications]

```toml
[notifications]
enabled = true
on_task_complete = true
on_error = true
on_failover = true
on_auth_expiry = true
on_all_providers_down = true
```

## [mcp.servers.*]

```toml
# Stdio transport (CLI-based servers)
[mcp.servers.github]
command = "npx"
args = ["-y", "@anthropic-ai/mcp-server-github"]

# HTTP transport
[mcp.servers.memory]
type = "http"
url = "http://localhost:8180/mcp"

# SSE transport
[mcp.servers.custom]
type = "sse"
url = "http://localhost:9000/sse"
headers = { Authorization = "Bearer token" }
```
