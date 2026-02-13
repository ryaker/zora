# Zora v0.5 - Policy Presets

These presets are starting points for pre-authorized execution. Choose the smallest scope that gets the job done.

## Preset: Safe (read-only, no shell)

Best for first run or high-sensitivity environments.

```toml
[filesystem]
allowed_paths = ["~/Projects", "~/.zora/workspace", "~/.zora/memory/daily", "~/.zora/memory/items"]
denied_paths = ["~/Documents", "~/Desktop", "~/Downloads", "~/Library", "~/.ssh", "~/.gnupg", "/"]
resolve_symlinks = true
follow_symlinks = false

[shell]
mode = "deny_all"
allowed_commands = []
denied_commands = ["*"]

[actions]
reversible = []
irreversible = ["git_push", "shell_exec_destructive"]
always_flag = ["git_push"]

[network]
allowed_domains = ["https://*"]
denied_domains = []
```

## Preset: Balanced (recommended default)

Read/write inside `~/Projects` plus safe shell allowlist.

```toml
[filesystem]
allowed_paths = ["~/Projects", "~/.zora/workspace", "~/.zora/memory/daily", "~/.zora/memory/items"]
denied_paths = ["~/Documents", "~/Desktop", "~/Downloads", "~/Library", "~/.ssh", "~/.gnupg", "/"]
resolve_symlinks = true
follow_symlinks = false

[shell]
mode = "allowlist"
allowed_commands = ["ls", "pwd", "rg", "git", "node", "pnpm", "npm"]
denied_commands = ["sudo", "rm", "chmod", "chown", "curl", "wget"]
max_execution_time = "5m"

[actions]
reversible = ["write_file", "edit_file", "git_commit", "mkdir", "cp", "mv"]
irreversible = ["git_push", "shell_exec_destructive"]
always_flag = ["git_push"]

[network]
allowed_domains = ["https://*"]
denied_domains = []
```

## Preset: Power (expanded access)

Use only if you understand the risks and need broader access.

```toml
[filesystem]
allowed_paths = ["~/Projects", "~/Documents", "~/.zora/workspace", "~/.zora/memory/daily", "~/.zora/memory/items"]
denied_paths = ["~/Library", "~/.ssh", "~/.gnupg", "/"]
resolve_symlinks = true
follow_symlinks = false

[shell]
mode = "allowlist"
allowed_commands = [
  "ls", "pwd", "rg", "git", "node", "pnpm", "npm",
  "python3", "pip", "jq", "yq", "find", "sed", "awk"
]
denied_commands = ["sudo", "rm", "chmod", "chown"]
max_execution_time = "10m"

[actions]
reversible = ["write_file", "edit_file", "git_commit", "mkdir", "cp", "mv"]
irreversible = ["git_push", "shell_exec_destructive"]
always_flag = ["git_push"]

[network]
allowed_domains = ["https://*"]
denied_domains = []
```

## Notes

- These are starting points. Always review the generated `policy.toml`.
- If you need `rm` or `curl`, add them explicitly and accept the risk.
- Keep irreversible actions flagged. If you allow them, log and review.
