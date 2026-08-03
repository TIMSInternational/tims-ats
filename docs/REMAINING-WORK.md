# Known Issues & Remaining Work

> Single backlog/status reference (rule #1: docs are code — update in the SAME PR as the change).
> **Truthed-up 2026-07-25 against HEAD `main` (commit `27249b18a3f92460f5a3b0f0841e0eb70c6e183f`, the docs
> commit immediately after PR #194)** — this truth-up covers PRs #97–#194 (2026-06-30 → 2026-07-25): the
> C# backend strangler-fig migration (Phases 1–5, in progress) and the CB-1/1b/1c/2a/2b compliance work.
> Supersedes the 2026-06-29 truth-up (PR #96, commit `5115a83`), which predates the C# migration entirely —
> that prior version did not mention it at all.
> **Partial truth-up 2026-07-27 (Phase-5 section only — everything else in this doc is still dated
> 2026-07-25, not re-verified in this pass):** PRs #195–#212 shipped the C# audit-log (Slice-17, #195) and
> access-review (Slice-18, #196) backend ports, AND — a previously undocumented layer — dark FE/TS
> cutover-prep wrappers (`apps/web/lib/platform-api/*.ts` + 2 server-side proxies) for ALL 12 read domains
> and ALL 8 write-capable domains, gated behind their own `NEXT_PUBLIC_<DOMAIN>_{READ,WRITE}_VIA_CSHARP`
> flags. See the Phase-5 bullet below for detail; this closes out ALL AI-doable FE/API cutover-prep work —
> what remains is the per-domain flag-flip/canary/delete-TS cycle itself (Federico-only).
> **`docs/PRODUCT-MAP.md` is STALE — this file is canonical for status.** Per-feature detail lives
> in the wave/spec docs cited below, and — for the C# migration specifically — in
> `docs/architecture/csharp-migration/00-master-plan.md`, `phase-5-strangler.md`, and
> `docs/architecture/table-ownership.md` (the authoritative per-table/per-domain ledger).

---

## ✅ DONE (verified in code + prod, not aspirational)

Detail for each lives in its wave/spec doc; this is the scannable status roll-up.

### Platform foundation

- **Security:** RLS tenant isolation LIVE (`RLS_ENFORCED=true`, fail-closed policies — **⚠️ CORRECTED 2026-08-02, see #111: "fail-closed" was NOT true in prod. An undocumented second PERMISSIVE policy family, `org_isolation`, existed on 67 tables with an `OR (current_org_id() IS NULL)` clause; because Postgres ORs permissive policies, an unset org GUC returned EVERY tenant's rows instead of zero — empirically verified (32/32 users across all 15 orgs). Not an active leak (`anon`/`authenticated` hold no grants; both app paths set role+GUC atomically), but the backstop was defeated. **FIXED AND VERIFIED IN PROD 2026-08-02** via `packages/db/prisma/manual/2026-08-02-fix-rls-fail-open-org-isolation.sql` — all 67 `org_isolation` policies dropped; unset GUC now returns 0 rows, and a per-org sweep across all 15 orgs confirms 32/32 users still visible to exactly their own org and no other (0 mismatches). Tenant isolation is genuinely fail-closed again. **Defect 2 ALSO FIXED AND VERIFIED 2026-08-02** via `packages/db/prisma/manual/2026-08-02-fix-rls-allow-all-join-tables.sql` — an `allow_all (USING true)` policy was OR-ing past the correct fail-closed session-subquery guard on 7 tenant-scoped join tables (`user_roles`, `role_permissions`, `user_teams`, `interview_evaluators`, `calibration_members`, `calibration_votes`, `learning_path_courses`), leaving them with no effective DB isolation in ANY GUC state — worse than Defect 1. Dropped; post-fix an unset GUC returns 0 on all 7 and a per-org sweep accounts for every row (3033/3033 `role_permissions`, 12/12 `user_roles`). `allow_all` deliberately retained on `permissions`/`platform_owner_emails` — genuine global RLS-exempt catalogs. **End state: every tenant table carries exactly one policy, the fail-closed `tenant_isolation`.** Still open on #111: provenance of the out-of-band policies, and a CI regression guard**); SQL-injection/IDOR fixes; `hr_admin` fail-closed allowlist; Turnstile on public apply; nonce CSP; Upstash rate limiting; CI grep-gates (any/raw-SQL/XSS/ts-ignore/eval/service_role/AI-door). (PRs #2–#11)
- **AI safety:** single gated door `invokeAgent` (fail-closed budget → cache → PII sanitize + Bedrock Guardrails MASK → circuit breaker → Zod-validate → usage log); CI + vitest enforce "no Bedrock outside `packages/ai`". (PRs #15–#19, guardrail wired #53)
- **Architecture:** Router→Service→Repository standard; god-components split; Sentry (token pending) + Pino; caching layer; Supavisor pooling; mobile sweep (~35 routes @390×844); Vercel prod + alias.
- **MFA/TOTP** for platform owners + super_admins (built; `MFA_ENFORCED` off by default). (PR #51) — CB-2a (PR #148) later closed the tRPC + impersonation enforcement-path bypass; see Compliance-by-design below. The flag itself is still off in prod — see Tier 0.
- **Platform console → 100%** (real reset, AI budget editor, audit export, signed-cookie impersonation, GDPR/Habeas-Data export, force-logout, alert-rule cron engine). (PRs #47–#53)

### C# Backend Migration — Phases 1–4 COMPLETE; Phase 5 (strangler) IN PROGRESS, built + parity-verified + DARK

Master plan: converge the backend fully onto C#/.NET via a 7-phase strangler-fig migration
(`docs/architecture/2026-07-15-csharp-backend-target-architecture.md` is the what/why;
`docs/architecture/csharp-migration/00-master-plan.md` is the how/when/order/gates). Frontend stays
Next.js/React; `ai-gateway` stays a separate polyglot inference service by design — never migrated.
Verified directly in code (`services/Tims.Platform/src/Tims.Api/Program.cs`): every Phase-5 route below is
wrapped in `if (options.<X>Enabled || isOpenApiDocGeneration) { ... }`, defaulting `false`.

- **Phase 1 — runway + spikes — DONE.** `Tims.Platform` C# solution scaffolded; Spike A proved EF Core can
  hold Postgres RLS/GUC under Supavisor transaction-pooling (Testcontainers); Spike B proved the TS and C#
  authz kernels agree on the same golden fixtures. Table-ownership ledger (`docs/architecture/table-ownership.md`) and its CI enforcement are live. (PR #132)
- **Phase 2 — identity/auth plane — DONE.** C# validates Supabase JWTs (ES256, exp/iss/aud/JWKS) and `tims_`
  API keys; resolves all 4 principal types (platform-owner/org-user/candidate/external-key) + impersonation;
  permission/scope (RBAC) parity; rate-limiting on shared Redis keys. (PRs #133–#136)
- **Phase 3 — first real domain, HRIS — DONE, greenfield.** HRIS is the first EF-owned product domain
  (`hris_*` tables, RLS-wrapped) — the proof the C# stack delivers value before any working TS domain is
  touched. (PR #137) **⚠️ CORRECTED 2026-08-03: the four `hris_*` tables had NEVER been applied to
  production**, despite this entry reading DONE since 2026-07-16. Found by querying prod directly while
  auditing migration state for #115 — all four were absent. Applied 2026-08-03 from a script generated
  off the EF migration (`services/Tims.Platform/db/manual/20260716000000_hris_domain.sql`); all four now
  exist with `FORCE` RLS, one fail-closed `tenant_isolation` policy each, and `app_tenant` grants, and
  `/gate` check 14 passes. Side effect worth noting: this created prod's first `__EFMigrationsHistory`
  row, giving EF a real migration baseline where there was none.
- **Phase 4 — C# workers — DONE.** `Tims.Workers` host + Quartz scheduler + resilient-job framework running
  a recurring HRIS sync job; Slice 2 added a clustered/persistent Quartz ADO(Postgres) store for scheduler HA
  (dark behind `Workers:ClusteredSchedulerEnabled` — needs Federico to apply the DDL + flip it). (PRs #138, #152)
- **Phase 5 — strangler (migrate working domains one at a time) — IN PROGRESS.** Per
  `docs/architecture/table-ownership.md` (the authoritative ledger), every domain below is at the SAME
  stage — C# read and/or write surface implemented, golden-parity fixtured against TS, RLS/RBAC-proven in
  Testcontainers, **FLIP-READY** — but deployed dark behind a feature flag defaulting `false`. TS remains the
  sole active reader/writer of every one of these tables in prod today:
  - External-vendor assessment — read (#139) + write (#140); the staff `updateValidation` write (#151) made
    BOTH writers C#, so this table is FLIP-READY.
  - Billing — invoice read (#141) + usage/plan/config read (#142) + Stripe-webhook write (#145) + tenant
    self-serve billing (#146). Usage/plan/config read **flipped and live in prod** —
    `NEXT_PUBLIC_BILLING_USAGE_VIA_CSHARP=true`. **Invoice read FLIPPED AND LIVE IN PROD 2026-07-31** —
    `NEXT_PUBLIC_BILLING_INVOICES_VIA_CSHARP=true`, parity-verified fresh 5/5 PASS immediately before
    flipping (RLS check was structurally-pass-only — both parity test orgs had zero seeded invoices, so
    cross-tenant isolation wasn't data-proven, only structurally). Its TS `listInvoices`/`getInvoice`
    procedures and FE tRPC fallback (`apps/web/lib/platform-api/billing.ts`) have since been fully
    deleted too (branch `ts-deletion-billing-invoices-read`, same day) — a 9th domain TS deletion, after
    the S5 item-4 8-domain sequence below had already closed. Stripe-webhook write and self-serve
    write remain dark: test-mode verified end-to-end but Federico has explicitly declined the
    live-Stripe-key prod cutover.
  - Reporting / recruitment-analytics — read (#150). **Flipped and live in prod**
    (`NEXT_PUBLIC_REPORTING_READ_VIA_CSHARP=true`) — and its TS router/wrapper-fallback has since
    been fully deleted (2026-07-28, see "TS dead-code deletion" note below), not just flagged.
  - Team-intel — read (#153). **CONFIRMED FLIPPED AND LIVE in prod** (2026-07-27) —
    `NEXT_PUBLIC_TEAMINTEL_READ_VIA_CSHARP=true` in Vercel prod and `Platform:TeamIntelReadEnabled=true`
    on App Runner. `dashboard-kpis` and the rest of the team-intel reads are served by C# today.
  - Evaluation360 — read (#158) + write (#170). **Both flipped and live in prod** (2026-07-28) —
    `NEXT_PUBLIC_EVALUATION360_READ_VIA_CSHARP` and `_WRITE_VIA_CSHARP` both confirmed `true` via
    `vercel env pull`, real prod redeploys reached `● Ready`. Its TS router/wrapper-fallback has
    since been fully deleted (2026-07-28, see "TS dead-code deletion" note below).
  - Succession — read (#160) + write (#171). **Both flipped and live in prod** (2026-07-28), same
    confirmation method as evaluation360 above.
  - Compensation — FX-free read (#162) + FX-gateway/FX-dependent reads (#168) + write (#169).
    **Read (FX-free) and write flipped and live in prod** (2026-07-28) —
    `NEXT_PUBLIC_COMPENSATION_READ_VIA_CSHARP` and `_WRITE_VIA_CSHARP` both `true`. The FX-dependent
    reads (`getBandDistribution`, `getTotalCompBreakdown`, `getDashboardKpis`) are gated on a
    SEPARATE flag, `NEXT_PUBLIC_COMPENSATION_FX_READ_VIA_CSHARP`, which does **not** exist in Vercel
    yet — still TS-served, blocked on seeding the `fx_rates` table
    (`docs/architecture/csharp-migration/fx-seed-once-runbook.md`, Federico-only). **TS deletion
    2026-07-29:** 7 of the router's 14 procedures were deleted (the 5 FX-free reads + both writes);
    the 3 FX-dependent procedures are **deliberately retained as the live prod path**, and the 4
    zero-FE-consumer procedures (`getPayEquity`, `simulateAdjustment`, `getMarketComparison`,
    `getEmployeeComp`) are untouched pre-existing dead code. _(UPDATE 2026-07-31: the FX carve-out
    above is now closed — `NEXT_PUBLIC_COMPENSATION_FX_READ_VIA_CSHARP` is confirmed permanently
    live in prod, parity-verified 10/10 PASS via `scripts/parity/cli.ts verify compensation`, and
    `getBandDistribution`/`getTotalCompBreakdown`/`getDashboardKpis` have now had their TS side
    deleted too (`packages/api/src/routers/compensation.ts`), following the same TS-deletion
    pattern as the other 8 domains' second-pass entries elsewhere in this doc. The FE wrapper
    (`apps/web/lib/platform-api/compensation.ts`) now calls the C# service unconditionally for all
    10 of its hooks — the file is no longer split. `getPayEquity`/`simulateAdjustment`/
    `getMarketComparison`/`getEmployeeComp` remain untouched, unrelated zero-FE-consumer dead code,
    unaffected by this change.)_
  - Nine-box — read (#164) + calibration write (#172). **Both flipped and live in prod** (2026-07-28),
    same confirmation method as evaluation360 above.
  - Engagement — read (#166) + write (#173). **Write flipped and live in prod** (2026-07-28) —
    `NEXT_PUBLIC_ENGAGEMENT_WRITE_VIA_CSHARP=true` (value re-read directly from Vercel production on
    2026-07-29). TS side deleted 2026-07-29 for the 3 FE-consumed mutations (`createSurvey`,
    `activateSurvey`, `submitSurveyResponse`); `createActionPlan`/`updateActionPlan` are untouched
    zero-FE-consumer dead code. _(UPDATE 2026-07-31: the "read flag does not exist in Vercel —
    still dark, all 14 TS reads DELIBERATELY RETAINED" claim in this paragraph is now stale — see
    the newer "Engagement — read (#166). FLIPPED AND LIVE IN PROD 2026-07-31" entry below, and its
    matching TS-deletion note further down: the 8 reads with a live FE wrapper are deleted, the 6
    zero-wrapper reads remain untouched.)_
  - DEI — read (#167). **FLIPPED AND LIVE IN PROD 2026-07-31** —
    `NEXT_PUBLIC_DEI_READ_VIA_CSHARP=true`, parity-verified fresh 50/50 PASS immediately before
    flipping. Real FE consumers: `apps/web/app/(admin)/engagement/dei/*`,
    `apps/web/app/(admin)/dashboard/hr-exec-dashboard.tsx`,
    `apps/web/app/(admin)/compensation/comp-left-column.tsx`. **TS deletion 2026-07-31:** 8 of the
    router's 10 procedures were deleted (`getDashboardKpis`, `getGenderRepresentation`,
    `getAgeDistribution`, `getNationalityDiversity`, `getPayEquity`, `getLeadershipDiversity`,
    `getHiringFunnel`, `getPromotionEquity`, `getInclusionIndex` — 9 counting pay-equity, which
    shares this domain's ONE FE flag despite its own separate `Platform:FxReadsEnabled` backend
    gate); the FE wrapper (`apps/web/lib/platform-api/dei.ts`) now calls the C# service
    unconditionally for all 9. `getEthnicityDistribution`/`getDisabilityDistribution` are
    **deliberately retained** as untouched, pre-existing zero-FE-consumer dead code.
  - External-vendor — read (#139) + write (#140/#151). **READ FLIPPED AND LIVE IN PROD 2026-07-31** —
    `EXTERNAL_VENDOR_READ_VIA_CSHARP=true` (a plain server env var, not `NEXT_PUBLIC_`, since this
    surface is TS-server-to-C# rather than browser-to-C#). Re-checked for code drift since the
    2026-07-28 manual verification (2/2 PASS) immediately before flipping — zero commits touched either
    side of the boundary since. **WRITE remains dark** (`EXTERNAL_VENDOR_WRITE_VIA_CSHARP` not set) —
    this endpoint is called by a real external vendor's live API integration, not just internal staff;
    the prior write verification (200+409+correct provenance, 2026-07-28) required Federico to manually
    create a scoped API key via Settings→Integrations, which can't be re-run headlessly. Backend flag
    `Platform__ExternalVendorWriteEnabled` is already `true` on App Runner, so flipping the Vercel flag
    alone would activate it — recommend Federico do one fresh manual write test before flipping.
    **TS deletion (2026-07-31):** the Prisma-backed fallback in `external-assessment.service.ts`'s
    `list()`/`getOne()` (gated behind `EXTERNAL_VENDOR_READ_VIA_CSHARP`) was provably dead and has
    been deleted — both methods now proxy to the C# service unconditionally. Deleted the now-fully-
    unused `packages/api/src/repositories/external-assessment.repository.ts` and the dead
    `auditExport()` helper (the C# use case audits its own exports). `dto/external-assessment.ts`
    (`toExternalAssessmentResultV1`/`ExternalResultRow`) is DELIBERATELY RETAINED — it has independent
    live consumers beyond the deleted repository/fallback: `tests/access/external-assessment-api.test.ts`
    and the golden-fixture parity suite `tests/external-vendor/assessment-result-v1-fixtures.test.ts`.
    The WRITE side (`external-validation.service.ts`, `EXTERNAL_VENDOR_WRITE_VIA_CSHARP`) is untouched —
    still dark, its TS path is still live prod.
  - Audit-log (Phase-5 Slice-17) — read (#195). **FLIPPED AND LIVE IN PROD 2026-07-31** —
    `NEXT_PUBLIC_AUDIT_LOG_READ_VIA_CSHARP=true`, real FE consumer is
    `apps/web/app/(admin)/platform/audit/page.tsx`. (Prior claim that "the C# service has never been
    independently deployed" was stale — the backend flag `Platform__AuditLogReadEnabled` was already
    `true` on the live App Runner service before this flip, confirmed via `aws apprunner
describe-service`; only the frontend Vercel flag was missing.)
  - Access-review (Phase-5 Slice-18) — read + write (#196). Platform-owner-only, fixed-org-id surface.
    **READ FLIPPED AND LIVE IN PROD 2026-07-31** — `NEXT_PUBLIC_ACCESS_REVIEW_READ_VIA_CSHARP=true`,
    parity-verified fresh 12/12 PASS immediately before flipping. (Prior claim of "zero FE consumers in
    either stack" was stale — `apps/web/app/(admin)/platform/access-review/page.tsx` +
    `attest-modal.tsx` already consumed the wrapper.) **WRITE ALSO FLIPPED AND LIVE 2026-07-31** —
    `NEXT_PUBLIC_ACCESS_REVIEW_WRITE_VIA_CSHARP=true`, backend `Platform__AccessReviewWriteEnabled`
    added via full-map `aws apprunner update-service`, parity-verified fresh 3/3 PASS immediately
    before flipping. **UPDATE 2026-07-31 (TS deletion):** the TS side of the write
    (`attestAccessReview` router procedure, `access-review.service.ts`'s `attest()`,
    `access-review.repository.ts`'s `insertAttestation`/`orgExists`) has been DELETED outright — C#
    is now the sole writer of `access_reviews`. The read procedures (getAccessReview/
    exportAccessReviewCsv/listAccessReviewAttestations) are unaffected — their TS deletion is a
    separate, not-yet-done task.
  - Engagement — read (#166). **FLIPPED AND LIVE IN PROD 2026-07-31** —
    `NEXT_PUBLIC_ENGAGEMENT_READ_VIA_CSHARP=true`. First attempt at this flip caught a real
    parity-verify failure (12/43 FAIL: apparent eNPS cross-tenant leak + hr_admin 403s everywhere) —
    root-caused as a parity-harness fixture gap, not an app bug (harness never seeded
    `engagement:read` grants or eNPS fixtures for the test orgs; see commit `7fd23a7`). Backend flag
    was rolled back immediately, harness fixed + 782/782 unit + 1012/1012 integration tests still
    passing, re-verified 43/43 PASS, then re-flipped for real.
  - **Cutover-verification harness** (`scripts/parity/`, PRs #177–#194): a TypeScript CLI proving
    parity/RLS/RBAC for each surface against the real Supabase prod DB before any flag flips.
  - **FE/TS dark-cutover wrapper layer (2026-07-27, PRs #197–#212) — now fully COMPLETE, both reads and
    writes** (net of the documented zero-consumer exceptions below — parity-verified backend surfaces with
    no real FE call site were intentionally left unwrapped rather than shipped as dead code). A
    previously-undocumented layer distinct from the backend PRs above: every domain's tRPC consumers can
    now route through the C# service one flag at a time. READS — all 12 domains (external-vendor, billing,
    reporting, team-intel, evaluation360, succession, compensation, nine-box, engagement, DEI, audit-log,
    FX-dependent compensation/DEI reads) have a `useX()` hook per read, originally dark and mirroring the exact
    tRPC output type — though for domains whose flag has since gone live and whose TS procedures were
    subsequently deleted (reporting, evaluation360, team-intel, billing-usage, succession, nine-box,
    compensation's 5 FX-free reads, and DEI's 9 of 10) the hook is now C#-only with hand-declared types, no
    longer dark and no longer mirroring a tRPC output
    type — **including billing's invoice-read** (`billing.listInvoices`/`billing.getInvoice`,
    `packages/api/src/routers/billing.ts:58,83`, backend PR #141, ported by `BillingReadEndpoints.cs` behind
    `Platform:BillingReadEnabled`): a 2026-07-27 gap audit (cutover-automation script flagged the missing
    `NEXT_PUBLIC_*_VIA_CSHARP` flag) had confirmed this tenant-scoped pair had **zero real FE consumers** —
    the tenant `settings/billing` page only called `getBillingConfig`/`getCurrentPlan`/`getUsage` (already
    wrapped via `NEXT_PUBLIC_BILLING_USAGE_VIA_CSHARP`), and the only invoice UI in `apps/web`
    (`app/(admin)/platform/invoices/*`) called the unrelated cross-org `platform.listInvoices`/
    `platform.getInvoice` admin procedures, not this pair. **UPDATE 2026-07-28: that gap is closed** — a new
    `useBillingInvoices`/`useBillingInvoice` dark wrapper (`apps/web/lib/platform-api/billing.ts`, gated on
    `NEXT_PUBLIC_BILLING_INVOICES_VIA_CSHARP`, independent of `BILLING_USAGE_VIA_CSHARP`) now backs a new
    `apps/web/app/(admin)/settings/billing/billing-invoices.tsx` card wired into `settings/billing/page.tsx` —
    the first-ever real FE consumer of this surface, shipping dark like every other surface. The unrelated
    `app/(admin)/platform/invoices/*` admin UI is untouched. "Billing" in the READS list above now means all
    4 reads (usage/plan/config/invoices). WRITES — all 8
    write-capable domains (external-vendor, evaluation360, succession, nine-box, compensation, engagement,
    billing-webhook, billing-self-serve) have a `useXMutation()` hook per write MUTATION THAT HAS A
    LIVE FE CALL SITE — originally dark; where the write flag has since gone live and the TS mutation was
    deleted (succession, nine-box, compensation, engagement) the hook is now C#-only — several procedures per domain
    (e.g. succession's `addCriticalRole`, engagement's
    `createActionPlan`) have zero consumers and were intentionally left unwrapped (dead code otherwise). The
    billing Stripe-webhook write is a proxy inside `packages/api/src/services/billing-webhook.service.ts`,
    not a browser wrapper — Stripe calls the Next.js route directly, so the flag lives entirely server-side.
    A real bug was found and fixed in this pass (#212): the browser `PlatformApiError` never surfaced the
    C# error response body's `message` field, only a generic placeholder — any consumer checking specific
    backend error text would have silently broken once a write flag flipped live. Fixed before any write
    domain's flag actually flips.
  - **First C# prod deploy** — AWS App Runner (Terraform IaC, PR #157; Gate-G3 runbook, PRs #154/#174). A
    2026-07-27 prep pass (`docs/architecture/csharp-migration/PROD-DEPLOY-PREP-2026-07-27.md`, PR #201)
    verified the Docker image builds and runs locally against the runbook's exact steps, and drafted the
    compliance-SQL/MFA-timing/DB-role decisions — but **explicitly executed none of it against real
    infrastructure** (Federico-only: DB password rotation, the 3 SQL files, `aws ecr`/App Runner itself).
    _(RESOLVED 2026-07-27: the EARLIER deployment attempt — commits `cf83fba`/`1606118`/`49c74d3`, 2026-07-24 —
    was the team-intel read flip; Federico confirmed it completed and is still live in prod. This does NOT
    mean the broader App Runner deployment is otherwise fully verified/stable — only that this one specific
    surface is confirmed receiving live traffic.)_
- **Truth-up 2026-07-29: 12 of the ~20 `NEXT_PUBLIC_*_VIA_CSHARP` flags are now flipped and live in
  prod** (confirmed via `vercel env ls`/`vercel env pull` against the real Vercel project, cross-checked
  against real prod redeploys reaching `● Ready`). This entry replaces a prior "DONE for exactly ONE
  domain (team-intel read); NOT DONE for the other 12 pieces" claim that was accurate as of 2026-07-27
  but went stale after the 2026-07-28 write-flag-flip session and was never truthed up in the same PR
  (a process miss — flag flips in prod are Federico-only and don't always land alongside a
  doc-updating commit; flag this doc explicitly whenever a flip session happens). **Live now:** team-intel read, reporting read, billing-usage read, succession read+write,
  nine-box read+write, evaluation360 read+write, compensation read (FX-free subset)+write, engagement
  write. **Still dark:** compensation FX-dependent read subset (blocked on seeding `fx_rates`, see the
  `feat/fx-seed-once` work), billing invoice-read (flag never created despite the FE consumer existing),
  engagement read, DEI read, billing Stripe-webhook/self-serve writes (Federico has declined the
  live-Stripe-key cutover), audit-log, access-review, external-vendor (none of these last three ever
  got a `NEXT_PUBLIC_*` flag in Vercel — no FE consumer or different cutover mechanism, see their
  respective slice docs). TS-code deletion (step 7) has now happened for all 8 domains, covering
  all 12 live read/write surfaces — reporting and evaluation360 (2026-07-28), team-intel and billing-usage
  (2026-07-29), succession (2026-07-29, **partially** deleted — 8 of 9 read procedures + 2 of
  5 write procedures; `getCriticalRole` and 3 zero-consumer write mutations remain untouched,
  unrelated dead code), nine-box (2026-07-29, **partially** deleted — 7 of 11 read procedures +
  3 of 5 write procedures; `getAxisBreakdown`/`getMovementHistory`/`simulate`/`getQuadrantPlan`
  (reads) and `submitCalibrationVote`/`finalizeCalibration` (writes) remain untouched, unrelated
  zero-consumer dead code), and compensation (2026-07-29, **partially** deleted — 5 of 8
  FE-consumed read procedures + both write procedures; the 3 FX-dependent reads
  `getBandDistribution`/`getTotalCompBreakdown`/`getDashboardKpis` are DELIBERATELY RETAINED because
  `NEXT_PUBLIC_COMPENSATION_FX_READ_VIA_CSHARP` still does not exist in Vercel and TypeScript is
  their live prod path, and `getPayEquity`/`simulateAdjustment`/`getMarketComparison`/
  `getEmployeeComp` remain untouched zero-consumer dead code — _(this "DELIBERATELY RETAINED" claim
  is now stale, see the "UPDATE 2026-07-31" note on the Compensation entry above: the FX flag went
  permanently live and these 3 procedures were TS-deleted too)_), and engagement (2026-07-29,
  **partially** deleted — 3 of 5 write procedures, `createSurvey`/`activateSurvey`/
  `submitSurveyResponse`; `createActionPlan`/`updateActionPlan` remain untouched zero-consumer dead
  code, and — AS OF THIS 2026-07-29 ENTRY — ALL 14 read procedures were DELIBERATELY RETAINED
  because `NEXT_PUBLIC_ENGAGEMENT_READ_VIA_CSHARP` did not yet exist in Vercel and TypeScript was
  their live prod path, structurally the same reason compensation retained its 3 FX reads.
  _(UPDATE 2026-07-31: superseded for 8 of the 14 — the read flag flipped live (see the
  "Engagement — read (#166). FLIPPED AND LIVE IN PROD 2026-07-31" entry above) and the 8 reads
  with a live FE wrapper (`myPendingSurveys`/`getSurveyForResponse`/`getEnps`/`getClimateHeatmap`/
  `getLowClimateAlerts`/`listActionPlans`/`listLeaderCommitments`/`getDashboardKpis`) had their TS
  procedures deleted from `packages/api/src/routers/engagement.ts`, mirroring the other 7 domains'
  precedent. The remaining 6 — `listSurveys`, `getSurveyResults`, `getResultsByArea`,
  `getWordCloud`, `getSentiment`, `getRotationRisk` — have zero FE wrapper/query consumers and stay
  untouched, unrelated dead-or-live code, same category as compensation's 4 zero-consumer reads
  above.)_). **This closes
  the S5 item-4 TS-deletion sequence: all 12 live surfaces (across all 8 domains) have had their dead
  TS code deleted, and ZERO live surfaces are left with undeleted TS fallback code sitting behind an
  always-true flag.** **UPDATE 2026-07-31: a 9th domain joined this sequence** — access-review
  (read), whose flag (`NEXT_PUBLIC_ACCESS_REVIEW_READ_VIA_CSHARP`) flipped live the same day (see the
  Access-review entry above). All 3 registered TS read procedures
  (getAccessReview/exportAccessReviewCsv/listAccessReviewAttestations,
  `packages/api/src/routers/platform/access-review.ts`) were deleted — unlike succession/nine-box/
  compensation, no zero-consumer procedure survived, so this domain follows the
  reporting/evaluation360/team-intel/billing-usage "fully deleted read surface" pattern instead of
  the "partial" one. The TS router itself was NOT deleted outright, though — attestAccessReview (the
  write) still lives there; its own flag (`NEXT_PUBLIC_ACCESS_REVIEW_WRITE_VIA_CSHARP`) is ALSO now
  confirmed live in prod (2026-07-31, see the Access-review entry above), but its TS-deletion is a
  separate, not-yet-done follow-up task. Two known, deliberately-deferred follow-ups from this sequence, recorded here so
  they aren't lost with no successor TS-deletion branch to carry them: (1) once any domain's dark READ
  flag is eventually flipped, that domain's FE modal `invalidate()` calls that target now-C#-routed
  reads will invalidate a dead tRPC cache key instead of the real `['platform-api', <domain>, …]` key
  — a latent bug common to every dual-path wrapper in this migration, not introduced by any single
  domain's deletion, and only surfaces at the next flag flip; (2) several C# XML doc-comments across
  `services/Tims.Platform/src/**/Engagement/*.cs` still cite `engagement.ts` line numbers from before
  this domain's TS deletion (some now point at unrelated surviving code rather than failing loudly) —
  C# source was explicitly out of scope for this migration's TS-deletion sweeps, so this drift was
  never going to be caught in-branch; worth a dedicated cleanup pass, not urgent. Flipping a
  domain's flag in prod is explicitly **Federico-only, at canary**
  (`docs/superpowers/plans/2026-07-24-cutover-verification-harness.md`); TS-code deletion is AI-doable
  per-domain once a flag is confirmed live, per the reporting/evaluation360 precedent.

### Compliance-by-design — CB-1/1b/1c/2a/2b — **SHIPPED** (`docs/architecture/compliance/00-compliance-by-design-roadmap.md`)

First slices of the SOC 1 Type II / SOC 2 Type II / ISO 27001 engineering control backlog (Federico directive
2026-07-17). Prod DDL/secrets remain Federico-run; app-layer controls are live.

- **CB-1 — audit-log tamper-evidence** (`data_access_logs`, PR #143): insert-only DB trigger + `REVOKE UPDATE/DELETE` from `app_tenant` — the sensitive-read/export audit trail is now append-only at the database, not just by writer discipline.
- **CB-1b — `audit_logs` immutability** (PR #144): the twin control for the admin/security-event ledger (all
  20 `db.auditLog.create` call sites) — same insert-only trigger + revoke. _(Documented FK-cascade caveat:
  org/user hard-delete is blocked while immutable — no such delete path exists today, so this is safe, but
  it's a recorded follow-up if one is ever added.)_
- **CB-1c — security-event audit coverage** (PR #147): the previously-UNLOGGED events now write to the
  (now-immutable) trail in the live app — authN failures (`login_failed`), authZ denials
  (FORBIDDEN/UNAUTHORIZED throws in `trpc.ts`), role/permission grant edits, feature-flag bulk ops,
  platform-owner cross-org reads/exports.
- **CB-2a — MFA enforcement depth** (PR #148): closes the tRPC + impersonation-cookie MFA bypass — a
  privileged principal could previously reach protected procedures or start an impersonation session without
  MFA even when `MFA_ENFORCED=true`. **This is a different concern from the Tier-0 "MFA enforce" line below**:
  CB-2a fixed the _enforcement path_; flipping `MFA_ENFORCED=true` in prod (the actual go-live decision) is
  still open and owner-only — see Tier 0.
- **CB-2b — access-review + recertification tooling** (PR #149): users×roles×grants×last-login report +
  a per-org quarterly recertification workflow (audited export, attestation, expired/cross-org flags).
- **Not yet built** (recorded in the roadmap, not started): CB-3 (CloudTrail/GuardDuty + centralized log
  shipping), CB-4 (Terraform/CDK IaC — partially seeded by the C# migration's App Runner Terraform, PR #157; the CI-billing-bypass change-mgmt fix is still open, see Tier 0), CB-5 (Dependabot/pen-test), CB-6 (retention and erasure automation), CB-7 (backup-restore tests/DR runbook), CB-8 (continuous-compliance evidence export).

### Wave 2.5 — Access control — **COMPLETE + LIVE IN PROD** (`docs/WAVE-2.5-ACCESS-CONTROL.md`)

- All 7 slices shipped (PRs #67–#74): deny-by-default kernel, endpoint hardening, scope enforcement (recruitment + people), role-aware UI, sensitive-data k-anonymity (min-5, codex-hardened 14 rounds), membership admin, **external API-key auth (7b, #74)**.
- **✅ Wave-DATA deploy IS APPLIED in prod** (verified 2026-06-29 by direct query): the `seed-access --apply` matrix ran — 9 roles with correct scoped grants (super*admin/hr_admin/recruiter/external→`organization`, hrbp→`unit`, leader/committee→`team`, employee→`own`) replicated across all 11 orgs (98 permissions × roles); legacy recruiter over-grants (`offer:approve`, `vacancy:approve`) removed. The role matrix is genuinely enforced. *(The prior doc's "seed not yet run" note was stale.)\_

### Role-native experience — **COMPLETE** (`docs/ROLE-EXPERIENCE-REBUILD-SPEC.md`)

- Slices 0–4 shipped (PRs #75–#80 + follow-ups #81–#90): manifest-driven IA, all 7 org roles + platform_owner have distinct purpose-built tRPC-backed shells + landings; impersonation propagates effective identity to RSCs (#83).

### Recruitment ATS (the spine) — **REAL**

- Pipeline, vacancies, candidates, interviews, assessment _authoring_, offers, talent pools, recruitment analytics — all functional with working mutations.

### Candidate portal — **REAL** (`docs/WAVE-1-CANDIDATE-PORTAL.md`)

- Job board, apply (Turnstile), magic-link login, status dashboard (My Applications/Interviews/Offers + timelines), offer e-signing. (Slices 1–4)
- **Staff/candidate auth boundary RESOLVED** — token-based linking (B2), `docs/SECURITY-staff-candidate-auth-linking.md`. _(Prior doc listed this as an open SECURITY/HIGH; it shipped 2026-06-10.)_

### AI Voice Interview (ElevenLabs) — **COMPLETE** (specs 2026-06-24/26/28)

- Live conversational pre-screen (Slice 1, #92), Zoom-style call redesign (#94), **paid per-org add-on + per-type duration caps (#95)**. Gated, billed (frozen per-minute usage + add-on fee), platform-admin controlled. Ships dark per org until enabled.

### i18n enforcement — **COMPLETE** (#96, `tests/security/i18n-no-hardcoded-strings.test.ts`)

- Absolute vitest gate blocking hardcoded user-facing strings in `apps/web` (CI Security-Audit + local `/gate`). ~393 hardcoded strings across 86 files swept to `t.*` (both locales). _(The prior doc's "i18n complete, 1802 keys" was inaccurate — strings were leaking; now genuinely enforced.)_ See [[tims-i18n-enforcement]].

### 8 live gate-wired AI agents

- cv-parser, candidate-screener, vacancy-writer, inclusive-language, interview-guide, interview-summarizer, bias-detector, ai-voice-interview. Interview AI endpoints surfaced in the room UI (#89).

---

## 🔧 REMAINING — by tier (effort × impact)

### Tier 0 — Operational flips & config (cheap, high-leverage; mostly owner-action)

| Owner        | Item                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Federico     | **Stripe go-live** — set `STRIPE_SECRET_KEY` + `STRIPE_PRICE_STARTER` + `STRIPE_PRICE_PROFESSIONAL` (latter two missing from `.env.example`), register webhook, configure Billing Portal. Code is complete + verified in test mode (`docs/WAVE-2-STRIPE-BILLING.md`); dormant until keys set.                                                                                                                                                                                                                           |
| Federico     | **`DAILY_API_KEY`** — human video interviews (`interview.createVideoRoom`) now fail closed with a clear provider-config error and `.env.example` documents the required Daily.co vars. The prod/local Daily key checked on 2026-07-14 reached Daily but returned `authentication-error`, so it must be replaced with a valid key. The AI voice interview uses ElevenLabs and is unaffected.                                                                                                                             |
| Federico     | **Fix Bedrock payment instrument (AWS acct 747814092517)** — Sonnet 4.5 Marketplace subscription can't activate; 5 analysis agents (interview-summarizer/guide, bias-detector, interview-fit-score, candidate-screener) are downgraded to Haiku 4.5 as a stopgap. Restore to Sonnet in `registry.ts` once billing clears.                                                                                                                                                                                               |
| Federico     | **MFA enforce** — enroll TOTP at `/mfa`, set `MFA_ENFORCED=true` in Vercel prod. _(CB-2a, PR #148, already closed the tRPC + impersonation enforcement-path bypass, so this item is now narrower than before: it's purely the go-live flag flip, not a code gap.)_                                                                                                                                                                                                                                                      |
| —            | ~~**GitHub Actions billing**~~ — **stale, corrected 2026-08-01**: this session observed full CI runs (real build/test durations, all jobs executing) on PRs #8–#11, not the described 0-steps-in-3-11s failure. Whatever billing issue caused #195–#212's admin-overrides appears resolved (or was scoped to a window that's since passed) — not re-verified against github.com/settings/billing directly, but the symptom is gone. Branch protection (1 approval required) is what's now gating normal merges, not CI. |
| Federico     | Branch protection on `main` (6 required checks ready); `SENTRY_AUTH_TOKEN` for readable stack traces.                                                                                                                                                                                                                                                                                                                                                                                                                   |
| TIMS/product | **Per-org `AiAgentOrgConfig` budgets** — a fail-closed $25/mo cap applies until set (AI silently stops at the cap).                                                                                                                                                                                                                                                                                                                                                                                                     |
| TIMS/product | **ai-voice-interview activation** per org (platform admin → AI Agents → Orgs: enable + `billableUsdPerMinute`/`addonMonthlyFeeUsd`/caps).                                                                                                                                                                                                                                                                                                                                                                               |

### C# Backend Migration — remaining work (see DONE section above for what's built)

| Owner          | Item                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Federico       | **Per-domain production ownership flip** — 13 Phase-5 domains (external-vendor, billing invoice/usage/webhook, reporting-analytics, team-intel, evaluation360, succession, compensation, nine-box, engagement, DEI, FX-gateway, audit-log, access-review) are built + parity-verified + FLIP-READY per `table-ownership.md`, and (as of 2026-07-27) EVERY domain's FE/TS dark-cutover wrapper is ALSO built for both reads and writes with a real FE consumer — the flip is purely an infra/ops decision now, no more app code is blocking it. _(UPDATE 2026-07-28: the 2026-07-27 gap audit's caveat about billing's invoice-read having NO FE wrapper is now stale — a real FE consumer was built (`useBillingInvoices`/`useBillingInvoice` in `apps/web/lib/platform-api/billing.ts`, gated on `NEXT_PUBLIC_BILLING_INVOICES_VIA_CSHARP`, rendered by the new `apps/web/app/(admin)/settings/billing/billing-invoices.tsx` card), so billing invoice-read IS now a real flip candidate like every other surface. Access-review's zero-consumer exception noted above is unaffected — it still has no UI page to cut over.)_ Flipping a domain (dark → canary → full via `scripts/parity/cli.ts verify <surface>`), then moving its tables to `efcore` in the ledger and deleting the TS logic, is a manual, per-domain, canary-gated decision. **UPDATE 2026-07-31: 19 of ~23 flags are now flipped and live** (this line previously claimed "none has been flipped," which was already stale before this truth-up and contradicted the DONE section above — see the 2026-07-31 additions there: audit-log read, access-review read, billing invoice-read, DEI read, external-vendor read, engagement read, compensation FX-read). **UPDATE 2026-08-01: access-review write is also confirmed live** (`NEXT_PUBLIC_ACCESS_REVIEW_WRITE_VIA_CSHARP` verified present in Vercel production via `vercel env ls`) — the "remaining dark" list above was stale on this point. Remaining dark: external-vendor write, billing Stripe-webhook/self-serve write (declined) — each blocked on a distinct Federico-only action (a manual vendor API-key re-test, or the declined Stripe cutover), detailed above. |
| Federico       | **Scheduler HA** — `Workers:ClusteredSchedulerEnabled` needs the flag flipped (Phase 4 Slice 2, PR #152; currently RAMJobStore, single-replica). **⚠️ CORRECTED 2026-08-03: the DDL is ALREADY APPLIED** — all 11 `qrtz_*` tables verified present in prod. Only the flag flip remains, so this is smaller than recorded. _(Conversely, the Phase-3 `hris_\*` tables were documented as DONE but had **never** been applied; corrected the same day — see the HRIS note below. Both drifts found by querying prod rather than reading migrations, which is what #115 is about.)\_                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| —              | ~~**DB-enforce audit insert-only**~~ — **RESOLVED, doc was stale** (fixed PR #8, 2026-07-31): `docs/architecture/table-ownership.md`'s "Security follow-up" section now confirms both `data_access_logs` and `audit_logs` have the `REVOKE UPDATE, DELETE` grant + guard trigger applied in prod — found already live, nothing left to do.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| — (unclaimed)  | **DDL governance follow-ups (#118–#124)** — #115 is CLOSED: the four DDL paths are reconciled against a committed `pg_dump` baseline (`packages/db/baseline/prod-public-schema.sql`), governance is written down (`docs/architecture/ddl-governance.md`), and drift detection is wired as `/gate` **check 16**. Seven follow-ups were split out rather than bundled: **#118** declare the 11 undeclared FKs, **#119** the 6 `gen_random_uuid()` defaults, **#120** `nine_box_evaluations.updated_at` (zero provenance — adopt or drop), **#121** drop the orphaned `current_org_id()`, **#122** C# fixture drift + a wrong migration id in the ledger, **#123** `tims_ddl_log` so hand-applied psql DDL is auditable, **#124** check 16 into CI (it is local-only today). None blocks M2.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| — (unclaimed)  | **Audit/compliance domain as its own Phase-5 slice** — the audit writer is already cross-cutting (Phase-2 WP2.7 + CB-1/1b/1c), but it hasn't been formalized as a discrete strangler domain per the recommended order in `phase-5-strangler.md`. No sub-plan exists yet.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| — (unclaimed)  | **Candidate pipeline state machine** — `phase-5-strangler.md`'s recommended order deliberately saves this for later ("more cross-cutting… do it once the pattern is proven"). No sub-plan exists yet.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| TIMS/product   | **Phase 6 — Team Suite integration** — blocked on the intake study of the Azure DevOps `tims.configuration.core` repo (auth/tenant/DB model + module classification, `phase-6-team-suite.md`); no work package can start before it lands.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| — (structural) | **Phase 7 — retire TS backend + consolidate** — not started; explicitly gated on Phase 5 finishing every targeted domain.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |

### Tier 1 — Last-mile UI wiring — **DONE (PR #98, 2026-06-29)** (`docs/superpowers/specs/2026-06-29-tier1-last-mile-wiring-design.md`)

The mutations were real but no UI invoked them; all wired via shared modal pattern (useState + `Modal` + tRPC + invalidate + i18n). Shipped + live in prod:

- **Succession** — Add Successor (`addSuccessor`). ✅
- **Engagement** — Create + Launch Survey (originally `createSurvey` + `activateSurvey` draft→active; now the C# `POST /engagement/surveys` + `POST /engagement/surveys/{id}/activate` behind `useEngagementCreateSurvey`/`useEngagementActivateSurvey` — both TS procedures were deleted 2026-07-29). ✅
- **Learning** — Enroll per-course (`enrollUser`). ✅ _(enrollment "complete" deferred — needs an admin enrollment-list view; no surface exists yet.)_
- **Compensation** — Approve/Reject adjustment (atomic; originally `compensation.approveAdjustment`, now the C# `POST /compensation/adjustments/{id}/approve` behind `useCompensationApproveAdjustment` — the TS procedure was deleted 2026-07-29). ✅
- **Performance** — Create OKR / Commitment / Log Coaching session (`createOkr`/`createCommitment`/`createCoachingSession`). ✅
- **Onboarding** — Create Plan (`onboarding.create`) + inline task toggle (`updateTask`). ✅
- Out of scope (still open): Export buttons (Tier 4 CSV infra), Simulate stubs (Tier 2/sim).

### Tier 2 — Fabricated / mock data surfaced as real — **DONE (branch `feat/tier2-honest-data`, 2026-06-29)** (`docs/superpowers/specs/2026-06-29-tier2-honest-data-design.md`)

Honest-hybrid pass: real metric where data exists + cheap; honest `N/D`/`EmptyState` otherwise; fabricated trend chips deleted.

- **Platform Health** (`system.helpers.ts`) — full honesty pass (was ~8 fabricated metrics, not just the 3 the prior doc named): real DB latency (dropped the `×3` fudge); uptime / storage / DB-connections / background-jobs / AI-Bedrock / email / realtime → `N/D`; fake progressBars removed; page banner `99.97%` → `N/D`. ✅
- **Learning** course progress — `Math.random()` (`course-catalog.tsx`) replaced with the REAL per-course avg of `Enrollment.progress` (`listCourses` groupBy). ✅
- **Team-Intelligence** — `DEMO_ALERTS`/`DEMO_HIRES` panels → honest `EmptyState` ("disponible con el agente de IA"); KPIs now real `avgTenureYears` + `diversityIndex` (`getDashboardKpis`); PCA-balance + avg-performance → `N/D`; fabricated trend chips + `?? 12` fallback removed; diversity KPI honestly relabeled (was mislabeled "Shannon index"; the real calc is uniqueRoles/count). ✅
- ~~Performance OKR on-target/at-risk split (`activeOkrs*0.53/0.32`)~~ — **was never real**: no such fabricated split existed in code; `performance.getDashboardKpis` already returns a real active-OKR count + real average progress. Prior doc entry was inaccurate; nothing to fix.
- **Deferred (honestly labeled `N/D`/empty, NOT faked):** email-from-`auditLog` aggregate, avg-performance aggregate (Feedback/Recognition/OKR), Supabase storage/uptime/realtime real sources, AI-usage reuse on the health page, and the Wave-3 DISC competency model behind balance-alerts/recommended-hires. Other still-fabricated KPIs to sweep next: succession-kpis `?? 12` fallback; a `'Tecnologia'` hardcoded label on the team-intel page.

### Tier 3 — Big unbuilt features (net-new product scope)

| Priority                   | Feature                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| HIGH (core differentiator) | **Assessment Player** (`docs/WAVE-1.5a-ASSESSMENT-PLAYER.md`, approved, slice 1 authoring shipped #65). Slices 2–4 shipped: candidate take-flow backend + auto-scoring (Slice 2), player UI (Slice 3), dashboard entry point (Slice 4). **Local/dynamic norm scoring shipped** (Slice 5, `docs/superpowers/specs/2026-08-01-assessment-player-norm-scoring-design.md`): `AssessmentResult` now carries `band`/`percentile`/`normSampleSize`, computed live in `submitAssessment` against each org's own per-assessment-type population (plus a one-time backfill for pre-existing results), gated behind a minimum sample size. This is a **dynamic, self-referential norm** (candidates vs. other candidates in the same org), not a static externally-validated reference norm — that gap (fixed cutoffs from a published psychometric battery) is still open, see the LIA row below. + **Wave 1.5b webcam proctoring** (deferred, own milestone). + Wave 3 `assessment-evaluator` agent for essay scoring (lights up `assessment.getExplainability`, currently honest 501). |
| ~~MEDIUM~~ DONE            | ~~**360° Evaluations** (`docs/plans/2026-06-17-360-evaluations-greenfield.md`) — fully greenfield (no model/router/service), ~5–6 slices.~~ **This line was stale.** Shipped Sprint 1.7 (`8df2000`, 2026-07-13): `ReviewCycle`/`RaterAssignment`/`RaterResponse` schema, admin UI (`talent/360`), participant UI (`my-360`). Subsequently C#-migrated (Phase-5 Slice-7 read/Slice-13 write), flipped live in prod, TS side deleted. Fully built and live — not a backlog item.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ~~MEDIUM~~ DONE            | ~~**Commitments** — backend real, UI read-only (no create form).~~ Create form shipped (PR #98 S4, `createCommitment`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ~~MEDIUM~~ DONE            | ~~**Candidate CV/resume upload + real CV→text extraction** (S3 + PDF/DOCX) — apply is text-only today, yet `parseCV` expects CVs.~~ Shipped: public apply flow accepts an optional PDF/DOCX via presigned S3 upload, extracts text (`pdf-parse`/`mammoth`), and auto-runs `parseCV` (#251). Staff paste-text flow unchanged; malware/AV scanning and staff-side upload still fake — tracked separately.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |

### Tier 4 — Infrastructure (deferred by design / scale-gated)

- **Background workers (`workers/`)** — empty one-line stub; no Trigger.dev jobs. Caps batch AI, async scoring, scheduled jobs (billing automation, data-retention purges). Emails/exports run in-process today.
- **Real export generation** — audit, candidate-pool CSV, DEI report are stubs returning fake statuses; no CSV/XLSX pipeline wired.
- **AI agents** — ~21 of 36 catalog agents are pure stubs (`assessment-evaluator`, candidate-matcher, interview-question-gen, email-composer, etc.). ~~`interview-fit-score` is dead code~~ — **stale, corrected 2026-07-31**: it's actually wired via `analyzeAiInterview` (`ai-interview-analysis.service.ts`), called from the AI Voice Interview completion flow (`ai-interview.service.ts`) — not dead. Mock stubs to truth-up: pipeline `getNextBestAction`, candidate `getRecommendations`. ~~Catalog `status` is hardcoded `'stub'` for all 32 even though 8 are live~~ — **fixed 2026-07-31**: `seedAiAgents` now derives status from `AGENT_REGISTRY` membership, `resolveAgentId`'s upsert now promotes an existing row to `active` on every real invocation (was a no-op `update: {}` that silently froze status), and 5 real live agents (`candidate-faq`, `interview-guide`, `ai-voice-interview`, `interview-fit-score`, `fit-explainer`) that were missing from the seed catalog entirely have been added (32 → 36 entries).
- **Automated invoice generation + usage metering** — invoicing is MANUAL via `platform.createInvoice`; the AI add-on bills through it. `getUsage` returns null for storage/apiCalls (no metering source); plan limits not enforced; Stripe `invoice.*` webhooks not handled.
- **AI gateway microservice** (`services/ai-gateway`, Docker/ECS) — does not exist; in-process `packages/ai` door is the implementation.

### Tier 5 — External integration blockers

- **PCA auto-email read endpoints — MISSING** (active external blocker): the external service needs list-companies + list-candidates/results exposing **email + PcaCod + completion**. The `external` router exposes assessment results with `completedAt` only — **no email, no PcaCod, no companies/candidates listing**. See [[tims-pca-auto-email]].
- **LIA band/norm tables — MISSING** (ties to Assessment Player scoring + the nexa-platform LIA battery). See [[lia-assessment-gap-analysis]].
- **Google Calendar OAuth** for interviews (currently .ics only).
- **Real-time notifications** (websocket/SSE) for pipeline updates.

### Hygiene / recorded debt

- **ElevenLabs config**: the live gate (`routers/ai-interview.ts`) omits `ELEVENLABS_WEBHOOK_SECRET` (a missing secret → interviews run but never bill/analyze); the 3-var `lib/elevenlabs.ts` helper is dead. Consolidate; add EL vars to `.env.example` + `lib/env.ts`; rotate any committed secrets.
- **ExchangeRate-API attribution + subprocessor registration**: the C# FX gateway (`ExchangeRateApiGateway`, `services/Tims.Platform/src/Tims.Infrastructure/Fx/`) uses ExchangeRate-API's free/open tier, whose ToS requires (a) attribution — a link to https://www.exchangerate-api.com somewhere in the product once its rates are used to render converted amounts in the UI — and (b) registering it as a data subprocessor (SOC2). Neither is done yet; do both before/when `NEXT_PUBLIC_COMPENSATION_FX_READ_VIA_CSHARP` is flipped live. See `docs/architecture/csharp-migration/fx-provider-swap-2026-07-28.md`.
- **i18n stragglers** the scanner can't catch (precision-first): a handful of detector-missed literals (e.g. a `'Iniciar Sesion'`-class button) + 2 server→client conversions (`auth/layout.tsx`, `why-work-section.tsx`) made to use the hook; `global-error.tsx` keeps a hardcoded ES fallback (no `I18nProvider` in scope) — allowlisted.
- **Wave 2.5 follow-ups (recorded, not faked):** `data_access_logs` purge job + its `@@index([organizationId, createdAt])`; consent 30-day anonymization job (matrix-compliant deferral); shared Zod/const unions for dataType/action/consentType; `tims:perm:` legacy cache-prefix removal; candidate→employee role transition (needs product def); several accepted k-anonymity residuals (org-wide ratio denominators, `getBenefitsUtilization` head-count, `getEnps` div-guard artifact); tighten DEI/engagement tests toward behavioral (note: engagement's ONLY behavioral test, `tests/tier1/s2-activate-survey.test.ts`, was retired on 2026-07-29 together with its subject — the deleted `activateSurvey` TS procedure — so the remaining engagement tests are all static-tripwire or pure-kernel; the behavioral coverage now lives in `EngagementWriteTests.cs` and the parity harness).
- **Talent-pool mobile filter drawer** (filters hidden <md — deliberate tradeoff).
- **Honest-unavailable panels** awaiting backing features: external market salary feed (compensation), NLP service (climate wordcloud/sentiment).
- **Nine-box** grid is select-only (no drag-to-persist; "Simulador" is a declared backend stub).

---

## Remaining — blocked on user / product decisions

| Owner        | Task                                                                                                                                              |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| TIMS/product | Trim audit/feature_flags/monitoring/organization from `hr_admin` allowlist (needs product confirm).                                               |
| TIMS/product | Candidate self-service data deletion (right-to-erasure) — subject EXPORT exists; deletion is manual (backlog if product commits to self-service). |
| Federico     | Phone re-test of the mobile sweep → report findings for surgical fixes.                                                                           |

## Deferred by design (rule #9 — build for the trigger, not the dream)

- Presidio PII strip/re-inject (input sanitization + Bedrock Guardrails MASK cover today's scale).
- Supabase sa-east-1 migration; Prisma read replicas; pgvector (Phase 4+).
- Payroll/IT-provisioning integrations, external LMS, external eval vendors, custom connector SDK (per Architecture doc exclusions, Phase 10+).
