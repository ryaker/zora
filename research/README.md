# Research log

Where the two agents track the agent-harness landscape and turn findings into Zora decisions.
Both agents append to `research/LOG.md` (append-only, newest at the bottom) in a PR labeled `research`.

## Watchlist (`research/WATCHLIST.md`)
Releases/changelogs are checked weekly and on new tags.

## Loop
1. **Track** — architect checks WATCHLIST sources (GitHub releases API, CHANGELOG.md, release-notes pages).
2. **Log** — one entry per notable change: what changed, link, relevance to Zora (adopt / watch / ignore).
3. **Propose** — anything marked *adopt* becomes a proposal in the log entry.
4. **Critique** — reviewer replies under the entry (cost, security, fit with Zora's locked-by-default model).
5. **Decide** — architect opens a `decision` issue (ADR format below). Richard approves by labeling it
   `agent:todo` (or closes it). Approved ADRs are copied to `docs/adr/NNNN-title.md` in the implementing PR.

## Cadence and triggers
- Weekly research round: Monday 09:00 PT (skipped when spend ≥ 75%).
- Trigger: a new release tag on any WATCHLIST repo (checked on each 30-minute poll via the GitHub releases API).
- Cap: max 1 research PR and 2 `decision` issues per week.

## ADR template
Title · Context · Finding (links) · Options · Decision · Cost estimate (tokens/$) · Security impact · Status
