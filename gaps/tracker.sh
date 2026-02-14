#!/bin/bash
# Zora Gaps Tracker - CLI for implementation agents
# Usage: ./gaps/tracker.sh [command] [args]
#
# Commands:
#   board              Show full board (WSJF-ranked, dependency-aware)
#   next               Show next actionable gaps (unblocked, highest WSJF)
#   status             Summary counts by status
#   category [cat]     Show gaps for category (orchestration, error_handling, etc.)
#   detail [ID]        Show full detail for a gap
#   claim [ID]         Mark gap as in_progress (sets claimed_by from $AGENT_NAME)
#   done [ID]          Mark gap as completed
#   blocked            Show gaps waiting on dependencies
#   deps [ID]          Show dependency chain for a gap
#   stream             Show parallelizable work streams

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
JSON="$SCRIPT_DIR/wsjf-scores.json"
AGENT="${AGENT_NAME:-unnamed-agent}"

if [ ! -f "$JSON" ]; then
  echo "ERROR: gaps-analysis.json not found at $JSON"
  exit 1
fi

case "${1:-board}" in

  board)
    python3 -c "
import json, sys
with open('$JSON') as f: data = json.load(f)
gaps = sorted(data['gaps'], key=lambda g: g['wsjf']['score'], reverse=True)
print(f'{\"#\":>3} {\"ID\":>10} {\"WSJF\":>6} {\"Sev\":>3} {\"Status\":>12} {\"Dep\":>5} Title')
print('-' * 90)
for i, g in enumerate(gaps, 1):
    dep = 'WAIT' if g.get('blocked_by') else 'GO'
    st = g.get('status', 'open')
    print(f'{i:3d} {g[\"id\"]:>10} {g[\"wsjf\"][\"score\"]:6.2f} {g[\"severity\"]:>3} {st:>12} {dep:>5} {g[\"title\"][:48]}')
"
    ;;

  next)
    python3 -c "
import json
with open('$JSON') as f: data = json.load(f)
gaps = data['gaps']

# Find completed gaps
completed = {g['id'] for g in gaps if g.get('status') == 'completed'}

# Find actionable: open, not blocked by incomplete gaps
actionable = []
for g in gaps:
    if g.get('status', 'open') != 'open': continue
    blockers = [b for b in g.get('blocked_by', []) if b not in completed]
    if not blockers:
        actionable.append(g)

actionable.sort(key=lambda g: g['wsjf']['score'], reverse=True)
print(f'NEXT ACTIONABLE ({len(actionable)} available):')
print(f'{\"#\":>3} {\"ID\":>10} {\"WSJF\":>6} {\"Sev\":>3} {\"Cat\":>16} Title')
print('-' * 85)
for i, g in enumerate(actionable[:15], 1):
    print(f'{i:3d} {g[\"id\"]:>10} {g[\"wsjf\"][\"score\"]:6.2f} {g[\"severity\"]:>3} {g[\"category\"]:>16} {g[\"title\"][:45]}')
if len(actionable) > 15:
    print(f'  ... and {len(actionable)-15} more')
"
    ;;

  status)
    python3 -c "
import json
from collections import Counter
with open('$JSON') as f: data = json.load(f)
gaps = data['gaps']
status_counts = Counter(g.get('status', 'open') for g in gaps)
cat_counts = Counter(g['category'] for g in gaps)

print('STATUS:')
for s, c in sorted(status_counts.items()):
    bar = '█' * c
    print(f'  {s:>12}: {c:2d} {bar}')
print(f'  {\"TOTAL\":>12}: {len(gaps)}')

print(f'\nBY CATEGORY:')
for cat, c in sorted(cat_counts.items()):
    done = sum(1 for g in gaps if g['category'] == cat and g.get('status') == 'completed')
    print(f'  {cat:>16}: {done}/{c} done')

# Show blocking chain status
blockers = [g for g in gaps if g.get('blocks') and g.get('status', 'open') != 'completed']
if blockers:
    print(f'\nBLOCKING GAPS (not yet done):')
    for g in blockers:
        print(f'  {g[\"id\"]:>10} blocks {len(g[\"blocks\"])} gaps: {\"  \".join(g[\"blocks\"])}')
"
    ;;

  category|cat)
    CAT="${2:-}"
    if [ -z "$CAT" ]; then
      echo "Usage: tracker.sh category [orchestration|type_safety|error_handling|testing|operational|logging|documentation]"
      exit 1
    fi
    python3 -c "
import json
with open('$JSON') as f: data = json.load(f)
gaps = [g for g in data['gaps'] if g['category'] == '$CAT']
if not gaps:
    print(f'No gaps found for category: $CAT')
    print('Valid: orchestration, type_safety, error_handling, testing, operational, logging, documentation')
else:
    gaps.sort(key=lambda g: g['wsjf']['score'], reverse=True)
    print(f'{\"$CAT\".upper()} ({len(gaps)} gaps):')
    print(f'{\"ID\":>10} {\"WSJF\":>6} {\"Sev\":>3} {\"Status\":>10} Title')
    print('-' * 80)
    for g in gaps:
        st = g.get('status', 'open')
        print(f'{g[\"id\"]:>10} {g[\"wsjf\"][\"score\"]:6.2f} {g[\"severity\"]:>3} {st:>10} {g[\"title\"]}')
"
    ;;

  detail)
    GAP_ID="${2:-}"
    if [ -z "$GAP_ID" ]; then
      echo "Usage: tracker.sh detail [GAP_ID]"
      exit 1
    fi
    python3 -c "
import json
with open('$JSON') as f: data = json.load(f)
gap = next((g for g in data['gaps'] if g['id'] == '$GAP_ID'), None)
if not gap:
    print(f'Gap not found: $GAP_ID')
else:
    s = gap['wsjf']
    print(f'Gap: {gap[\"id\"]} - {gap[\"title\"]}')
    print(f'Category: {gap[\"category\"]}')
    print(f'Severity: {gap[\"severity\"]}  Impact: {gap[\"impact\"]}  Files: {gap[\"files_affected\"]}')
    print(f'Status: {gap.get(\"status\", \"open\")}')
    print(f'Detail: {gap[\"detail_file\"]}')
    print()
    print(f'WSJF Score: {s[\"score\"]:.2f}')
    print(f'  Usability:  {s[\"usability_value\"]:2d}/10  (Can users get stuff done?)')
    print(f'  Wiring:     {s[\"wiring_impact\"]:2d}/10  (Connects unconnected modules?)')
    print(f'  Security:   {s[\"security_risk\"]:2d}/10  (Closes vulnerability?)')
    print(f'  Time Crit:  {s[\"time_criticality\"]:2d}/10  (Blocks other work?)')
    print(f'  Job Size:   {s[\"job_size\"]:2d}/10  (Complexity for AI agent)')
    print()
    if gap.get('blocks'):
        print(f'BLOCKS: {\", \".join(gap[\"blocks\"])}')
    if gap.get('blocked_by'):
        print(f'BLOCKED BY: {\", \".join(gap[\"blocked_by\"])}')
    if gap.get('claimed_by'):
        print(f'Claimed by: {gap[\"claimed_by\"]}')
"
    ;;

  claim)
    GAP_ID="${2:-}"
    if [ -z "$GAP_ID" ]; then
      echo "Usage: AGENT_NAME=my-agent tracker.sh claim [GAP_ID]"
      exit 1
    fi
    python3 -c "
import json
with open('$JSON') as f: data = json.load(f)
gap = next((g for g in data['gaps'] if g['id'] == '$GAP_ID'), None)
if not gap:
    print(f'Gap not found: $GAP_ID'); exit(1)
if gap.get('status') == 'in_progress':
    print(f'Already claimed by: {gap.get(\"claimed_by\", \"unknown\")}'); exit(1)
if gap.get('status') == 'completed':
    print(f'Already completed'); exit(1)

# Check blockers
completed = {g['id'] for g in data['gaps'] if g.get('status') == 'completed'}
blockers = [b for b in gap.get('blocked_by', []) if b not in completed]
if blockers:
    print(f'BLOCKED by: {\", \".join(blockers)}')
    print('Complete those first.'); exit(1)

gap['status'] = 'in_progress'
gap['claimed_by'] = '$AGENT'
with open('$JSON', 'w') as f: json.dump(data, f, indent=2)
print(f'Claimed {gap[\"id\"]} for $AGENT')
print(f'Detail file: {gap[\"detail_file\"]}')
"
    ;;

  done)
    GAP_ID="${2:-}"
    if [ -z "$GAP_ID" ]; then
      echo "Usage: tracker.sh done [GAP_ID]"
      exit 1
    fi
    python3 -c "
import json
with open('$JSON') as f: data = json.load(f)
gap = next((g for g in data['gaps'] if g['id'] == '$GAP_ID'), None)
if not gap:
    print(f'Gap not found: $GAP_ID'); exit(1)

gap['status'] = 'completed'
with open('$JSON', 'w') as f: json.dump(data, f, indent=2)

# Check what this unblocks
unblocked = []
completed = {g['id'] for g in data['gaps'] if g.get('status') == 'completed'}
for g in data['gaps']:
    if g.get('status', 'open') != 'open': continue
    blockers = [b for b in g.get('blocked_by', []) if b not in completed]
    if not blockers and g.get('blocked_by'):
        unblocked.append(g)

print(f'Completed: {gap[\"id\"]}')
if unblocked:
    print(f'UNBLOCKED:')
    for g in unblocked:
        print(f'  {g[\"id\"]:>10} WSJF={g[\"wsjf\"][\"score\"]:.2f}  {g[\"title\"][:50]}')
"
    ;;

  blocked)
    python3 -c "
import json
with open('$JSON') as f: data = json.load(f)
completed = {g['id'] for g in data['gaps'] if g.get('status') == 'completed'}
print('BLOCKED GAPS:')
for g in data['gaps']:
    if g.get('status', 'open') != 'open': continue
    blockers = [b for b in g.get('blocked_by', []) if b not in completed]
    if blockers:
        print(f'  {g[\"id\"]:>10} waiting on: {\", \".join(blockers)}')
"
    ;;

  deps)
    GAP_ID="${2:-}"
    if [ -z "$GAP_ID" ]; then
      echo "Usage: tracker.sh deps [GAP_ID]"
      exit 1
    fi
    python3 -c "
import json
with open('$JSON') as f: data = json.load(f)
lookup = {g['id']: g for g in data['gaps']}
gap = lookup.get('$GAP_ID')
if not gap:
    print(f'Gap not found: $GAP_ID'); exit(1)

def print_tree(gid, depth=0, visited=None):
    if visited is None: visited = set()
    if gid in visited: return
    visited.add(gid)
    g = lookup.get(gid)
    if not g: return
    st = g.get('status', 'open')
    marker = '✓' if st == 'completed' else '→' if st == 'in_progress' else '○'
    print(f'{\"  \" * depth}{marker} {gid} ({g[\"severity\"]}, WSJF={g[\"wsjf\"][\"score\"]:.1f}) {g[\"title\"][:40]}')
    for child in g.get('blocks', []):
        print_tree(child, depth + 1, visited)

print(f'Dependency tree for {gap[\"id\"]}:')
# Show what blocks this gap
if gap.get('blocked_by'):
    print(f'Blocked by:')
    for b in gap['blocked_by']:
        bg = lookup.get(b)
        if bg:
            st = bg.get('status', 'open')
            marker = '✓' if st == 'completed' else '○'
            print(f'  {marker} {b} - {bg[\"title\"][:50]}')
    print()

print(f'Blocks (downstream):')
print_tree('$GAP_ID')
"
    ;;

  stream|streams)
    python3 -c "
import json
with open('$JSON') as f: data = json.load(f)
gaps = data['gaps']
completed = {g['id'] for g in gaps if g.get('status') == 'completed'}

# Define streams
streams = {
    'A: Orchestration': ['ORCH-10', 'ORCH-01', 'ORCH-02', 'ORCH-03', 'ORCH-04', 'ORCH-06', 'ORCH-07', 'ORCH-08', 'ORCH-09', 'ORCH-05', 'ORCH-11'],
    'B: Error Handling': ['ERR-01', 'ERR-02', 'ERR-03', 'ERR-04', 'ERR-05', 'ERR-06'],
    'C: Operations': ['OPS-01', 'OPS-02', 'OPS-03', 'OPS-04', 'OPS-05'],
    'D: Testing': ['TEST-01', 'TEST-02', 'TEST-03', 'TEST-04', 'TEST-05', 'TEST-06', 'TEST-07'],
    'E: Type Safety': ['TYPE-01', 'TYPE-02', 'TYPE-03', 'TYPE-04', 'TYPE-05', 'TYPE-06', 'TYPE-07', 'TYPE-08'],
    'F: Logging + Docs': ['LOG-01', 'LOG-02', 'LOG-03', 'LOG-04', 'DOC-01', 'DOC-02', 'DOC-03', 'DOC-04', 'DOC-05'],
}

lookup = {g['id']: g for g in gaps}
for stream_name, ids in streams.items():
    stream_gaps = [lookup[gid] for gid in ids if gid in lookup]
    done = sum(1 for g in stream_gaps if g.get('status') == 'completed')
    total = len(stream_gaps)
    bar = '█' * done + '░' * (total - done)
    print(f'\n{stream_name} [{done}/{total}] {bar}')
    for g in stream_gaps:
        st = g.get('status', 'open')
        blockers = [b for b in g.get('blocked_by', []) if b not in completed]
        if st == 'completed':
            marker = '  ✓'
        elif st == 'in_progress':
            marker = '  →'
        elif blockers:
            marker = '  ⏳'
        else:
            marker = '  ○'
        suffix = f' (waiting: {\", \".join(blockers)})' if blockers else ''
        print(f'{marker} {g[\"id\"]:>10} {g[\"wsjf\"][\"score\"]:5.2f} {g[\"title\"][:45]}{suffix}')
"
    ;;

  release)
    python3 -c "
import json
with open('$JSON') as f: data = json.load(f)
gaps = data['gaps']
gate = [g for g in gaps if g.get('release_gate')]
done = [g for g in gate if g.get('status') == 'completed']
remaining = [g for g in gate if g.get('status') != 'completed']

total = len(gate)
done_n = len(done)
bar = '█' * done_n + '░' * (total - done_n)

print(f'RELEASE GATE: {done_n}/{total} [{bar}]')
print()

if remaining:
    # Sort by dependency order: unblocked first, then WSJF
    completed_ids = {g['id'] for g in gaps if g.get('status') == 'completed'}
    unblocked = []
    blocked = []
    for g in remaining:
        blockers = [b for b in g.get('blocked_by', []) if b not in completed_ids]
        if blockers:
            blocked.append((g, blockers))
        else:
            unblocked.append(g)

    unblocked.sort(key=lambda g: g['wsjf']['score'], reverse=True)

    if unblocked:
        print('ACTIONABLE NOW:')
        for g in unblocked:
            st = g.get('status', 'open')
            marker = '→' if st == 'in_progress' else '○'
            claimed = f' [{g[\"claimed_by\"]}]' if g.get('claimed_by') else ''
            print(f'  {marker} {g[\"id\"]:>10} WSJF={g[\"wsjf\"][\"score\"]:5.2f}  {g[\"title\"][:45]}{claimed}')

    if blocked:
        print(f'\nWAITING ON DEPENDENCIES:')
        for g, blockers in blocked:
            print(f'  ⏳ {g[\"id\"]:>10} WSJF={g[\"wsjf\"][\"score\"]:5.2f}  waiting: {\", \".join(blockers)}')

if done:
    print(f'\nCOMPLETED:')
    for g in done:
        print(f'  ✓ {g[\"id\"]:>10}  {g[\"title\"][:50]}')

if not remaining:
    print()
    print('🚀 ALL RELEASE GATE GAPS CLOSED — READY TO SHIP')
"
    ;;

  *)
    echo "Zora Gaps Tracker"
    echo ""
    echo "Usage: ./gaps/tracker.sh [command]"
    echo ""
    echo "Commands:"
    echo "  board              Full board (WSJF-ranked)"
    echo "  next               Next actionable gaps (unblocked, highest WSJF)"
    echo "  release            Release gate progress (12 must-close gaps)"
    echo "  status             Summary counts"
    echo "  category [cat]     Gaps for a category"
    echo "  detail [ID]        Full detail for a gap"
    echo "  claim [ID]         Claim a gap (set AGENT_NAME env var)"
    echo "  done [ID]          Mark gap completed"
    echo "  blocked            Show dependency-blocked gaps"
    echo "  deps [ID]          Dependency tree for a gap"
    echo "  stream             Parallel work streams with progress"
    echo ""
    echo "Environment:"
    echo "  AGENT_NAME         Your agent name (for claim tracking)"
    ;;
esac
