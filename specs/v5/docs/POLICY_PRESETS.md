# Zora v0.6 - Policy Presets

These presets are starting points for pre-authorized execution. Choose the smallest scope that gets the job done.

> **v0.6 Update:** All presets now include `[budget]` and `[dry_run]` sections for action budgets and dry-run preview mode. See [SECURITY.md](../../../SECURITY.md) for details on these features.

## Preset: Locked (fresh install default)

Zero access. No filesystem, shell, network, or actions permitted. Run `zora-agent init` to configure.

```toml
[filesystem]
allowed_paths = []
denied_paths = ["/", "~/", "~/.ssh", "~/.gnupg", "~/.aws"]
resolve_symlinks = true
follow_symlinks = false

[shell]
mode = "deny_all"
allowed_commands = []
denied_commands = ["*"]
split_chained_commands = true
max_execution_time = "0s"

[actions]
reversible = []
irreversible = ["*"]
always_flag = ["*"]

[network]
allowed_domains = []
denied_domains = ["*"]
max_request_size = "0"

[budget]
max_actions_per_session = 0
token_budget = 0
on_exceed = "block"

[budget.max_actions_per_type]

[dry_run]
enabled = true
tools = []
audit_dry_runs = true
```

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
split_chained_commands = true
max_execution_time = "1m"

[actions]
reversible = []
irreversible = ["git_push", "shell_exec_destructive"]
always_flag = ["git_push"]

[network]
allowed_domains = ["https://*"]
denied_domains = []
max_request_size = "10mb"

[budget]
max_actions_per_session = 100
token_budget = 200000
on_exceed = "block"

[budget.max_actions_per_type]
shell_exec = 20
shell_exec_destructive = 0

[dry_run]
enabled = false
tools = []
audit_dry_runs = true
```

**Budget behavior:** 100 actions max, 200K tokens. Exceeding the budget **blocks** further actions — no override prompt.

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
```

**Budget behavior:** 500 actions max, 1M tokens. Exceeding the budget **flags** for user approval — you can choose to continue or stop.

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

[budget]
max_actions_per_session = 2000
token_budget = 5000000
on_exceed = "flag"

[budget.max_actions_per_type]
shell_exec = 500
write_file = 800
shell_exec_destructive = 50

[dry_run]
enabled = false
tools = []
audit_dry_runs = true
```

**Budget behavior:** 2,000 actions max, 5M tokens. Exceeding the budget **flags** for user approval.

## Budget Summary by Preset

| Preset | Actions/Session | Token Budget | On Exceed | Destructive Limit |
|--------|:-:|:-:|:-:|:-:|
| Locked | 0 | 0 | block | 0 |
| Safe | 100 | 200K | block | 0 |
| Balanced | 500 | 1M | flag | 10 |
| Power | 2,000 | 5M | flag | 50 |

## Notes

- These are starting points. Always review the generated `policy.toml`.
- If you need `rm` or `curl`, add them explicitly and accept the risk.
- Keep irreversible actions flagged. If you allow them, log and review.
- Action budgets reset each session. They prevent runaway loops, not normal usage.
- Enable dry-run mode (`enabled = true`) when testing new policy configurations.
- Intent capsules and RAG injection defense are automatic — no policy configuration needed.
