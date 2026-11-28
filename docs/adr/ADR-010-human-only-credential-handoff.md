# ADR-010: Human-only handoff for credential changes

- Status: Proposed (design only, no code) — issue #200
- Source: OpenBot v1.1.0 evaluation (research/LOG.md, 2026-11-18, item 3)

## Context

Zora can drive a browser or call connector tools. Some actions are different in
kind from "risky": changing a password, adding or removing a 2FA factor, editing
recovery email/phone, rotating or creating an API key or app password. An
approval ("yes, go ahead") is the wrong control, because the agent would then
type or handle a new credential itself, in its context, logs and tool arguments.
OpenBot's answer: no approval can make the agent do it; the human does it and
tells the agent "I did it myself" or "Don't do it".

Today nothing in Zora recognises this kind. `IrreversibilityScorer` scores by
tool name (`toolToAction()`), `PolicyEngine` classifies shell/file actions, and
`SecretRedactHook` redacts secret-shaped *arguments* after the fact. A browser
"type into password field" call is scored like any other form fill.

## Decision (proposed)

Add one new outcome, **`handoff`**, alongside allow / ask / deny. It is
*stricter than ask*: an approval (human or grant, including #233 job grants)
can never turn a `handoff` into an allow.

```toml
[policy.handoff]
enabled = true                     # default true once shipped (fail-closed)
# Signals are matched on action metadata, never on content the agent is reading.
tool_patterns = ["*change_password*", "*set_password*", "*enroll_2fa*", "*add_mfa*",
                 "*rotate_api_key*", "*create_api_key*", "*update_recovery*"]
url_patterns  = ["*/settings/security*", "*/account/password*", "*/2fa*"]
field_types   = ["password", "otp", "totp"]   # browser form field kinds
```

Behaviour when a call matches:

1. The call is **not executed**. The tool result tells the model: "This needs
   you to do it yourself; ask the user." No retry path exists inside the job.
2. A message goes to the user through the existing approval channel
   (Telegram/Signal/dashboard) with two replies: `done` ("I did it myself") and
   `skip` ("Don't do it"). The job pauses or continues per the reply; the agent
   is told only the outcome, never given a credential.
3. Audit entry `handoff:<reason>` with the matched signal; no argument values
   (they are redacted already).

## Invariants

- **Tightening only.** The kind can only remove autonomy. It sits in the
  PreToolUse stage (fails closed on error), so no loosening of any existing
  check, and `tests/security/tool-enforcement.test.ts` is unchanged.
- **Metadata, not prose.** Match tool name, URL and field type. Text inside a
  page, document or message the agent reads must never trigger or suppress a
  handoff (it is untrusted; matching it would let injected text switch the gate
  off or spam the user). We do not claim injection resistance beyond that.
- **Not a secrets store.** The agent never receives the new credential. Real
  credential values stay in the gateway (OneCLI); nothing here reads or writes
  them.
- **Best effort, honest limits.** Pattern lists cannot see every site. The
  default list is deliberately small and high-precision; a miss falls back to
  today's behaviour (scored/asked), never to a looser one. Users may *add*
  patterns in policy.toml; removing defaults needs an explicit edit (protected
  file).

## Open questions

- **Which actions count?** Proposed v1: password change, 2FA enrol/remove,
  recovery contact change, API key/app-password create/rotate. Payment and
  "share/publish" kinds are separate (they are covered by ask today; see the
  classification-coverage audit in the OpenBot shortlist, item 2).
- **Browser tool coverage.** The repo has no first-party browser tool; handoff
  hooks into whatever MCP browser tool a user connects, via `tool_patterns` and
  the call's URL/field arguments when present. Need a survey of common browser
  MCP argument shapes before the hook can match `url_patterns`/`field_types`.
- **Routines.** A routine hitting a handoff has no human present: it records the
  pending handoff and stops that step rather than waiting forever.

## Alternatives

- Treat as score 95 (auto-deny): works for blocking but gives the user no
  "I did it myself" path, so the task just fails.
- Content-based detection: rejected, injectable.

## Follow-ups if accepted

1. `[policy.handoff]` schema + loader + defaults (docs/configuration.md).
2. PreToolUse matcher + `handoff` result type + channel prompt (`done`/`skip`).
3. Tests: matched call never executes even under a #233 grant or blanket
   approval; page text cannot trigger/suppress; audit entry has no values.
