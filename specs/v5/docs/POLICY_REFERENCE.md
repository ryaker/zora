# Zora v0.5 - Policy Reference

Draft policy reference based on v0.5 spec. This defines the security boundary.

## Policy file

`~/.zora/policy.toml`

The policy is read-only to tools. Edit via CLI only.

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

## Enforcement order

1. Resolve to absolute canonical path
2. Denied paths take precedence
3. Allowed paths must match
4. Split chained commands and validate each
5. Apply action classification (irreversible always flagged)

## Worker scoping

Workers receive a scoped capability token that can only reduce access from the global policy. They cannot widen permissions.

## Policy violations

Policy violations return structured tool errors to the model for self-correction. The violation is logged to the audit trail.
