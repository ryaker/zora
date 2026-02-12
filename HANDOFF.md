# Zora Build Handoff — Agent Relay Notes

> **Date:** 2026-02-12
> **Branch:** `feature/t1-scaffold` → PR to `develop`
> **Tests:** 62 passing, 0 failing
> **TypeScript:** Clean compile (`tsc --noEmit` passes)

---

## What's In This PR (Tier 1, Items 1-3)

### Item 1: Project Scaffolding
- `package.json` — Node 20+, ESM, vitest, tsx, smol-toml
- `tsconfig.json` — strict mode, bundler resolution, path aliases
- `vitest.config.ts` — TypeScript-native test runner
- Full directory structure matching spec §4.3:
  - `src/{cli,config,orchestrator,providers,tools,memory,security,routines,teams,steering,dashboard,wasm}/`
  - `tests/{unit/{config,providers,tools,orchestrator,security},integration,fixtures}/`

### Item 2: Config System
- `src/config/defaults.ts` — All default values from spec §7 + validation functions
- `src/config/loader.ts` — TOML parsing via smol-toml, deep-merge with defaults, `loadConfig()` / `loadConfigFromString()`
- `src/config/index.ts` — Barrel exports
- `ConfigError` class with aggregated validation errors

### Item 3: Core TypeScript Interfaces
- `src/types.ts` (319 lines) — Single source of truth:
  - `LLMProvider`, `AuthStatus`, `QuotaStatus`, `AgentEvent`, `TaskContext`
  - `ProviderCapability`, `CostTier`, `RoutingMode`, `TaskComplexity`
  - `HandoffBundle`, `AuditEvent`, `WorkerCapabilityToken`
  - `ZoraConfig`, `ZoraPolicy` and all sub-config types

### Test Infrastructure
- `tests/fixtures/mock-provider.ts` — Full `LLMProvider` mock with configurable behavior + assertion tracking
- `tests/fixtures/sample-config.toml` — Test config with 2 providers
- `tests/fixtures/sample-policy.toml` — Test policy file
- 62 tests across 3 suites:
  - `defaults.test.ts` (27) — default values, validation rules
  - `loader.test.ts` (12) — TOML parsing, merge, error handling
  - `mock-provider.test.ts` (23) — interface compliance, execution flow

### Docs (from GPT 5.2 session)
- `specs/v5/docs/POLICY_PRESETS.md` — Safe/Balanced/Power presets
- `specs/v5/docs/WEB_ONBOARDING_SPEC.md` — Local web wizard spec
- Updated `specs/v5/docs/ONBOARDING_INSTALL.md` — Presets, scope, dry-run sections
- Updated `README.md` — Links to new docs

---

## What To Do Next

### Next Feature Branch: `feature/t1-claude-provider` (Item 4)
**Claude Provider** — Agent SDK integration

**IMPORTANT: Read the docs first.** Don't guess at the SDK APIs:
1. Read `@anthropic-ai/claude-agent-sdk` npm docs + GitHub README for the real `query()` API
2. Read Gemini CLI OSS repo docs for the subprocess wrapper pattern
3. Then implement `ClaudeProvider` class implementing `LLMProvider`

Key design decisions:
- Mac session token auth (long-running token, no API key)
- `execute()` as AsyncGenerator yielding `AgentEvent`s
- Use dependency injection for `queryFn` so tests don't spawn subprocesses
- Auth health check, quota status tracking

### Then: `feature/t1-core-tools` (Items 5-6)
Core tools + Policy engine

### Full Tier 1 Remaining (Items 4-11)
| Item | Branch | What | Est |
|------|--------|------|-----|
| 4 | `feature/t1-claude-provider` | Claude SDK provider | 3h |
| 5-6 | `feature/t1-core-tools` | Tools + policy engine | 4h |
| 7-8 | `feature/t1-execution-loop` | Agentic loop + JSONL persistence | 2.5h |
| 9 | `feature/t1-cli` | CLI commands | 1.5h |
| 10-11 | `feature/t1-protections` | Critical file + atomic writes | 1h |

---

## Key Files

| File | Purpose |
|------|---------|
| `src/types.ts` | All shared TypeScript types — start here |
| `src/config/defaults.ts` | Default config + validation functions |
| `src/config/loader.ts` | TOML parsing + deep merge |
| `tests/fixtures/mock-provider.ts` | Reusable mock for all provider tests |
| `tests/fixtures/sample-config.toml` | Test config with 2 providers |
| `specs/v5/ZORA_AGENT_SPEC.md` | Canonical spec (1,745 lines) |
| `specs/v5/IMPLEMENTATION_PLAN.md` | WSJF work items |

## Commands
```bash
npm test          # Run all 62 tests
npm run lint      # TypeScript type-check
npm run dev       # Run entry point (placeholder)
```

---

*Build fast. Ship real output. Open source when it works.*
