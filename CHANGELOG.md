# Changelog

All notable changes to this project will be documented in this file.

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
- Dashboard server on localhost:7070 with Express, steering API, and health endpoint
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
