# TIMS ATS — C# Backend First Prod Deploy (Gate G3) + Cutover Runbook

**Target:** AWS App Runner (us-west-2, co-located with the Supabase DB — hard latency constraint from #100).
**Prepared:** 2026-07-21. **Updated:** 2026-07-23 (current to `main` `6db1dbb`, post-#173 — the ENTIRE strangler
read + pure-code write surface is merged and dark; the pure-code port runway is exhausted). **Status:** ready for
Federico execution.

> **What changed since 2026-07-21.** The runbook was written at Gate G3 with 9 dark surfaces. Since then 13 more
> slices merged (all the people/comp/eval360/succession/nine-box/engagement READS + the compensation/eval360/
> succession/nine-box/engagement WRITES + the FX gateway) — **22 surface flags now**, one new EF migration
> (`fx_rates`), and several **flip-ready** write domains. §2 (flag surface), §1 (migrations), and §6 (cutover
> order) below are updated to the full current set. **UPDATE 2026-07-27:** this is no longer universally true —
> `TeamIntelReadEnabled` has been flipped and confirmed live in prod (Federico). Every OTHER surface below is
> still dark; nothing else has been deployed. **UPDATE 2026-07-28:** the FX rate provider was swapped from
> Frankfurter to ExchangeRate-API (`open.er-api.com`) — the gateway called Frankfurter's v1 (ECB) batch
> endpoint, which doesn't support COP/CRC, the actual currencies real customer orgs use. **Correction
> (2026-07-29):** Frankfurter's v2 API DOES support both, via a real batch endpoint too
> (`GET /v2/rates?base=X&quotes=Y,Z,...`) — so ExchangeRate-API was kept instead because Frankfurter's own
> `/v2/currencies` catalog doesn't list COP/CRC even though its rate endpoints serve real data for both, an
> inconsistency ExchangeRate-API's ~166-currency catalog doesn't have. See
> `docs/architecture/csharp-migration/fx-provider-swap-2026-07-28.md` for the full correction.
> The `fx_rates` migration/table/job design in §1/§8 is unaffected — only the upstream data source changed.

> **Who runs what.** Everything in this runbook that touches PROD (AWS, secrets, prod DDL, DNS, feature-flag
> flips, deleting TS) is **Federico-run** — the standing migration rule (`I never touch prod`). Claude prepared
> this doc + the deploy artifacts, and does the per-surface FE-rewiring PRs (§6). Nothing here has been executed,
> EXCEPT the team-intel read flip noted above, which Federico ran manually outside this runbook's documented
> sequence (see the CORS/CSP fix commits, #183/#184, 2026-07-24).

> **The big picture.** The C# backend has been deployed for at least one surface — `TeamIntelReadEnabled` is
> confirmed live — but every other strangler surface is still dark code on `main`. "Moving to production" = the
> remaining 12 read/write pieces still need standing up per this runbook, then cutting over one flag at a time.
> The live TS app is unaffected throughout and is the rollback target for every surface.

---

## 0. Blocking pre-reqs (clear BEFORE the C# deploy)

- [x] **0.1 — 🔴 Rotate the leaked prod DB password — DONE 2026-07-27 (Federico).** The password leaked
      to a chat transcript a second time (during this session's parity-harness setup, in addition to the
      original 2026-07-20 leak this item was written for) — rotated via the Supabase dashboard, Vercel
      `DATABASE_URL`/`DIRECT_URL` updated in the same session, prod redeployed (`vercel --prod`), and the
      live TS app confirmed working post-rotation. The C# App Runner service's `/ready` also returned 200
      throughout — either it uses a different DB role than the rotated `postgres` password, or it was
      riding an existing pooled connection; **not independently confirmed which**, worth a proactive check
      of the `Platform__DatabaseConnectionString` Secrets Manager value next time this comes up.
- [ ] **0.2 — (recommended, independent of C#) apply the pending compliance prod SQL** (`psql -v ON_ERROR_STOP=1
--single-transaction "<DIRECT_PROD_URL>" -f <file>`): merge **PR #144** then apply CB-1
      (`packages/db/prisma/manual/2026-07-17-data-access-logs-immutable.sql`), CB-1b
      (`2026-07-17-audit-logs-immutable.sql`), CB-2b (`2026-07-17-add-access-reviews.sql`). Verify UPDATE/DELETE/
      TRUNCATE raise "…is append-only". These are part of "everything to prod" but do NOT block the C# service.
- [ ] **0.3 — decide MFA enforcement timing.** Since #178 this is **TWO flags that must move together**: `MFA_ENFORCED` in Vercel (web) and `Platform:MfaEnforced` on this service (terraform `mfa_enforced`, wired #179). Both dark today; both fail OPEN when unset. Flipping only the web one re-creates the #173 split-brain — the C# service would keep serving a privileged `aal1` session that tRPC refuses.

---

## 1. Target architecture

- **ONE App Runner service first: `tims-platform-api`** (from an ECR image), us-west-2, port **8080**,
  liveness `/health`, readiness `/ready`, auto-scaling min 1. This serves ALL the strangler READ/WRITE surfaces
  (they need no new tables).
- **DEFER `tims-platform-workers`** (Quartz/HRIS) — blocked on BambooHR creds + Sprint-1.8 requirements; its
  clustered `qrtz_` store DDL is applied to prod but inert. Deploy it in a later step (§8), not now.
- **Egress:** App Runner default public egress → Supabase pooler (internet-facing). No VPC connector needed.
- **Secrets:** AWS Secrets Manager, bound to the service; the instance role grants read.
- **EF migrations for prod.** Every strangler surface EXCEPT FX is `efcoreReadOnly`/`efcoreStranglerWrite` over
  EXISTING Prisma tables (no DDL). Two EF-owned migrations exist:
  - **`20260723032952_fx_rates` — apply BEFORE the FX-reads cutover** (surface #10 in §6). It creates the
    efcore-owned `fx_rates` table — a **global, RLS-EXEMPT catalog** (like `ai_agents`/`permissions`), `GRANT SELECT
TO app_tenant`, written only by the privileged refresh (the Workers `FxRefreshJob`, or since 2026-08-15 the API-hosted `FxRefreshHostedService` behind `Platform__FxRefreshEnabled`). The API can run without it as long as
    `FxReadsEnabled=false`; applying it + running the first frankfurter refresh is a prerequisite ONLY for flipping
    FX reads. (The refresh job runs on the Quartz scheduler — see §8; until Workers deploy, seed `fx_rates` via a
    one-off refresh or manual insert before flipping FX.)
  - **`20260716000000_hris_domain`** — for the deferred Workers/HRIS path (§8), inert until then. `qrtz_` already applied.
  - Apply with `dotnet ef migrations script <from> <to>` → review the SQL → `psql` direct (5432), like the compliance SQL.

---

## 2. Prod config — the `Platform:` env surface

App Runner env vars use `Platform__<Name>` (double-underscore = section nesting). **All 21 surface flags default
`false`;** set them explicitly `false` for the first deploy for auditability. The full set (each = one strangled
surface, flipped per §6):

- **Reads (12):** `ExternalVendorReadEnabled`, `BillingReadEnabled`, `BillingUsageEnabled`, `ReportingReadEnabled`,
  `TeamIntelReadEnabled`, `Evaluation360ReadEnabled`, `SuccessionReadEnabled`, `CompensationReadEnabled`,
  `NineBoxReadEnabled`, `EngagementReadEnabled`, `DeiReadEnabled`, `FxReadsEnabled` (needs the `fx_rates`
  migration and a seed first).
- **Writes (9):** `ValidationStaffWriteEnabled`, `ExternalVendorWriteEnabled`, `CompensationWriteEnabled`,
  `Evaluation360WriteEnabled`, `SuccessionWriteEnabled`, `NineBoxWriteEnabled`, `EngagementWriteEnabled`,
  `BillingWebhookWriteEnabled`, `BillingSelfServeEnabled`.
  (The exact CLR property names are in `services/Tims.Platform/src/Tims.Api/Configuration/PlatformOptions.cs`.)

| Env var                                      | Source                             | Required                               | Notes                                                                                        |
| -------------------------------------------- | ---------------------------------- | -------------------------------------- | -------------------------------------------------------------------------------------------- |
| `Platform__DatabaseConnectionString`         | Supabase (post-0.1 rotation)       | ✅                                     | **See the DB-ROLE requirement below — the #1 first-deploy risk.**                            |
| `Platform__RedisConnectionString`            | Upstash                            | ⚠️ recommended                         | perm-cache + rate-limit; fail-soft if absent (degrades, doesn't crash).                      |
| `Platform__SupabaseJwtIssuer`                | Supabase project                   | ✅                                     | e.g. `https://<ref>.supabase.co/auth/v1`.                                                    |
| `Platform__SupabaseJwtAudience`              | —                                  | default `authenticated`                | leave default unless customized.                                                             |
| `Platform__SupabaseJwksMetadataAddress`      | Supabase project                   | ✅                                     | JWKS URL — **must be asymmetric (RS256/JWKS), NOT legacy HS256** (deploy-verify below).      |
| `Platform__ImpersonationSecret`              | = the TS HMAC impersonation secret | ✅ (for impersonation)                 | **must byte-match** the TS value (shared signed cookie) or owner impersonation breaks.       |
| `Platform__OtlpEndpoint`                     | observability backend              | optional                               | OTel traces/metrics export.                                                                  |
| `Platform__<Surface>Enabled` ×21             | —                                  | set `false`                            | The full read+write set listed above (§2). All default false; set explicit for auditability. |
| `Stripe__SecretKey`, `Stripe__WebhookSecret` | Stripe                             | only before billing-write cutover      | leave unset while billing writes are dark.                                                   |
| `ASPNETCORE_URLS`                            | —                                  | preset in Dockerfile (`http://+:8080`) | do not override.                                                                             |

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

**Order (lowest-risk read → writes last). "Flip-ready" = the domain is FULLY C# once its write flips, so after
prod-verify you drop the TS router/service/repo and flip its tables to `efcore` (a true ownership transfer).
"Coexistence" = the tables are still read/written by TS or other C#-unported surfaces, so both writers stay
(dark-coordinated) and the table stays `efcoreStranglerWrite` — no ownership flip yet.**

**Phase A — reads (each: FE-rewire PR → flag true → canary → verify; no ownership change, tables stay Prisma-owned):**

1. `TeamIntelReadEnabled` — newest, isolated, pure read. **Best first canary — CONFIRMED FLIPPED AND LIVE**
   (2026-07-27, Federico).
2. `ReportingReadEnabled`.
3. `BillingReadEnabled` → `BillingUsageEnabled`.
4. `Evaluation360ReadEnabled` → `SuccessionReadEnabled` → `CompensationReadEnabled` → `NineBoxReadEnabled` →
   `EngagementReadEnabled` → `DeiReadEnabled` (the people/comp dashboards — staff-JWT reads; k-anon suppression
   lives in the shared kernels, already golden-parity).
5. `FxReadsEnabled` — **prereq: apply `fx_rates` (§1) + seed the first ExchangeRate-API refresh** (register
   exchangerate-api.com in the SOC2 subprocessor list — the gateway is ExchangeRate-API, not Frankfurter; see
   the 2026-07-28/29 UPDATE above). Backs the FX-dependent comp + dei pay-equity reads.
6. `ExternalVendorReadEnabled` — API-key surface; coordinate the external vendor.

**Phase B — writes (after each domain's reads are verified; writes last):**

7. `ExternalVendorWriteEnabled` + `ValidationStaffWriteEnabled` — **FLIP-READY together:** completes
   `preemployment_validations` → flip that table to `efcore` + delete both TS write paths.
8. `Evaluation360WriteEnabled` — **FLIP-READY:** eval360 reads (#4) + writes = fully C# → drop the TS eval360 router,
   flip review_cycles/rater_assignments/rater_responses to `efcore`.
9. `SuccessionWriteEnabled` — **FLIP-READY:** drop TS succession router, flip critical_roles/successors.
10. `NineBoxWriteEnabled` — **FLIP-READY:** drop TS ninebox router, flip calibration_sessions/members/votes.
11. `CompensationWriteEnabled` — **COEXISTENCE** (salary_adjustments/employee_compensations still read by other
    surfaces); keep both writers, table stays `efcoreStranglerWrite`.
12. `EngagementWriteEnabled` — the flag flip ITSELF is safe to canary now: monitoring.ts/dei.ts/the alert cron
    are plain Prisma reads with no caching or cross-request consistency assumption, and the C# writer produces
    byte-identical rows (verified 2026-07-27), so a reader can't tell which stack wrote a row. Still
    **COEXISTENCE** for the TERMINAL state only — those three files still call `db.survey`/`db.actionPlan`
    (Prisma models), so deleting the TS engagement router / moving surveys/survey_responses/action_plans to
    `efcore` stays blocked until they're ported too.
13. `BillingWebhookWriteEnabled` → `BillingSelfServeEnabled` — **COEXISTENCE:** `subscriptions`/`invoices`
    ownership flip stays blocked (non-billing TS writers in the provisioning txns).

    **Resolved 2026-07-27 (was ambiguous — see below): NO Stripe dashboard/API change. Do NOT register a new
    webhook endpoint or generate a new signing secret.** Flipping this flag only changes what the EXISTING
    Next.js route (`apps/web/app/api/webhooks/stripe/route.ts`) does internally — Stripe keeps POSTing to the
    exact same URL it always has. Proof, from the current code (not aspirational):
    - `billing-webhook.service.ts`'s `handleStripeWebhook` (packages/api/src/services/billing-webhook.service.ts:226-229)
      branches on the flag BEFORE any TS-side signature verification. When true it calls
      `handleStripeWebhookViaCSharp` (same file, :210-222), which forwards the RAW body + `Stripe-Signature`
      header **verbatim** via `platformPostRaw('/billing/webhooks/stripe', …)` — an internal server-to-server
      call from the Next.js process to the C# App Runner service, never exposed to Stripe.
    - The C# side (`BillingWebhookEndpoints.cs:27-45`) reads the raw body itself and verifies the signature
      independently, using its OWN `Stripe:WebhookSecret` config value (`Program.cs:452`,
      `StripeBillingOptions.cs:26`) — TS does not pre-verify and does not pass a pre-verified flag through.
    - Nowhere in the codebase (routes, Terraform, docs) is the C# App Runner service URL ever registered as a
      Stripe webhook target — `NEXT_PUBLIC_TIMS_PLATFORM_API_URL` / the Terraform output of the same name is
      used only for (a) server-to-server calls like the one above and (b) the FE's generated OpenAPI client.
      There is no route today for Stripe to hit the C# service directly, so interpretation (b) ("re-point the
      Stripe webhook to C#") is not just unnecessary — it isn't wired up at all.
    - **Consequence for `Stripe__WebhookSecret` (`services/Tims.Platform/deploy/terraform/main.tf:26`,
      `variables.tf:101` `manage_stripe_secrets`):** because Stripe's registered endpoint and its signing
      secret never change, this MUST be set to the exact same value as the existing TS `STRIPE_WEBHOOK_SECRET`
      (`packages/api/src/lib/stripe.ts:116`) — a copied/passthrough secret, NOT a fresh secret from a
      separately-created Stripe endpoint object. Setting a different value here will make every webhook 400
      once the flag flips (signature verification will fail against the wrong secret).
    - **Operational steps:** (1) copy the existing `STRIPE_WEBHOOK_SECRET` value into the C# service's
      `Stripe__WebhookSecret` secret (and the existing `STRIPE_SECRET_KEY` into `Stripe__SecretKey`); (2) flip
      `manage_stripe_secrets = true` + `Platform:BillingWebhookWriteEnabled = true`; (3) no Stripe
      dashboard/API action of any kind is required.

**The H1/both-stacks hardenings ship LIVE with the TS side already** (succession/nine-box/engagement reject cross-org
FK refs) — they only ever reject previously-broken writes, so they are safe irrespective of cutover timing.

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

- Generate the OpenAPI client for the FE from `contracts/openapi/Tims.Api.json` (the contract is emitted at build,
  committed, and accurate even though the routes are dark — so the client can be generated BEFORE the deploy).
- Prepare the per-surface FE-rewiring PRs in the §6 order, starting with **team-intel read** (surface #1). Each PR
  points one surface at the C# endpoint via the generated client, dark by default (same wrapper pattern as the
  staged nine-box read cutover, #165) — so a flip is a flag change, not a code change, on deploy day.
- After each write domain is prod-verified: the **ownership-flip PRs** (drop the TS router/service/repo, flip the
  table to `efcore` in the ledger) for the flip-ready domains (validation, eval360, succession, nine-box).
- Resolve any code follow-ups the §5 deploy-verifies surface (JWKS shape, rate-limit buckets, Redis perm-cache).

## 11. Phase 7 — final consolidation (the last code, AFTER all surfaces are cut over + verified)

Once every §6 surface is live on C# and prod-verified, retire the TS backend:

- Delete the remaining tRPC routers/services/repos and `packages/api` + `packages/db` (Prisma) — everything the
  FE no longer calls; the FE runs entirely on the generated OpenAPI client.
- Remove the tRPC/superjson client wiring from `apps/web`; the coexistence tables (billing/comp/engagement) flip to
  `efcore` only when their LAST TS writer is gone.
- This is real, substantial FE + cleanup coding — **deferred by design** until the backend is deployed and every
  surface proven, because you cannot safely delete the old stack before the new one carries all traffic. It is the
  ~15% of the migration that remains after this runbook is executed.
