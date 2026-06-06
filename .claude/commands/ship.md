---
description: Ship the current change — branch, commit, PR, gate, merge, deploy to Vercel prod, smoke test
allowed-tools:
  - Bash
  - Skill
---

# /ship — Branch → PR → Gate → Merge → Deploy → Smoke

Take the current working-tree change all the way to production, gated at every step.

## Execution Contract (non-negotiable)

You MUST complete the steps in order and stop at the first gate failure. You are forbidden from:

- Merging before the gate verdict is in (CI green when Actions works; full local `/gate` PASS when it doesn't)
- Committing directly to `main` — always a branch + PR, even for one-line changes
- Deploying from any directory other than the repo ROOT (deploying from `apps/web` breaks workspace deps)
- Skipping the smoke test or declaring "shipped" without it
- Force-pushing, `--no-verify`, or amending published commits

**Fail-closed guardrail**: if any step fails (gate, merge, deploy, smoke), STOP and report exactly what failed and what state the branch/PR/deployment is in. Do not improvise recovery without asking.

## Steps

### 1. Branch + Commit
If on `main`, create a branch first (`feat/...`, `fix/...`, `refactor/...`, `chore/...` per CLAUDE.md §10). Commit with a conventional message (`feat(scope): ...`).

### 2. Push + PR
```bash
git push -u origin <branch>
gh pr create --title "..." --body "..."
```

### 3. Gate
- Check whether GitHub Actions is healthy: `gh run list -L1` after the push.
  - **CI healthy** → wait for all 6 jobs green (`gh pr checks --watch`). That is the gate.
  - **CI down** (jobs fail in seconds with a billing/spending-limit annotation) → run the **full local gate instead**: invoke the `/gate` command and require **GATE PASSED**.
- A failed gate means: report failures, fix on the branch, re-gate. Never merge red.

### 4. Merge (squash)
```bash
gh pr merge --squash --delete-branch
git checkout main && git pull
```

### 5. Deploy — from repo ROOT
```bash
vercel deploy --prod --yes
```
- If Vercel returns a daily-quota error (Hobby 100/day), STOP: report that the merge is done but the deploy is quota-blocked, to retry when the quota resets. The alias step below is then also pending.
- Confirm the output shows `Aliased: https://tims-ats.vercel.app`. If it deployed but did not alias, run `vercel alias set <deployment-url> tims-ats.vercel.app`.

### 6. Smoke test
```bash
curl -s -o /dev/null -w "%{http_code}" https://tims-ats.vercel.app/login          # expect 200
curl -s -o /dev/null -w "%{http_code}" https://tims-ats.vercel.app/careers/tims-international  # expect 200
```
Anything other than 200/200 = FAILED ship. Report it; the previous deployment is still aliased only if the alias step didn't run — state which.

## Output

Report: branch, PR number + link, gate mode used (CI or local) + verdict, merge commit, deployment URL, smoke results.
