# SEC-30 — the audit log records only what succeeded

Plus **TEST-22**, the cheap guard that belongs next to it.

Both came out of reading `deepseek-ai/deepseek-harness`'s
`docs/tool-execution-pipeline.md`, which logs `tool/call` **before** execution
and `tool/result` after. Zora logs only after. The finding below is from Zora's
own source, not from theirs — the comparison is only what prompted the look.

## SEC-30 — what is wrong

A tool call that is **blocked** produces no audit entry at all.

`toolHookRunnerToPreToolUse` (`src/hooks/sdk-hook-bridge.ts:132-146`) returns the
deny decision to the SDK and writes a `log.warn` to the pino stream. That is the
entire record. The tool never executes, so `PostToolUse` never fires, so
`ToolHookRunner.runAfter` never runs, so `AuditLogHook` — the only writer of tool
records since SEC-28 — is never invoked.

The pino line is an operational log: not hash-chained, not tamper-evident, and
not what `zora-agent audit` reads. So the tamper-evident log contains the calls
that **worked** and nothing else. For a security log that is backwards: the
denial, the call that hung, and the call killed mid-flight are the events worth
having, and none of them appear.

The same hole covers a tool that starts and never returns. The single record is
written on completion, so a hang or a mid-tool crash leaves the log looking as
though the call was never attempted.

### The vocabulary is already there and unused

`AuditEntryEventType` (`src/security/security-types.ts:15-26`) declares eleven
event types. Exactly two are ever written anywhere in `src/`:

```
3 × 'tool_invocation'
1 × 'dry_run'
```

`policy_violation` — the type that names precisely this event — is declared in
two files and has **zero writers**. `tool_result` is likewise declared and never
written as an audit type. This is the same defect class as ARCH-02 and MEM-34: a
capability that exists in the type system and nowhere on a path that runs.

## SEC-30 — what to build

1. `AuditLogHook.phase`: `'after'` → `'both'`.
   - before → `eventType: 'tool_invocation'` (the attempt)
   - after → `eventType: 'tool_result'` (the outcome)

   Both types already exist; no schema change, and therefore no change to
   `_computeHash`'s field list (see SEC-28 — adding a hashed field breaks
   verification of every entry already written).

2. **Correlation is the real work.** `ToolCallContext`
   (`src/hooks/tool-hook-runner.ts:14-20`) carries no call identifier, so an
   attempt cannot be joined to its outcome. The SDK supplies `tool_use_id` to
   the bridge, so the value exists — it has to be threaded through
   `runBefore`/`runAfter` into the context. Without it the two records are
   unlinkable and the change is not worth making.

3. The deny path in the bridge writes `eventType: 'policy_violation'` carrying
   `blockedBy` and `reason`, giving that type its first writer.

### Ordering trap — the two halves are one change

`AuditLogHook` is registered **third of six** (after `SensitiveFileGuard` and
`ShellSafety`, before `RateLimit`, `SecretRedact` and `IrreversibilityScorer`).
A before-record at that position therefore fires for calls the later three hooks
go on to deny.

That is the right semantics — an attempt should be recorded whether or not it is
permitted — **but only if the denial record ships at the same time**. Shipped
alone, a pre-execution record makes every denied call look like an invocation
with no outcome, which is indistinguishable from a hang. Do not split these
across two PRs.

Second-order note: the before-record captures arguments as they stand at hook 3,
i.e. before `SecretRedactHook` rewrites them. `AuditLogHook` runs its own
`redactSecrets()` over what it writes, so nothing leaks, but the recorded
arguments are the attempt's, not the ones that executed. The after-record
carries the executed arguments. Worth stating in `SECURITY.md` rather than
leaving a reader to infer it.

### Cost

Roughly 150 lines across `audit-log.ts`, `tool-hook-runner.ts`,
`sdk-hook-bridge.ts`, plus extensions to
`tests/security/audit-single-writer.test.ts` and the `SECURITY.md` sections
SEC-28 rewrote. It doubles audit volume and puts two serialised writes on the
queue per tool call; both are acceptable, but measure before claiming otherwise.

## TEST-22 — pin the monotonicity the chain already has

`ToolHookRunner.runBefore` (`src/hooks/tool-hook-runner.ts:80-88`) returns as
soon as a hook denies. A later hook cannot overturn an earlier denial because it
never runs. **The property holds today — this is not a live bug.**

What is missing is anything that keeps it true. `ToolHookResult` is
`{ allow: boolean }`, so a hook can express "allow", which reads as an
affirmative vote while only ever meaning "abstain". The type permits an
aggregation the runner happens not to perform.

The refactor that breaks it is easy to imagine and easy to justify: collecting
every hook's result before deciding gives much better denial messages ("blocked
by 2 of 6 hooks"). That rewrite is exactly where an abstain silently becomes an
override, and nothing in the suite would fail.

**Build:** a test that registers a chain where hook 2 denies and hook 3 would
allow, then asserts both that the outcome is `allow: false` **and that hook 3
never ran**. The second assertion is the one that survives a rewrite to
vote-collection; the first alone would still pass under a buggy aggregation that
lets a later allow win only in some orderings. Mutation-test it by making
`runBefore` continue past a denial.

~30 lines, one new test file, no `src/` change.

### The bigger version, deliberately not scoped here

deepseek-harness makes its guards *monotonic by type* — they "deny or abstain",
and allow is unrepresentable. Zora's equivalent would replace `ToolHookResult`
with `{decision:'abstain'} | {decision:'deny', reason} | {decision:'rewrite',
modifiedArgs}`, touching all six built-in hooks, the runner, the bridge and
every hook test — the most security-sensitive file set in the repo — to enforce
a property that currently holds anyway.

Worth doing only when those files are open for another reason. One wrinkle for
whoever does: `IrreversibilityScorerHook` returns `{allow: true}` after clearing
the approval gate (`src/hooks/built-in/irreversibility-scorer.ts:162`), where the
boolean genuinely means "approved" rather than "abstain". A mechanical rename
loses that distinction.

## Sequencing

TEST-22 lands **before** SEC-30, not because it is bigger — it is far smaller —
but because SEC-30 is the change that edits the hook chain, and the guard is
worth most when it is already in place while someone is modifying the thing it
protects.
