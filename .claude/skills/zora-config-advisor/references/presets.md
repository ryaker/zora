# Policy Presets Reference

## Safe (read-only, no shell)

Best for: first run, analysis tasks, high-sensitivity environments.

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
max_request_size = "10mb"
```

## Balanced (recommended default)

Best for: most dev workflows, code generation, testing.

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
split_chained_commands = true
max_execution_time = "5m"

[actions]
reversible = ["write_file", "edit_file", "git_commit", "mkdir", "cp", "mv"]
irreversible = ["git_push", "shell_exec_destructive"]
always_flag = ["git_push"]

[network]
allowed_domains = ["https://*"]
denied_domains = []
max_request_size = "10mb"
```

## Power (expanded access)

Best for: ops workflows, multi-project, data pipelines. Use only if you understand the risks.

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
split_chained_commands = true
max_execution_time = "10m"

[actions]
reversible = ["write_file", "edit_file", "git_commit", "mkdir", "cp", "mv"]
irreversible = ["git_push", "shell_exec_destructive"]
always_flag = ["git_push"]

[network]
allowed_domains = ["https://*"]
denied_domains = []
max_request_size = "10mb"
```

## Tool Stack Additions

When the user selects tool stacks, merge these into `allowed_commands`:

| Stack | Commands |
|-------|----------|
| Node.js | node, npm, npx, tsc, vitest |
| Python | python3, pip, pip3 |
| Rust | cargo, rustc, rustup |
| Go | go |
| General CLI | ls, pwd, cat, head, tail, wc, grep, find, which, echo, mkdir, cp, mv, touch |
