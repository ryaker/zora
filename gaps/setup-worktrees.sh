#!/bin/bash
# Setup git worktrees for parallel agent implementation
# One worktree per agent stream, one branch per stream
#
# Usage: ./gaps/setup-worktrees.sh
#
# Creates:
#   ~/Dev/zora-worktrees/orchestration/    → fix/orchestration-gaps
#   ~/Dev/zora-worktrees/error-hardening/  → fix/error-handling-gaps
#   ~/Dev/zora-worktrees/ops/              → fix/ops-gaps
#   ~/Dev/zora-worktrees/quality/          → fix/quality-gaps

set -e

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORKTREE_BASE="$HOME/Dev/zora-worktrees"
BASE_BRANCH="main"

# Ensure we're in the repo
cd "$REPO_DIR"

# Fetch latest
echo "Fetching latest from origin..."
git fetch origin

# Ensure main is up to date
echo "Updating $BASE_BRANCH..."
git checkout $BASE_BRANCH 2>/dev/null && git pull origin $BASE_BRANCH || true

# Create worktree base directory
mkdir -p "$WORKTREE_BASE"

# Define streams: directory → branch name
declare -A STREAMS
STREAMS=(
  ["orchestration"]="fix/orchestration-gaps"
  ["error-hardening"]="fix/error-handling-gaps"
  ["ops"]="fix/ops-gaps"
  ["quality"]="fix/quality-gaps"
)

for dir in "${!STREAMS[@]}"; do
  branch="${STREAMS[$dir]}"
  worktree_path="$WORKTREE_BASE/$dir"

  if [ -d "$worktree_path" ]; then
    echo "Worktree already exists: $worktree_path (skipping)"
    continue
  fi

  echo ""
  echo "Creating worktree: $dir → $branch"

  # Create branch from main if it doesn't exist
  if git show-ref --verify --quiet "refs/heads/$branch" 2>/dev/null; then
    echo "  Branch $branch exists locally"
  elif git show-ref --verify --quiet "refs/remotes/origin/$branch" 2>/dev/null; then
    echo "  Branch $branch exists on remote, tracking"
    git branch --track "$branch" "origin/$branch" 2>/dev/null || true
  else
    echo "  Creating new branch $branch from $BASE_BRANCH"
    git branch "$branch" "$BASE_BRANCH"
  fi

  # Create worktree
  git worktree add "$worktree_path" "$branch"
  echo "  Created: $worktree_path"
done

echo ""
echo "=== Worktree Setup Complete ==="
echo ""
git worktree list
echo ""
echo "Each agent should cd into their worktree and run:"
echo "  cd $WORKTREE_BASE/<stream-name>"
echo "  ./gaps/tracker.sh next"
echo ""
echo "Streams:"
for dir in "${!STREAMS[@]}"; do
  echo "  $dir → $WORKTREE_BASE/$dir (branch: ${STREAMS[$dir]})"
done
