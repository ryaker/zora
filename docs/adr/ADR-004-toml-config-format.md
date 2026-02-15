# ADR-004: TOML Configuration Format

**Status:** Accepted
**Date:** 2025-12-01
**Authors:** Zora Core Team

## Context

Zora needs a configuration format for two files:
- `config.toml` -- Agent behavior, providers, routing, memory, security, steering, and notifications.
- `policy.toml` -- Security policy: filesystem, shell, network, budget, and dry-run rules.

The format must be human-readable, human-editable, and support nested structures and arrays of tables (for the `[[providers]]` array).

## Decision

Use TOML (Tom's Obvious Minimal Language) for both configuration files. Parse with the `smol-toml` library (zero native dependencies, pure JavaScript).

Key reasons for TOML:
1. **Readable by non-programmers.** Config is written by end users who may not be developers.
2. **Native array-of-tables syntax.** `[[providers]]` maps cleanly to the multi-provider config without JSON array nesting.
3. **Comments.** Users can annotate their config. JSON does not support comments.
4. **Type safety.** TOML distinguishes strings, integers, booleans, and arrays at the syntax level. Less ambiguity than YAML.
5. **Ecosystem alignment.** Rust and Go ecosystems (Cargo.toml, Hugo) have validated TOML for configuration at scale.

## Consequences

**Positive:**
- Clean, minimal syntax for the provider array pattern.
- Comments enable self-documenting config files.
- `zora init` can generate annotated config with inline documentation.
- `smol-toml` has no native dependencies, so it works without compilation.

**Negative:**
- Less familiar to developers who primarily use JSON or YAML.
- Deeply nested config structures can become verbose (mitigated by keeping nesting shallow -- max 2 levels).
- No schema validation built into TOML. Validation is done in TypeScript at load time by mapping to typed interfaces (`ZoraConfig`, `ZoraPolicy`).

## Alternatives Considered

1. **JSON.** Rejected: no comments, verbose syntax for the provider array, not user-friendly for editing.
2. **YAML.** Rejected: whitespace-sensitivity causes subtle bugs, security concerns with YAML parsers (arbitrary code execution in some implementations), ambiguous type coercion (`yes`/`no` as booleans).
3. **INI.** Rejected: no standard for arrays or nested structures. Cannot represent the provider config cleanly.
4. **Custom DSL.** Rejected: high implementation cost, no ecosystem tooling, learning curve for users.
