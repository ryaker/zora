---
name: zora-config-advisor
description: "Guide users through configuring Zora agent setup by interviewing them about their workflow, then generating tailored config.toml and policy.toml files. Use when: (1) setting up Zora for a new workflow, (2) tuning security policy for a specific task, (3) choosing providers, MCP servers, or skills for a use case, (4) reviewing or tightening an existing Zora config. Triggers on \"configure Zora\", \"Zora setup\", \"policy for\", \"config for\", \"zora init help\", \"what permissions\", \"which MCP servers\"."
---

# Zora Configuration Advisor

Help users create or refine their Zora `config.toml` and `policy.toml` for a specific workflow.

## How This Works

You conduct a structured interview (Phases 1-4), then generate ready-to-use config files. The user describes their workflow; you map it to the right permissions, providers, and tools.

## Phase 1: Understand the Workflow

Ask the user these questions (adapt phrasing naturally):

1. **What should Zora do?** Get a 1-2 sentence description of the task/workflow.
2. **Where does the work happen?** Which directories contain the relevant code/data?
3. **What tools does the workflow use?** (git, npm, python, docker, etc.)
4. **Does it need network access?** Which APIs or domains?
5. **Does it need to push/deploy?** Or is it read-analyze-write only?

## Phase 2: Assess the Security Surface

Based on Phase 1 answers, determine:

| Dimension | Question to resolve |
|-----------|-------------------|
| **Filesystem scope** | Which paths need read? Write? Which are off-limits? |
| **Shell commands** | Which specific commands? Deny-all or allowlist? |
| **Irreversible actions** | Does the workflow push code, send emails, delete files? |
| **Network exposure** | HTTPS-only? Specific domains? No network? |

### Preset starting point

Recommend a preset as the base, then customize:

- **Safe** — no shell, read-only. Good for analysis, summarization, review.
- **Balanced** — allowlisted shell, project-scoped writes. Good for most dev work.
- **Power** — broader shell + filesystem. Good for ops, multi-project, data pipelines.

For preset details, see [references/presets.md](references/presets.md).

## Phase 3: Select Providers and Tools

### Providers

Ask what LLM backends they have available:

```bash
which claude && echo "Claude CLI found"
which gemini && echo "Gemini CLI found"
node --version
```

Then recommend ranking based on the workflow:

| Workflow type | Recommended primary | Why |
|--------------|-------------------|-----|
| Code refactoring | Claude | Best at code reasoning |
| Large codebase analysis | Gemini | 1M token context |
| Creative writing | Claude | Stronger creative output |
| Data processing | Either | Both handle structured data well |
| Local/offline | Ollama | Free, no network needed |

### MCP Servers

Only recommend MCP servers the workflow actually needs:

| Server | Wire it when... |
|--------|----------------|
| GitHub | Workflow creates PRs, manages issues, searches code |
| Google Workspace | Workflow touches Gmail, Calendar, Drive, Docs |
| Filesystem | Always available (built-in) |
| Memory (Mem0) | Long-running project needing cross-session context |
| Nanobanana | Workflow generates AI images |
| Asset Intelligence | Workflow manages image assets |
| Chrome DevTools | Workflow tests web pages or scrapes content |

### Skills

List relevant skills based on the workflow domain. Skills auto-activate, so just confirm they're installed:

```bash
ls ~/.claude/skills/
```

For the full skill catalog and mapping, see [references/skill-map.md](references/skill-map.md).

## Phase 4: Generate Config Files

Once all questions are answered, generate both files.

### policy.toml

Use `smol-toml` format. Structure:

```toml
[filesystem]
allowed_paths = [...]
denied_paths = [...]
resolve_symlinks = true
follow_symlinks = false

[shell]
mode = "allowlist"  # or "deny_all" or "denylist"
allowed_commands = [...]
denied_commands = [...]
split_chained_commands = true
max_execution_time = "5m"

[actions]
reversible = [...]
irreversible = [...]
always_flag = [...]

[network]
allowed_domains = [...]
denied_domains = []
max_request_size = "10mb"
```

### config.toml

Full structure reference: [references/config-reference.md](references/config-reference.md).

### Present to User

Show both files with inline comments explaining each choice. Ask:
- "Does this look right?"
- "Any paths I should add or remove?"
- "Want to tighten or loosen the shell policy?"

### Write Files

Once approved, write to `~/.zora/config.toml` and `~/.zora/policy.toml`.

## Guidelines

- Always start narrow and offer to widen — never the reverse
- Every `allowed_path` and `allowed_command` should trace back to a stated workflow need
- If the user says "I don't know" about security questions, default to the Safe preset
- Never put `sudo`, `rm -rf`, or credential paths in allowed lists unless explicitly requested
- Explain WHY each permission is needed, not just WHAT it allows
- Suggest running a test task after config generation to verify
