# ADR-001: Provider Abstraction Layer

**Status:** Accepted
**Date:** 2025-12-01
**Authors:** Zora Core Team

## Context

Zora needs to work with multiple LLM backends (Claude, Gemini, Ollama, and future models). Each backend has different APIs, authentication mechanisms, streaming protocols, and pricing models. The orchestrator should not contain backend-specific logic.

## Decision

Define a single `LLMProvider` interface that all backends must implement. The interface covers five concerns:

1. **Availability** -- `isAvailable()` reports whether the provider is ready.
2. **Authentication** -- `checkAuth()` probes token/session validity.
3. **Quota** -- `getQuotaStatus()` reports rate-limit and quota state.
4. **Execution** -- `execute()` runs a task as an async generator of `AgentEvent` objects.
5. **Cancellation** -- `abort()` stops an in-progress task.

Providers are registered in a factory function (`createProviders`) keyed by the `type` field in `config.toml`. The orchestrator, router, failover controller, and auth monitor all operate on the `LLMProvider` interface without knowing which backend is behind it.

## Consequences

**Positive:**
- Adding a new LLM backend requires implementing one interface and adding one factory case. No orchestrator changes needed.
- The router can compare providers by rank, capabilities, and cost tier without knowing their internals.
- Failover works generically: if provider A fails, try provider B.
- Testing is straightforward: inject a mock `LLMProvider` with a mock `queryFn`.

**Negative:**
- The interface is a lowest-common-denominator contract. Provider-specific features (Claude's extended thinking, Gemini's grounding) must be tunneled through generic fields (`TaskContext.modelPreference`, custom capabilities).
- The `execute()` async generator pattern adds complexity compared to a simple request/response model, but is necessary for streaming and steering.

## Alternatives Considered

1. **Direct SDK integration in the orchestrator.** Rejected because it would create tight coupling and make adding new providers expensive.
2. **Plugin/DLL model.** Rejected as over-engineered for the current number of providers. The factory pattern achieves the same decoupling with less complexity.
3. **HTTP-based provider protocol (like MCP).** Considered but deferred. The in-process interface is faster and simpler. An HTTP adapter can wrap `LLMProvider` later if remote providers are needed.
