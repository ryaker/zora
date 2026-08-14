# Runtime Safety Layer

Zora's security model has two tiers. The first tier — the PolicyEngine — defines *what* Zora is allowed to do. The second tier — the runtime safety layer — evaluates *how risky a specific action is right now* and stops to ask when the answer is "too risky."

The model is: **Prevent → Pause → Prove.**

| Phase | Mechanism | What It Does |
|-------|-----------|-------------|
| **Prevent** | PolicyEngine + startup audit | Blocks structurally unsafe actions before they can be requested |
| **Pause** | Irreversibility scoring + approval queue | Pauses high-risk actions and waits for your explicit go-ahead |
| **Prove** | Audit log + session risk forecaster | Records everything; detects emerging risk patterns across a session |

All runtime safety features are **disabled by default**. Enable only what you need.

---

## How to Enable

Add a `[safety]` section to `~/.zora/policy.toml`:

```toml
[safety]
enabled = true

[safety.scoring]
enabled = true

[safety.approval]
enabled = true
channel = "telegram"   # or "dashboard" — where approval requests appear

[safety.forecaster]
enabled = true

[safety.reputation]
enabled = true

[safety.audit]
startup_check = true
```

Restart the daemon after changing this file:

```bash
zora-agent stop && zora-agent start
```

---

## Irreversibility Scoring

Every tool call is scored 0–100 before it executes. The score represents how hard the action is to undo.

### Default Score Table

| Tool / Action | Score | Notes |
|---------------|-------|-------|
| `read_file` | 5 | Read-only, no side effects |
| `web_fetch` | 10 | Network read, no mutation |
| `write_file` | 20 | File can be restored from git |
| `edit_file` | 20 | Same as write |
| `bash` (read-only: `ls`, `cat`, `git diff`) | 10 | Classified as safe |
| `bash` (write: `mkdir`, `cp`, `mv`) | 35 | Reversible with effort |
| `bash` (`npm install`, `pip install`) | 45 | State change, rollback needed |
| `git_commit` | 55 | Commit exists, can be reverted |
| `git_push` (origin) | 70 | Remote state changed |
| `send_signal_message` | 80 | Message delivered, cannot unsend |
| `send_telegram_message` | 80 | Same |
| `delete_file` | 95 | No undo without backup |
| `bash` (`rm -rf`) | 98 | Destructive, near-irreversible |

Scores are additive when actions chain. A `git_push` immediately after a `git_commit` within the same task scores as 70 (the push, the riskier of the two) plus 10 drift bonus if it wasn't in the original task scope.

### Configuring Thresholds

```toml
# ~/.zora/policy.toml
[actions.thresholds]
warn      = 40   # log a warning, allow the action
flag      = 65   # pause and route to the approval queue
auto_deny = 95   # block outright, no approval option
```

Actions scoring between `warn` and `flag` are logged with a `[HIGH_RISK]` tag but not blocked. Actions above `flag` are held until you respond. Actions at or above `auto_deny` are refused immediately — Zora explains why and asks if you want to lower the threshold for this session.

### Overriding Scores for Specific Tools

```toml
[actions.scores]
write_file  = 15   # lower if you trust your git discipline
git_push    = 50   # lower for trusted personal repos
delete_file = 80   # lower if you have reliable backups
```

---

## Human-in-the-Loop Approval

When an action scores above `flag`, Zora pauses execution and routes the action to the approval queue.

### Telegram Approval

Configure a Telegram bot token and your chat ID in `~/.zora/policy.toml`:

```toml
[integrations.telegram]
bot_token = "env:ZORA_TELEGRAM_TOKEN"   # never plaintext — use env: prefix
allowed_users = [123456789]             # your Telegram numeric user ID

[safety.approval]
enabled = true
channel = "telegram"
timeout_seconds = 300   # auto-deny after 5 minutes
```

When an action is flagged, you receive:

```
⚠️ Zora Action Approval Required
Action: git_push (origin main)
Risk: 70/100 (high)
Task: "update deployment scripts"
Token: ZORA-A8F2

Reply: /approve ZORA-A8F2 allow
       /approve ZORA-A8F2 deny
       /approve ZORA-A8F2 allow-30m
       /approve ZORA-A8F2 allow-session
```

**Approval scopes:**

| Scope | What It Does |
|-------|-------------|
| `allow` | Approve this one action |
| `deny` | Block this action; Zora explains and suggests alternatives |
| `allow-30m` | Approve all matching actions for the next 30 minutes |
| `allow-session` | Approve this action type for the rest of the session |

If you don't respond within `timeout_seconds`, the action is auto-denied.

### Dashboard Approval

Set `channel = "dashboard"` to handle approvals in the web UI at `http://localhost:8070`. Actions appear in the **Pending Approvals** panel with the same approval scope options.

---

## Session Risk Forecaster

The forecaster watches three risk signals across an entire session and escalates the approval threshold when the composite score passes a limit.

### Signals

**Drift** — Has the agent's actions moved away from its original task?

Zora extracts keywords from the initial task description and compares them against the tools and file paths used as the session progresses. A session starting with "update deployment scripts" that starts touching billing code scores high on drift.

**Salami** — Is the agent executing a sequence of individually small actions that together build toward something harmful?

Each action is scored for contribution to known harmful patterns: privilege escalation, data exfiltration, lateral movement, credential gathering. No single action triggers this signal; it accumulates.

**Commitment Creep** — Are actions getting progressively more irreversible over time?

Tracks the moving average of irreversibility scores across the last 10 actions. If the average is trending up — starting with file reads, then writes, then git pushes, then message sends — the forecaster treats the next action as higher risk than its individual score suggests.

### Thresholds

```toml
[safety.forecaster]
enabled = true

[safety.forecaster.thresholds]
drift_warn         = 0.4   # 40% keyword divergence from original task
drift_flag         = 0.7   # 70% divergence — next action needs approval
salami_warn        = 30    # composite harm potential warning
salami_flag        = 60    # composite harm potential — flag actions
creep_warn         = 55    # moving avg irreversibility warning
creep_flag         = 72    # moving avg irreversibility — flag actions

[safety.forecaster]
composite_flag     = 1.5   # sum of normalized signals; flag when exceeded
```

When the composite score passes `composite_flag`, the effective `flag` threshold for new actions drops by 15 points — so actions that would normally pass silently get routed to approval.

---

## Agent Reputation

When a spawned subagent repeatedly has actions blocked — either by policy or by the approval queue — it enters a progressive cooldown.

### Cooldown Levels

| Level | Trigger | Behavior |
|-------|---------|---------|
| **Normal** | 0–2 blocked actions | No restrictions |
| **Throttled** | 3 blocked actions in a session | 2s delay before each action; warning logged |
| **Restricted** | 5 blocked actions | Every action needs explicit approval, regardless of score |
| **Suspended** | 8 blocked actions | Agent shut down; parent notified |
| **Reset** | 24 hours of clean behavior | Returns to Normal |

This prevents a misbehaving subagent from bypassing restrictions by simply retrying at volume.

### Configuration

```toml
[safety.reputation]
enabled = true
throttle_after  = 3    # blocked actions before throttle
restrict_after  = 5    # blocked actions before restrict
suspend_after   = 8    # blocked actions before shutdown
reset_hours     = 24   # hours of clean behavior to reset
```

---

## Per-Project Security Scope

You can restrict a subagent's permissions below the global ceiling without raising them. Drop a `.zora/security-policy.toml` in any project directory and Zora applies it when running tasks in that project.

**This file can only restrict — it cannot grant permissions the global policy doesn't allow.**

### Full Reference

```toml
# .zora/security-policy.toml

[policy.tools]
# Tools in this list are denied even if the global policy allows them.
denied = ["bash", "spawn_zora_agent"]

# Tools in this list are the ONLY ones allowed (allowlist mode).
# If both denied and allowed are set, denied takes precedence.
allowed = ["read_file", "web_fetch", "write_file"]

[policy.filesystem]
# Additional paths to deny access to, on top of the global deny list.
deny = ["./secrets", "./credentials"]

# Restrict write access to specific subdirectories only.
write_allow = ["./output", "./reports"]

[policy.actions]
# Maximum irreversibility score for any action in this project.
# Overrides the global flag threshold — sets a hard ceiling, not just a warning.
max_irreversibility_score = 60   # nothing riskier than a git commit

# Override the flag threshold for this project only.
flag = 45

[policy.budget]
# Tighter action budget for this project, if you want it below the global default.
max_actions_per_session = 30

[policy.network]
# Restrict outbound network calls to specific domains.
allow_domains = ["api.github.com", "registry.npmjs.org"]

[policy.shell]
# Additional denied commands, on top of the global deny list.
deny = ["curl", "wget", "python3"]
```

### Example: Read-Only Code Review Agent

A code review agent has no reason to write files, run shell commands, or send messages:

```toml
# projects/my-app/.zora/security-policy.toml
[policy.tools]
allowed = ["read_file", "web_fetch"]

[policy.actions]
max_irreversibility_score = 10
```

### Example: Report Generation Agent

A reporting agent needs to write files but shouldn't touch git or send external messages:

```toml
[policy.tools]
denied = ["bash", "spawn_zora_agent", "send_signal_message", "send_telegram_message"]

[policy.filesystem]
write_allow = ["./reports"]

[policy.actions]
max_irreversibility_score = 25
```

---

## Startup Security Audit

Every time the daemon starts, Zora runs a self-audit of its configuration files
and environment. The gate lives in `src/cli/daemon.ts` (it calls
`runSecurityAuditSilent()` before the orchestrator boots) and the checks
themselves in `src/cli/security-commands.ts`.

### Running the Audit Manually

```bash
zora-agent security                  # full audit, human-readable
zora-agent security --fix            # auto-fix the permission issues it can (chmod corrections)
zora-agent security --format json    # machine-readable output
```

Those are the only two options the command registers
(`src/cli/security-commands.ts`). `--format` accepts `text` (the default) or
`json`; any other value falls back to `text`.

### Output Format

```
$ zora-agent security
✓ PASS  ~/.zora permissions (700)
✓ PASS  config.toml permissions (600)
✓ PASS  policy.toml permissions (600)
✗ FAIL  Plaintext secret in config.toml (config.toml:44)
⚠ WARN  Node.js >= 20 LTS
✓ PASS  Daemon binds to localhost only

Summary: 4 PASS, 1 FAIL, 1 WARN
```

FAILs block startup. Each FAIL carries its own message naming the remediation
(for a plaintext secret, the environment variable to move it to); there is no
separate `--explain` flag.

### Checks Performed

There are three severities — `PASS`, `FAIL`, `WARN`. There is no `INFO` level.

| # | Check | Severity when failing | Auto-fix with `--fix`? |
|---|-------|----------------------|------------------------|
| 1 | `~/.zora/` directory permissions (expect 700) | FAIL (WARN if the directory does not exist yet) | Yes — `chmod 700` |
| 2 | `config.toml` permissions (expect 600) | FAIL | Yes — `chmod 600` |
| 3 | `policy.toml` permissions (expect 600), for both the project and the global copy | FAIL | Yes — `chmod 600` |
| 4 | Plaintext secrets in any `*.toml` under the config dir, reported one finding per line with `file:line` | FAIL | No — requires manual remediation |
| 5 | Daemon bind address is localhost, not `0.0.0.0` | FAIL | No |
| 6 | AgentBus URL uses HTTPS for non-local hosts | WARN | No |
| 7 | Node.js >= 20 LTS | WARN | No |
| 8 | Signal channel configured but `channel-policy.toml` missing | WARN | No |

FAILs block daemon startup entirely. WARNs are logged at boot but do not block
startup.

### Disabling Startup Audit

If you need to skip the audit for scripted deployments (not recommended), set an
environment variable — there is no config key for this:

```bash
ZORA_SKIP_SECURITY_AUDIT=1 zora-agent daemon start
```

The daemon logs a warning when it takes that path.

---

## Troubleshooting

### Actions Are Being Blocked Unexpectedly

1. Run `zora-agent audit --last 1h` and look for `policy_violation` entries.
   `--last` takes a duration (`30m`, `24h`, `7d`) — a bare number is ignored and
   falls back to the 24h default.
2. Narrow to just the denials with `zora-agent audit --type policy_violation`,
   or to one task with `zora-agent audit --job <jobId>`.
3. Each entry prints its entry ID, event type, job ID, timestamp, and the tool
   name. The deny reason itself is in the daemon log, not the audit CLI output.

If the score seems wrong, override it for the specific tool in `policy.toml`:

```toml
[actions.scores]
git_push = 50   # adjust downward if you're comfortable with your repo
```

### Approval Messages Not Arriving

- Verify `ZORA_TELEGRAM_TOKEN` is set in your environment.
- Run `zora-agent security` — a misconfigured token shows as FAIL.
- Check `~/.zora/logs/safety.log` for delivery errors.
- Test the bot directly: send `/start` to your bot in Telegram.

### Session Flagged Despite Low Individual Action Scores

The session risk forecaster is elevating the effective threshold. Per-session
state — the drift, salami, and commitment-creep components of the composite
score — is persisted as JSON under `~/.zora/session-risk/<sessionId>.json`
(`MemoryRiskForecaster`, `src/core/memory-risk-forecaster.ts`).

The forecaster is off unless you turn it on, and there is no CLI flag for it.
Disable it by editing `config.toml`:

```toml
[risk_forecaster]
enabled = false
```

### Agent Stuck in Restricted or Suspended State

Per-subagent reputation is persisted as JSON under
`~/.zora/agent-reputation/<agentId>.json` (`AgentCooldown`,
`src/core/agent-cooldown.ts`). Read the file to see the denial count and current
state.

The CLI registers no `reputation` command. To reset a subagent that was
incorrectly suspended, delete its reputation file:

```bash
rm ~/.zora/agent-reputation/<agent-id>.json
```

### Startup Blocked by Security Audit FAIL

Re-run `zora-agent security`. Each failing check prints its own remediation hint
on the `→` line beneath it.

Common fixes:

```bash
# Fix directory permissions
chmod 700 ~/.zora
chmod 600 ~/.zora/config.toml ~/.zora/policy.toml

# Move plaintext token to environment variable
# In ~/.zora/config.toml, replace:
#   bot_token = "123456:ABCdef..."
# With:
#   bot_token = "env:ZORA_TELEGRAM_TOKEN"
# Then add to your shell profile:
export ZORA_TELEGRAM_TOKEN="123456:ABCdef..."
```

---

## See Also

- [Security Guide](../../SECURITY.md) — full OWASP coverage, PolicyEngine internals, trust levels
- [Signal Channel Setup](../SIGNAL_CHANNEL_SETUP.md) — configuring Signal as an inbound/outbound channel
- [Troubleshooting](../troubleshooting.md) — general troubleshooting reference
