# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Security — read this before upgrading

**Your `policy.toml` was not being enforced on the path that runs your tasks.**

`ClaudeProvider` defaulted `permissionMode` to the SDK's permission-bypass
mode, and neither factory passed anything else. The SDK does not call
`canUseTool` in that mode. Everything downstream of that callback was therefore
inert on the main task path: the PolicyEngine's path and shell allow/deny
lists, the SEC-10 capability-token checks, and the channel capability allowlist
and `destructiveOpsAllowed` gate — Signal included. Filesystem and shell
restrictions you had configured did not stop anything. `policy.toml` was
advisory.

This was not total. `ExecutionLoop` already used `'default'`, so the heartbeat,
memory-extraction and context-compression paths *were* enforced. Only the path
that runs user-submitted tasks was not — which is to say, the path that
matters.

**Separately, the tool hooks were cosmetic.** The whole `ToolHookRunner` chain —
`SensitiveFileGuard`, `ShellSafety`, `AuditLog`, `RateLimit`, `SecretRedact`,
`IrreversibilityScorer` — ran when the orchestrator *observed* a `tool_call`
event streamed back from the SDK. The SDK owns tool execution, so by then the
tool had already run. On a denial the code synthesised a `tool_result` into
Zora's own history and told nobody: the real command executed and only Zora's
transcript claimed otherwise. `SensitiveFileGuardHook`'s "hard-coded,
non-bypassable layer" comment was aspirational. So was `SecretRedactHook` — its
redaction applied only to what Zora wrote to its own log, while the SDK ran the
original, unredacted arguments.

**If you ran a prior version**, assume that any tool call the model chose to
make was executed, regardless of what your policy said, and audit accordingly.
The audit log is the record of what actually ran.

#### Fixed

- **`permissionMode` is `'default'` everywhere (SEC-20).** Passed explicitly
  from both factories. The bypass mode is removed from the type union rather
  than made configurable — `grep -rn bypassPermissions src/` returns nothing,
  and a test asserts it stays that way.
- **Hook denials are real denials (SEC-21).** `src/hooks/sdk-hook-bridge.ts`
  adapts the same `ToolHookRunner` onto the SDK's `PreToolUse` hook, which is
  the actual pre-execution seam: a deny short-circuits ahead of `canUseTool` and
  the tool is never invoked. Two behaviour changes fall out of this:
  - The chain **fails closed**. A hook that throws now denies. Previously the
    exception was caught, logged as non-critical, and the tool ran.
  - `SecretRedactHook`'s argument rewrite reaches execution via `updatedInput`,
    so redacted arguments are what actually run.
- **All twelve Zora tools were missing from the main task path (SDK-01).**
  `ClaudeProvider` set `sdkOptions['customTools']`, which is not an option the
  SDK has — it destructures its options explicitly, so the key was dropped
  silently while the system prompt kept instructing the model to call those
  tools. Both `ExecutionLoop` and `ClaudeProvider` now build their MCP server
  through one shared `buildZoraMcpServer()`. Tool input schemas are JSON Schema
  in Zora and are converted to Zod before reaching `createSdkMcpServer()`;
  without that conversion 0.3.x throws and 0.2.x silently advertised every tool
  with an empty parameter list.
- **Gemini prompts go on stdin, not argv (SEC-22).**
- **Providers run in the configured workspace (PROV-10)**, not the daemon's
  working directory.
- **Stream timeouts abort the stream** instead of throwing from inside a timer
  (ERR-20).

`tests/security/tool-enforcement.test.ts` is the permanent regression guard for
all of the above.

### Changed

- **Claude Agent SDK upgraded from 0.2.76 to 0.3.232 (SDK-02).** The
  `package.json` caret range was pinned to the 0.2 line, so the dependency would
  never have picked up 0.3 on its own.
- **`sparrowdb` upgraded from 0.1.24 to 0.1.26 (MEM-35).** The graph tier now
  refuses to open a database another process already holds, because on 0.1.26
  and earlier nothing else does: SparrowDB takes no lock, and two processes
  writing one database root corrupt its catalog *permanently* — upstream
  measured 4 of 5 concurrent runs left the database unopenable
  ([SparrowDB #524](https://github.com/ryaker/SparrowDB/issues/524)). Zora sits
  squarely in the shape upstream warns about: the daemon holds the graph for its
  lifetime while every other `zora-agent` command opens its own. A lock file in
  the database root (`.zora-graph.lock`) now turns the second process away with
  a warning naming the holder, reclaimed automatically once that process is
  gone, and SparrowDB's own `database locked` error — which lands in a version
  after 0.1.26 and also catches non-Zora writers — routes to the same inert
  path. The outcome is unchanged from every other graph failure: one warning, no
  `graph_recall`, lexical memory intact.

  Two adapter comments were wrong by the time 0.1.26 shipped, so
  `tests/unit/memory/graph/dialect-contract.test.ts` now asserts all twelve
  documented engine quirks directly against the installed engine — a version
  bump is a test run rather than a re-reading. `ORDER BY` is correct as of
  0.1.26 (it was not before), and a replayed property-carrying edge `CREATE` now
  overwrites in place rather than duplicating; the adapter's existing guards
  were right either way, but for a different reason than the comments claimed.

  `sparrow-loader` also drops `darwin-x64` from its supported-platform list.
  0.1.26 stopped declaring `optionalDependencies` on platform sub-packages that
  were never published and bundles the two real binaries instead: an Intel Mac
  previously passed the platform gate and then failed at `require`. Supported
  platforms are linux-x64 (glibc) and darwin-arm64.
- **Default model is `claude-opus-5` (SDK-04).** The provider fallback and the
  config `zora-agent init` generates are now the same exported constant, so
  which model you got no longer depends on whether `model` was written into
  `config.toml`.
- **`effort` is exposed per provider** (`low` | `medium` | `high` | `xhigh` |
  `max`), forwarded only when configured. Previously nothing in the codebase set
  it, so a heartbeat and a refactor ran at identical depth.

### Added

- **Graph memory tier (MEM-30) — experimental, off by default.** An optional
  graph over SparrowDB answering relational questions that lexical search
  cannot, exposed to the model as a `graph_recall` tool alongside the BM25
  `memory_search`. Enable with `ZORA_GRAPH_MEMORY=1`; `ZORA_GRAPH_MEMORY_PATH`
  overrides the database location. `sparrowdb` is an optional dependency loaded
  lazily. A missing module, unsupported platform, unopenable database, failed
  worker spawn or startup timeout each produce an inert client and one warning
  rather than a throw, and `graph_recall` is simply not registered. Runs on a
  worker thread — the measured main-thread block is 0.007 ms/call versus
  3.853 ms/call in-process.
- **`graph_recall` reaches the model (MEM-34).** The tier above was built,
  tested and documented, but `createGraphTools` was called from nowhere in
  `src/` — the graph was reachable only from its own test suite, and the claim
  above that it was "exposed to the model" was false. Wired into
  `Orchestrator._buildCustomTools()`, with the client started before the tool
  list is cached and closed on shutdown. `tests/unit/tools/tool-registration.test.ts`
  is the guard: every tool factory must be invoked in `_buildCustomTools()` and
  its result must reach the returned array, because a tool that is never
  registered is indistinguishable from a tool that is never chosen.
- **Documentation drift guard (DOC-12).** `tests/unit/docs/` fails the build
  when the docs and the code disagree on model IDs, config keys, SDK versions,
  the hook pipeline, or CLI commands.

### Performance

- Session listing uses a maintained index instead of reading every file
  (PERF-02); bounded item cache for `StructuredMemory.listItems()`; per-request
  disk I/O and static bodies hoisted out of dashboard hot paths.
- `O(1)` `tool_result` → `tool_call` lookup (PERF-01); `SOUL.md` cached and
  watched rather than read per task (PERF-03); five background timers unref'd
  so they no longer hold the event loop open (PERF-04); retry polling is
  demand-driven (PERF-05); custom tool definitions built once at boot (PERF-06).

### Documentation

- **`SECURITY.md` re-verified claim by claim (DOC-11).** Every claim is now
  cited to a file, cited to a test, or removed. Removed: a `decodeAndCheck()`
  encoding defense that does not exist anywhere in the repository, eleven audit
  event types that appear nowhere in the codebase, and a subagent restriction
  level documented as requiring approval when the code logs and allows. Three
  mechanisms that read as always-on — ApprovalQueue, MemoryRiskForecaster,
  AgentCooldown — are opt-in and inactive on a default install, and are now
  marked as such.
- **Docs said `zora` where the binary is `zora-agent`** — 39 occurrences across
  `README.md`, `SECURITY.md` and `docs/`. Every one of them was "command not
  found" on a clean install.
- `CLAUDE.md` rewritten against v0.12.0 reality (DOC-10). `docs/reviews/` and
  `docs/research/` marked as dated records that are not updated.

## [0.9.1] — 2026-03-12

### Documentation

- Added **Runtime Safety Layer** section (section 6) to the README security architecture overview, covering irreversibility scoring, human-in-the-loop approval, session risk forecasting, agent reputation cooldown, per-project security scope, and startup security audit
- New reference doc: `docs/advanced/security-runtime.md` — full configuration reference for the runtime safety layer, including the Prevent → Pause → Prove model, all TOML keys with descriptions, scoring table, Telegram approval setup, forecaster thresholds, agent cooldown levels, and troubleshooting guide
- Updated Documentation table in README to cross-reference the new runtime safety doc

## [0.9.0] — 2026-02-14

First release candidate. All 12 release gate criteria verified against source code. Zora boots, runs tasks, fails over between providers, persists sessions, and shuts down cleanly.

### Orchestration (all release-gate gaps closed)
- Central `Orchestrator.boot()` initializes all subsystems in dependency order
- `submitTask()` flows through: classify, route, execute, persist events, inject memory, handle failover
- Automatic provider failover with depth-limited recursion (max 3 levels)
- Persistent retry queue polled every 30s with configurable backoff
- AuthMonitor scheduled checks every 5 minutes with pre-expiry warnings
- HeartbeatSystem and RoutineManager started at boot
- SteeringManager polled during execution for mid-task course corrections
- SessionManager persists all events to JSONL per job

### Error Handling (release-gate hardening)
- AuditLogger propagates write failures instead of silently swallowing
- GeminiProvider logs JSON parse failures with full context (first 200 chars + stack)
- ExecutionLoop stream timeout protection (30-minute default, configurable)

### CLI (fully functional daemon lifecycle)
- `zora-agent start` — Spawns daemon via fork(), writes pidfile (mode 0600), auto-opens dashboard
- `zora-agent stop` — SIGTERM with 5s grace period, SIGKILL fallback, pidfile cleanup
- `zora-agent status` — Pidfile + kill(pid, 0) liveness check, stale pidfile detection
- `zora-agent doctor` — Detects Node.js version, Claude CLI, Gemini CLI

### Added
- Granular model selection per provider type (claude-opus, claude-sonnet, claude-haiku)
- `--max-cost-tier` CLI flag and routine config for cost-aware routing
- Ollama provider for local models (Llama, Mistral) at zero cost
- `RoutineManager.runRoutine()` for manual/test-triggered routines
- Provider quota/usage tracking in dashboard
- Docker multi-stage build with health checks
- Dashboard SSE live feed, task submission, onboarding screen
- 552 tests passing (49 unit, 3 integration, 1 benchmark), 0 type errors

### Changed
- RoutineManager routes through `Orchestrator.submitTask()` (gets routing, failover, memory, persistence)
- Router cost filtering uses shared `COST_ORDER` constant

### Fixed
- OllamaProvider now implements `getUsage()` (was missing from LLMProvider interface)
- Test expectations aligned to actual config default (`zora-agent` not `zora`)
- Routine TOML validation fixed for `[task]` section parsing

## [0.6.0] — 2026-02-13

### Security Hardening (OWASP LLM Top 10 / Agentic Top 10)

This release addresses critical security gaps identified in a comprehensive audit against OWASP LLM Top 10 (2025) and OWASP Agentic Top 10 (ASI-2026).

**Action Budgets (LLM06/LLM10 — Excessive Agency / Unbounded Consumption)**
- Per-session action limits (`max_actions_per_session`) prevent unbounded autonomous loops
- Per-type limits (`max_actions_per_type`) cap shell commands, file writes, and destructive operations independently
- Token budget enforcement caps total LLM token consumption per session
- Configurable `on_exceed` behavior: `"block"` (hard stop) or `"flag"` (prompt for approval)
- Budget tracking integrated into PolicyEngine with `recordAction()` and `recordTokenUsage()`
- All four presets (locked/safe/balanced/power) include budget defaults

**Dry-Run Preview Mode (ASI-02 — Tool Misuse)**
- `[dry_run]` policy section enables preview-without-execute for write operations
- Write tools (Write, Edit, destructive Bash) intercepted; read-only tools pass through
- Smart command classification: `ls`, `cat`, `git status`, `git diff`, `pwd`, `echo` recognized as read-only
- Dry-run interceptions logged to audit trail when `audit_dry_runs = true`
- Configurable per-tool targeting via `tools` array (empty = all write tools)

**Intent Capsules / Mandate Signing (ASI-01 — Agent Goal Hijack)**
- New `IntentCapsuleManager` creates HMAC-SHA256 signed mandate bundles per task
- SHA-256 mandate hashing with keyword extraction and category tagging
- Per-action drift detection: category match, keyword overlap (>10% threshold), capsule expiry
- Goal drift flagged for human review (not blocked outright to avoid false positives)
- Per-session signing keys via `crypto.randomBytes(32)`
- Timing-safe signature verification via `crypto.timingSafeEqual`

**RAG/Tool-Output Injection Defense (LLM01 — Prompt Injection)**
- 10 new RAG-specific injection patterns added to PromptDefense
- Detects: `[IMPORTANT INSTRUCTION]`, `NOTE TO AI`, `HIDDEN INSTRUCTION`, embedded `<system>`/`<instruction>`/`<override>`/`<admin>` tags, delimiter attacks, role impersonation
- New `sanitizeToolOutput()` function wraps suspicious tool outputs in `<untrusted_tool_output>` tags
- Existing `sanitizeInput()` updated to include RAG patterns in scan

**Infrastructure: Centralized Policy Loader**
- Extracted duplicated TOML→ZoraPolicy parsing from `cli/index.ts` and `cli/daemon.ts` into `src/config/policy-loader.ts`
- Single source of truth for all policy field defaults and backward compatibility
- New optional `[budget]` and `[dry_run]` sections with safe defaults for missing fields

### Added
- Claude Agent SDK integration — ExecutionLoop wraps SDK `query()` with full message streaming
- Claude provider with lazy SDK import, dependency injection, abort support, and cost tracking
- Gemini CLI provider with subprocess management and stdout streaming
- N-provider router with capability matching, cost-tier awareness, and ranking modes
- Failover controller with HandoffBundle creation for mid-task provider transitions
- Retry queue with quadratic backoff and disk persistence
- Auth health monitor for provider credential tracking
- Session manager with JSONL persistence and corruption tolerance
- Policy engine with symlink detection, path canonicalization, and SDK tool interception
- Audit logger with SHA-256 hash-chained append-only JSONL and chain verification
- Secrets manager with AES-256-GCM encryption, PBKDF2 key derivation, and atomic writes
- Integrity guardian with SHA-256 baselines and file quarantine
- Leak detector with 9 pattern categories (API keys, JWTs, private keys, AWS credentials)
- Prompt defense with 20+ injection patterns (direct + RAG) and tool output sanitization
- Capability tokens with expiration enforcement and path/command validation
- 3-tier hierarchical memory system (MEMORY.md, daily notes, structured items)
- Salience scorer with exponential decay and Jaccard similarity
- Structured memory with CRUD operations and atomic writes
- Extraction pipeline with schema validation, retry logic, and deduplication
- Category organizer with auto-categorization and relevance scoring
- Team manager with filesystem-based coordination and config persistence
- Mailbox with atomic write-then-rename message queue
- Gemini bridge with subprocess orchestration and inbox polling
- Bridge watchdog with heartbeat monitoring and exponential backoff restart
- Agent loader with YAML frontmatter parsing for SDK agent definitions
- Steering manager with job-specific message persistence and archiving
- Flag manager with timeout auto-resolve and state transitions
- Telegram gateway with long polling, user allowlist, and steering commands
- Routine manager with TOML-defined tasks and node-cron scheduling
- Heartbeat system with markdown task parsing and completion marking
- Event trigger manager with fs.stat polling and glob pattern matching
- Dashboard server on localhost:8070 with Express, steering API, and health endpoint
- Auth middleware with timing-safe Bearer token comparison
- Skill loader for dynamic ~/.claude/skills/ discovery
- CLI with `ask`, `status`, `start`, `stop` commands plus memory, audit, edit, team, steer, and skill subcommands
- MCP server configuration support in config loader
- Comprehensive test suite (48 files, 500+ passing tests via Vitest + Playwright)
- CI/CD with Claude Code review workflow

### Known Limitations (0.6.0, resolved in 0.9.0)
- ~~No main orchestrator wiring~~ — **Fixed in 0.9.0**: Orchestrator.boot() wires all components
- ~~CLI start/stop are placeholder~~ — **Fixed in 0.9.0**: Full daemon lifecycle with pidfile management
- ~~Dashboard /api/jobs returns empty~~ — **Fixed in 0.9.0**: Returns real session data
- ~~Router/FailoverController/RetryQueue/AuthMonitor never invoked~~ — **Fixed in 0.9.0**: All invoked via Orchestrator
- GeminiProvider tool parsing uses regex (still true, works but not formally verified)
- ~~ExecutionLoop does not poll SteeringManager~~ — **Fixed in 0.9.0**: Polled during execution

## [0.5.0] — 2026-02-10

### Added
- Initial project scaffolding with spec-first architecture
- Tier 1 (Foundation) implementation complete
- Tier 2 (Intelligence) implementation substantially complete
- v0.5 specifications and onboarding documentation
- TOML-based configuration system with deep merge and validation
- TypeScript strict mode with comprehensive type definitions
