# Keys for the Zora agents (OneCLI on the M2 Air)

All API keys live only in the OneCLI vault on the M2 Air
(dashboard http://127.0.0.1:10254, gateway :10255, bound to localhost; OneCLI 1.45.0).
Agent containers never see a key: they send the placeholder `onecli-managed` and the
gateway swaps the real key in on the way out, matched by host (and path).

The M4's OneCLI (v1.42.0) is left untouched; NanoClaw v2026.11.0 needs gateway 1.45 for
per-agent grants, and pointing the Air at the M4 would mean re-binding the M4 gateway.

## Fastest path: the helper on the Air

```bash
cd ~/Dev/nanoclaw
./zora-keys.sh          # hidden prompts; rows 1-8 below, plus the grants
./zora-smoke.sh         # one cheap run per agent, then stops everything
```

Rows 1-2 go through NanoClaw's own sign-in steps (`--step gateway-auth claude`,
`--step provider-auth opencode`) so NanoClaw records them as the model keys and grants
them automatically. Rows 3-8 are created with `onecli secrets create --file <0600 tmp>`
and attached with `onecli agents grants attach-secret`.

## Secrets to create

| # | Name | Type | Host pattern | Path pattern | Header / format | Attach to |
|---|---|---|---|---|---|---|
| 1 | `Anthropic` | anthropic | `api.anthropic.com` | (none) | `x-api-key: {value}` (set by type) | zora-architect |
| 2 | `OpenAI` | openai | `api.openai.com` | (none) | `Authorization: Bearer {value}` (set by type) | zora-reviewer |
| 3 | `Anthropic Admin (usage)` | generic | `api.anthropic.com` | `/v1/organizations/*` | `x-api-key` / `{value}` | zora-reviewer |
| 4 | `OpenAI Admin (usage)` | generic | `api.openai.com` | `/v1/organization/*` | `Authorization` / `Bearer {value}` | zora-reviewer |
| 5 | `GitHub zora-agents (API)` | generic | `api.github.com` | (none; the PAT itself is limited to ryaker/zora) | `Authorization` / `Bearer {value}` | both |
| 6 | `GitHub zora-agents (git)` | generic | `github.com` | `/ryaker/zora*` | `Authorization` / `Basic {value}`, value = base64(`x-access-token:<PAT>`) | both |
| 7 | `Nimble (MCP)` | generic | `mcp.nimbleway.com` | (none) | `Authorization` / `Bearer {value}` | zora-architect |
| 8 | `Nimble (REST)` | generic | `sdk.nimbleway.com` | (none) | `Authorization` / `Bearer {value}` | zora-architect |

Keys to create first:
- Anthropic: Console → Workspaces → new workspace `zora-agents` (monthly spend limit $140) and
  `zora-runtime` ($40). Create the agent key **in the `zora-agents` workspace** (single-workspace key).
  Admin key: Console → Settings → Admin keys (read-only use: cost_report).
- OpenAI: platform → Projects → new project `zora-agents` (budget $110) and `zora-runtime` ($50);
  project key in `zora-agents`. Admin key: Organization → Admin keys (scope: usage read).
- GitHub: fine-grained PAT, resource owner `ryaker`, **only** repository `ryaker/zora`,
  permissions Contents R/W, Pull requests R/W, Issues R/W, Metadata R; 90-day expiry.

- Nimble: nimbleway.com → Settings → API Keys, a separate key named `zora-agents` (free tier, 5,000 requests).
  The architect group already has Nimble's MCP server configured (`https://mcp.nimbleway.com/mcp`, header
  `Authorization: Bearer onecli-managed`, swapped by the gateway). Rows 7-8 come from `./zora-keys.sh nimble`.

Auto-reload / Auto Recharge OFF in both orgs.
