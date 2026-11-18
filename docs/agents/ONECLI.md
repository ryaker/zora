# Keys for the Zora agents (OneCLI on the M2 Air)

All API keys live only in the OneCLI vault on the M2 Air
(dashboard http://127.0.0.1:10254, gateway :10255, bound to localhost; OneCLI 1.45.0).
Agent containers never see a key: they send the placeholder `onecli-managed` and the
gateway swaps the real key in on the way out, matched by host (and path).

The M4's OneCLI (v1.42.0) is left untouched; NanoClaw v2026.11.0 needs gateway 1.45 for
per-agent grants, and pointing the Air at the M4 would mean re-binding the M4 gateway.

## Secrets to create

| # | Name | Type | Host pattern | Path pattern | Header / format | Attach to |
|---|---|---|---|---|---|---|
| 1 | `Anthropic` | anthropic | `api.anthropic.com` | (none) | `x-api-key: {value}` (set by type) | zora-architect |
| 2 | `OpenAI` | openai | `api.openai.com` | (none) | `Authorization: Bearer {value}` (set by type) | zora-reviewer |
| 3 | `Anthropic Admin (usage)` | generic | `api.anthropic.com` | `/v1/organizations/*` | `x-api-key` / `{value}` | zora-reviewer |
| 4 | `OpenAI Admin (usage)` | generic | `api.openai.com` | `/v1/organization/*` | `Authorization` / `Bearer {value}` | zora-reviewer |
| 5 | `GitHub zora-agents` | generic | `api.github.com` | `/repos/ryaker/zora/*` | `Authorization` / `Bearer {value}` | both |

Keys to create first:
- Anthropic: Console → Workspaces → new workspace `zora-agents` (monthly spend limit $140) and
  `zora-runtime` ($40). Create the agent key **in the `zora-agents` workspace** (single-workspace key).
  Admin key: Console → Settings → Admin keys (read-only use: cost_report).
- OpenAI: platform → Projects → new project `zora-agents` (budget $110) and `zora-runtime` ($50);
  project key in `zora-agents`. Admin key: Organization → Admin keys (scope: usage read).
- GitHub: fine-grained PAT, resource owner `ryaker`, **only** repository `ryaker/zora`,
  permissions Contents R/W, Pull requests R/W, Issues R/W, Metadata R; 90-day expiry.

Auto-reload / Auto Recharge OFF in both orgs.
