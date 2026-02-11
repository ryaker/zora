# Zora v0.5 - Architecture Overview

Draft architecture summary for v0.5. This is a high-level overview of the spec.

## System Layers

- Orchestrator core: router, scheduler, failover controller
- Provider registry: ordered, capability-tagged providers (N-provider model)
- Execution loop: think → act → observe with tool calls
- Tool layer: files, shell, web, memory, MCP, notifications
- Persistence: JSONL sessions, filesystem memory, encrypted secrets
- Security: policy engine, integrity checks, audit log

## N-provider registry (v0.5)

Providers are defined in `~/.zora/config.toml` as an ordered array. Each provider is tagged with:
- `rank` (user preference)
- `capabilities` (reasoning, coding, structured-data, large-context)
- `cost_tier` (free, included, metered, premium)

Routing selects the best available provider for a task based on required capabilities, rank, and health. Failover walks down the ranked list automatically.

## Routing modes

- `respect_ranking`: pick the highest-ranked healthy provider that meets task needs
- `optimize_cost`: favor cheaper providers when they can handle the task
- `provider_only`: force a named provider
- `round_robin`: distribute evenly across healthy providers

## Failover

When a provider hits quota or auth failure:
- Context is packaged into a handoff bundle
- Next-ranked provider is selected
- Work continues without human intervention

If all providers are down, tasks are queued with retry backoff and a critical notification is sent.

## Security model

Zora enforces a capability policy with allowlisted paths and commands. Policy violations return structured errors to the model (self-correction pattern), rather than blocking with human prompts.

Critical files are read-only to tools:
- `SOUL.md`, `MEMORY.md`, `policy.toml`, `config.toml`

Integrity baselines are computed for these files at init and checked periodically.

## Memory

Three-tier memory, inspired by memU:
- Tier 1: `MEMORY.md` (human-curated, read-only to tools)
- Tier 2: daily notes (agent-written, rolling window for context)
- Tier 3: structured memory items and categories

Salience scoring combines recency, reinforcement, and source trust.
