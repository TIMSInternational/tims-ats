# Deploy Scripts — Tims.Api Prod Deploy (Gate G3)

Reviewable, idempotent wrappers around the manual copy-paste bash commands in
[`docs/architecture/csharp-migration/PROD-DEPLOY-RUNBOOK-gate-g3.md`](../../docs/architecture/csharp-migration/PROD-DEPLOY-RUNBOOK-gate-g3.md).
These scripts do not invent a new deploy flow — each one scripts the runbook's
own commands exactly, made safe-by-default instead of copy-pasted by hand.

Sibling to [`scripts/parity/`](../parity/README.md) (the C#/TS parity harness);
same repo, different concern — parity verifies backend behavior, these scripts
operate the C# backend's first production deploy.

## Safety model (preflight-check.sh, build-and-push.sh, apply-compliance-sql.sh)

- **Dry-run by default.** Every script defaults to printing the exact commands
  it would run and does nothing else. No AWS call, no `docker push`, no
  database connection happens unless you explicitly opt in.
- **Explicit `--yes` required for anything real.** There is no way to trigger a
  real AWS/Docker/DB action by accident — `--yes` must be passed on the command
  line every time.
- **No credentials live in this repo or sandbox, ever.** `apply-compliance-sql.sh`
  reads `DIRECT_PROD_URL` from an environment variable only (never a CLI flag,
  to avoid shell-history/process-list leakage) and `build-and-push.sh` relies
  entirely on your ambient `aws` CLI credentials (profile/env/SSO) — neither
  script stores, prints, or hardcodes a secret.
- **Fail loud, fail early.** `build-and-push.sh` checks `aws sts
get-caller-identity` before doing anything else on a real run, so a missing
  or expired credential is caught in under a second instead of after a
  multi-minute Docker build.
- **These scripts are Federico-run for the `--yes` path** — same rule as the
  rest of the runbook ("I never touch prod" is Claude's side of that rule;
  Claude prepares/tests these scripts in dry-run only).

## The pre-deploy scripts (see cutover docs above for the flip/verify scripts)

### `preflight-check.sh`

Pure local, credential-free readiness check. Safe to run anywhere, any time,
including in an AI sandbox with no AWS/DB access. Checks:

1. `docker build` succeeds for `Tims.Api` and `Tims.Workers` (local Docker
   daemon + public MCR registry only — no AWS).
2. `terraform fmt -check` / `terraform validate` pass in
   `services/Tims.Platform/deploy/terraform/` (local static checks — no
   `plan`/`apply`, no state, no cloud calls).
3. The 2 EF migrations named in runbook §1 exist as files
   (`20260723032952_fx_rates`, `20260716000000_hris_domain`).
4. The 3 compliance SQL files named in runbook §0.2 exist under
   `packages/db/prisma/manual/`.
5. `scripts/parity/cli.ts` exists and its dependency graph resolves cleanly
   under `tsx` (module-load smoke test — no network/credentials needed).

Prints PASS/FAIL per check plus a summary; exits non-zero if anything fails.

```bash
scripts/deploy/preflight-check.sh
```

Run this **first**, and re-run it any time before a real deploy attempt.

### `build-and-push.sh`

Scripts runbook §3 (build + push the image to ECR) verbatim:

```bash
cd services/Tims.Platform
docker build --platform linux/amd64 -f src/Tims.Api/Dockerfile -t $REPO:$TAG .
docker tag $REPO:$TAG $ACCT.dkr.ecr.$REGION.amazonaws.com/$REPO:$TAG
docker push $ACCT.dkr.ecr.$REGION.amazonaws.com/$REPO:$TAG
```

Defaults: `--region us-west-2`, `--repo-name tims-platform-api` (matching the
Terraform variables of the same names), tag = short git SHA
(`git rev-parse --short HEAD`) — `--tag latest` is a hard error, since the
Terraform-managed ECR repo is `IMMUTABLE`-tagged.

```bash
# Safe default — prints the plan, does nothing:
scripts/deploy/build-and-push.sh --account-id 123456789012

# For real (Federico, after `terraform apply` has created the ECR repo):
scripts/deploy/build-and-push.sh --account-id 123456789012 --yes
```

**Note:** the runbook's one-time `aws ecr create-repository` step is
intentionally _not_ reproduced here — the Terraform module
(`services/Tims.Platform/deploy/terraform/main.tf`, `aws_ecr_repository.api`)
now owns the ECR repo. Run `terraform apply` (or at minimum
`-target=aws_ecr_repository.api`) before this script.

### `apply-compliance-sql.sh`

Scripts runbook §0.2 (the 3 pending compliance SQL files) verbatim, one
`psql -v ON_ERROR_STOP=1 --single-transaction` invocation per file, in order:

1. CB-1 — `2026-07-17-data-access-logs-immutable.sql`
2. CB-1b — `2026-07-17-audit-logs-immutable.sql`
3. CB-2b — `2026-07-17-add-access-reviews.sql`

Each file gets its own transaction (matching each file's own header comment
and the runbook), so a failure in file 2 cannot leave file 1's already-applied
change half-done.

```bash
# Safe default — prints the plan, opens no connection:
scripts/deploy/apply-compliance-sql.sh

# For real (Federico):
DIRECT_PROD_URL='postgres://...:5432/...' scripts/deploy/apply-compliance-sql.sh --yes
```

After each file, the script prints its verification step:

- CB-1 / CB-1b install an `ENABLE ALWAYS` append-only trigger. Verifying that
  means attempting a forbidden `UPDATE`/`DELETE`/`TRUNCATE` — this script does
  **not** do that automatically (an unattended script should not attempt real
  writes against an audit table, even ones expected to fail); it prints the
  exact `BEGIN; DELETE ...; ROLLBACK;` to run by hand.
- CB-2b only creates the `access_reviews` table + RLS policy (no append-only
  trigger), so its verification is a plain read-only
  `SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname =
'access_reviews'` — expect `t | t`.

## Order of operations (relative to the runbook + Terraform)

1. `scripts/deploy/preflight-check.sh` — any time, no creds needed.
2. Runbook §0.1 — rotate the DB password + update Vercel env (Federico, manual —
   out of scope for scripting; it's a one-time interactive credential rotation).
3. `scripts/deploy/apply-compliance-sql.sh --yes` — runbook §0.2 (optional,
   independent of the C# deploy, but recommended to clear early).
4. `terraform init && terraform validate && terraform plan` in
   `services/Tims.Platform/deploy/terraform/`, then
   `terraform apply -target=aws_ecr_repository.api` (or a full first `apply` —
   see that directory's own README) to create the ECR repo.
5. `scripts/deploy/build-and-push.sh --yes` — runbook §3, pushes the image
   Terraform's `image_tag` variable will reference.
6. `terraform apply` (full) — creates/updates the App Runner service pointing
   at the pushed tag (runbook §4).
7. Populate the Secrets Manager values out-of-band (`terraform output
secret_arns` + `aws secretsmanager put-secret-value`) — see
   `deploy/terraform/README.md`.
8. Runbook §5 — smoke gate (`/health`, `/ready`, `/openapi/v1.json`, a staff-JWT
   `/whoami`). Not scripted here (needs a minted Supabase JWT); still manual
   per the runbook.
9. Runbook §6 — per-surface cutover (FE-rewiring PRs + flag flips): use
   [`cutover.sh`](./cutover.sh) (see [`README-cutover.md`](./README-cutover.md))
   for the ~18 standard staff-JWT/browser-cookie read+write surfaces. For the
   3 domains with a different auth mechanism (external-vendor, billing-webhook,
   billing-self-serve), use
   [`cutover-external-vendor-read-verify.ts`](./cutover-external-vendor-read-verify.ts)
   together with
   [the special-domains runbook](../../docs/architecture/csharp-migration/cutover-special-domains.md) —
   those 3 are only partly scriptable by design; the doc is explicit about
   which pieces stay a manual, monitored procedure and why.

## What's deliberately NOT scripted here

- Runbook §0.1 (DB password rotation + Vercel env update) — one-time,
  interactive, credential-bearing; not a repeatable script.
- Runbook §0.3 (`MFA_ENFORCED` timing decision) — a judgment call, not a
  command.
- `terraform apply` itself — owned by `services/Tims.Platform/deploy/terraform/`
  directly; these scripts feed it (`image_tag`) but don't wrap it.
- Runbook §5 (smoke gate) and §6 (per-surface cutover) — need a minted staff
  JWT / live traffic decisions; out of scope for a credential-free script.
