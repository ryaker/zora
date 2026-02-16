# Ideas from Philipp Schmid's ia-agents for Zora

> Source: [github.com/philschmid/ia-agents](https://github.com/philschmid/ia-agents)
> Author: Philipp Schmid — AI Developer Experience at Google DeepMind, prev Tech Lead at Hugging Face
> Date: 2026-02-16

## TL;DR

Schmid's `ia-agents` is a minimal (~500 LOC core) TypeScript agent framework for Google's Gemini Interactions API. It ships two packages: `agents-core` (pure agent loop + streaming) and `agent` (batteries-included wrapper with hooks, sessions, skills, subagents). Several patterns map directly onto Zora's open gaps and architectural needs.

**5 high-value ideas identified. 3 map to open gaps. 2 are net-new improvements.**

---

## Idea 1: Lifecycle Hook System (maps to ORCH-05)

### What ia-agents does

ia-agents defines **6 typed lifecycle hooks** with a `HookRunner` that intercepts every stage of the agent loop:

| Hook | When | Can modify |
|------|------|-----------|
| `onAgentStart` | Before first LLM call | tools, system instructions, input |
| `onInteractionStart` | Before each LLM turn | interaction history (context window) |
| `beforeToolExecute` | Pre-tool execution | arguments; can **block** execution (`allow: false`) |
| `afterToolExecute` | Post-tool execution | tool result |
| `onInteractionEnd` | After each LLM turn | observation only |
| `onAgentEnd` | Loop complete | can inject follow-up input (re-trigger loop) |

Registration is simple: `session.on('beforeToolExecute', handler)`. The HookRunner executes handlers in registration order, accumulating modifications. `beforeToolExecute` short-circuits on `allow: false`.

### Why Zora needs this

Zora's `ExecutionLoop` already accepts `hooks?: Partial<Record<string, SdkHookMatcher[]>>` (line 60 of execution-loop.ts) but **nothing wires it**. The SDK supports hooks, but Zora has no mechanism for users or subsystems to register them.

### Concrete implementation for Zora

```typescript
// src/hooks/hook-runner.ts — Zora-native hook system
// Maps ia-agents pattern onto Zora's existing infrastructure

interface ZoraHooks {
  onTaskStart: (ctx: TaskContext) => Promise<TaskContext>;     // Modify task before routing
  beforeToolExecute: (tool: string, args: Record<string, unknown>) => Promise<{ allow: boolean; args?: Record<string, unknown> }>;
  afterToolExecute: (tool: string, result: unknown) => Promise<unknown>;
  onTaskEnd: (ctx: TaskContext, result: string) => Promise<string>;  // Can inject follow-up
}
```

**Key differences from ia-agents**: Zora should wire hooks into both the Orchestrator level (onTaskStart/onTaskEnd wrap `submitTask()`) AND into the SDK via `ZoraExecutionOptions.hooks`. This gives Zora hooks that the SDK doesn't know about — like pre-routing modification and post-completion memory extraction triggers.

**Where to wire**:
- `Orchestrator.submitTask()` (line 315): Call `onTaskStart` before routing
- `Orchestrator._executeWithProvider()` (line 418): Wire `beforeToolExecute`/`afterToolExecute` into SDK hooks
- After line 572 (result return): Call `onTaskEnd`

**Config surface** (config.toml):
```toml
[[hooks]]
event = "beforeToolExecute"
match = "Bash"
script = "~/.zora/hooks/validate-bash.sh"  # Shell-based hooks for non-TS users
```

**Priority**: HIGH — This unblocks user-defined security policies, logging, and observability without code changes.

---

## Idea 2: `transformContext` Callback (maps to context window management)

### What ia-agents does

Before each LLM call, ia-agents invokes a `transformContext` callback that receives the full interaction history and can prune, filter, or rewrite it. The built-in `pruneContext` just does `interactions.slice(-maxTurns)`, but the callback is open for any strategy.

### Why Zora needs this

Zora's `TaskContext.history` grows unboundedly during execution. Long tasks accumulate events that bloat the context window. There's no mechanism to trim history mid-execution. The `memoryContext` loading (line 322-329 of orchestrator.ts) is pre-execution only.

### Concrete implementation for Zora

Add a `transformContext` option to `ZoraExecutionOptions`:

```typescript
interface ZoraExecutionOptions {
  // ... existing fields ...
  transformContext?: (history: AgentEvent[], turn: number) => AgentEvent[];
}
```

**Default implementation**: Keep last N events based on model context window. Drop `thinking` events older than 5 turns. Summarize tool results older than 10 turns.

**Where to wire**: This maps to ia-agents' `onInteractionStart` hook. In Zora, it would be called inside the SDK's hook system — register an `onInteractionStart` SDK hook that calls `transformContext` before each LLM turn.

**Priority**: MEDIUM — Becomes critical for long-running autonomous tasks (routines, multi-step workflows).

---

## Idea 3: Filesystem-Based Artifact Loading with Layered Precedence (enhances skills system)

### What ia-agents does

ia-agents loads skills and subagents from a **3-layer precedence hierarchy**:

1. **Project** (`.agent/skills/`, `.agent/subagents/`) — per-project customization
2. **Global** (`~/.agent/skills/`) — user-wide defaults
3. **Built-in** (package `skills/` directory) — framework defaults

Discovery: scan directories for `SKILL.md` / `*.md` files, parse YAML frontmatter against Zod schemas, deduplicate by name (first-match-wins).

Subagents get their own tool allowlists, isolated context, and cannot spawn nested subagents.

### How Zora compares

Zora's `SkillLoader` (src/skills/skill-loader.ts) scans `~/.claude/skills/` — **single layer only**. No project-level skills, no built-in defaults, no subagent definitions.

### Concrete implementation for Zora

```typescript
// Enhanced skill discovery with 3-layer precedence
const SKILL_LAYERS = [
  path.join(process.cwd(), '.zora', 'skills'),     // Project
  path.join(os.homedir(), '.zora', 'skills'),       // Global (existing)
  path.join(__dirname, '..', 'skills'),             // Built-in
];

// New: Subagent definitions
const SUBAGENT_LAYERS = [
  path.join(process.cwd(), '.zora', 'subagents'),
  path.join(os.homedir(), '.zora', 'subagents'),
];
```

**Subagent isolation** (ia-agents pattern): Each subagent gets:
- Its own `ExecutionLoop` instance
- Declared tool subset (not the full tool set)
- No access to parent conversation history
- Cannot spawn nested subagents

This maps cleanly onto Zora's existing `ExecutionLoop` — spawn a new one per subagent with restricted `allowedTools`.

**Priority**: MEDIUM — Useful for teams/organizations sharing skill libraries, and for Zora's `teams/` module.

---

## Idea 4: Typed Streaming Event Protocol (improves ORCH-08, TYPE-01)

### What ia-agents does

ia-agents defines a **discriminated union** of streaming events with fine-grained lifecycle markers:

```
agent.start → interaction.start → text.start → text.delta* → text.end →
tool.start → tool.delta* → tool.end → interaction.end → agent.end
```

Each event has a typed payload. Consumers get start/delta/end for every operation, enabling:
- Progress bars (tool.start → tool.end timing)
- Streaming text display (text.delta)
- Cost tracking (interaction.end carries usage)
- Verbosity levels (terse/normal/verbose filtering)

### How Zora compares

Zora has 7 event types (`thinking | tool_call | tool_result | text | error | done | steering`) but:
- No start/end pairs for operations
- No delta events for streaming text
- No per-interaction usage tracking
- No verbosity filtering

### Concrete implementation for Zora

Extend `AgentEventType`:

```typescript
type AgentEventType =
  // Existing
  | 'thinking' | 'tool_call' | 'tool_result' | 'text' | 'error' | 'done' | 'steering'
  // New: lifecycle markers
  | 'task.start' | 'task.end'
  | 'turn.start' | 'turn.end'
  | 'text.delta'
  | 'tool.start' | 'tool.end';
```

Add to `DoneEventContent` and new `TurnEndContent`:
```typescript
interface TurnEndContent {
  turn: number;
  usage: { input_tokens: number; output_tokens: number; cost_usd: number };
}
```

**Verbosity filtering** (ia-agents' `printStream` pattern):
```typescript
function filterEvents(events: AsyncIterable<AgentEvent>, level: 'terse' | 'normal' | 'verbose') {
  // terse: only text + done + error
  // normal: + tool_call/tool_result
  // verbose: everything including thinking, deltas, turn markers
}
```

**Priority**: LOW-MEDIUM — Quality improvement that enhances dashboard, CLI, and Telegram output. Maps to TYPE-01 (discriminated unions) and ORCH-08 (streaming optimizations).

---

## Idea 5: Two-Package Modularity (architectural consideration)

### What ia-agents does

Splits into:
- `agents-core` (~500 LOC): Pure `agentLoop()` function. No opinions. Just loop + tools + streaming.
- `agent`: Opinionated wrapper with sessions, hooks, skills, subagents, built-in tools, CLI.

Users can adopt just the core loop or add the full agent wrapper.

### How this applies to Zora

Zora is a monolith (`src/` with everything). This works fine for an end-user product, but limits reuse. The core orchestration loop (Router → Provider → Events) could be extracted.

### Concrete approach

Not a full split, but **extract the core execution pipeline as a standalone module**:

```
src/
  core/           # NEW: Pure execution (no config, no CLI, no dashboard)
    agent-loop.ts   # agentLoop(prompt, options) → AsyncIterable<AgentEvent>
    tool.ts         # Tool definition factory (Zod-based, like ia-agents)
    types.ts        # Core types only
  orchestrator/   # Uses core/ + adds routing, failover, retry, memory, steering
  ...
```

This lets:
- The `teams/` module spawn lightweight agent loops without full Orchestrator overhead
- Tests run the core loop in isolation
- Future: publish `@zora/core` for embedding

**Priority**: LOW — Architectural refactor. Only worth doing after release gate closes.

---

## Summary: Priority-Ordered Action Items

| # | Idea | Maps to | Priority | Effort |
|---|------|---------|----------|--------|
| 1 | Lifecycle hook system | ORCH-05 | **HIGH** | 2-3 days |
| 2 | transformContext callback | Context mgmt | **MEDIUM** | 1 day |
| 3 | Layered artifact loading | Skills enhancement | **MEDIUM** | 1-2 days |
| 4 | Typed streaming events | ORCH-08, TYPE-01 | **LOW-MED** | 2 days |
| 5 | Core extraction | Architecture | **LOW** | 3-5 days |

### Quick Wins (< 1 day each)

- **Zod-based tool factory**: ia-agents uses `z.toJSONSchema()` for tool parameter validation. Zora's `CustomToolDefinition.input_schema` is a raw `Record<string, unknown>`. Adding a `tool()` factory function with Zod validation would catch schema errors at registration time instead of at LLM call time.

- **`maxInjectionLoops` guard**: ia-agents caps re-entry from `onAgentEnd` follow-up injection. Zora's `onTaskEnd` hook (Idea 1) should have the same guard to prevent infinite loops.

- **Subagent nesting prevention**: ia-agents explicitly blocks `delegate_to_subagent` from being available inside subagents. Zora's teams module should enforce the same pattern.

---

## Key Architectural Difference

ia-agents is Gemini-native and wraps the Interactions API directly. Zora wraps the Claude Agent SDK. This means:

- ia-agents **owns** the agent loop (it IS the loop)
- Zora **delegates** to the SDK's loop and intercepts via hooks/callbacks

This makes Idea 1 (hooks) slightly different in Zora: hooks need to work at **two levels** — Zora's orchestration layer (pre/post routing, memory injection) AND the SDK's execution layer (tool interception). ia-agents only has one level because it owns the loop.

This is actually an **advantage** for Zora — users get richer hook points than ia-agents offers, because Zora's orchestration adds routing, failover, and memory that ia-agents doesn't have.
