# ADR-005: Multi-Agent Coordination Architecture

**Status:** Accepted
**Date:** 2026-02-25
**Authors:** Zora Core Team

## Context

Zora supports multi-agent teams for tasks that benefit from parallelism and specialization: PR review (one agent per changed file), code audit (security agent + style agent), and research tasks (researcher + synthesizer). The coordination model must:

1. Support heterogeneous agent types (Claude agents and Gemini agents in the same team).
2. Avoid shared mutable state that would create race conditions.
3. Allow the coordinator agent to receive results and make synthesis decisions.
4. Be inspectable and debuggable via the filesystem.
5. Work within Zora single-machine deployment constraint (no broker, no network).

## Decision

Implement multi-agent coordination via a **filesystem-based mailbox system** (TeamManager + Mailbox) with the following structure:

    ~/.zora/teams/<teamName>/
      config.json       # TeamConfig: members, coordinatorId, persistent flag
      inboxes/
        <agentId>.json  # Per-agent inbox: array of MailboxMessage objects

Key decisions:

1. **Directory-based team identity**: Teams are named directories. The name is the primary identifier. Validation prevents path traversal (src/teams/team-manager.ts validateName()).

2. **Atomic mailbox writes**: All inbox writes use writeAtomic() (src/utils/fs.ts) to prevent partial-write corruption in concurrent scenarios.

3. **Message types**: MailboxMessageType union (src/teams/team-types.ts) defines: task, result, status, steer, handoff, shutdown, idle. This is a closed vocabulary enabling typed dispatch.

4. **Coordinator pattern**: Every team has exactly one coordinatorId (must be a member agentId). The coordinator aggregates results and drives the next step. No leaderless consensus.

5. **Ephemeral vs persistent teams**: persistent=false teams are torn down after completion (teardown removes the team directory). persistent=true teams survive process restarts.

6. **PR lifecycle teams**: prNumber and prTitle fields in TeamConfig allow PR-specific team instances (src/teams/pr-lifecycle.ts).

7. **Team inbox as a channel** (superseded the Gemini bridge, Aug 2026): MailboxChannelAdapter (src/channels/team/mailbox-channel-adapter.ts) presents an agent's inbox as an IChannelAdapter, so a delegated task traverses the ChannelManager pipeline — policy gate, capability resolver, quarantine — like any other inbound message (INVARIANT-9).

   This replaced GeminiBridge, which wrapped the gemini CLI as a subprocess. That bridge ran inbox messages directly, so delegated work skipped the authorization and quarantine an identical instruction over Signal would have gone through, and it passed the prompt as an argv entry — the world-readable construction SEC-22 had already removed from GeminiProvider. Routing to Gemini is now provider selection on an ordinary task rather than a second execution path.

8. **Bridge watchdog**: BridgeWatchdog (src/teams/bridge-watchdog.ts) monitors a SupervisedPoller's heartbeat and restarts it on staleness. It supervises the team MailboxChannelAdapter; a team inbox that silently stops draining is indistinguishable from an idle team without it.

## Consequences

**Positive:**
- No broker infrastructure required. Teams work offline and restart cleanly.
- Filesystem mailboxes are human-inspectable with any text editor or cat command.
- Atomic writes prevent the most common concurrent access corruption.
- The coordinator pattern is simple to reason about and test.
- BridgeWatchdog provides fault tolerance for crashed sub-agents.

**Negative:**
- Polling-based coordination (agents must poll their inbox). No push notification between agents. Acceptable for long-running tasks where polling latency is negligible.
- Filesystem IOPS can become a bottleneck with many agents and high message frequency. Acceptable for current 2-4 agent team sizes.
- No distributed transaction support: if the coordinator crashes mid-synthesis, partial results may be lost. Mitigated by persistent team option and session JSONL.

## Alternatives Considered

1. **In-process event emitter (EventEmitter)**: Rejected because agents run as separate processes (Gemini via subprocess, Claude via SDK); in-process events do not cross process boundaries.
2. **Redis pub/sub**: Rejected for violating zero-external-dependencies constraint (ADR-003). Would require a running Redis instance.
3. **SQLite shared database**: Rejected due to native dependency (better-sqlite3 requires compilation). Noted for future revisit if team sizes grow.
4. **HTTP REST between agents**: Rejected as over-engineered for local single-machine coordination. Adds port allocation complexity and failure modes.
