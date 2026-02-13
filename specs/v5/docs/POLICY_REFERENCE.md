# Zora v0.6 - Policy Reference

Complete reference for all policy configuration options in `~/.zora/policy.toml`.

## Policy file

`~/.zora/policy.toml`

The policy is read-only to tools. Edit via CLI or text editor only.

## Example policy (annotated)

```toml
[filesystem]
allowed_paths = [
  "~/Projects",
  "~/Documents",
  "~/.zora/workspace",
  "~/.zora/memory/daily",
  "~/.zora/memory/items"
]
denied_paths = [
  "~/.ssh",
  "~/.gnupg",
  "~/Library/Keychains",
  "~/.zora/config.toml",
  "~/.zora/policy.toml",
  "~/.zora/workspace/SOUL.md",
  "~/.zora/memory/MEMORY.md"
]
resolve_symlinks = true
follow_symlinks = false

[shell]
mode = "allowlist"
allowed_commands = [
  "git", "npm", "node", "python3",
  "jq", "yq", "grep", "find", "sed", "awk",
  "cat", "head", "tail", "wc", "sort", "uniq",
  "ls", "mkdir", "cp", "mv",
  "make", "cmake"
]
denied_commands = ["shutdown", "reboot", "format", "diskutil", "sudo"]
split_chained_commands = true
max_execution_time = "5m"

[actions]
reversible = ["write_file", "edit_file", "git_commit", "mkdir", "cp", "mv"]
irreversible = ["git_push", "shell_exec_destructive"]
always_flag = ["git_push"]

[network]
allowed_domains = ["*"]
denied_domains = []
max_request_size = "10MB"

[budget]
max_actions_per_session = 500
token_budget = 1000000
on_exceed = "flag"

[budget.max_actions_per_type]
shell_exec = 100
write_file = 200
shell_exec_destructive = 10

[dry_run]
enabled = false
tools = []
audit_dry_runs = true

[memory]
default_categories = ["*"]

[mcp]
allowed_servers = ["*"]
auto_approve_tools = true

[notifications]
enabled = true
on_task_complete = true
on_error = true
on_auth_expiry = true
on_long_running = "30m"
```

## Section Reference

### `[filesystem]` — File Access Control

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `allowed_paths` | string[] | `[]` | Paths Zora can read/write. Supports `~` expansion. |
| `denied_paths` | string[] | `[]` | Paths always blocked, even if a parent is allowed. Denied takes precedence. |
| `resolve_symlinks` | bool | `true` | Resolve symlinks to their real paths before checking access. |
| `follow_symlinks` | bool | `false` | Whether to follow symlinks that point outside allowed paths. |

### `[shell]` — Command Execution Control

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `mode` | string | `"allowlist"` | One of: `"allowlist"` (only listed commands), `"denylist"` (everything except listed), `"deny_all"` (no commands). |
| `allowed_commands` | string[] | `["ls", "npm", "git"]` | Commands permitted when mode is `"allowlist"`. |
| `denied_commands` | string[] | `[]` | Commands blocked. In `"denylist"` mode, these are the only ones blocked. |
| `split_chained_commands` | bool | `true` | Parse chained commands (`&&`, `\|\|`, `;`, `\|`) and validate each individually. |
| `max_execution_time` | string | `"1m"` | Maximum wall-clock time for a single command. Format: `"30s"`, `"5m"`, `"1h"`. |

### `[actions]` — Action Classification

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `reversible` | string[] | `[]` | Actions considered safe/undoable (e.g., `write_file`, `mkdir`). |
| `irreversible` | string[] | `[]` | Actions that can't be undone (e.g., `git_push`). Subject to extra scrutiny. |
| `always_flag` | string[] | `[]` | Actions that always require human approval before execution. |

### `[network]` — Network Access Control

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `allowed_domains` | string[] | `[]` | Domains Zora can make requests to. `"*"` = all. `"https://*"` = HTTPS only. |
| `denied_domains` | string[] | `[]` | Domains always blocked. |
| `max_request_size` | string | `"10mb"` | Maximum request body size. |

### `[budget]` — Action Budget Limits (v0.6+)

Prevents unbounded autonomous execution. Addresses OWASP LLM06 (Excessive Agency) and LLM10 (Unbounded Consumption).

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `max_actions_per_session` | number | `0` | Maximum total tool invocations per session. 0 = unlimited. |
| `token_budget` | number | `0` | Maximum total LLM tokens consumed per session. 0 = unlimited. |
| `on_exceed` | string | `"block"` | `"block"` = deny the action. `"flag"` = prompt user for approval. |

### `[budget.max_actions_per_type]` — Per-Type Limits (v0.6+)

Fine-grained limits by action category. If a category is not listed, it has no per-type limit (only the global limit applies).

| Key | Type | Description |
|-----|------|-------------|
| `shell_exec` | number | Max shell command executions per session. |
| `write_file` | number | Max file write operations per session. |
| `shell_exec_destructive` | number | Max destructive shell operations per session. |
| *(any string)* | number | Custom action category limit. |

**Example:**
```toml
[budget.max_actions_per_type]
shell_exec = 100
write_file = 200
shell_exec_destructive = 10
```

### `[dry_run]` — Dry-Run Preview Mode (v0.6+)

Preview write operations without executing them. Addresses OWASP ASI-02 (Tool Misuse).

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | bool | `false` | When `true`, write operations are intercepted and logged instead of executed. |
| `tools` | string[] | `[]` | Which tools to intercept. Empty = all write tools (`Write`, `Edit`, `Bash`). Specify `["Bash"]` to only intercept shell commands. |
| `audit_dry_runs` | bool | `true` | Log dry-run interceptions to the audit trail. |

**Read-only commands pass through:** When dry-run is enabled, read-only Bash commands (`ls`, `cat`, `git status`, `git diff`, `git log`, `pwd`, `which`, `echo`, etc.) still execute normally.

## Enforcement order

1. Resolve to absolute canonical path
2. Denied paths take precedence over allowed paths
3. Allowed paths must match
4. Split chained commands and validate each individually
5. Check budget limits (total + per-type)
6. Check intent capsule for goal drift (automatic, no config needed)
7. Check dry-run interception
8. Apply action classification (irreversible actions flagged per `always_flag`)

## Automatic security (no configuration needed)

The following security features are active automatically and require no policy configuration:

| Feature | What It Does |
|---------|-------------|
| **Intent Capsules** | HMAC-SHA256 signed mandate per task. Detects goal drift from injected instructions. |
| **RAG Injection Defense** | 20+ patterns detect prompt injection in tool outputs and RAG documents. |
| **Leak Detection** | 9 pattern categories scan outputs for API keys, JWTs, private keys, AWS credentials. |
| **Hash-Chain Audit** | Every action logged with SHA-256 chain for tamper detection. |
| **Secrets Encryption** | AES-256-GCM with PBKDF2 key derivation for stored credentials. |
| **File Integrity** | SHA-256 baselines detect unauthorized file modifications. |

## Worker scoping

Workers receive a scoped capability token that can only reduce access from the global policy. They cannot widen permissions.

## Policy violations

Policy violations return structured tool errors to the model for self-correction. The violation is logged to the audit trail with the hash chain.

## Backward compatibility

The `[budget]` and `[dry_run]` sections are optional. If missing, Zora uses safe defaults:
- No budget limits (unlimited actions/tokens) — matching pre-v0.6 behavior
- Dry-run disabled — all operations execute normally

Existing `policy.toml` files from v0.5 work without modification.
