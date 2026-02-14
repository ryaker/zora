## Foundation scaffold: type system, config engine, and test infrastructure

> Tier 1, Items 1–3 of the [WSJF Implementation Plan](specs/v5/IMPLEMENTATION_PLAN.md)
> 35 files changed · 3,630 insertions · 62 tests passing · clean `tsc --noEmit`

---

### Context

Zora is a long-running autonomous AI agent for macOS — multi-provider, capability-routed, memory-enriched. The [v0.5 spec](specs/v5/ZORA_AGENT_SPEC.md) defines an N-provider architecture where users stack-rank LLM providers (Claude, Gemini, OpenAI, local models) and the router matches tasks to the best available provider based on capabilities and cost tiers, with automatic failover down the ranked list.

This PR establishes the foundation that everything else builds on: the TypeScript type system, the TOML-based config engine, and the test infrastructure. Nothing in this PR runs an LLM or executes tasks — it's the skeleton and nervous system that Items 4–11 will wire up.

---

### What's in this PR

#### 1. Project scaffolding

**Toolchain:** Node 20+, ESM (`"type": "module"`), TypeScript 5.7 in strict mode with `noUncheckedIndexedAccess` and `noUnusedLocals`/`noUnusedParameters`, bundler module resolution, vitest for testing, tsx for dev execution.

**Directory structure** matches spec §4.3 — every module has its home:

```
src/
  cli/  config/  dashboard/  memory/  orchestrator/
  providers/  routines/  security/  steering/  teams/
  tools/  wasm/
  types.ts        ← single source of truth for all shared interfaces
  index.ts        ← entry point + re-exports
tests/
  unit/{config, providers, tools, orchestrator, security}/
  integration/
  fixtures/       ← reusable mocks + test configs
```

Empty directories tracked with `.gitkeep` files so the full structure is visible to anyone cloning the repo.

**Single runtime dependency:** `smol-toml` for TOML parsing (zero transitive deps, 15KB). DevDeps are `typescript`, `vitest`, `tsx`, and `@types/node` — nothing else.

#### 2. Core type system (`src/types.ts` — 319 lines)

Every interface, type alias, and enum that the codebase shares lives in one file. This is the contract that providers, the router, the orchestrator, the policy engine, and the CLI all agree on.

Key types and the spec sections they implement:

| Type | Purpose | Spec ref |
|------|---------|----------|
| `LLMProvider` | Provider contract — `execute()` returns `AsyncGenerator<AgentEvent>` for streaming | §4.2 |
| `AuthStatus` / `QuotaStatus` | Provider health signals that drive failover decisions | §4.2 |
| `AgentEvent` | Unified event stream (`thinking`, `tool_call`, `tool_result`, `text`, `error`, `done`) | §4.2 |
| `TaskContext` | Everything the router and provider need to execute a task — capabilities, complexity, resource type, history, memory | §5.1 |
| `HandoffBundle` | Structured context package for provider failover — task, progress, artifacts, tool history | §5.3 |
| `ZoraConfig` | Full config shape matching `config.toml` — agent, providers[], routing, failover, memory, security, steering, notifications | §7 |
| `ZoraPolicy` | Security policy shape — filesystem paths, shell allowlist/denylist, action classifications, network rules | §6 |
| `WorkerCapabilityToken` | Scoped permission subset for per-job sandboxing | §6.3 |
| `ProviderCapability` | Extensible capability tags (`reasoning`, `coding`, `creative`, `search`, etc.) + custom strings | §5.1 |
| `CostTier` / `RoutingMode` / `TaskComplexity` | Routing decision axes | §5.1 |

Design choices:

- **`ProviderCapability` is a union with `(string & {})`** — you get autocomplete for the built-in tags but users can add arbitrary capability strings for custom providers without touching the type definition.
- **`LLMProvider.execute()` returns `AsyncGenerator<AgentEvent>`** rather than a callback or observable — this gives the orchestrator natural `for await...of` consumption with backpressure, and makes testing trivial (just `yield` events in sequence).
- **All config sub-types are separate interfaces** (`AgentConfig`, `RoutingConfig`, `FailoverConfig`, etc.) — this keeps validation functions focused and lets future code import just the slice it needs.

#### 3. Config engine (`src/config/`)

Three files, clear responsibilities:

**`defaults.ts`** — Every default value from spec §7, exported as typed constants (`DEFAULT_AGENT`, `DEFAULT_ROUTING`, `DEFAULT_FAILOVER`, etc.) plus `DEFAULT_CONFIG` as the assembled whole. Also exports two validation functions:

- `validateProviderConfig(p, index)` — checks required fields (name, type, rank ≥ 1, non-empty capabilities, valid cost tier) with indexed error messages
- `validateConfig(config)` — validates agent settings (parallel jobs, CPU/memory limits), routing mode enum + provider_only constraint, provider name/rank uniqueness among enabled providers, failover bounds, steering port range

Both return `string[]` of error messages — empty array means valid. Errors are descriptive and reference the config path (e.g., `"providers[2].rank is required and must be a positive integer"`).

**`loader.ts`** — TOML parsing and merge logic:

- `deepMerge(target, source)` — recursive object merge where arrays are replaced (not concatenated) and source wins on conflicts
- `parseConfig(raw)` — merges parsed TOML with defaults, handles TOML's `[[providers]]` array-of-tables syntax with per-provider defaults
- `loadConfig(path)` — async file read → parse → validate → return or throw
- `loadConfigFromString(toml)` — same pipeline but from a string (used in tests)
- `ConfigError` — error class with `.errors: string[]` for aggregated validation failures

**`index.ts`** — barrel re-exports.

#### 4. Test infrastructure

**Mock provider** (`tests/fixtures/mock-provider.ts`) — A full `LLMProvider` implementation with:

- Configurable initial states (auth valid/invalid, quota healthy/exhausted, available/unavailable)
- Assertion tracking (`.executeCalls`, `.abortCalls`, `.authCheckCount`, `.quotaCheckCount`)
- `failAfterEvents` option for testing mid-execution failures
- `reset()` to clear state between tests
- Custom capability and cost tier injection

This mock will be reused by every test that touches the router, orchestrator, failover controller, or execution loop. It's designed so tests never need to spawn real subprocesses.

**Test config fixtures** — `sample-config.toml` (2-provider setup with Claude rank 1 + Gemini rank 2) and `sample-policy.toml` (filesystem + shell + actions + network rules).

**62 tests across 3 suites:**

| Suite | Tests | What it covers |
|-------|-------|----------------|
| `defaults.test.ts` | 27 | Every default value matches spec, `validateProviderConfig` for all required fields and edge cases, `validateConfig` for routing modes, duplicate names/ranks, resource limits, failover bounds |
| `loader.test.ts` | 12 | File loading, string loading, deep merge preserving nested defaults, ConfigError aggregation, malformed TOML, missing file, providers array parsing |
| `mock-provider.test.ts` | 23 | Interface compliance (readonly props, all methods present), execution flow (thinking→text→done event sequence), auth/quota state changes, abort tracking, failure injection, reset |

#### 5. Documentation (from GPT 5.2 session)

- `specs/v5/docs/POLICY_PRESETS.md` — Safe/Balanced/Power preset definitions for onboarding
- `specs/v5/docs/WEB_ONBOARDING_SPEC.md` — Local web wizard spec (localhost config UI)
- Updated `specs/v5/docs/ONBOARDING_INSTALL.md` — Presets, scope, dry-run sections

---

### What's explicitly NOT in this PR

This is a foundation PR. These are all in scope for subsequent branches:

- **No LLM providers** — `ClaudeProvider`, `GeminiProvider` come in `feature/t1-claude-provider` (Item 4)
- **No tool implementations** — `read_file`, `shell_exec`, etc. come in `feature/t1-core-tools` (Items 5–6)
- **No execution loop** — The agentic think-act-observe cycle comes in `feature/t1-execution-loop` (Items 7–8)
- **No CLI commands** — `zora-agent start`, `zora-agent ask`, etc. come in `feature/t1-cli` (Item 9)
- **No security enforcement** — Policy engine, critical file protection, atomic writes come in `feature/t1-protections` (Items 10–11)

---

### Design decisions worth noting

1. **Single `types.ts` file** — Not split per module. At 319 lines it's manageable, and having one import path (`../types.js`) prevents circular dependency headaches as the codebase grows. Can be split later if it exceeds ~500 lines.

2. **`smol-toml` over `@iarna/toml`** — Zero dependencies, smaller bundle, actively maintained, full TOML 1.0 spec compliance. The config file is the only user-facing file format in the system so the parser choice matters.

3. **Validation returns error arrays, not throws** — `validateConfig()` and `validateProviderConfig()` collect all errors in a single pass. `ConfigError` wraps them with a human-readable count message. This means users see _all_ their config problems at once instead of fixing one, re-running, hitting the next one.

4. **Deep merge replaces arrays** — When your TOML overrides `capabilities = ["coding"]`, you get exactly `["coding"]`, not `["reasoning", "coding", "creative", "coding"]`. Array merge semantics cause subtle bugs in config systems.

5. **Provider defaults applied per-provider** — Each `[[providers]]` entry gets `enabled: true`, `cost_tier: "metered"`, `rank: 0` as defaults before user values are applied. This means a minimal provider block only needs `name`, `type`, `rank`, and `capabilities`.

6. **AsyncGenerator for execution** — The `LLMProvider.execute()` signature uses `AsyncGenerator<AgentEvent>` rather than callbacks or event emitters. This makes the orchestrator loop a simple `for await (const event of provider.execute(task))` and testing is just `yield` statements in the mock.

---

### How to verify

```bash
npm install        # install deps (smol-toml + devDeps)
npm test           # 62 tests, all passing
npm run lint       # tsc --noEmit — clean compile, zero warnings
```

---

### What's next

**Item 4: Claude Provider** (`feature/t1-claude-provider`) — Implement `ClaudeProvider` against the `LLMProvider` interface using the `@anthropic-ai/claude-agent-sdk`. Mac session token auth, `execute()` as AsyncGenerator, dependency-injected `queryFn` for testability.

Full remaining Tier 1 roadmap: Items 4–11, estimated ~12 hours to a working single-provider agent that can `zora-agent ask "write me a blog post"` and produce output.
