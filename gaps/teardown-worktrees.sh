#!/bin/bash
# Teardown git worktrees after implementation is complete
# Usage: ./gaps/teardown-worktrees.sh
#
# Removes all worktrees and optionally cleans up branches

set -e

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORKTREE_BASE="$HOME/Dev/zora-worktrees"

cd "$REPO_DIR"

echo "Current worktrees:"
git worktree list
echo ""

DIRS=("orchestration" "error-hardening" "ops" "quality")

for dir in "${DIRS[@]}"; do
  worktree_path="$WORKTREE_BASE/$dir"
  if [ -d "$worktree_path" ]; then
    echo "Removing worktree: $worktree_path"
    git worktree remove "$worktree_path" --force
  else
    echo "Not found (already removed?): $worktree_path"
  fi
done

# Prune stale references
git worktree prune

echo ""
echo "Remaining worktrees:"
git worktree list
echo ""
echo "Branches NOT deleted (merge via PR first, then delete):"
git branch | grep "fix/" || echo "  (none)"
echo ""
echo "Done. Use 'git branch -d <branch>' after merging PRs."
