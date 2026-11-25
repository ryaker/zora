# Auto-ontology memory (experimental, default off)

Status as of Nov 24, 2026. Everything here is described from the source on
`main` plus the retrieval change in PR #230 (`agent/194c-ontology-retrieval`).
Where behavior depends on #230 it says so; re-check this page when #230 lands.
Tracking issue: #194. Research behind the design: `research/LOG.md`, entry
"Auto Ontology → agent memory" (#231).

## What it is

Zora's ordinary memory (`memory_search`) finds a memory by its wording. The
auto-ontology adds a small graph beside it: after a job commits memories, a
tool-less model call extracts **entities** (kind ∈ person, project, tool,
concept) and **relations** (`from --predicate--> to`) from each memory, and
stores them with the memory's ID as **provenance**. A later search can ask
"what memories mention entity X" or "which memories assert X uses Y", even
when the wording differs.

It is not a source of truth. Extracted facts are provisional model claims; the
memory text stays the evidence.

## Enable (two environment flags, no `config.toml` key)

```bash
export ZORA_GRAPH_MEMORY=1      # graph tier (needs the optional SparrowDB native module)
export ZORA_GRAPH_ONTOLOGY=1    # auto-ontology; inert unless the line above is set too
```

Both default off. The ontology flag is necessary but not sufficient: ontology
writes are dropped and reads return nothing unless the graph tier is also on.
With only `ZORA_GRAPH_MEMORY` set, the legacy graph tier and `graph_recall` still
run; they are separate from the ontology. With neither set, behavior is plain memory. Graph tier details
and the one-process-per-database rule: `docs/configuration.md`, "Graph memory".

## What happens when it is on

1. **Extraction (on `main`, #222).** Requires `memory.auto_extract`. After a job's
   automatic memory extraction has persisted its items, enrichment runs over those
   newly persisted items only (not memories saved via `memory_save`):
   at most 5 memories per run, 60 s wall-clock budget, one model call each, with
   the built-in tool surface disabled. It never delays or alters the memory save.
2. **Validation of model output (`src/memory/graph/ontology-extractor.ts`).**
   Output is untrusted. It must parse as JSON within size caps (≤20 entities,
   ≤30 relations, names ≤200 chars, no control characters); kinds outside the
   closed list are dropped, not guessed; an entity is kept only if its name
   literally occurs in the source memory text; a relation only if both endpoints
   were kept. Anything unusable stores nothing.
3. **Storage.** `(:OntEntity {name, kind})-[:EVIDENCED_BY]->(:Memory {memId})`,
   plus `(:Assertion {from, predicate, to, memId})` per memory. One node per
   (kind, name) in the store; "first classification wins" applies only within one
   extraction response, so different memories can classify the same name differently.
   Assertions also store `akey`, `fromKey`, `toKey` and `predicate`; `ts` is the source
   memory's creation time, not a validity time. Corrections do not retire older rows:
   they are retained. Extraction checks the shape and that names occur in the text;
   it does not verify that a predicate is true.
4. **Retrieval (PR #230, not yet on `main`).** `memory_search` accepts optional
   `entity` and `relation` arguments. The graph only proposes memory IDs. Each ID
   must pass the same checks a lexical hit does (it resolves via `peekItem`, so
   archived or forgotten memories drop out; matches the `type` filter), must pass a
   runtime-supplied source-eligibility check, and the entity names must still
   appear in the memory's *current* text. Survivors are appended after lexical hits
   marked `via: "graph"`, `provisional: true`, `score: null`, within the same
   `limit`. Any graph error discards all graph candidates (lexical-only).

**Current limitation.** #230 ships the retrieval path inert in production: the
orchestrator passes no source-eligibility policy, so graph expansion returns
nothing until Richard decides how per-job source visibility is checked. Today,
turning the flags on therefore builds the graph (step 1–3) but `memory_search`
results do not change. Answer-side citation enforcement is also still open
(#194).

## Worked example

Saved memory `mem_a1`: "Zora uses SparrowDB for the graph tier."

Extraction output after validation (abbreviated: the stored records also carry the
memory's creation timestamp and internal keys):

```json
{"memId":"mem_a1","entities":[{"name":"Zora","kind":"project"},{"name":"SparrowDB","kind":"tool"}],
 "relations":[{"from":{"name":"Zora","kind":"project"},"to":{"name":"SparrowDB","kind":"tool"},"kind":"uses"}]}
```

Stored: two `OntEntity` nodes, one `Assertion(Zora, uses, SparrowDB, mem_a1)`,
and `EVIDENCED_BY` edges to `Memory(mem_a1)`.

## Example queries (after #230, once the eligibility policy is supplied)

```jsonc
// everything linked to an entity
{"query": "graph storage", "entity": {"name": "SparrowDB", "kind": "tool"}}
// a specific relation (both entities must appear in the memory text)
{"query": "what does Zora use", "relation": {
  "from": {"name": "Zora", "kind": "project"},
  "to":   {"name": "SparrowDB", "kind": "tool"}, "predicate": "uses"}}
```

## When it helps vs plain `memory_search`

- Hypothesis, not measured: it may help when a question is anchored on an entity
  whose memories word it differently, or a relation answer is spread over several
  notes. Matching is exact on `(kind, name)` and predicate, so aliases and case
  variants are NOT resolved today; the benchmark below should test the hypothesis.
- No help or worse: a memory whose wording already matches the query (BM25 finds
  it); entities the extractor missed or mis-kinded (the graph can only point at
  what was extracted); relations whose predicate wording differs (`uses` vs
  `built on`; predicates are matched exactly).
- Cost: one extra model call per persisted memory (max 5 per job) when on.

## Forgetting and retention

`memory_forget` removes the structured item and its search-index/cache entries but
does not touch the graph (static review; no graph cleanup path found). Ontology
rows derived from a forgotten memory are retained. #230's handler drops a graph
candidate whose ID no longer resolves, which *suppresses* it at read time; that is
not deletion and is not production behavior while retrieval is inert. Closing this
retained-derived-data gap is a follow-up and should land before retrieval is activated.

## Validating it

- Unit coverage: `tests/unit/memory/graph/ontology-extractor.test.ts` (parsing,
  grounding, caps, deadline) and, with #230, `tests/unit/tools/memory-search-ontology.test.ts`
  (authorization, staleness, budget, failure fallback).
- There is no CLI to browse the ontology yet; that is a gap, and any inspect command
  that exposes graph contents needs an access review before it ships.
- Two evaluations are proposed in the #231 research entry and neither exists yet:
  (1) an offline retrieval benchmark (frozen fixtures, equal eligibility and result
  budgets, source recall/precision), runnable once written; (2) answer, abstention
  and citation scoring, which cannot be validated through production #230 until the
  source-visibility policy and answer-side citation enforcement exist.
