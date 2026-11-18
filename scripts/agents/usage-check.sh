#!/usr/bin/env bash
# Month-to-date API spend for the Zora agents, per pool and per line (agent vs. Zora runtime).
# Runs inside a NanoClaw agent container, where HTTPS goes through the OneCLI gateway.
# No real keys live here: requests carry the placeholder "onecli-managed" and the gateway
# swaps in the ADMIN keys stored in OneCLI (host + path scoped; see docs/agents/ONECLI.md).
#
#   Anthropic: GET /v1/organizations/cost_report  (Admin key; amounts are decimal strings in cents)
#   OpenAI:    GET /v1/organization/costs          (Admin key; amount.value in USD)
#
# Optional env:
#   BUDGET=200  ANTHROPIC_CYCLE_DAY=10  OPENAI_CYCLE_DAY=5
#   ANTHROPIC_WS_ARCHITECT, ANTHROPIC_WS_ZORA   Console workspace ids  (attribution lines)
#   OPENAI_PROJ_REVIEWER,   OPENAI_PROJ_ZORA    OpenAI project ids     (attribution lines)
# Output: a markdown table on stdout; paste between the SPEND markers in ops/spend.md.
set -euo pipefail
export BUDGET=${BUDGET:-200}
PH=onecli-managed
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT

read -r A_START O_START O_TS < <(python3 - "${ANTHROPIC_CYCLE_DAY:-10}" "${OPENAI_CYCLE_DAY:-5}" <<'PY'
import sys, datetime as d
def start(day):
    t = d.date.today()
    if t.day >= day: return t.replace(day=day)
    prev = t.replace(day=1) - d.timedelta(days=1)
    return prev.replace(day=min(day, prev.day))
a, o = start(int(sys.argv[1])), start(int(sys.argv[2]))
print(a.isoformat(), o.isoformat(), int(d.datetime(o.year, o.month, o.day, tzinfo=d.timezone.utc).timestamp()))
PY
)
export A_START O_START

curl -fsS "https://api.anthropic.com/v1/organizations/cost_report?starting_at=${A_START}T00:00:00Z&group_by[]=workspace_id&limit=31" \
  -H "x-api-key: $PH" -H "anthropic-version: 2023-06-01" > "$TMP/a.json" 2>"$TMP/a.err" || echo '{"error":"anthropic cost_report failed"}' > "$TMP/a.json"
curl -fsS "https://api.openai.com/v1/organization/costs?start_time=${O_TS}&bucket_width=1d&group_by[]=project_id&limit=31" \
  -H "Authorization: Bearer $PH" > "$TMP/o.json" 2>"$TMP/o.err" || echo '{"error":"openai costs failed"}' > "$TMP/o.json"

python3 - "$TMP/a.json" "$TMP/o.json" <<'PY'
import json, os, sys, datetime as d
budget = float(os.environ["BUDGET"])
A = json.load(open(sys.argv[1])); O = json.load(open(sys.argv[2]))
def a_total(ws=None):
    return sum(float(r.get("amount") or 0) / 100.0
               for b in A.get("data", []) for r in b.get("results", [])
               if ws is None or r.get("workspace_id") == ws)
def o_total(proj=None):
    return sum(float((r.get("amount") or {}).get("value") or 0)
               for b in O.get("data", []) for r in b.get("results", [])
               if proj is None or r.get("project_id") == proj)
def action(pct):
    return ("PAUSE (label agents:paused)" if pct >= 100 else "review/fix open PRs only" if pct >= 90
            else "downshift models, 60-min cadence, no research" if pct >= 75
            else "note burn rate" if pct >= 50 else "normal")
def row(name, spent):
    pct = 100 * spent / budget
    return f"| {name} | ${spent:,.2f} | {pct:.0f}% | {action(pct)} |"
out = [f"As of {d.datetime.now():%Y-%m-%d %H:%M} (box-local time)", "",
       f"| Line | Spent this cycle | % of ${budget:.0f} | Action |", "|---|---|---|---|"]
out.append(row(f"Anthropic pool (since {os.environ['A_START']})", a_total()) if "error" not in A else f"| Anthropic pool | – | – | {A['error']} |")
for label, env in [("  zora-architect", "ANTHROPIC_WS_ARCHITECT"), ("  Zora runtime", "ANTHROPIC_WS_ZORA")]:
    if os.environ.get(env) and "error" not in A: out.append(row(label, a_total(os.environ[env])))
out.append(row(f"OpenAI pool (since {os.environ['O_START']})", o_total()) if "error" not in O else f"| OpenAI pool | – | – | {O['error']} |")
for label, env in [("  zora-reviewer", "OPENAI_PROJ_REVIEWER"), ("  Zora runtime", "OPENAI_PROJ_ZORA")]:
    if os.environ.get(env) and "error" not in O: out.append(row(label, o_total(os.environ[env])))
print("\n".join(out))
PY
