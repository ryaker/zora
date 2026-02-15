# Zora v0.5 - Configuration Guide

Draft configuration guide based on v0.5 spec. Adjust names as CLI and schema stabilize.

## Where config lives

- `~/.zora/config.toml` (agent config, provider registry, routing)
- `~/.zora/policy.toml` (capability policy, security boundary)

Both are read-only to the tool layer and must be edited via CLI.

## Core agent config

```toml
[agent]
name = "zora"
workspace = "~/.zora/workspace"
max_parallel_jobs = 3
default_timeout = "2h"
heartbeat_interval = "30m"
log_level = "info"

[agent.identity]
soul_file = "~/.zora/workspace/SOUL.md"

[agent.resources]
cpu_throttle_percent = 80
memory_limit_mb = 4096
throttle_check_interval = "10s"
```

## Provider registry

Providers are defined as an ordered array. Routing considers rank, capabilities, and cost tier. You can define **multiple entries of the same type** with different models to enable granular model selection:

```toml
# ─── Multi-tier Claude models ───────────────────────────────
[[providers]]
name = "claude-opus"
type = "claude-sdk"
rank = 1
capabilities = ["reasoning", "coding", "creative"]
cost_tier = "premium"
enabled = true
auth_method = "mac_session"
model = "claude-opus-4"
max_turns = 200

[[providers]]
name = "claude-sonnet"
type = "claude-sdk"
rank = 2
capabilities = ["reasoning", "coding", "creative"]
cost_tier = "included"
enabled = true
auth_method = "mac_session"
model = "claude-sonnet-4-5"
max_turns = 200

[[providers]]
name = "claude-haiku"
type = "claude-sdk"
rank = 3
capabilities = ["creative", "fast"]
cost_tier = "free"
enabled = true
auth_method = "mac_session"
model = "claude-3-5-haiku-latest"
max_turns = 100

# ─── Other providers ────────────────────────────────────────
[[providers]]
name = "gemini"
type = "gemini-cli"
rank = 4
capabilities = ["search", "structured-data", "large-context", "coding"]
cost_tier = "free"
enabled = true
auth_method = "workspace_sso"
cli_path = "gemini"
model = "gemini-2.5-pro"
max_turns = 100

[[providers]]
name = "ollama"
type = "ollama"
rank = 5
capabilities = ["creative", "reasoning", "fast"]
cost_tier = "free"
enabled = true
model = "llama3.2"
endpoint = "http://localhost:11434"
max_turns = 50
```

Common fields:
- `name`: unique provider id (used in `model_preference`)
- `type`: integration type (`claude-sdk`, `gemini-cli`, `ollama`)
- `rank`: lower number = higher priority (must be unique among enabled providers)
- `capabilities`: routing tags
- `cost_tier`: `free`, `included`, `metered`, `premium`
- `enabled`: true/false
- `model`: specific model identifier (e.g. `claude-opus-4`, `llama3.2`)
- `endpoint`: API base URL (for Ollama: `http://localhost:11434`)

## Routing

```toml
[routing]
mode = "respect_ranking"  # respect_ranking | optimize_cost | provider_only | round_robin
# provider_only_name = "claude"
```

## Failover

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

## Memory

```toml
[memory]
long_term_file = "~/.zora/memory/MEMORY.md"
daily_notes_dir = "~/.zora/memory/daily"
items_dir = "~/.zora/memory/items"
categories_dir = "~/.zora/memory/categories"
context_days = 7
max_context_items = 20
max_category_summaries = 5
auto_extract_interval = 10
```

## Security and audit

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

## Steering and notifications

```toml
[steering]
enabled = true
poll_interval = "5s"
dashboard_port = 8070
notify_on_flag = true
flag_timeout = "10m"
auto_approve_low_risk = true
always_flag_irreversible = true

[notifications]
enabled = true
on_task_complete = true
on_error = true
on_failover = true
on_auth_expiry = true
on_all_providers_down = true
```
