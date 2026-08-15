# Zora — Project Instructions

Read this first, then follow the links. It is deliberately short: it is loaded
into every session's context, so it says what you cannot guess and defers
everything else to `docs/`.

## What Zora Is

Zora is a long-running personal AI agent you install and run, not a toolkit for
building agents. It takes real actions on your machine, remembers across
sessions, and is reachable from a CLI, a local dashboard, Signal, and Telegram.

The differentiator is that the safety rules live in `~/.zora/policy.toml` and are
consulted before every tool call — not in the conversation, where context
compaction can erase them. Competitors: OpenClaw, NanoClaw, memU.

Current version: **0.12.0**. Node >= 20, TypeScript, ESM.

## Repository Layout

```
src/
  index.ts        # library entry point
  types.ts        # core shared types (TaskContext, ProviderConfig, ZoraPolicy, …)
  types/          # channel types
  cli/            # commander CLI: ask, start/stop, daemon, doctor, status, plus
                  # memory/audit/edit/team/steer/skill/subagent/hook/secret/security groups
  config/         # TOML config + policy loading, defaults
  core/           # approval queue, agent cooldown, project policy, memory risk forecaster
  orchestrator/   # Orchestrator (boot + submitTask), ExecutionLoop, Router, SessionManager,
                  # FailoverController, RetryQueue, AuthMonitor, TLCI dispatch
                  # (step classifier → execution planner → dispatcher), error pattern detector
  providers/      # claude-sdk, gemini-cli, ollama, echo (test) + circuit breaker
  security/       # PolicyEngine, capability tokens, intent capsules, hash-chained AuditLogger,
                  # IntegrityGuardian, SecretsManager, LeakDetector, prompt defense, shell validator
  hooks/          # ToolHookRunner, built-in tool hooks, SDK PreToolUse/PostToolUse bridge
  tools/          # Zora-defined tools + buildZoraMcpServer (the one tool-registration path)
  memory/         # MemoryManager tiers, StructuredMemory, extraction/validation pipelines,
                  # ContextCompressor, salience scoring, observer + reflector workers, plan cache
  channels/       # ChannelManager pipeline, policy gate, capability resolver, quarantine,
                  # signal/, telegram/ and team/ adapters, signature-validating webhook server
  steering/       # mid-task steering messages, flags, Telegram gateway
  teams/          # multi-agent teams: mailbox, agent loader, bridge watchdog, PR lifecycle
  skills/         # skill loader/installer, SkillSynthesizer, SkillsLock, auditor + scanner
  routines/       # cron and event-triggered routines, heartbeat
  dashboard/      # Express server + auth middleware + cost tracker + React frontend/
  services/       # NegativeCache (cross-session failure memory)
  integrations/   # AgentBus client
  lib/  utils/    # error normalizer; logger, fs, args, event filter, validators
  templates/      # security-policy.toml.template — a reference copy; nothing in src/
                  # reads it (`zora-agent init` generates policy.toml inline)
tests/            # unit/ integration/ e2e/ security/ benchmarks/ fixtures/
docs/             # see the map below
gaps/             # WSJF tracker + gap remediation notes
```

## Security Model

This is the part to get right. As of Wave 1 of the August 2026 remediation, a
tool call on the main task path passes through this chain:

```
model requests a tool
  │
  ├─ 1. allowedTools (static, SDK)     — ExecutionLoop's internal paths only
  │                                      (heartbeat/extraction/compression).
  │                                      The main provider path leaves it unset:
  │                                      an allowlist is a filter, not a registry.
  ├─ 2. PreToolUse hook (SDK-native)   — src/hooks/sdk-hook-bridge.ts adapts
  │                                      ToolHookRunner onto the SDK hook.
  │                                      A deny here genuinely blocks: the SDK
  │                                      never invokes the tool. Fails closed —
  │                                      a hook that throws denies the call.
  │                                      Also the only place argument rewrites
  │                                      (SecretRedactHook) reach execution.
  ├─ 3. canUseTool  (permissionMode: 'default')
  │                                    — PolicyEngine, SEC-10 capability tokens,
  │                                      and, for channel-originated tasks, the
  │                                      channel CapabilitySet allowlist and
  │                                      destructiveOpsAllowed gate.
  ├─ 4. tool executes
  └─ 5. PostToolUse hook               — observational: audit log, LeakDetector,
                                         NegativeCache, error-pattern detection.
```

Non-negotiable invariants:

- **`permissionMode` is `'default'` everywhere.** That is the only mode under
  which the SDK calls `canUseTool`. `bypassPermissions` does not appear anywhere
  in `src/` and must not be reintroduced — `grep -rn "bypassPermissions" src/`
  should stay empty.
- **Hook denials are real denials.** `ToolHookRunner` keeps its interface but is
  invoked *from* the `PreToolUse` bridge, not from stream observation. The
  orchestrator's `tool_call` handler now only observes and logs; do not put
  enforcement back there, and do not re-run the hook chain there (it would
  double-count rate limits and double-write audit entries).
- **One tool-registration path.** Both `ExecutionLoop` and `ClaudeProvider` build
  their MCP server via `buildZoraMcpServer()` in `src/tools/zora-mcp-server.ts`.
  There is no `customTools` SDK option — passing one silently drops every tool.
  Tool input schemas are JSON Schema in Zora and must be converted to Zod before
  reaching `createSdkMcpServer()`.

Built-in tool hooks, in registration order: `SensitiveFileGuard`, `ShellSafety`,
`AuditLog`, `RateLimit`, `SecretRedact`, `IrreversibilityScorer`.

Around that chain sit the always-on pieces: a hash-chained append-only audit log,
HMAC-signed intent capsules for goal-drift detection, `IntegrityGuardian`
SHA-256 baselines over SOUL.md / MEMORY.md / policy.toml / config.toml,
CaMeL-style dual-LLM quarantine so channel message content never reaches the
privileged loop directly, and supply-chain scanning of skills
(`@nodesecure/js-x-ray` + `skills.lock.json`).

`tests/security/tool-enforcement.test.ts` is the regression guard for all of the
above. It must not be weakened; if it starts failing, something is unenforced.

Details: `docs/adr/ADR-002-policy-enforcement.md`,
`docs/adr/ADR-006-security-architecture.md`, `docs/advanced/security-runtime.md`,
and the August 2026 review in `docs/reviews/`.

## Running Things

```bash
npm run build          # tsc + dashboard frontend
npm run lint           # tsc --noEmit — this is the lint
npm run test:unit      # vitest (the fast loop)
npm run test:browser   # playwright
npm test               # unit + browser
npm run test:integration   # ZORA_INTEGRATION=1, CLI ask path
npm run test:e2e           # ZORA_E2E=1, scenario harness (EchoProvider by default)
npm run test:e2e:real      # same, against real providers
npm run dev            # tsx src/index.ts
```

Before opening a PR: `npm run lint` and `npm run test:unit` must pass.

## The Tracker

Work is tracked as WSJF-scored gaps in `gaps/wsjf-scores.json`.

```bash
./gaps/tracker.sh remaining          # open gaps
./gaps/tracker.sh next               # highest-WSJF unblocked gap
./gaps/tracker.sh detail  <ID>       # scores, dependencies, files
./gaps/tracker.sh deps    <ID>       # dependency tree
AGENT_NAME=you ./gaps/tracker.sh claim <ID>
./gaps/tracker.sh done <ID>          # shows what you unblocked
```

Workflow: `next` → `detail` → read the category file in `gaps/` → `claim` →
implement → `npm run lint && npm run test:unit` → `done`.

Gap detail lives in `gaps/ORCHESTRATION.md`, `TYPE_SAFETY.md`,
`ERROR_HANDLING.md`, `TESTING.md`, `OPERATIONAL.md`,
`LOGGING_DOCUMENTATION.md`, `SECURITY_HARDENING.md`, plus
`APPENDIX_A.md`–`APPENDIX_E.md`. No file there exceeds 1000 lines; read
structure first, then the section you need.

Specialist agent definitions for the older gap streams live in `.claude/agents/`
(`orchestration-agent.md`, `error-hardening-agent.md`, `ops-agent.md`,
`quality-agent.md`). They predate the August 2026 waves; where the two disagree,
the remediation plan wins.

The current plan of record is `docs/reviews/2026-08-remediation-plan.md`
(WSJF backlog, dependency waves, per-agent file ownership), against the findings
in `docs/reviews/2026-08-code-review.md`.

## Documentation Map

| Topic | File |
|---|---|
| Install and first task | `QUICKSTART.md`, `SETUP_GUIDE.md`, `docs/BEGINNERS_GUIDE.md` |
| Config + policy reference | `docs/configuration.md` |
| Writing a provider | `docs/provider-guide.md` |
| Runtime safety layer | `docs/advanced/security-runtime.md` |
| Architecture decisions | `docs/adr/ADR-001`–`ADR-008` |
| Architecture (TOGAF, ontologies) | `docs/architecture/` |
| Signal channel setup | `docs/SIGNAL_CHANNEL_SETUP.md` |
| E2E / cross-LLM evaluation | `docs/testing/e2e-cross-llm-evaluation.md` |
| Diagnosing a broken install | `docs/troubleshooting.md`, `zora-agent doctor` |
| Review record (do not edit) | `docs/reviews/`, `docs/research/` |

`docs/archive/` is a historical record of superseded specs. Do not cite it as
current and do not update it.

## Rules

- **Verify before you assert.** This file and `docs/` are read by every future
  agent; a confident wrong statement propagates. If you cannot verify a claim in
  the source, leave it out.
- **Check the tracker** before starting — someone may already hold the gap — and
  update it when you finish.
- **One worktree per agent, disjoint file ownership.** Parallel waves assign
  each agent a file set in `docs/reviews/2026-08-remediation-plan.md`. Stay
  inside yours; `src/orchestrator/orchestrator.ts` is assigned to exactly one
  agent per wave.
- **Conventional commits**, referencing the gap ID (e.g. `fix(security): … (SEC-21)`).
- **Comment the why, with a gap ID.** The existing comment discipline is the
  reason this codebase is reviewable; match it.
- **Do not weaken a security test** to make a change pass.

## API Documentation Rule

Before implementing any call to an external API (Twilio, Signal, OpenAI, Agent
Phone, etc.):

1. Use `mcp__plugin_context7_context7__resolve-library-id` to locate the library.
2. Then `mcp__plugin_context7_context7__query-docs` to fetch current docs.

Never assume API shape, auth headers, or endpoint paths from training data —
always verify against live docs first. This prevents hallucinated parameters and
outdated SDK usage.
