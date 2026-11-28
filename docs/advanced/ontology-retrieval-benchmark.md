# Ontology retrieval benchmark (Stage 1)

Measures whether graph expansion in `memory_search` (#230) finds supporting memories that lexical search alone misses. Gates the rest of the ontology backlog (#242–#246): measure before building.

Run: `npx vitest run tests/benchmarks/ontology-retrieval` (prints the table; no SparrowDB or model needed).

## Design

- **Fixtures** (`tests/benchmarks/ontology-retrieval/fixtures.ts`): 61 hand-written memories (45 informative, 16 distractors that share words with queries) and 20 questions with hand-labelled gold memory keys, in five types: single-hop, multi-hop, alias, temporal, provenance.
- **Frozen extractor output**: each memory carries the entities/relations the extractor would emit. The benchmark measures retrieval, not extraction.
- **Arms**: A = `memory_search` with the query only. B = same call plus the `entity`/`relation` argument. Both go through the real `createMemoryTools` handler and a real `MemoryManager` store, same budget (k = 5), no `min_score`.
- **Graph**: an in-memory stand-in for `GraphStore` (exact `(kind, name)` and predicate matching, failure-aware client surface). It is not SparrowDB itself, so store-level bugs are out of scope here.
- **Metrics**: recall@5 and precision@5 against gold, per type; "fixed" = questions where B found a gold memory A did not; "broken" = the reverse.

## Result (this commit)

| type | n | recall@5 A | recall@5 B | precision@5 A | precision@5 B | fixed | broken |
|---|---|---|---|---|---|---|---|
| single-hop | 6 | 0.19 | 0.42 | 0.10 | 0.20 | 2 | 0 |
| multi-hop | 5 | 0.60 | 0.60 | 0.12 | 0.12 | 0 | 0 |
| alias | 3 | 0.00 | 0.00 | 0.00 | 0.00 | 0 | 0 |
| temporal | 2 | 0.00 | 0.00 | 0.00 | 0.00 | 0 | 0 |
| provenance | 4 | 0.38 | 0.38 | 0.10 | 0.10 | 0 | 0 |
| all | 20 | 0.28 | 0.35 | 0.08 | 0.11 | 2 | 0 |

## Reading it

With 20 questions, a difference of one or two items is noise; report counts, not a headline. Observations that hold regardless:

- **Graph expansion helps single-hop only when the result budget has room.** Graph-only candidates score with a relevance floor of 0.5 and compete with lexical hits for the same k = 5 slots. In several questions the lexical hits already fill the budget and a gold memory the graph supplies is dropped (e.g. q1, q4, q6, q7: for q7 the graph returns the `Zora uses SparrowDB` memory, yet the result list omits it). Candidate follow-ups: reserve a few slots for graph hits, or raise the floor. Not changed here.
- **Alias**: the real tool's stale-evidence check (the entity name must still appear in the memory text) drops a memory that says "Sparrow" for entity `SparrowDB`. Alias resolution (#245) will not help until that check is alias-aware; the benchmark's alias items show a loss on both arms.
- **Temporal**: the graph has no validity/supersession (#244), so it cannot prefer the current fact; both arms score 0 on the two temporal items.
- No question got worse with the graph (broken = 0).

## Limits / next

- Stage 2 (answer, abstention, citation scoring) is not runnable until answer-side citation enforcement lands.
- Extraction quality is measured separately (needs a model).
- Add questions before drawing conclusions about any single type.
