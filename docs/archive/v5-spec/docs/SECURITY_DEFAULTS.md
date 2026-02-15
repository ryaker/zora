# Zora v0.5 - Security Defaults (Safe by Default)

Draft defaults for v0.5. Adjust once the policy schema is finalized.

Zora is designed to work without per-action prompts. The security boundary is your policy. These defaults are intentionally conservative.

## Default policy summary

- Read access: `~/Projects`, `~/.zora`
- Write access: `~/Projects`, `~/.zora`
- Denied paths: `~/Documents`, `~/Desktop`, `~/Downloads`, `~/Library`, `/`
- Shell allowlist: safe read-only and build commands
- No destructive commands
- Web fetch allowed only over HTTPS
- Integrity and audit logging enabled

## Example default policy

```toml
[fs]
allow_read = ["~/Projects", "~/.zora"]
allow_write = ["~/Projects", "~/.zora"]
deny = ["~/Documents", "~/Desktop", "~/Downloads", "~/Library", "/"]
resolve_symlinks = true
follow_symlinks = false
max_read_bytes = 5000000

[shell]
allow = ["ls", "pwd", "rg", "git", "node", "pnpm", "npm"]
deny = ["rm", "sudo", "chmod", "chown", "kill", "curl", "wget", "scp", "ssh"]
max_runtime = "5m"

[network]
allow = ["https://*"]
deny_private_ips = true

[security]
audit_log = true
integrity_guard = true
prompt_injection_guard = true
secrets_encryption = true
```

## Why no per-action prompts

Zora is designed to complete multi-step tasks without stalling. Policy violations return structured errors to the model so it can self-correct, rather than blocking on human approval.

## How to expand access safely

Examples:

1. Allow Documents for report writing

```toml
[fs]
allow_write = ["~/Projects", "~/.zora", "~/Documents"]
```

2. Allow Docker (if you understand the risk)

```toml
[shell]
allow = ["ls", "pwd", "rg", "git", "node", "pnpm", "npm", "docker"]
```

## Critical file protection

`SOUL.md`, `MEMORY.md`, `policy.toml`, and `config.toml` are read-only to the tool layer. This blocks prompt injection from rewriting your identity or permissions.

## Irreversible actions

The policy should treat irreversible actions as explicit and exceptional. Examples:
- pushing git commits
- deleting data
- modifying auth configuration

If you enable these, make it deliberate and document it in the policy comments.
