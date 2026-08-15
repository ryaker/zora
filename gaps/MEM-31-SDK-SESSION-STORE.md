# MEM-31 — findings against SDK 0.3.232

**Status: open, and not implementable as scored.** Researched 2026-08-15 against
the pinned `@anthropic-ai/claude-agent-sdk@0.3.232` type definitions in
`node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts`, which are the
authoritative description of the version this repo actually runs.

The gap reads "Adopt SDK `sessionStore`; retire parallel JSONL transcript", on
the rationale (remediation plan, line 55) that Zora's `SessionManager` JSONL and
`BufferedSessionWriter` "can become an SDK-native store — one source of truth
instead of two parallel transcripts".

`sessionStore` cannot do that. It is a **mirror, not a replacement**.

## What the SDK contract actually says

From `Options.sessionStore` (sdk.d.ts:1613–1624):

> Mirror session transcripts to an external store. When set, the subprocess
> **still writes to CLAUDE_CONFIG_DIR** (set it to /tmp for ephemeral local copy)
> **AND** emits entries to this adapter via dual-write.
>
> **Cannot be used with `persistSession: false`** — local writes are required for
> the mirror to function (the mirror hook fires after local write success).

And `SessionStore.append` (sdk.d.ts:5097): "Called AFTER the subprocess's local
write succeeds — durability is already guaranteed locally."

So adopting it **adds** a copy rather than retiring one. It is also `@alpha`.

## Why the mirrored entries cannot replace Zora's transcript

`SessionStoreEntry` (sdk.d.ts:5158–5173) is explicit that the entry shape is
"the on-disk transcript format … CLI-internal and **not part of the SDK API
surface**", exposed only as `{ type: string; uuid?: string; [k: string]: unknown }`,
and that "adapters should treat entries as pass-through blobs".

Zora's `sessions/{jobId}.jsonl` holds `AgentEvent` — Zora's own provider-agnostic
vocabulary (`text`, `tool_call`, `tool_result`, `steering`, `done`, …). It is
read, not just written:

- `dashboard/server.ts` — `/api/jobs` and `/api/history` via `listSessions()`
- `steering/telegram-gateway.ts:211` — `listSessions()`
- `cli/index.ts:164`
- `SessionManager`'s own `sessions-index.json` derives event count, last
  activity and status from event *types* (PERF-02)

Opaque pass-through blobs cannot serve any of those.

## The independent blocker: non-Claude providers

`Orchestrator._executeWithProvider` persists every `AgentEvent` to
`SessionManager` regardless of which provider ran the task, and Zora ships
`claude-provider`, `gemini-provider`, `ollama-provider` and `echo-provider`. An
SDK-native session store exists only for the Claude SDK path, so making the
transcript SDK-native would drop session history — and with it the dashboard
history and `/api/jobs` — for every non-Claude provider. This blocker holds
regardless of what the SDK's store API looked like.

## The current state, stated precisely

There *are* two parallel transcripts today, so the gap's diagnosis is right even
though its prescription is not:

1. The SDK's own JSONL under `CLAUDE_CONFIG_DIR`. Zora never sets
   `persistSession`, which defaults to `true`, so this is written on every
   Claude task — and **Zora never reads it**. Nothing in `src/` calls
   `getSessionMessages` or the SDK's `listSessions`.
2. Zora's `sessions/{jobId}.jsonl` of `AgentEvent`s, written and read as above.

## Recommendation for the owner — a scope decision, not an implementation

The gap's own prescription works against its goal: `sessionStore` is
mutually exclusive with the one option that would actually retire a transcript.

- **If the goal is "retire a parallel transcript"**, the lever is
  `persistSession: false`, which stops writing transcript 1 — the one nothing
  reads. That is the opposite of adopting `sessionStore`, and the two cannot be
  combined. It costs the ability to resume a session from disk, which is exactly
  what **SDK-03** wants to start using, so the two gaps are in direct conflict
  and must be decided together.
- **If the goal is "Zora owns the SDK transcript"** (e.g. to put it somewhere
  durable), `sessionStore` is the right API, but it is an addition, the entries
  stay opaque, and it is `@alpha`. That is a different gap from the one scored,
  and it should be re-scored: the job size is larger and the "retire a
  transcript" benefit is zero.

Either way the WSJF entry as written (wiring_impact 7, job_size 3, on the
premise that a transcript goes away) does not describe available work. Left
open deliberately rather than implemented to the letter, because implementing
`sessionStore` would land a third copy of the transcript while the gap's
one-line summary claimed a parallel one had been retired.

## Related, for whoever picks up SDK-03

SDK-03 ("session resume via `resume`/`forkSession` instead of XML replay") is
real: `ClaudeProvider._buildPrompt` replays `task.history` as an
`<execution_history>` XML blob inside the user prompt, and the SDK offers
`resume`, `forkSession` and `sessionId` natively.

The risk to size before starting is the failure path. Native resume reads the
transcript from `CLAUDE_CONFIG_DIR`; if it has been cleared or the session
predates a config-dir change, `resume` cannot find it and the task must fall
back to the XML replay it is meant to replace. That fallback runs on the main
execution path for every Claude task, and its trigger is a real-provider error
shape — which this repo's tests cannot currently exercise, since `test:e2e`
runs against `EchoProvider` and CI never runs `test:e2e:real` or
`test:integration`. Landing SDK-03 without that coverage means shipping an
unverified error path on the hottest path in the system.
