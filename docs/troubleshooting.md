# Troubleshooting Guide

Common issues and their solutions when running Zora.

---

## Authentication Failures

### Claude provider: "session expired" or "not authenticated"

**Symptoms:** Tasks fail with `authentication`, `session_expired`, or `unauthorized` errors from the Claude provider.

**Cause:** The Claude SDK uses a Mac session token that has expired.

**Fix:**
1. Open a terminal and run `claude` to start a new interactive Claude session. This refreshes the session token.
2. Restart the Zora daemon: `zora daemon stop && zora daemon start`.
3. Verify auth status on the dashboard at `http://localhost:7070`.

If using `auth_method = "api_key"`:
1. Verify the environment variable specified in `api_key_env` is set and contains a valid key.
2. Check for typos in the environment variable name in `config.toml`.

### Gemini provider: "workspace_sso" auth failure

**Symptoms:** Gemini tasks fail with authentication errors.

**Fix:**
1. Run `gcloud auth login` to refresh your Google Workspace SSO credentials.
2. If using `auth_method = "api_key"`, verify the API key environment variable is set.
3. If using a custom `cli_path`, verify the binary exists and is executable.

### Auth token expiry notifications

**Symptoms:** Dashboard shows auth warnings but tasks still work.

**Explanation:** The AuthMonitor checks provider auth status every 5 minutes. It issues pre-expiry warnings 2 hours before token expiration. These are informational -- the provider is still functional until the token actually expires.

---

## Provider Not Found

### "No provider available" error

**Symptoms:** `submitTask` throws `No provider available: ...`

**Causes and fixes:**

1. **All providers disabled.** Check `config.toml` and ensure at least one provider has `enabled = true`.

2. **No provider matches required capabilities.** The router classifies each task by complexity and resource type, then selects a provider whose `capabilities` match. If no provider has the needed capability, routing fails.
   - Fix: Add the missing capability to a provider's `capabilities` list, or change `routing.mode` to `"provider_only"` to bypass capability matching.

3. **Provider auth failed.** A provider whose `checkAuth()` returns `valid: false` is excluded from routing.
   - Fix: See the Authentication Failures section above.

4. **Provider quota exhausted.** A provider whose `getQuotaStatus()` returns `isExhausted: true` is excluded.
   - Fix: Wait for the cooldown period to expire, or enable failover to another provider.

5. **Routing mode misconfigured.** If `routing.mode = "provider_only"` but `provider_only_name` doesn't match any provider's `name`, routing fails.
   - Fix: Verify the `provider_only_name` value matches a configured provider name exactly.

---

## Policy Denials

### "Access to <path> is not permitted by current capability policy"

**Cause:** The path is not in `policy.toml`'s `filesystem.allowed_paths`.

**Fix:** Add the path to `allowed_paths` in `~/.zora/policy.toml`:
```toml
[filesystem]
allowed_paths = ["~/.zora", "~/my-project"]
```
Or re-run `zora init` to regenerate the policy for your workspace.

### "Access to <path> is explicitly denied by security policy"

**Cause:** The path is in `filesystem.denied_paths`. Deny rules take precedence over allow rules.

**Fix:** Remove the path from `denied_paths` if you intentionally need access. Paths like `~/.ssh` and `~/.gnupg` are typically denied for security.

### "Command '<cmd>' is not in the allowlist"

**Cause:** Shell policy is in `allowlist` mode and the command is not listed.

**Fix:** Add the command to `shell.allowed_commands` in `policy.toml`:
```toml
[shell]
mode = "allowlist"
allowed_commands = ["ls", "cat", "git", "npm", "your-command"]
```

### "Shell command execution is disabled by security policy"

**Cause:** Shell policy `mode` is set to `"deny_all"`.

**Fix:** Change the mode to `"allowlist"` or `"denylist"` and configure the appropriate command lists.

### "Command '<cmd>' is forbidden by security policy"

**Cause:** The command is in `shell.denied_commands`. This applies in both `allowlist` and `denylist` modes.

**Fix:** Remove the command from `denied_commands` if you need it. Be cautious with commands like `rm` and `sudo`.

### "Symlink target <path> is outside allowed boundaries"

**Cause:** A file is a symlink whose real target resolves outside `allowed_paths`, and `follow_symlinks` is `false`.

**Fix:** Either add the symlink's real target to `allowed_paths`, or set `follow_symlinks = true` (less secure).

### "Session action budget exceeded"

**Cause:** The `budget.max_actions_per_session` limit was reached.

**Fix:** Increase the limit in `policy.toml`, or set it to `0` for unlimited:
```toml
[budget]
max_actions_per_session = 500
```

### "[DRY RUN] Would write to file: ..."

**Cause:** Dry-run mode is enabled. Write operations are previewed but not executed.

**Fix:** To disable dry-run, set `enabled = false` in `policy.toml`:
```toml
[dry_run]
enabled = false
```

---

## Daemon Won't Start

### `zora daemon start` does nothing or exits immediately

**Possible causes:**

1. **Port conflict.** The dashboard port (default `7070`) is already in use.
   - Fix: Change `steering.dashboard_port` in `config.toml`, or stop the process using the port: `lsof -i :7070`.

2. **Config file missing or invalid.** The daemon cannot parse `config.toml`.
   - Fix: Run `zora init` to generate a fresh config, or validate your TOML syntax.

3. **Policy file missing.** The `security.policy_file` path doesn't exist.
   - Fix: Run `zora init` to generate the policy file, or create it manually.

4. **No providers enabled.** The daemon boots but cannot do anything without at least one enabled provider.
   - Fix: Enable at least one provider in `config.toml`.

### Daemon crashes on boot

**Check the logs** at `~/.zora/logs/daemon.log` (if configured) or look at stderr output.

Common crash causes:
- Invalid TOML syntax in `config.toml` or `policy.toml` (missing quotes, wrong types).
- File permission errors on `~/.zora/` directories.
- Missing dependencies (run `npm install` in the Zora directory).

### PID file stale

If the daemon didn't shut down cleanly, a stale PID file may prevent restart.

**Fix:** Remove the PID file and restart:
```bash
rm ~/.zora/daemon.pid
zora daemon start
```

---

## Dashboard Not Loading

### Browser shows "connection refused" at localhost:7070

1. **Daemon not running.** Start it: `zora daemon start`.
2. **Wrong port.** Check `steering.dashboard_port` in `config.toml`.
3. **Firewall blocking.** Ensure localhost connections are allowed.

### Dashboard loads but shows no data

1. **No active sessions.** The dashboard displays data from the SessionManager. If no tasks have run, there's nothing to show.
2. **CORS issues.** If accessing the dashboard from a different origin, the Express server may block requests. Access it from `http://localhost:<port>` directly.

### Dashboard shows stale provider status

The dashboard polls provider status periodically. If a provider's auth/quota status changed recently, wait for the next poll cycle (default: 5 seconds based on `steering.poll_interval`).

---

## Telegram Not Connecting

### Bot doesn't respond to messages

1. **Telegram not enabled.** Set `steering.telegram.enabled = true` in `config.toml`.
2. **Missing bot token.** Set `steering.telegram.bot_token` to your BotFather token.
3. **User not allowed.** Add your Telegram username to `steering.telegram.allowed_users`:
   ```toml
   [steering.telegram]
   enabled = true
   bot_token = "123456:ABC-DEF..."
   allowed_users = ["your_username"]
   ```
4. **Rate limited.** If you're sending messages faster than `rate_limit_per_min`, messages are dropped.

### Bot sends "unauthorized" replies

Your Telegram username is not in `allowed_users`. Add it and restart the daemon.

---

## Common Error Messages

| Error Message | Cause | Fix |
|---------------|-------|-----|
| `Orchestrator.boot() must be called before accessing subsystems` | Code attempted to use the orchestrator before `boot()` completed. | Ensure `await orchestrator.boot()` is called before `submitTask()`. |
| `Cannot grant access to <path> -- permanently denied by policy` | `expandPolicy()` was called with a path in `denied_paths`. | Remove the path from `denied_paths` first, or accept the restriction. |
| `Cannot allow command '<cmd>' -- permanently denied by policy` | `expandPolicy()` was called with a command in `denied_commands`. | Remove the command from `denied_commands` first. |
| `Token budget exceeded: N/M tokens used` | The session's token budget was exhausted. | Increase `budget.token_budget` or set to `0`. |
| `Goal drift detected: <reason>` | The IntentCapsuleManager flagged an action as inconsistent with the original task intent. | Review the action. If it's intentional, approve it when prompted. |
| `Bash tool invoked without a command` | A tool call was made to Bash with no `command` parameter. | This is a bug in the calling code. |
| `Max retries exceeded` | A task failed and exhausted all retry attempts. | Check provider health, then resubmit the task. |

---

## Diagnostic Commands

```bash
# Check if the daemon is running
zora daemon status

# View recent audit events
zora audit tail

# Check provider auth status
zora doctor

# Validate config and policy files
zora init --check

# View memory state
zora memory show
```
