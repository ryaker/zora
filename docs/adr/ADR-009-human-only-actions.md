# ADR-009: Ask, Don't Refuse, With a Short Never List

**Status:** Accepted
**Date:** 2026-11-28
**Authors:** Claude, for Richard (decision: Richard, 2026-11-28)
**Issues:** #265, #200, #233

## Context

Zora's goal is to be security-first without being so locked down that nobody uses it.
Richard compared it with four assistants that do real work for people: Claude Duet,
OpenAI dots, Meta Muse and Grok Bot. All four follow the same pattern:

- They act unasked on reads, research, drafts and scheduled work.
- They ask before a send, a payment, a signature or a delete.
- They keep a short list they never do, even when the user approves. Duet's list is
  trading securities and moving money between accounts. Dots leaves password changes
  with the user, and Muse never sees passwords or payment methods.

Zora was stricter in the wrong places:

- Approval was off by default, so an action that should ask was refused outright.
- Deletes scored at the auto-deny threshold, so even a "yes" was refused.
- A connector's `send_email` or `rotate_api_key` scored the 50-point unknown default,
  so it ran without asking.

## Decision

There are three outcomes, chosen by what an action does rather than by its tool name
(`classifyByEffect()` in `src/hooks/built-in/irreversibility-scorer.ts`).

1. **Act.** Reads, drafts, local edits and commits. Sends through a server with
   `acts_as = "zora"`, which is Zora speaking as itself in a channel, also act.
2. **Ask.** These go through the ApprovalQueue, which is on by default:
   - git push
   - a send as the user (`send_message`, 80)
   - a delete (`file_delete` and `remote_delete`, 85)
   - a payment (`payment`, 90)
   - destructive shell commands, in the `balanced` and `power` presets

   Questions reach Richard on Telegram, Slack or Signal, and his answer is a fixed
   `/approve` command.
3. **Never.** These are the `[actions] human_only` kinds, by default
   `credential_change` and `money_movement`. They are refused before scoring, so no
   approval, blanket window or score override can let them through. The denial reason
   tells the model to hand the step back to Richard.

## Consequences

- Asking only helps if someone can answer. When no approver can be reached, the queue
  still denies at once (#218), so every ask path fails closed.
- The never list is matched by name, so a tool with an unusual name can slip past it.
  Shell `passwd` is caught by command. This list is a backstop. It does not replace
  the policy, the capability tokens or the quarantine.
- Per-job grants (#233) build on this. Richard approves a job's scope once, and asks
  inside that scope stop. The never list stays in force inside any grant.
