# Zora — Architectural Decisions

This document records the key architectural choices made during development to ensure consistency and prevent rework.

---

## 2026-02-12 Structured XML Prompt History
**Context:** Injecting history and steering messages into LLM prompts using raw strings (e.g., `Assistant: text`) is vulnerable to prompt injection and provides weak delimiters for the model.
**Decision:** Standardized all history context (text, tool_calls, tool_results, steering) using structured XML-like tags (e.g., `<assistant_response>`, `<tool_call>`, `<human_steering>`).
**Rationale:** Explicit tags reduce "jailbreak" potential from untrusted steering sources and provide cleaner structural guidance for reasoning models like Claude and Gemini.
**Alternatives Considered:** JSON-in-prompt (too token-heavy), raw delimiters (fragile).
**Trade-offs:** Slightly more verbose prompts.
**Status:** Active

---

## 2026-02-12 Express 4 for Dashboard Stability
**Context:** Express 5.x uses `path-to-regexp` v8, which introduces breaking changes in catch-all routing (`*` vs `(.*)`), causing recursion or parameter errors in SPA setups.
**Decision:** Downgraded to Express 4.21.2.
**Rationale:** Express 4 is stable, widely used for local SPAs, and supports the standard `*` catch-all route without complex parameter naming requirements.
**Alternatives Considered:** Persisting with Express 5 (routing was unstable in tests).
**Trade-offs:** Misses newest HTTP features of Express 5, which are not needed for a local dashboard.
**Status:** Active

---

## 2026-02-12 Secure AppleScript Arg Passing
**Context:** Sending macOS notifications via `exec('osascript -e ...')` with string interpolation was vulnerable to command injection if a title/message contained single quotes.
**Decision:** Refactored `NotificationTools` to use the `on run argv` pattern with `execFile`.
**Rationale:** Passing strings as positional arguments to `osascript` completely bypasses the shell parser, making it impossible to inject commands.
**Alternatives Considered:** Manual backslash escaping (highly fragile).
**Trade-offs:** Slightly more verbose AppleScript code.
**Status:** Active

---
