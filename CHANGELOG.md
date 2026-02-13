# Changelog

All notable changes to this project will be documented in this file.

## [0.6.1] — 2026-02-13

### Added
- Granular model selection — define multiple entries per provider type (claude-opus, claude-sonnet, claude-haiku) with distinct cost tiers and capabilities
- `max_cost_tier` field on routine config and CLI (`--max-cost-tier`) for cost-aware task routing (Router filters providers by cost ceiling)
- Ollama provider (`type = "ollama"`) for local/OSS models (Llama, Mistral, etc.) — `cost_tier = "free"`, no API limits
- `RoutineManager.runRoutine()` method for manual/test-triggered routine execution

### Changed
- RoutineManager now routes tasks through `Orchestrator.submitTask()` instead of calling `ExecutionLoop.run()` directly — routines get full routing, failover, memory context, and session persistence
- `model_preference` and `max_cost_tier` from routine TOML configs now flow through to the Router (previously silently dropped)
- Router `_sortByCost()` uses shared `COST_ORDER` constant; new `_filterByCostCeiling()` method for soft cost constraints

### Fixed
- Example routine TOML files used `[routine.task]` (nests under routine in TOML) instead of separate `[task]` section — validation expected `raw.task` at top level

## [0.6.0] — 2026-02-13

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
- Prompt defense with 10+ injection patterns and output validation
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
- Comprehensive test suite (38 files, 62+ passing tests via Vitest + Playwright)
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
