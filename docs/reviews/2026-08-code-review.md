# Zora Code Review — August 2026

Full-codebase review of `zora-agent` v0.12.0 (144 TS files, ~27.7k LOC), plus a
competitive read of what OpenClaw and NanoClaw have shipped in the last six
months.

**Headline:** the architecture is sound and the breadth is real — policy engine,
capability tokens, intent capsules, hash-chained audit log, channel gates,
memory tiers, TLCI dispatch. But **the two layers that actually stop a tool call
are both inert on the main execution path**, and **every Zora-defined tool is
silently dropped before it reaches the model**. Both are wiring bugs in
`ClaudeProvider`, not design flaws. Everything else in this document is
secondary to fixing those two.

Verification level is noted per finding. Where I state SDK behavior I verified it
against `@anthropic-ai/claude-agent-sdk` 0.2.141 (the version `^0.2.76` resolves
to today), installed and inspected directly.

---

## P0 — Correctness / security

### 1. `permissionMode: 'bypassPermissions'` disables the PolicyEngine gate

`src/providers/claude-provider.ts:178`

```ts
this._permissionMode = options.permissionMode ?? 'bypassPermissions';
```

Both factories construct the provider with no options beyond config
(`src/cli/index.ts:71`, `src/cli/daemon.ts:66`), so **every production task runs
in `bypassPermissions`**. The provider then passes `canUseTool` alongside it
(`claude-provider.ts:283-285`) and relies on it for enforcement.

From the SDK's own type definitions (0.2.141, `sdk.d.ts:1496`):

> `'bypassPermissions'` — Bypass all permission checks (requires
> `allowDangerouslySkipPermissions`)

and from the Agent SDK reference, `canUseTool` is invoked *only when the
permission flow falls through to a prompt* — explicitly **not** under
`bypassPermissions`. Zora also never sets `allowDangerouslySkipPermissions`
(default `false`, `sdk.mjs`), so the mode is at best rejected and at worst
honored.

Consequence: `PolicyEngine.createCanUseTool()`, the SEC-10 capability-token
checks in `_buildTokenAwareCanUseTool()`, and the channel `allowedTools` /
`destructiveOpsAllowed` filter built in `submitTask()` (`orchestrator.ts:1064-1093`)
— including the Signal path — are all bypassed. `policy.toml` becomes advisory.

Note the contrast: `ExecutionLoop` gets this right (`permissionMode: 'default'`
at `orchestrator.ts:534`, `1903`, `2278`), so the heartbeat, extraction, and
compression paths *are* enforced. Only the main task path is not.

**Fix:** default `permissionMode` to `'default'` in `ClaudeProvider`, and pass it
explicitly from both factories. If a bypass mode is ever wanted, make it an
explicit opt-in config field that also sets `allowDangerouslySkipPermissions`.

**Verification owed:** one live task with a `bash rm` attempt under a deny policy,
asserting the deny fires. This is a two-minute test and belongs in
`tests/security/` permanently — it is the single most important regression test
in the repo.

### 2. Tool-hook denials are cosmetic on the main path

`src/orchestrator/orchestrator.ts:1330-1369`

`SensitiveFileGuardHook` is registered first and documented as *"a hard-coded,
non-bypassable layer that cannot be disabled via policy.toml"*
(`orchestrator.ts:689-691`). It isn't. The hook runs when the orchestrator
*observes* a `tool_call` event streamed back from the SDK. On `!hookBefore.allow`
the code synthesizes a `tool_result` event and pushes it into
`taskContext.history` — Zora's own array. Nothing is sent back to the SDK, which
owns tool execution. The real tool still runs; only Zora's local transcript says
it was blocked.

So the layering is: `canUseTool` (bypassed, finding #1) and `ToolHookRunner`
(observational). There is currently no working pre-execution gate on the provider
path.

**Fix:** move the hook chain into an SDK `PreToolUse` hook (the SDK's
`hooks` option, already typed in `ExecutionLoop`'s `SdkHookMatcher`) or fold it
into `canUseTool` once #1 is fixed. `PreToolUse` deny is the right home — per the
SDK docs, `PreToolUse` denies short-circuit ahead of `canUseTool`.

### 3. Every Zora-defined tool is dropped before it reaches the model

`src/providers/claude-provider.ts:288-294`

```ts
sdkOptions['customTools'] = task.customTools.map(t => ({
  name: t.name, description: t.description, input_schema: t.input_schema,
}));
```

`customTools` **does not exist in the SDK's options type** — I grepped
`sdk.d.ts` and `agentSdkTypes.d.ts` for it: zero occurrences. The SDK destructures
its options explicitly, so the key is dropped. Note the `.map()` also strips
`handler`, so even a hypothetical passthrough could not execute anything.

The correct mechanism is `createSdkMcpServer()` + `mcpServers`, which
`ExecutionLoop` already implements correctly (`execution-loop.ts:138-166`,
including the `// The old approach of passing { customTools } to sdkOptions was
silently ignored` comment). The fix landed in `ExecutionLoop` and never got
back-ported to `ClaudeProvider`.

Dead in the main path as a result: `check_permissions`, `request_permissions`,
`memory_search`, `memory_save`, `memory_forget`, `recall_context`,
`list_skills`, `invoke_skill`, `plan_workflow`, `list_subagents`,
`delegate_to_subagent`, `spawn_zora_agent`.

This also explains a behavioral oddity worth checking your logs for: the system
prompt instructs the model to *"use the check_permissions tool"*
(`orchestrator.ts:979-982`) for a tool that doesn't exist in its tool list.

**Fix:** extract the MCP-server construction from `ExecutionLoop` into a shared
`buildZoraMcpServer(customTools)` helper and call it from both. Add an assertion
test that a `TaskContext.customTools` entry appears in the SDK options as
`mcpServers['zora-tools']`.

### 4. Stream timeout throws inside a timer callback

`src/orchestrator/execution-loop.ts:202-206`

```ts
timeoutHandle = setTimeout(() => {
  log.error(...);
  throw new Error(`Stream timeout: ...`);   // uncaught — not a rejection
}, streamTimeout);
```

A `throw` inside a `setTimeout` callback does not reject the awaiting
`for await`; it surfaces as an `uncaughtException` and, with no handler, takes
down the daemon. The `try/finally` around it cannot catch it. So the ERR-05
timeout protection converts a hung stream into a process crash.

**Fix:** wire an `AbortController` into `sdkOptions.abortController` and call
`.abort()` from the timer; the generator then rejects normally and the existing
`catch` handles it. This also gives you real task cancellation, which the daemon
and dashboard currently lack.

---

## P1 — Cost, correctness-adjacent, and staleness

### 5. History is replayed as prompt text instead of resuming the SDK session

`src/providers/claude-provider.ts:593-634`

`_buildPrompt()` serializes the entire `taskContext.history` into an XML blob —
every tool call's arguments and every tool result, `JSON.stringify(..., null, 2)`
— and prepends it to the prompt on failover, retry-queue resume, and follow-up
injection.

Three costs:

- **Tokens.** Pretty-printed tool results are the bulk of an agentic transcript.
  A long session's replay can be an order of magnitude more expensive than the
  original run.
- **Cache.** The replayed blob differs byte-for-byte every turn and sits early in
  the prompt, so nothing downstream of it caches.
- **Fidelity.** A prose transcript is not the same as the model's real message
  history — tool-use/tool-result pairing, thinking blocks, and internal state are
  lost.

The SDK has first-class support for this: `resume` (session ID), `forkSession`,
`resumeSessionAt`, `continue`. `ClaudeProvider` already receives `session_id` on
every SDK message and currently discards it.

**Fix:** persist the SDK `session_id` per `jobId` (alongside the existing
session JSONL), and on resume/retry pass `resume: <sessionId>` with the *new*
instruction only. Keep `_buildPrompt`'s history path as the fallback for
cross-provider failover, where there is genuinely no session to resume. This is
probably the single largest cost win available.

### 6. Default model IDs are two generations stale

- `claude-provider.ts:270` — `this._config.model ?? 'claude-sonnet-4-6'`
- `cli/init-command.ts:106` — generated config writes `model = "claude-sonnet-4-6"`
- `cli/init-command.ts:121` — `gemini-2.5-pro`

Current Anthropic models are `claude-opus-5` / `claude-sonnet-5`
(1M context, 128K output). Sonnet 4.6 still works, but new installs get a
previous-generation default, and every effort/thinking knob in the codebase is
tuned for the old surface.

Related, and worth a pass of its own: nothing in the codebase sets
`output_config.effort`, adaptive thinking, or prompt caching. For a framework
whose selling point is long-running autonomy, `effort` is the main
intelligence/latency/cost dial and it is currently unexposed.

**Fix:** bump defaults to `claude-opus-5` (or `claude-sonnet-5` for the
cost-sensitive default), add `effort` to `ProviderConfig`, and re-baseline
`max_tokens`/timeouts against the new tokenizer.

### 7. Gemini prompts go through argv

`src/providers/gemini-provider.ts:205-211`

```ts
const args = ['chat', '--prompt', prompt];
...
const child = spawn(this._cliPath, args);
```

`prompt` here is the full `_buildPrompt()` output — memory context plus the whole
XML history. Two problems:

- **`E2BIG`.** Linux caps a single argv entry at `MAX_ARG_STRLEN` (128 KiB).
  Any non-trivial session exceeds that and the spawn fails with an error that
  looks like a Gemini outage, which then trips the circuit breaker and failover.
- **Disclosure.** Full prompt text — memory context, file paths, whatever the
  user typed — is visible to any local process via `ps aux` / `/proc/*/cmdline`.
  For a security-first framework this is the kind of thing a competitor's
  security writeup would lead with.

**Fix:** write the prompt to the child's stdin (`stdio: ['pipe', ...]`,
`child.stdin.end(prompt)`).

### 8. `ClaudeProvider` ignores `agent.workspace`

`claude-provider.ts:175` — `this._cwd = options.cwd ?? process.cwd()`, and
neither factory passes `cwd`. So the agent's filesystem tools operate relative to
wherever the daemon happened to be started, not the configured workspace. Both
`ExecutionLoop` call sites resolve `config.agent.workspace` correctly; the
provider path doesn't. Same class of bug as #1 and #3 — the provider was never
brought up to parity with `ExecutionLoop`.

### 9. `checkAuth()` is a stub that always returns valid

`claude-provider.ts:218-236` returns an optimistic `{ valid: true }` and caches
it. `AuthMonitor` polls `checkAll()` every five minutes
(`orchestrator.ts:471-481`) and gets that cached optimism forever. Auth failures
are only ever discovered by a task failing mid-flight — which is exactly the
scenario `AuthMonitor` exists to pre-empt, and the reason
`checkpoint_on_auth_failure` / `preExpiryWarningHours` exist. Either implement a
real probe or delete the monitor; right now it burns a timer to do nothing.

---

## P2 — Efficiency

Ordered by impact. None of these are dangerous; all are cheap to fix.

| # | Where | Issue | Fix |
|---|---|---|---|
| 10 | `orchestrator.ts:1378-1381` | `[...taskContext.history].reverse().find(...)` runs **per `tool_result` event** — copies and scans the entire history each time. O(n²) in events over a long session, and history is unbounded. | Keep a `Map<toolCallId, ToolCallEventContent>` populated on `tool_call`, deleted on `tool_result`. Already have `_toolCallStartTimes` doing exactly this shape. |
| 11 | `session-manager.ts:166-208` | `listSessions()` reads **every session file in full** to count lines and parse the last one. `/api/jobs` and `/api/history` both call it on every dashboard poll. | Maintain a `sessions/index.json` updated on write, or `stat` for mtime + read only the file tail. |
| 12 | `orchestrator.ts:943-951` | `fs.existsSync` + `fs.readFileSync` on SOUL.md **per task**, blocking the event loop. | Read once at boot, cache, invalidate on an `fs.watch` (IntegrityGuardian already watches config). |
| 13 | Whole codebase (76 call sites) | Sync fs (`readFileSync`/`existsSync`/`readdirSync`) including in `dashboard/server.ts` and `core/*`. Fine at boot, not on request paths. | Audit the ~10 that sit inside request/task handlers; leave boot-time ones alone. |
| 14 | `orchestrator.ts` (5 sites) | Background timers (`authCheck`, `retryPoll`, `consolidation`, `integrity`, `memoryExtract`) are never `.unref()`'d. This is why `skipChannels` exists as a workaround for one-shot `ask` mode. | `.unref()` all five; delete the special-casing. |
| 15 | `orchestrator.ts:486-520` | Retry queue polls every 30s unconditionally, even when empty — 2,880 wakeups/day for an idle daemon. | Schedule to the next entry's `readyAt` instead of a fixed tick. NanoClaw's 60s sweep does the same thing but only for *due* rows. |
| 16 | `orchestrator.ts:1020` | `_createCustomTools()` rebuilds ~12 tool definitions (and their closures) on every `submitTask`. | Build once in `boot()`; only the `jobId`-bound `canUseTool` needs to be per-task. |
| 17 | `orchestrator.ts:1445-1447` | Steering poll `await`s inside the event loop on every `text`/`tool_result` event, serializing the stream behind a filesystem check (debounced, but still). | Move to an `fs.watch` on the steering dir, push into a queue the loop drains synchronously. |
| 18 | `claude-provider.ts:363` | `tool.end` events emit `tool: ''` — tool name isn't carried through, so the dashboard timeline shows blanks. | Reuse the `pendingTools` map to carry the name. |

---

## P3 — Refactor

### `orchestrator.ts` is a 2,286-line god object

`boot()` alone is ~490 lines and does security bootstrap, memory bootstrap,
provider wiring, five timer schedules, config-hook compilation, tool-hook
registration, TLCI init, and Signal channel boot. `_executeWithProvider()` is
another ~500 lines of nested event handling with failover recursion threaded
through seven parameters.

It works, and the comments are unusually good. But it is the file every agent
touches, so it is where every merge conflict happens, and its size is why bugs
#1/#3/#8 could sit in `ClaudeProvider` unnoticed — no one reads the seam.

Suggested split, in dependency order (each is mechanical and independently
testable):

```
orchestrator/
  bootstrap/security-bootstrap.ts   # IntegrityGuardian, SecretsManager, LeakDetector,
                                    # AuditLogger, the always-on warnings
  bootstrap/background-scheduler.ts # all 5 self-rescheduling timers, one API,
                                    # unref'd, start/stopAll
  bootstrap/channel-bootstrap.ts    # _bootSignalChannel + _handleChannelMessage
  execution/event-pipeline.ts       # the per-event body of _executeWithProvider as
                                    # an ordered handler chain
  execution/failover-policy.ts      # depth/budget/WeakSet bookkeeping
  tools/zora-tools.ts               # _createCustomTools + the shared MCP builder (#3)
```

Target: `orchestrator.ts` under 400 lines, doing only construction and delegation.

### Smaller ones

- **Two interval parsers.** `_parseIntervalMs` (handles `ms|s|m|h`, default 5s)
  and `_parseIntervalMinutes` (handles `s|m|h`, default 30m) coexist with
  different grammars and silent different defaults. One `parseDuration()` in
  `utils/`, returning ms, with everything else derived.
- **`.replace(/^~/, os.homedir())` appears ~12 times** across orchestrator,
  providers, and CLI, with at least one variant using `process.env['HOME']`
  instead (`orchestrator.ts:774`). One `expandHome()` in `utils/fs.ts`.
- **`CLAUDE.md` is stale.** It describes a "Health Score 8/10" and a gap tracker
  with "10 remaining gaps", against a repo that has since shipped channels,
  steering, teams, TLCI, skills synthesis, and routines. Every agent that opens
  this repo reads that file first and starts from a wrong model of the codebase.
  Rewrite it against v0.12.0 reality.

---

## What OpenClaw and NanoClaw have done since Zora was built

Both are worth tracking for different reasons: OpenClaw is the category-defining
incumbent (347k GitHub stars as of April 2026 — the most-starred project on the
platform), NanoClaw is the architectural counter-argument and the closer
competitor to Zora's positioning.

### OpenClaw

Shipped Nov 2025 as Clawdbot → Moltbot (Jan 2026, trademark dispute) → OpenClaw
(Jan 29, 2026). Architecture settled into seven components: **Channel System,
Gateway, Plug-ins & Skills, Agent Runtime, Memory & Knowledge, LLM Provider,
Local Execution**. Notable since:

- **Local-first Gateway as the single control plane** for sessions, channels,
  tools, and events, with all session history persisted to disk so conversations
  survive restarts. Zora has the same pieces but no single control plane —
  `Orchestrator` is a god object rather than a gateway, and channels are wired
  ad hoc.
- **Layered memory with semantic vector search over SQLite + embeddings.** Zora's
  memory is JSON-file-per-item with MiniSearch BM25 on top. BM25 is a defensible
  choice (no embedding cost, no model dependency), but per-item files mean
  `listItems()` is O(n) file reads, and there's no semantic recall at all.
- **Supply-chain defense on the skill registry.** After the *ClawHavoc* campaign,
  ClawHub added the **ClawScan** code scanner and (June 1, 2026) a skill-screening
  partnership with NVIDIA. Zora has `skill-auditor.ts`/`skill-scanner.ts` and
  `@nodesecure/js-x-ray` already — this is a genuine strength, and it is
  currently undersold in the README.
- **Multi-provider breadth**: GPT-5 family and Codex support (2026.4.10),
  GPT-5.4-pro (2026.4.14).
- **A real security literature exists now** — multiple arXiv papers analyzing
  OpenClaw specifically, including one on background-execution heartbeats
  enabling *silent memory pollution*. That last one is directly relevant: Zora
  runs a heartbeat that can write to memory, and `ReflectorWorker` /
  `consolidateDailyNotes` run unattended. Worth reading against your own
  threat model.

### NanoClaw

Positioned as "a lightweight alternative to OpenClaw that runs in containers for
security", TypeScript, built directly on Anthropic's Claude Agent SDK — i.e.
the same SDK Zora uses, aimed at the same "more secure than OpenClaw" niche.
Its architecture is the most useful thing here because it solves Zora's problems
differently:

- **Container per session, not permission checks in-process.** One Docker
  container per group, only that group's directory mounted, agent runs as an
  unprivileged user. Their explicit critique of OpenClaw is that the gateway runs
  on the host with user-level permissions. **Zora is currently on the OpenClaw
  side of that line** — and findings #1 and #2 mean Zora's in-process checks
  aren't even running. An OS boundary would have contained both bugs.
- **SQLite as the only transport.** Paired `inbound.db` (host writes) /
  `outbound.db` (container writes) per session — *"one writer per file, opposite
  directions"*. No message bus, no RPC, no HTTP between host and agent; a crashed
  container cannot corrupt the host queue. DELETE journal mode rather than WAL,
  for Docker mount compatibility. Compare Zora's JSONL append + in-memory
  `BufferedSessionWriter` with a re-buffer-on-failure path.
- **Polling over long-lived connections**, deliberately: host opens, writes,
  closes per operation.
- **Heartbeat-based liveness, not wall-clock timeouts** — long-running legitimate
  work is never killed on a timer. Zora's `streamTimeout` (30 min default) does
  exactly the thing they designed against, and does it by crashing (#4).
- **Session resumption via the provider's session ID**, persisted to
  `outbound.db`, plus a **`PreCompact` hook that re-injects routing context**
  before context compaction. This is finding #5 solved properly, and the
  `PreCompact` trick is worth stealing outright — Zora's `ContextCompressor`
  currently has no equivalent guarantee that identity/routing survives
  compression.
- **Composed `CLAUDE.md` per spawn**: `instructions.prepend.md` + shared base +
  skill fragments + MCP tool instructions, regenerated on every spawn, with users
  editing only the prepend file and the `memory/` tree. Cleaner than Zora's
  single SOUL.md read (which is also re-read from disk per task, #12).
- **Three session types** — `shared`, `per-thread`, `agent-shared` — resolved at
  routing time. Zora has one session model.
- **60s host sweep** wakes containers only for due `process_after` rows and
  enforces container SLAs. Same idea as Zora's retry poll, but demand-driven
  (#15).
- **Admin surface is a CLI over a Unix socket**, no internal HTTP API. Zora
  exposes an Express dashboard; worth confirming its auth story is airtight given
  it is the one network listener in the system.

### What to take from each

1. **Steal the session-ID resume + `PreCompact` hook from NanoClaw** (#5). Biggest
   cost/quality win available, and it's a known-good pattern on the same SDK.
2. **Steal demand-driven scheduling** (#15) and **heartbeat liveness over
   wall-clock timeouts** (#4) from NanoClaw.
3. **Take the container boundary seriously.** Zora doesn't need to become
   NanoClaw, but "security-first" is a hard claim to defend against a competitor
   whose isolation is an OS boundary while yours is a function call — especially
   with #1 and #2 outstanding. Even an optional `--isolate` mode that runs the
   agent in a container with only the workspace mounted would change the
   conversation. This is the biggest strategic gap.
4. **Keep and promote the skill-supply-chain work.** OpenClaw had to build
   ClawScan *after* an incident; Zora shipped `js-x-ray` scanning, `SkillsLock`,
   and an approval queue before one. That's the strongest differentiation in the
   repo and the README barely mentions it.
5. **Consider embeddings for memory recall** as an opt-in tier alongside BM25 —
   OpenClaw's semantic layer is a visible capability gap, though the
   no-embedding-dependency stance is defensible for a local-first tool.

---

## Suggested order of work

**Week 1 — make the security model real again.**
1. `permissionMode: 'default'` (#1) + a permanent deny-enforcement test.
2. Move tool hooks to SDK `PreToolUse` (#2).
3. Shared MCP tool builder; restore all 12 Zora tools (#3).
4. `AbortController` for stream timeout (#4).
5. Gemini prompt via stdin (#7); provider `cwd` from config (#8).

These are all small, all in two files, and together they change Zora from
"policy exists" to "policy is enforced".

**Week 2 — cost and freshness.**
6. SDK session resume (#5).
7. Model defaults + `effort` exposure (#6).
8. `checkAuth` (#9) — implement or delete.

**Week 3 — efficiency pass.**
9. Findings #10–#18. All mechanical; a day or two total.

**Week 4 — refactor + docs.**
10. Split `orchestrator.ts`; unify `parseDuration`/`expandHome`; rewrite
    `CLAUDE.md` against v0.12.0.

**Then — strategic.**
11. Optional container isolation mode. Scope it as a spike first.

---

## Things that are good and shouldn't change

Worth stating plainly, because the findings above are all negative:

- The comment discipline is genuinely excellent — nearly every non-obvious branch
  explains *why*, with a gap ID. That's what made this review tractable.
- `BufferedSessionWriter`'s close-path race handling, the `_failoverErrors`
  `WeakSet`, the promise-guarded TLCI init, and the `_shuttingDown` reschedule
  guard are all correct handling of things that are easy to get wrong.
- Self-rescheduling `setTimeout` over `setInterval` for async work is the right
  call throughout.
- The security *surface* — intent capsules, capability tokens, hash-chained
  audit, leak detection, injection sanitization with `<untrusted_tool_output>`
  wrapping, Casbin channel policy — is more thorough than either competitor's.
  It just needs to be plugged in.
- 113 test files with unit/integration/e2e/security/benchmark separation, and a
  CI matrix across Linux and macOS.
