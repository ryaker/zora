# API spend ledger

Updated daily (18:00 PT) by zora-reviewer from `scripts/agents/usage-check.sh`.
Nimble usage is read from the Nimble dashboard (no usage API wired yet); the architect logs its request count per research round in research/LOG.md.
Agents must read this before starting work and obey the thresholds in docs/agents/WORKFLOW.md.
"Not yet measured: admin keys not entered" below is expected (OneCLI keys have no admin usage scopes; provider-side
monthly caps enforce spend). Treat it as under budget and keep working; it is never a blocker.

| Pool | Cycle | Budget | Line | Monthly target |
|---|---|---|---|---|
| Anthropic | 10th → 10th | $200 | zora-architect | $140 |
| Anthropic | | | Zora runtime | $40 |
| Anthropic | | | Buffer | $20 |
| OpenAI | 5th → 5th | $200 | zora-reviewer | $110 |
| OpenAI | | | Zora runtime (after OpenAI provider lands) | $50 |
| OpenAI | | | Buffer | $40 |
| Nimble (web search/extract) | monthly | free tier: 5,000 requests | zora-architect research rounds | $0 (stay in free tier; then $1/1k searches, $3/1k extracts) |
| Ollama Cloud | plan billing date | included plan credits | Zora Referee (`deepseek-v4.1-flash:cloud`, on demand only) | $0 extra (stays inside the existing Ollama plan; check ollama.com usage) |

## Current cycle
<!-- usage-check.sh rewrites the block below -->
<!-- BEGIN SPEND -->
Not yet measured: admin keys not entered in OneCLI.
<!-- END SPEND -->
