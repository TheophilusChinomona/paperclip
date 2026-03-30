---
name: upstream-resolve
version: 1.0.0
description: >
  Resolve upstream merge conflicts file by file. Accepts upstream changes for
  non-custom files automatically. Walks through custom integration files carefully
  with diffs. Run after /upstream-sync reports conflicts. Invoke with /upstream-resolve.
allowed-tools:
  - Bash
  - Read
  - Edit
---

# Upstream Resolve

Resolves merge conflicts after a failed /upstream-sync. Two categories:
- **Non-custom files** → accept upstream version automatically (their code, not ours)
- **Custom files** → show the diff, resolve hunk by hunk carefully

## Step 1 — Verify we're in a conflict state

```bash
MERGE_HEAD=$(cat .git/MERGE_HEAD 2>/dev/null || echo "none")
echo "MERGE_HEAD: $MERGE_HEAD"
```

If `MERGE_HEAD` is `none`: tell the user "No merge in progress. Run /upstream-sync first." Stop.

## Step 2 — Identify the repo and custom paths

```bash
REMOTE=$(git remote get-url upstream 2>/dev/null || echo "none")

if echo "$REMOTE" | grep -q "paperclip"; then
  CUSTOM_PATHS="packages/adapters/openclaw-gateway packages/integrations cli/src/commands/onboard.ts"
  REPO="paperclip"
elif echo "$REMOTE" | grep -q "openclaw"; then
  CUSTOM_PATHS="extensions/paperclip-orchestration src/agents/pi-embedded-runner/run/attempt.ts src/gateway/protocol/index.ts"
  REPO="openclaw"
else
  CUSTOM_PATHS=""
  REPO="unknown"
fi

echo "Repo: $REPO"
echo "Protected paths: $CUSTOM_PATHS"
```

## Step 3 — List all conflicted files

```bash
CONFLICTS=$(git diff --name-only --diff-filter=U)
echo "Conflicted files:"
echo "$CONFLICTS"
```

Categorise each file:
- Is it under one of the `CUSTOM_PATHS`? → **custom** (needs careful review)
- Everything else → **upstream** (safe to accept theirs)

Show the user a clear table: file | category | action.

## Step 4 — Resolve non-custom files automatically

For each **upstream** file:

```bash
git checkout --theirs -- <file>
git add <file>
echo "✅ Accepted upstream: <file>"
```

Do this in a loop for all non-custom conflicts. Do not prompt the user for each one — just do it and report the list at the end.

## Step 5 — Resolve custom files carefully

For each **custom** file, one at a time:

1. Show the user the full conflict diff:
```bash
git diff <file>
```

2. Read the file with the Read tool so you can see the conflict markers clearly.

3. For each conflict hunk (`<<<<<<< HEAD` ... `=======` ... `>>>>>>> upstream`):
   - Show the user: **our version** vs **upstream version**
   - For logic that is purely our custom integration: keep ours
   - For logic that upstream changed in areas we don't own: accept theirs
   - If both sides changed the same area: merge the intent of both, favouring our custom logic

4. Use the Edit tool to write the resolved version (no conflict markers).

5. Stage the file:
```bash
git add <file>
```

6. Confirm to the user: "Resolved `<file>` — kept our [describe what] + accepted upstream [describe what]."

## Step 6 — Complete the merge

Once all conflicts are resolved:

```bash
# Verify no conflicts remain
REMAINING=$(git diff --name-only --diff-filter=U)
echo "Remaining conflicts: ${REMAINING:-none}"
```

If none remain:

```bash
UPSTREAM_SHA=$(git rev-parse --short MERGE_HEAD)
git commit --no-edit -m "chore: sync upstream @ $UPSTREAM_SHA (manual conflict resolution)"
```

Then push:

```bash
BRANCH=$(git symbolic-ref --short HEAD)
git push origin $BRANCH
```

Tell the user: "✅ Conflict resolution complete. Merged and pushed to origin/$BRANCH."

## Step 7 — Post-resolve check

Run a quick sanity check:

```bash
# Confirm our custom files are intact
for PATH in $CUSTOM_PATHS; do
  if [ -e "$PATH" ]; then
    echo "✅ $PATH — present"
  else
    echo "⚠️  $PATH — MISSING (may have been deleted by upstream)"
  fi
done
```

If any custom path is missing, alert the user immediately — this means upstream deleted or moved a file we depend on and we need to recreate it.
