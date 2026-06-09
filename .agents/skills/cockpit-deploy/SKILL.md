---
name: cockpit-deploy
description: Use whenever making ANY change to Tech/CEO-Cockpit — every edit must be committed and pushed to origin/main immediately so Vercel deploys to production. Never stage changes and wait.
---

# CEO Cockpit — Always Deploy Immediately

## The Rule

**Every change to `Tech/CEO-Cockpit/` must be committed and pushed to `origin/main` before the task is considered complete.**

No exceptions. No "I'll push later." The commit and push are part of the task, not a separate step.

## Why

Vercel auto-deploys from `origin/main`. Until you push, the change doesn't exist in production. Mert works with the live Cockpit daily — uncommitted changes are invisible to him.

## Workflow

After every Cockpit edit:

```bash
# 1. Stage only the files you changed
git add Tech/CEO-Cockpit/path/to/changed/file.ts

# 2. Commit with a clear message
git commit -m "$(cat <<'EOF'
feat/fix/chore(scope): what changed and why

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"

# 3. Push immediately — this triggers Vercel deploy
git push origin main
```

## Commit Message Convention

Follow the existing pattern in `git log`:
- `feat(component):` — new feature or UI addition
- `fix(component):` — bug fix or correction
- `chore:` — config, cleanup, renaming

## What Counts as a Cockpit Change

Any file under `Tech/CEO-Cockpit/` — pages, hooks, API routes, components, lib, constants. If you touched it, push it.

## Red Flags

**Never:**
- Stage changes and wait for user to ask you to push
- Say "changes are ready, just push when you want"
- Commit but not push (Vercel doesn't see commits until pushed)
- Push other unrelated unstaged changes along with Cockpit changes — stage only the files you changed

**Always:**
- Push in the same turn you made the change
- Confirm push succeeded before reporting the task done
- Note the Vercel deploy will take ~1 min after push
