# Ontology: assertion supersession and validity (design, #244)

Status: design only, no code. Everything below stays default-off behind
`ZORA_GRAPH_MEMORY` / `ZORA_GRAPH_ONTOLOGY`, and ranks rather than blocks:
retrieval is never gated (#230).

## Problem

An `Assertion` node is `{akey, fromKey, toKey, predicate, memId, ts}`
(`src/memory/graph/graph-store.ts`, `recordFacts`). `ts` is the *source
memory's* creation time, not when the fact held. `SUPERSEDES` exists only
between `Decision` nodes (`graph-types.ts`). So when a fact changes, the old
and new assertions are equally live. The retrieval benchmark
(`docs/advanced/ontology-retrieval-benchmark.md`) shows it: both temporal
questions (q15, q16) score recall 0 on both arms, and the stale memory
(`t1_old`, `t2_old`) is indistinguishable from the current one (`t1_new`,
`t2_new`).

## Proposal

1. **Supersession is an event, not an edit.** A correction adds a node and an
   edge; nothing is deleted or rewritten, so provenance (#242) still shows the
   old fact and why it was retired.
   - `(:Assertion)-[:SUPERSEDED_BY]->(:Assertion)` (new edge type, added to
     `EDGE_TYPES`).
   - The edge carries `ts` (when the retirement was recorded) and `reason`
     (`newer_memory` | `explicit_correction`).
2. **Validity is derived, not stored.** An assertion is *current* iff it has no
   outgoing `SUPERSEDED_BY`. No `valid_to` property to keep in sync; a replay
   of `recordFacts` stays idempotent.
3. **When does a new assertion retire an old one?** Conservatively, and only
   for *functional* predicates. Two assertions conflict only when they share
   `fromKey` and `predicate` but differ in `toKey` **and** the predicate is
   declared single-valued (`uses_mode`, `status`, `version`, `owner`, ...). Open
   predicates (`uses`, `mentions`, `relates_to`) accumulate and never
   supersede, because "Zora uses A" and "Zora uses B" are both true. The set of
   single-valued predicates is a small constant list in code, not model output.
   The newer assertion is the one whose source memory has the later `ts`; ties
   supersede nothing.
4. **Explicit corrections** (an extractor-emitted `corrects: <memId>` on a
   relation, or the user telling the agent a fact changed) may supersede across
   non-functional predicates, but only the named assertion.
5. **Retrieval effect: rank, never block.** In `memory_search`, a memory whose
   *only* graph support is superseded assertions gets a demotion multiplier
   (e.g. 0.6) and `superseded: true` in the result, so the model can say "this
   was true until X". It is still returned and still citable. Current-fact
   assertions keep today's `GRAPH_BOOST`. With the flags off, nothing changes.
6. **Inspect.** `zora-agent memory graph assertions` (#242) gains a
   `status` column (current/superseded) and `provenance` lists the
   superseding memory. Read-only.

## Why not alternatives

- **`valid_from` / `valid_to` properties**: need model-extracted dates, which are
  often wrong or absent; two writers can disagree. Derived validity from
  ordering of source memories needs no new model output.
- **Delete the old assertion**: loses provenance and makes a wrong supersession
  unrecoverable. This design is reversible by deleting one edge.
- **Supersede on any shared predicate**: would retire true facts
  (`uses` accumulates). Hence the single-valued allowlist.

## Evaluation (do this before building)

The benchmark fixtures already hold the pairs. Extend
`tests/benchmarks/ontology-retrieval`:
- give `t1`/`t2` relations with a single-valued predicate, add 6+ more temporal
  pairs (the current 2 are noise), plus 4 negative pairs where both facts stay
  true (open predicate) to measure false supersession;
- report: temporal recall@5 of the *current* memory, stale-in-top-1 rate, and
  false-supersession count (target 0). Build only if current-recall improves
  and false supersession is 0.

## Implementation sketch (follow-up issues if accepted)

1. `SUPERSEDED_BY` edge type, `GraphStore.supersede(oldAkey, newAkey, reason)`,
   `recordFacts` hook applying rule 3. Emitted-patterns test (labelled nodes,
   bound params) must keep passing.
2. `GraphMemoryClient.currentAssertions` / `isSuperseded(memIds)` ops; worker
   dispatch.
3. `memory_search` demotion + `superseded` flag; unit test with a stand-in graph.
4. CLI status column; docs.
5. Benchmark additions above.

## Open questions

- Which predicates are single-valued? Proposed starting list above; extractor
  predicates are free-form (`exactId`, max length), so unknown predicates default
  to open (never supersede).
- Should the demotion be a constant or configurable? Start constant.
