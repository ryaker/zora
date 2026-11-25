# Ollama model bake-off (#236) — 2026-11-25

Question (Richard): which open model on Ollama is best value for Zora's runtime?

## What was run
`scripts/bakeoff/ollama-bakeoff.mjs` against the three chat models on the host Ollama (all `:cloud`,
served by ollama.com), `temperature 0`, 3 repeats each:
- **Tool use**: 4 prompts x 3 repeats = 12 calls with 3 tools (`read_file`, `memory_search`, `send_message`);
  one prompt needs no tool. Pass = right tool and plausible arguments.
- **Long-context recall**: a needle (a codename) hidden 40% into 200 and 1,500 log lines, `num_ctx 32768`.
- **Latency**: p50 wall-clock per request. **Output tokens** summed.

This is a small smoke bench, not the `test:e2e:real` scenario harness (see "Not done").

## Results
| Model | Tool use | Recall 200 lines | Recall 1,500 lines | p50 latency | Output tokens |
|---|---|---|---|---|---|
| glm-5.3:cloud | 9/12 | 3/3 | 3/3 | 452 ms | 861 |
| glm-5.3-flash:cloud | 9/12 | 3/3 | 3/3 | 571 ms | 1,013 |
| deepseek-v4.1-flash:cloud | 9/12 | 3/3 | 3/3 | 632 ms | 1,078 |

All three missed the same prompt every time ("Tell the reviewer that PR 12 is ready" -> they called
`memory_search`, not `send_message`), so the 9/12 is one shared miss, not a spread between models.
The models do not separate on this suite.

## Cost
Unmeasured: Ollama cloud models are covered by the Ollama plan, with no per-token price to compare, so
"cost per task" cannot be computed here. Usage limits and the plan tier are Richard's call.

**Proposal for Richard (plain words):** keep whichever plan covers these cloud models; no change is
needed to run this bench. If Zora should run on Ollama day to day, tell us the plan's usage limits so we
can estimate cost per task. Nothing was purchased or changed.

## Recommendation (tentative)
`glm-5.3:cloud` as the first default to try: tied on quality, lowest p50 and fewest output tokens here.
The margin is small and 3 repeats is thin, so treat it as a tiebreak, not a verdict.

## Not done
- `test:e2e:real` scenario harness against these models (the harness has no per-model Ollama switch;
  needs a config fixture per model).
- Local (non-cloud) models: none are installed on the host except `nomic-embed-text` (embeddings).
- Dogfood config: no dogfood config exists in this repo, so the default provider was not changed.
- Needs Node `NO_PROXY=host.docker.internal` in this sandbox, or `fetch` fails against the proxy.

Reproduce: `OLLAMA_URL=http://localhost:11434 node scripts/bakeoff/ollama-bakeoff.mjs glm-5.3:cloud ...`
