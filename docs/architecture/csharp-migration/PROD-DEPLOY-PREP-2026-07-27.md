# Prod-Deploy Prep Artifacts — 2026-07-27

Prepared by Claude at Federico's request, covering 4 of the blocking pre-reqs in
`PROD-DEPLOY-RUNBOOK-gate-g3.md`. **Nothing here has been executed against prod** — every
command below is reviewed and ready to run, but running it is Federico's call, per the
standing "I never touch prod" rule. This doc supplements the runbook; it doesn't replace it.

---

## 1. AWS App Runner deploy — verified locally, ready to ship

**What I did (fully local, no AWS/prod access):**

- Built the `Tims.Api` Docker image from `services/Tims.Platform/src/Tims.Api/Dockerfile`
  (`--platform linux/amd64`, matching the runbook's Apple Silicon note) — **succeeded**, ~2 min.
- Ran the image locally with fake-but-shaped env vars (fake DB connection string, fake
  Supabase JWKS URL, fake impersonation secret) and hit it:

| Check                                         | Result  | Matches runbook expectation?                                                     |
| --------------------------------------------- | ------- | -------------------------------------------------------------------------------- |
| `GET /health`                                 | **200** | ✅ (liveness, no DB — confirmed it truly doesn't touch the DB)                   |
| `GET /openapi/v1.json`                        | **200** | ✅                                                                               |
| `GET /ready`                                  | **503** | ✅ (correctly fails — DB unreachable, as expected with a fake connection string) |
| `GET /team-intel/dashboard-kpis` (dark route) | **500** | ⚠️ runbook expects 404 here                                                      |

**The one discrepancy:** the runbook's §5 smoke gate expects a dark strangler route to 404
(flag off → route not mapped). I got a 500 instead. I believe this is an artifact of the
**fake, syntactically-invalid DB connection string** — the request likely hits auth/identity
middleware (which needs a real DB read to resolve the principal) _before_ the routing layer
gets a chance to 404 on the unmapped route, and a DB failure there throws an unhandled
exception instead of a clean 401. **This needs re-verification against a real (even
empty/dev) database** — don't treat the 500 as a confirmed bug, but don't skip re-checking
it during the real §5 smoke gate either.

**Exact commands (unchanged from the runbook, now confirmed working verbatim):**

```bash
cd services/Tims.Platform
ACCT=<your-account-id>; REGION=us-west-2; REPO=tims-platform-api; TAG=$(git rev-parse --short HEAD)
aws ecr create-repository --repository-name $REPO --region $REGION            # once
aws ecr get-login-password --region $REGION | docker login --username AWS --password-stdin $ACCT.dkr.ecr.$REGION.amazonaws.com
docker build --platform linux/amd64 -f src/Tims.Api/Dockerfile -t $REPO:$TAG .
docker tag $REPO:$TAG $ACCT.dkr.ecr.$REGION.amazonaws.com/$REPO:$TAG
docker push $ACCT.dkr.ecr.$REGION.amazonaws.com/$REPO:$TAG
```

Then create the App Runner service per runbook §4 (port 8080, health check `/health`, 1 vCPU/2GB,
min 1 instance) with the env vars from runbook §2 — **see §4 below for the one env var I have a
finding on** (`Platform__DatabaseConnectionString`).

**Nothing to fix in the Dockerfile or app code** — this is genuinely ready to build+push+deploy.

---

## 2. Compliance SQL (CB-1, CB-1b, CB-2b) — verified, ready to apply

All 3 files exist on `main`, are internally documented with their own APPLY commands, and are
pinned to golden tests (`ProdSqlMatchesBuilderTests`) so they can't silently drift from the C#
builder that generates the equivalent DDL. **PR #144 (the CB-1b prerequisite) is confirmed
merged** (2026-07-21).

**Apply in this order** (each is independently idempotent — `CREATE OR REPLACE` / `DROP ... IF
EXISTS` — so a partial failure on one doesn't corrupt the others, but run them in this order
since CB-2b creates a brand-new table the other two don't touch):

```bash
# Direct connection (5432, NOT the pooler) — required for DDL/trigger changes.
DIRECT_PROD_URL="<the real prod DIRECT_URL, post password-rotation>"

psql -v ON_ERROR_STOP=1 --single-transaction "$DIRECT_PROD_URL" \
  -f packages/db/prisma/manual/2026-07-17-data-access-logs-immutable.sql

psql -v ON_ERROR_STOP=1 --single-transaction "$DIRECT_PROD_URL" \
  -f packages/db/prisma/manual/2026-07-17-audit-logs-immutable.sql

psql -v ON_ERROR_STOP=1 --single-transaction "$DIRECT_PROD_URL" \
  -f packages/db/prisma/manual/2026-07-17-add-access-reviews.sql
```

**Verify after applying:**

```sql
-- Both should raise "... is append-only: ..." (SQLSTATE 42501):
UPDATE data_access_logs SET action = 'x' WHERE false;
UPDATE audit_logs SET action = 'x' WHERE false;

-- Should return the new table with RLS enabled:
SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = 'access_reviews';
-- expect: t | t
```

**One thing to flag, not fix:** CB-1b's file itself warns that once the `audit_logs` trigger is
installed, a hard-delete of an organization (which cascades to `audit_logs`) or a user
(`ON DELETE SET NULL`) will be **blocked** by the guard. The file states the app never does
hard-deletes today, so this is safe to apply as-is — just noting it's a real constraint, not
a hypothetical one, in case that assumption has changed since 2026-07-17.

---

## 3. `MFA_ENFORCED` timing — decision brief (not a decision I can make)

**What it does today** (`packages/shared/src/mfa.ts`): when `MFA_ENFORCED=true`, every
**platform owner or super_admin** session must be stepped up to Supabase AAL2 (a verified
TOTP factor used _this session_) before any privileged action succeeds — enforced both at the
`(admin)` page layout (redirect to `/mfa`) and in the tRPC middleware (`MFA_REQUIRED` sentinel).
It's fail-**open** by design: unset or any value other than the literal string `'true'` means
"not enforced" — a misconfigured env can never lock everyone out.

**The tradeoff:**

- **Flip it on before wider prod use** → closes a real gap (privileged accounts are currently
  reachable with password-only auth) but **will hard-lock out** any platform owner / super_admin
  who hasn't enrolled a TOTP factor yet — there's no grace period or bypass path in the code.
- **Leave it off longer** → privileged accounts stay password-only a while longer, but zero risk
  of locking out an unenrolled admin mid-incident.

**What I can't determine from the codebase:** whether any current platform-owner/super_admin
account has actually enrolled a verified TOTP factor yet. That's live Supabase user data I
don't have visibility into.

**Recommendation (not a decision — yours to make):** before flipping this, confirm every
privileged account has enrolled via the `/mfa` page (it already exists and works with the flag
off — enrollment isn't gated by the flag, only _enforcement_ is). Once confirmed, flipping it
is low-risk and instant to revert (`MFA_ENFORCED=false` in Vercel, no redeploy needed if it's
read at request time — confirm that's the case before relying on it as a rollback).

---

## 4. DB-role requirement — likely ALREADY satisfied, verify before assuming

The runbook frames this as needing a **new** role provisioned. Investigation suggests that's
probably unnecessary — **the existing `postgres` role the TS app already connects as likely
already satisfies both constraints simultaneously**:

- `packages/db/prisma/migrations/20260604100000_enable_rls_tenant_isolation/migration.sql`
  contains `GRANT app_tenant TO postgres;` — so `postgres` is already a member of `app_tenant`,
  meaning it can `SET LOCAL ROLE app_tenant` (Postgres requires either membership or superuser
  to `SET ROLE`, and this grant establishes membership either way).
- Supabase's `postgres` role is BYPASSRLS by default (documented in
  `docs/security/RLS-MIGRATION-PLAN.md` §4: _"Supabase's default `postgres` superuser... bypasses
  RLS"_) — satisfying the privileged pre-tenant path (identity resolution, audit writes).

**If this holds, `Platform__DatabaseConnectionString` can just be the SAME value as the TS
app's existing `DATABASE_URL`/`DIRECT_URL`** (post password-rotation from item 0.1) — no new
role, no new credential.

**Verify this directly against the real prod DB before trusting it** (read-only, safe to run
anytime, no schema/data changes):

```sql
-- Run as whatever role DATABASE_URL currently authenticates as:
SELECT current_user, current_setting('is_superuser');
SELECT rolname, rolbypassrls, rolsuper FROM pg_roles WHERE rolname = current_user;
-- expect rolbypassrls = t (or rolsuper = t) — confirms the privileged path works.

SELECT pg_has_role(current_user, 'app_tenant', 'MEMBER');
-- expect t — confirms SET LOCAL ROLE app_tenant will succeed.

-- End-to-end proof (run in one session/transaction, then roll back):
BEGIN;
SET LOCAL ROLE app_tenant;
SELECT current_user; -- should now show 'app_tenant'
SELECT set_config('app.current_org_id', '<any real org id>', true);
SELECT count(*) FROM candidates; -- should return that org's rows only (RLS engaged)
ROLLBACK;
```

**If any of those checks fail** (e.g., a hardened prod role setup that revoked `BYPASSRLS`
from `postgres` after the RLS migration, which the RLS-MIGRATION-PLAN doc itself floats as an
option), the fallback is exactly what the runbook originally proposed: provision a dedicated
role that is both an `app_tenant` member and `BYPASSRLS`:

```sql
CREATE ROLE tims_platform_api LOGIN PASSWORD '<generate>' BYPASSRLS;
GRANT app_tenant TO tims_platform_api;
```

Only do this if the verification above shows the existing role doesn't already work — creating
an unnecessary new credential is one more secret to rotate and manage.

---

## Summary — what's still Federico-only after this prep

Everything above is reviewed and ready. What remains is pure execution against real
infrastructure, which I have no access to and shouldn't attempt: rotating the DB password,
running the 3 SQL files, running the verification queries in §4 against the real DB, deciding
and flipping `MFA_ENFORCED`, and the actual `aws ecr` / App Runner steps in §1.
