---
name: upstream-check
version: 1.0.0
description: >
  Check how far behind this fork is from upstream and flag any incoming commits
  that touch our custom integration files. Use before syncing to understand
  what's coming in. Invoke with /upstream-check.
allowed-tools:
  - Bash
---

# Upstream Check

Run this first. Tells you exactly what's coming in from upstream before you touch anything.

## Step 1 — Identify this repo

```bash
REMOTE=$(git remote get-url upstream 2>/dev/null || echo "none")
REPO_NAME=$(basename "$(git rev-parse --show-toplevel 2>/dev/null)")
BRANCH=$(git symbolic-ref --short HEAD 2>/dev/null)
echo "Repo: $REPO_NAME"
echo "Branch: $BRANCH"
echo "Upstream: $REMOTE"
```

If upstream remote is `none`, stop and tell the user: "No upstream remote configured. Run: `git remote add upstream <url>`"

## Step 2 — Fetch upstream silently

```bash
git fetch upstream --quiet 2>/dev/null
```

## Step 3 — How far behind?

```bash
UPSTREAM_BRANCH=$(git rev-parse --abbrev-ref upstream/HEAD 2>/dev/null | sed 's|upstream/||' || echo "main")
BEHIND=$(git rev-list HEAD..upstream/$UPSTREAM_BRANCH --count)
AHEAD=$(git rev-list upstream/$UPSTREAM_BRANCH..HEAD --count)
UPSTREAM_SHA=$(git rev-parse --short upstream/$UPSTREAM_BRANCH)

echo "Behind upstream: $BEHIND commits"
echo "Ahead of upstream (our custom commits): $AHEAD commits"
echo "Upstream HEAD: $UPSTREAM_SHA"
```

If `BEHIND` is 0: tell the user "Already in sync with upstream. Nothing to do." and stop.

## Step 4 — List incoming commits

```bash
git log HEAD..upstream/$UPSTREAM_BRANCH --oneline --no-merges
```

Show these to the user clearly.

## Step 5 — Flag risky commits

Detect which incoming commits touch our custom integration files. These need human review before merging.

```bash
# Determine which paths are custom based on repo
if echo "$REMOTE" | grep -q "paperclip"; then
  CUSTOM_PATHS="packages/adapters/openclaw-gateway packages/integrations cli/src/commands/onboard.ts"
elif echo "$REMOTE" | grep -q "openclaw"; then
  CUSTOM_PATHS="extensions/paperclip-orchestration src/agents/pi-embedded-runner/run/attempt.ts src/gateway/protocol/index.ts"
else
  CUSTOM_PATHS=""
fi

echo "Checking incoming commits for changes to custom files..."
RISKY=""
for COMMIT in $(git log HEAD..upstream/$UPSTREAM_BRANCH --format="%H" --no-merges); do
  SHORT=$(git rev-parse --short $COMMIT)
  MSG=$(git log -1 --format="%s" $COMMIT)
  for PATH in $CUSTOM_PATHS; do
    if git diff-tree --no-commit-id -r --name-only $COMMIT | grep -q "^$PATH"; then
      RISKY="$RISKY\n⚠️  $SHORT $MSG  →  touches $PATH"
      break
    fi
  done
done

if [ -n "$RISKY" ]; then
  echo -e "\nRisky commits (touch our custom files):\n$RISKY"
else
  echo -e "\nNo incoming commits touch our custom files. Safe to auto-merge."
fi
```

## Step 6 — Verdict

Based on the above, give the user one of these verdicts:

**SAFE** — No risky commits. Tell them: "Run /upstream-sync to merge automatically."

**REVIEW NEEDED** — Risky commits exist. List each one with the file it touches and tell them: "Review these commits first, then run /upstream-sync. If conflicts occur, /upstream-resolve will guide you through."

**MAJOR CHANGE** — If more than 20 commits are incoming, flag it: "Large upstream drop ($BEHIND commits). Recommend reviewing the upstream changelog before syncing."
