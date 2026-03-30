---
name: upstream-sync
version: 1.0.0
description: >
  Fetch upstream, merge clean changes, and push automatically. Falls back to
  guided conflict resolution if there are conflicts. Run /upstream-check first
  to see what's coming in. Invoke with /upstream-sync.
allowed-tools:
  - Bash
---

# Upstream Sync

Merges upstream changes into your fork. Auto-pushes if clean. Hands off to /upstream-resolve if there are conflicts.

## Step 1 — Pre-flight

```bash
# Must be on the right branch with clean working tree
BRANCH=$(git symbolic-ref --short HEAD)
DIRTY=$(git status --porcelain)
REMOTE=$(git remote get-url upstream 2>/dev/null || echo "none")

echo "Branch: $BRANCH"
echo "Upstream: $REMOTE"
echo "Working tree: $([ -z "$DIRTY" ] && echo 'clean' || echo 'DIRTY')"
```

If working tree is dirty: tell the user to commit or stash their changes first. Stop.
If upstream remote is `none`: tell the user to run `git remote add upstream <url>`. Stop.

## Step 2 — Fetch upstream

```bash
git fetch upstream --quiet
UPSTREAM_BRANCH=$(git rev-parse --abbrev-ref upstream/HEAD 2>/dev/null | sed 's|upstream/||' || echo "main")
BEHIND=$(git rev-list HEAD..upstream/$UPSTREAM_BRANCH --count)
UPSTREAM_SHA=$(git rev-parse --short upstream/$UPSTREAM_BRANCH)
echo "$BEHIND commits behind upstream @ $UPSTREAM_SHA"
```

If `BEHIND` is 0: tell the user "Already in sync. Nothing to merge." and stop.

## Step 3 — Attempt merge

```bash
git -c user.name="upstream-sync" -c user.email="sync@local" \
  merge upstream/$UPSTREAM_BRANCH --no-edit \
  -m "chore: sync upstream @ $UPSTREAM_SHA"
MERGE_EXIT=$?
echo "Merge exit code: $MERGE_EXIT"
```

## Step 4a — Clean merge → push

If `MERGE_EXIT` is 0:

```bash
git push origin $BRANCH
```

Tell the user: "✅ Synced $BEHIND commits from upstream ($UPSTREAM_SHA). Pushed to origin/$BRANCH."

Then show a one-line summary of what changed:
```bash
git log --oneline -$BEHIND HEAD
```

Done. Stop here.

## Step 4b — Conflict → hand off

If `MERGE_EXIT` is not 0:

```bash
# Show what's conflicting
git diff --name-only --diff-filter=U
```

Tell the user clearly:
- How many files are conflicting
- Which ones are our custom files (need careful resolution) vs upstream files (safe to accept theirs)
- "Run /upstream-resolve to walk through each conflict file by file."

Do NOT abort the merge. Leave it in conflict state so /upstream-resolve can pick it up.
