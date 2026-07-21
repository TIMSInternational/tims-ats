# TIMS ATS — C# Backend First Prod Deploy (Gate G3) + Cutover Runbook

**Target:** AWS App Runner (us-west-2, co-located with the Supabase DB — hard latency constraint from #100).
**Prepared:** 2026-07-21. **Status:** ready for Federico execution.

> **Who runs what.** Everything in this runbook that touches PROD (AWS, secrets, prod DDL, DNS, feature-flag
> flips, deleting TS) is **Federico-run** — the standing migration rule (`I never touch prod`). Claude prepared
> this doc + the deploy artifacts, and does the per-surface FE-rewiring PRs (§6). Nothing here has been executed.

> **The big picture.** The C# backend has **never been deployed** — all strangler surfaces are dark code on
> `main`, and `services/Tims.Platform` is not part of the Vercel build. "Moving to production" = standing up the
> first C# service (this runbook), then cutting surfaces over one flag at a time. The live TS app is unaffected
> throughout and is the rollback target for every surface.

---

## 0. Blocking pre-reqs (clear BEFORE the C# deploy)
- [ ] **0.1 — 🔴 Rotate the leaked prod DB password** (leaked to a chat transcript during the 2026-07-20 qrtz
  apply) **+ update Vercel `DATABASE_URL`/`DIRECT_URL` in the SAME maintenance window** — resetting the password
  alone breaks the live TS app until Vercel env is updated. Do this first; the new password feeds §2.
- [ ] **0.2 — (recommended, independent of C#) apply the pending compliance prod SQL** (`psql -v ON_ERROR_STOP=1
  --single-transaction "<DIRECT_PROD_URL>" -f <file>`): merge **PR #144** then apply CB-1
  (`packages/db/prisma/manual/2026-07-17-data-access-logs-immutable.sql`), CB-1b
  (`2026-07-17-audit-logs-immutable.sql`), CB-2b (`2026-07-17-add-access-reviews.sql`). Verify UPDATE/DELETE/
  TRUNCATE raise "…is append-only". These are part of "everything to prod" but do NOT block the C# service.
- [ ] **0.3 — decide `MFA_ENFORCED` timing** (flip in Vercel after privileged users enroll a factor — TS-side, dark today).

---

## 1. Target architecture
- **ONE App Runner service first: `tims-platform-api`** (from an ECR image), us-west-2, port **8080**,
  liveness `/health`, readiness `/ready`, auto-scaling min 1. This serves ALL the strangler READ/WRITE surfaces
  (they need no new tables).
- **DEFER `tims-platform-workers`** (Quartz/HRIS) — blocked on BambooHR creds + Sprint-1.8 requirements; its
  clustered `qrtz_` store DDL is applied to prod but inert. Deploy it in a later step (§8), not now.
- **Egress:** App Runner default public egress → Supabase pooler (internet-facing). No VPC connector needed.
- **Secrets:** AWS Secrets Manager, bound to the service; the instance role grants read.
- **No new EF migration** is required for this deploy — every strangler surface is `efcoreReadOnly`/
  `efcoreStranglerWrite` over EXISTING Prisma tables. The only EF-owned migration (`20260716000000_hris_domain`)
  is for the deferred Workers/HRIS path (§8). `qrtz_` already applied.

---

## 2. Prod config — the `Platform:` env surface
App Runner env vars use `Platform__<Name>` (double-underscore = section nesting). All 9 flags default `false`;
set them explicitly `false` for the first deploy for auditability.

| Env var | Source | Required | Notes |
|---|---|---|---|
| `Platform__DatabaseConnectionString` | Supabase (post-0.1 rotation) | ✅ | **See the DB-ROLE requirement below — the #1 first-deploy risk.** |
| `Platform__RedisConnectionString` | Upstash | ⚠️ recommended | perm-cache + rate-limit; fail-soft if absent (degrades, doesn't crash). |
| `Platform__SupabaseJwtIssuer` | Supabase project | ✅ | e.g. `https://<ref>.supabase.co/auth/v1`. |
| `Platform__SupabaseJwtAudience` | — | default `authenticated` | leave default unless customized. |
| `Platform__SupabaseJwksMetadataAddress` | Supabase project | ✅ | JWKS URL — **must be asymmetric (RS256/JWKS), NOT legacy HS256** (deploy-verify below). |
| `Platform__ImpersonationSecret` | = the TS HMAC impersonation secret | ✅ (for impersonation) | **must byte-match** the TS value (shared signed cookie) or owner impersonation breaks. |
| `Platform__OtlpEndpoint` | observability backend | optional | OTel traces/metrics export. |
| `Platform__<Surface>Enabled` ×9 | — | set `false` | ExternalVendorRead/Write, BillingRead/Usage/WebhookWrite/SelfServe, ReportingRead, ValidationStaffWrite, TeamIntelRead. |
| `Stripe__SecretKey`, `Stripe__WebhookSecret` | Stripe | only before billing-write cutover | leave unset while billing writes are dark. |
| `ASPNETCORE_URLS` | — | preset in Dockerfile (`http://+:8080`) | do not override. |

### 🔴 DB-ROLE requirement (the #1 first-deploy risk — verify before §5 sign-off)
**Every** `DbContext` uses this single connection string (`Program.cs:110-274`), but they split into two paths:
- **Tenant path** (reporting/team-intel/billing-read/external reads, staff writes): each query is wrapped in
  `TenantScope` → `SET LOCAL ROLE app_tenant` + org GUC per transaction → RLS-scoped. Safety comes from the
  `SET LOCAL ROLE`, NOT the base role.
- **Privileged pre-tenant path** (NO TenantScope): `IdentityDbContext` (resolves the staff principal from
  users/user_roles/roles on EVERY authenticated request), the billing webhook write, and audit writes.
So the connection's **base login role must simultaneously**: (1) be a **member of `app_tenant`** so the tenant
path can `SET LOCAL ROLE app_tenant`; and (2) **read the identity tables (and do the privileged writes) past
RLS** on the pre-tenant path — i.e. effectively **BYPASSRLS** for the non-TenantScope contexts. Memory precedent:
"privileged connector read needs the BYPASSRLS pooler role." **Action:** confirm which Supabase role satisfies
BOTH, or provision one; point `Platform__DatabaseConnectionString` at it (Supavisor tx-pooling 6543 for the
tenant path). ⚠️ Because the base role is BYPASSRLS, the tenant path's isolation depends ENTIRELY on every tenant
query going through `TenantScope` — that invariant is enforced in code + tests, but note the coupling.

---

## 3. Build + push the image to ECR (Federico, AWS creds)
```bash
cd services/Tims.Platform
ACCT=<your-account-id>; REGION=us-west-2; REPO=tims-platform-api; TAG=$(git rev-parse --short HEAD)
aws ecr create-repository --repository-name $REPO --region $REGION            # once
aws ecr get-login-password --region $REGION | docker login --username AWS --password-stdin $ACCT.dkr.ecr.$REGION.amazonaws.com
# Apple Silicon → force amd64 (App Runner runs x86_64):
docker build --platform linux/amd64 -f src/Tims.Api/Dockerfile -t $REPO:$TAG .
docker tag $REPO:$TAG $ACCT.dkr.ecr.$REGION.amazonaws.com/$REPO:$TAG
docker push $ACCT.dkr.ecr.$REGION.amazonaws.com/$REPO:$TAG
```
(Dockerfile build context = `services/Tims.Platform`; multi-stage; non-root; EXPOSE 8080. Confirmed accurate.)

## 4. Create the App Runner service (Federico)
- **Source:** the ECR image above (manual deploys recommended for a first prod service; enable auto later).
- **Port** 8080. **Health check:** HTTP path `/health` (liveness, no DB — won't flap on a DB blip).
- **Instance:** start 1 vCPU / 2 GB; auto-scaling min 1 / max small.
- **Env + secrets:** §2 (secrets → Secrets Manager refs; the instance role reads them).
- **Instance role:** Secrets Manager read now; add SES/BambooHR later for Workers.

## 5. Post-deploy smoke — STILL DARK, no traffic routed (sign-off gate)
- [ ] `GET /health` → **200** (liveness).
- [ ] `GET /ready` → **200** (DB + Redis reachable) — proves the connection string + Redis.
- [ ] `GET /openapi/v1.json` → **200**.
- [ ] Mint a real Supabase **staff JWT** → `GET /whoami` → **200** with the resolved principal — proves JWKS
  (asymmetric-JWT deploy-verify) **and** the privileged identity read (DB-ROLE requirement §2). If this 401s,
  the base role can't read identity tables → fix the role before any cutover.
- [ ] `GET /team-intel/dashboard-kpis` (any strangler route) → **404** (flags off) — confirms dark.
- [ ] Logs (Serilog JSON): no PII, TraceId present.
**Do not proceed to §6 until /ready and /whoami are green.**

---

## 6. Per-surface cutover (one flag at a time; TS stays until prod-verified)
**Reality check:** flipping a flag makes the C# route LIVE, but the React FE still calls tRPC (superjson). So a
cutover per surface = **(a)** Claude ships a FE-rewiring PR pointing that surface at the C# endpoint via the
generated OpenAPI client → **(b)** Federico sets the flag `true` → **(c)** canary (run both, compare) → **(d)**
prod-verify → **(e)** delete the TS router/service/repo (+ flip the table to `efcore` where a write surface is
now fully C#). **The flag alone does not move the FE.**

**Order (lowest-risk read → writes last):**
1. `TeamIntelReadEnabled` — newest, isolated, pure read. **Best first canary.**
2. `ReportingReadEnabled`.
3. `BillingReadEnabled` → then `BillingUsageEnabled`.
4. `ExternalVendorReadEnabled` — API-key surface; coordinate the external vendor.
5. `ExternalVendorWriteEnabled` + `ValidationStaffWriteEnabled` — completes `preemployment_validations`; then
   flip that table's ownership to `efcore` and delete both TS write paths together.
6. `BillingWebhookWriteEnabled` (set `Stripe__*` + re-point the Stripe webhook to C# first) → then
   `BillingSelfServeEnabled`. `subscriptions`/`invoices` ownership flip stays blocked (non-billing TS writers).

## 7. Rollback
- **Per surface:** flag `false` + FE reverts to tRPC (keep TS until prod-verified — never delete TS before verify). Instant.
- **Service:** App Runner → redeploy previous image / pause. The TS app is fully independent, unaffected.

## 8. Workers / HRIS + scheduler HA (deferred — separate later step)
Deploy `tims-platform-workers` only when HRIS goes live (BambooHR creds + Sprint-1.8 fields/cadence/conflict).
Then: apply the `20260716000000_hris_domain` EF migration to prod (`dotnet ef migrations script` → review →
psql direct 5432); set the Quartz connection vs Supavisor tx-pooling (session pooler/direct if lock contention);
flip `Workers:ClusteredSchedulerEnabled=true`; THEN scale past replica 1. Prefer a dedicated scheduler DB role
over `app_tenant`. Set `Workers:HrisSyncEnabled=false` until real connector rows land.

---

## 9. Federico action checklist (ordered)
1. [ ] Rotate DB password + update Vercel env (0.1).
2. [ ] (optional) merge #144 + apply CB-1/CB-1b/CB-2b prod SQL (0.2).
3. [ ] Resolve + provision the DB-ROLE (§2) — the base login role (member of app_tenant + BYPASSRLS for the pre-tenant path).
4. [ ] Build + push the image to ECR (§3).
5. [ ] Create the App Runner service with env/secrets, flags all `false` (§4).
6. [ ] Run the §5 smoke gate; do not proceed unless /ready + /whoami green.
7. [ ] Per surface (§6): tell Claude to ship the FE-rewiring PR → flip the flag → canary → verify → delete TS.

## 10. Claude's scope (in parallel, no prod access)
- Generate the OpenAPI client for the FE from `contracts/openapi/Tims.Api.json`.
- Prepare the per-surface FE-rewiring PRs, starting with **team-intel read** (surface #1).
- Resolve any code follow-ups the §5 deploy-verifies surface.
