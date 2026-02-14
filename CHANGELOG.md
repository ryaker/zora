# Changelog

All notable changes to this project will be documented in this file.

## [0.9.0] — 2026-02-14

### Added
- Granular model selection — define multiple entries per provider type (claude-opus, claude-sonnet, claude-haiku) with distinct cost tiers and capabilities
- `max_cost_tier` field on routine config and CLI (`--max-cost-tier`) for cost-aware task routing (Router filters providers by cost ceiling)
- Ollama provider (`type = "ollama"`) for local/OSS models (Llama, Mistral, etc.) — `cost_tier = "free"`, no API limits
- `RoutineManager.runRoutine()` method for manual/test-triggered routine execution
- Policy-aware orchestrator with security-first onboarding
- Provider quota/usage tracking in dashboard
- Docker containerization for integration testing
- Dashboard live data — real system metrics wired to frontend
- Dashboard task submission with SSE live feed
- Dashboard auto-open browser on `zora start`
- Dashboard welcome screen and onboarding for new users
- UX overhaul — zero-to-productive onboarding flow
- Remediation roadmap implementation (wiring components together)
- Production readiness assessment and roadmap

### Changed
- RoutineManager now routes tasks through `Orchestrator.submitTask()` instead of calling `ExecutionLoop.run()` directly — routines get full routing, failover, memory context, and session persistence
- `model_preference` and `max_cost_tier` from routine TOML configs now flow through to the Router (previously silently dropped)
- Router `_sortByCost()` uses shared `COST_ORDER` constant; new `_filterByCostCeiling()` method for soft cost constraints
- Dashboard labels replaced jargon with plain English
- Comprehensive security documentation update for v0.6 hardening (OWASP compliance)

### Fixed
- Example routine TOML files used `[routine.task]` (nests under routine in TOML) instead of separate `[task]` section — validation expected `raw.task` at top level
- PR review feedback: config-aware dashboard port, Windows start fix, non-blocking submitTask, typed log entries, SSE error logging, system metrics caching

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

### Known Limitations
- No main orchestrator wiring components together — individual modules work but are not connected into an integrated system
- CLI `start`/`stop` commands output placeholder text (not functional daemon management)
- Dashboard `/api/jobs` returns empty array (placeholder)
- Router, FailoverController, RetryQueue, and AuthMonitor exist but are never invoked during execution
- GeminiProvider tool parsing uses unverified regex patterns
- ExecutionLoop does not poll SteeringManager during task execution

## [0.5.0] — 2026-02-10

### Added
- Initial project scaffolding with spec-first architecture
- Tier 1 (Foundation) implementation complete
- Tier 2 (Intelligence) implementation substantially complete
- v0.5 specifications and onboarding documentation
- TOML-based configuration system with deep merge and validation
- TypeScript strict mode with comprehensive type definitions
