using System.ComponentModel.DataAnnotations;

namespace Tims.Api.Configuration;

/// <summary>
/// Strongly-typed platform configuration, bound from the "Platform" config section and
/// validated at startup (see Program.cs: ValidateDataAnnotations + ValidateOnStart). This
/// is the C# analog of the TS Zod env gate — a missing required value fails the process
/// FAST at boot, never at first request. Secrets are sourced from env / the platform
/// secret store, never committed; appsettings.json carries only non-secret dev defaults.
/// </summary>
public sealed class PlatformOptions
{
    public const string SectionName = "Platform";

    /// <summary>Human-readable service name (OTel resource, logs).</summary>
    [Required]
    public string ServiceName { get; init; } = "tims-platform";

    /// <summary>
    /// Postgres connection string used by the readiness probe (and, from Phase 2, the
    /// tenant/privileged EF data sources). Required — absence fails startup.
    /// </summary>
    [Required]
    public string DatabaseConnectionString { get; init; } = string.Empty;

    /// <summary>
    /// Redis connection string (Upstash/StackExchange form). Optional in Phase 1: when
    /// absent, the readiness probe reports Redis as "not configured" (Degraded, not fatal)
    /// rather than pinging a server that does not exist yet.
    /// </summary>
    public string? RedisConnectionString { get; init; }

    /// <summary>
    /// OTLP exporter endpoint for traces (the existing OTel/Sentry backend). Optional:
    /// when absent, traces are still produced but not exported (no-op exporter).
    /// </summary>
    public string? OtlpEndpoint { get; init; }

    // --- Supabase JWT (WP2.1) ---------------------------------------------------------
    // Optional in Phase 2 (no product traffic yet): when unset the JWT scheme is wired
    // but fail-closed (no valid issuer/keys → every token rejected). Real values come from
    // env at deploy. `sub` carries the Supabase user id → the TIMS principal (WP2.2).

    /// <summary>Expected token issuer, e.g. https://&lt;project&gt;.supabase.co/auth/v1.</summary>
    public string? SupabaseJwtIssuer { get; init; }

    /// <summary>Expected audience. Supabase signs end-user tokens with aud "authenticated".</summary>
    public string SupabaseJwtAudience { get; init; } = "authenticated";

    /// <summary>
    /// OIDC discovery address for asymmetric verification — the
    /// <c>.well-known/openid-configuration</c> URL (NOT the raw <c>.well-known/jwks.json</c>;
    /// a JWKS URL loads zero signing keys → all tokens 401). A mistaken jwks.json value is
    /// normalized to its openid-configuration sibling (SupabaseJwtMetadata). When unset, the
    /// issuer's discovery document is used (Program.cs Authority fallback).
    /// </summary>
    public string? SupabaseJwksMetadataAddress { get; init; }

    /// <summary>
    /// Comma-separated list of browser origins allowed to call this API cross-origin
    /// (e.g. "https://tims-ats.vercel.app"). Explicit origins only — never a wildcard.
    /// Empty/unset ⇒ no browser origin is allowed (fail-safe). Server-to-server callers
    /// send no Origin header and are unaffected.
    /// </summary>
    public string? AllowedCorsOrigins { get; init; }

    // --- Platform-owner impersonation (WP2.4) -----------------------------------------

    /// <summary>
    /// HMAC secret for the platform-owner impersonation cookie (the C# analog of the TS
    /// <c>NEXTAUTH_SECRET</c>). Optional and fail-closed: when unset, impersonation is simply
    /// UNAVAILABLE (<see cref="Tims.Domain.Identity.ImpersonationCookie.VerifyImpersonationToken"/>
    /// returns null for every cookie), so a platform owner always resolves to their own context.
    /// </summary>
    public string? ImpersonationSecret { get; init; }

    // --- Phase-5 strangler deploy flags (dark-by-default) ------------------------------
    // The REAL per-surface deploy flags that make "exactly one active runtime writer/reader"
    // a runtime FACT, not just a ledger claim. Both DEFAULT false (dark): when a flag is off
    // the corresponding external route is NOT mapped (a request 404s), so deploying Tims.Api
    // adds NO second live writer/reader — TS stays the sole active stack for the surface until
    // Federico flips the flag per-surface at canary (dark → canary → full). The OpenAPI
    // document still describes the routes at build time (see Program.cs — the GetDocument doc
    // generation forces them mapped), so the contract stays accurate while runtime stays dark.

    /// <summary>
    /// Phase-5 Slice 2 (efcoreStranglerWrite): when true, the C# external-vendor validation WRITE
    /// surface (<c>POST /external/validations/{id}/result</c>) is mapped and live. DEFAULT false
    /// (dark) — the C# writer to <c>preemployment_validations</c> stays inert so TS remains the
    /// single active writer until cutover.
    /// </summary>
    public bool ExternalVendorWriteEnabled { get; init; }

    /// <summary>
    /// Phase-5 Slice 1 (efcoreReadOnly): when true, the C# external-vendor assessment READ surface
    /// (<c>GET /external/assessment-results[...]</c>) is mapped and live. DEFAULT false (dark) — TS
    /// remains the single active reader until cutover.
    /// </summary>
    public bool ExternalVendorReadEnabled { get; init; }

    /// <summary>
    /// Phase-5 Slice 3 (efcoreReadOnly): when true, the C# billing invoice READ surface
    /// (<c>GET /billing/invoices[...]</c>) is mapped and live. The FIRST staff-JWT C# product read.
    /// DEFAULT false (dark) — TS remains the single active reader until cutover.
    /// </summary>
    public bool BillingReadEnabled { get; init; }

    /// <summary>
    /// Phase-5 Slice 3b (efcoreReadOnly): when true, the C# billing usage/plan/config READ surface
    /// (<c>GET /billing/usage</c>, <c>/billing/plan</c>, <c>/billing/config</c>) is mapped and live.
    /// DEFAULT false (dark) — TS remains the single active reader until cutover (separate flag from
    /// <see cref="BillingReadEnabled"/> for finer per-surface canary control).
    /// </summary>
    public bool BillingUsageEnabled { get; init; }

    /// <summary>
    /// Phase-5 Slice 4 (efcoreStranglerWrite): when true, the C# Stripe billing WEBHOOK write surface
    /// (<c>POST /billing/webhooks/stripe</c>) is mapped and live — the state-sync engine that upserts
    /// <c>subscriptions</c> and mirrors <c>organizations.plan</c>. DEFAULT false (dark): the C# writer stays
    /// inert so the TS webhook remains the SINGLE active writer to <c>subscriptions</c> until Federico flips
    /// this at canary. This is a COEXISTENCE write, not the ownership flip (subscriptions still has other
    /// non-webhook writers — see docs/architecture/csharp-migration/phase-5-slice-4-billing-webhook-writes.md).
    /// </summary>
    public bool BillingWebhookWriteEnabled { get; init; }

    /// <summary>
    /// Phase-5 Slice 4b (efcoreStranglerWrite + efcoreAppendOnly): when true, the C# tenant self-serve billing
    /// WRITE surface (<c>POST /billing/checkout-session</c>, <c>/billing/portal-session</c>,
    /// <c>/billing/cancel-subscription</c>) is mapped and live — Stripe checkout/portal/cancel + the customer-link
    /// compare-and-set + the fail-soft audit_logs write. DEFAULT false (dark): TS remains the sole active
    /// self-serve path until Federico flips this at canary.
    /// </summary>
    public bool BillingSelfServeEnabled { get; init; }

    /// <summary>
    /// Phase-5 Slice 5 (efcoreReadOnly): when true, the C# recruitment-analytics READ surface
    /// (<c>GET /reporting/kpis|funnel|source-breakdown|trend|lost-by-delay|recruiter-sla</c>) is mapped and
    /// live. Staff-JWT + <c>vacancy:read</c> + organization/company scope (the org-rollup gate); the queries
    /// aggregate ORG-WIDE pipeline/offer data. DEFAULT false (dark) — TS remains the single active reader
    /// until cutover.
    /// </summary>
    public bool ReportingReadEnabled { get; init; }

    /// <summary>
    /// Phase-5 (efcoreStranglerWrite): when true, the C# STAFF pre-employment-validation WRITE surface
    /// (<c>PATCH /validations/{id}</c>) is mapped and live — the SECOND strangler writer on
    /// <c>preemployment_validations</c> (the external-vendor submit is the first). Staff-JWT + <c>offer:update</c>
    /// + the by-id IDOR probe on the parent offer. DEFAULT false (dark): the C# writer stays inert so the TS
    /// staff <c>updateValidation</c> remains the SINGLE active writer to this surface until Federico flips it at
    /// canary. Completing BOTH strangler writers (external + staff) makes the table flip-ready; the ownership
    /// flip to <c>efcore</c> stays deferred to cutover.
    /// </summary>
    public bool ValidationStaffWriteEnabled { get; init; }

    /// <summary>
    /// Phase-5 Slice 6 (efcoreReadOnly): when true, the C# team-intel READ surface
    /// (<c>GET /team-intel/teams/{id}/{profile|members|balance-score|balance-alerts|recommended-hires}</c>,
    /// <c>/team-intel/compare</c>, <c>/team-intel/dashboard-kpis</c>) is mapped and live. Staff-JWT +
    /// <c>team_intel:read</c>; the by-id reads run the <c>assertScoped('team')</c> IDOR probe (the FIRST live
    /// scope-probe on a READ path), compare composes <c>scopeWhereFor('team')</c>, and dashboard-kpis applies
    /// the organization/company org-gate (Codex F3). DEFAULT false (dark) — TS remains the single active
    /// reader until cutover.
    /// </summary>
    public bool TeamIntelReadEnabled { get; init; }

    /// <summary>
    /// Phase-5 Slice 7 (efcoreReadOnly): when true, the C# evaluation360 READ surface is mapped and live —
    /// <c>GET /evaluation360/cycles</c> + <c>/evaluation360/cycles/{id}/progress</c> (STAFF:
    /// <c>evaluation360:read</c> + organization/company org-gate), and <c>GET /evaluation360/my/rater-tasks</c>,
    /// <c>/evaluation360/my/reports/{cycleId}</c>, <c>/evaluation360/my/report-cycles</c> (SELF-SERVICE: identity
    /// only — any resolved principal, NO grant, NO scope — hard-filtered on the caller's own user id). The
    /// <c>myReport</c> aggregation reuses the shared <c>Eval360Aggregate</c> min-3 anonymity kernel. DEFAULT false
    /// (dark) — TS remains the single active reader until Federico flips it at canary (deploy-gated cutover).
    /// </summary>
    public bool Evaluation360ReadEnabled { get; init; }

    /// <summary>
    /// Phase-5 Slice 8 (efcoreReadOnly): when true, the C# succession READ surface is mapped and live —
    /// <c>GET /succession/critical-roles[/{id}][/suggested-successors|/simulate-exit]</c>,
    /// <c>/succession/flight-risk</c>, <c>/succession/competency-coverage</c>,
    /// <c>/succession/roles-without-successor</c>, <c>/succession/comp-gap-alerts</c>,
    /// <c>/succession/dashboard-kpis</c>. Staff-JWT + <c>succession:read</c>; the reads exercise ALL THREE scope
    /// mechanics — <c>scopeWhereFor</c> (row filter), <c>assertScoped('criticalRole')</c> (by-id IDOR probe,
    /// 404-not-403), and <c>requireOrgScope</c> (org-rollup, narrow → 403, Codex F3). getCompGapAlerts also
    /// enforces a secondary <c>compensation:read</c> grant + audits every exposed comp row fail-closed. DEFAULT
    /// false (dark) — TS remains the single active reader until Federico flips it at canary (deploy-gated cutover).
    /// </summary>
    public bool SuccessionReadEnabled { get; init; }

    /// <summary>
    /// Phase-5 Slice 9 (efcoreReadOnly): when true, the C# FX-free compensation READ surface is mapped and live
    /// — <c>GET /compensation/salary-bands</c>, <c>/compensation/market-comparison</c>,
    /// <c>/compensation/benefits-utilization</c>, <c>/compensation/compa-ratio-distribution</c>,
    /// <c>/compensation/pending-adjustments</c>, <c>/compensation/employee/{userId}</c>,
    /// <c>/compensation/my-compensation</c>. Staff-JWT + <c>compensation:read</c>: salary-bands/market-comparison
    /// are grant-only; benefits-utilization/compa-ratio-distribution apply the org-gate (Codex F3);
    /// pending-adjustments composes <c>scopeWhereFor('salaryAdjustment')</c> + <c>selectFor</c> field-auth +
    /// fail-closed audit; employee/{userId} does <c>assertSubjectInScope</c> (out-of-set → 403) + selectFor +
    /// audit; my-compensation is own-pinned (subject = caller). The five FX reads + two writes stay on TS. DEFAULT
    /// false (dark) — TS remains the single active reader until Federico flips it at canary (deploy-gated cutover).
    /// </summary>
    public bool CompensationReadEnabled { get; init; }

    /// <summary>
    /// Phase-5 Slice 10 (efcoreReadOnly): when true, the C# nine-box READ surface is mapped and live —
    /// <c>GET /ninebox/grid</c>, <c>/ninebox/employee/{userId}[/axis-breakdown]</c>,
    /// <c>/ninebox/movement-history</c>, <c>/ninebox/simulate</c>, <c>/ninebox/calibrations[/{id}]</c>,
    /// <c>/ninebox/my-calibrations</c>, <c>/ninebox/quadrant-plan</c>, <c>/ninebox/bench-strength</c>,
    /// <c>/ninebox/dashboard-kpis</c>. Staff-JWT + <c>ninebox:read</c>; the eleven reads span
    /// <c>scopeWhereFor('nineBoxEvaluation')</c> (getGrid/getMovementHistory), <c>assertSubjectInScope</c>
    /// (getEmployeeDetail/getAxisBreakdown → 403 out-of-set), <c>requireOrgScope</c> (listCalibrations/
    /// getBenchStrength/getDashboardKpis, Codex F3), the hand-rolled calibration membership gate (getCalibration
    /// → 404/403) + created-by-OR-member self list (myCalibrations), and the grant-only PURE reads (simulate/
    /// getQuadrantPlan). DEFAULT false (dark) — TS remains the single active reader until Federico flips it at
    /// canary (deploy-gated cutover).
    /// </summary>
    public bool NineBoxReadEnabled { get; init; }

    /// <summary>
    /// Phase-5 Slice 11 (efcoreReadOnly): when true, the C# engagement READ surface is mapped and live —
    /// <c>GET /engagement/surveys[/{id}/results|/take|/results-by-area|/word-cloud|/sentiment]</c>,
    /// <c>/engagement/my/pending-surveys</c>, <c>/engagement/enps</c>, <c>/engagement/climate-heatmap</c>,
    /// <c>/engagement/alerts</c>, <c>/engagement/action-plans</c>, <c>/engagement/leader-commitments</c>,
    /// <c>/engagement/dashboard-kpis</c>, <c>/engagement/rotation-risk</c>. Staff-JWT + <c>engagement:read</c>; the
    /// 14 reads span grant-only + per-item min-5 (listSurveys), OWN identity-anchored with NO org-gate
    /// (myPendingSurveys/getSurveyForResponse), <c>requireOrgScope</c> (the 9 org-rollup aggregates — narrow
    /// team/unit/own → 403), and <c>scopeWhereFor('actionPlan'|'leaderCommitment')</c> row filters
    /// (listActionPlans/listLeaderCommitments). The five aggregate suppression shapers (survey-results / eNPS /
    /// climate / results-by-area / dashboard-KPI differencing guard) are the pure @tims/shared /
    /// Tims.Domain.Engagement kernels (golden-parity both stacks); the wire is the raw model/kernel shape (no
    /// schemaVersion — INTERNAL read). DEFAULT false (dark) — TS remains the single active reader until Federico
    /// flips it at canary (deploy-gated cutover). The five writes stay on TS.
    /// </summary>
    public bool EngagementReadEnabled { get; init; }

    /// <summary>
    /// Phase-5 Slice 11b (efcoreReadOnly): when true, the C# DEI READ surface is mapped and live —
    /// <c>GET /dei/dashboard-kpis</c>, <c>/dei/gender-representation</c>, <c>/dei/age-distribution</c>,
    /// <c>/dei/nationality-diversity</c>, <c>/dei/ethnicity-distribution</c>, <c>/dei/disability-distribution</c>,
    /// <c>/dei/leadership-diversity</c>, <c>/dei/hiring-funnel</c>, <c>/dei/promotion-equity</c>,
    /// <c>/dei/inclusion-index</c>. Staff-JWT + <c>dei:read</c> (GRANT-ONLY — the reads are org-wide demographic
    /// rollups whose disclosure control is min-5 k-anonymity, NOT an org-scope gate). The demographic group-bys read
    /// the THREE native Prisma enums on <c>employee_demographics</c> (Gender/Ethnicity/DisabilityStatus) into CLR
    /// enums via a dedicated enum-mapped data source, isolated behind a holder so it never bleeds into the
    /// string-based contexts. The suppression/ratio shapers (buildDistribution / leadershipDiversity /
    /// deiDashboardKpis / inclusionIndex + pct/median/ageBand) are the pure @tims/shared / Tims.Domain.Dei kernels
    /// (golden-parity both stacks). DEFAULT false (dark) — TS remains the single active reader until Federico flips
    /// it at canary (deploy-gated cutover). getPayEquity (FX) → Slice 11c; the generateReport mutation stays on TS.
    /// </summary>
    public bool DeiReadEnabled { get; init; }

    /// <summary>
    /// Dark-by-default gate for the Phase-5 Slice-17 cross-org audit-log READ surface
    /// (platform.getCrossOrgAuditLogs/exportAuditLogsCsv). Mapped only when true, or during
    /// OpenAPI-doc generation. TS stays the sole active reader until Federico flips this at canary.
    /// </summary>
    public bool AuditLogReadEnabled { get; init; }

    /// <summary>
    /// Phase-5 Slice 11c: when true, the C# FX-derived READ surface is mapped and live — the FIVE deferred
    /// compensation FX reads (<c>GET /compensation/band-distribution</c>, <c>/compensation/pay-equity</c>,
    /// <c>/compensation/simulate-adjustment</c>, <c>/compensation/total-comp-breakdown</c>,
    /// <c>/compensation/dashboard-kpis</c>) PLUS <c>GET /dei/pay-equity</c>. Each resolves its conversion rate
    /// from the DB-pinned <c>fx_rates</c> via <see cref="Tims.Application.Fx.IFxRateProvider"/> (latest
    /// effective-dated pin, cross-rate via USD) and shapes money through the pure convertMoney/sumMoney kernels;
    /// a cold-start missing pin FAILS SOFT (the FX-derived field is omitted/suppressed, never a 500). The
    /// k-anon min-5 + scope/field-auth mechanics mirror Slice-9/11b. Dark-by-default (TS's live currency.ts +
    /// frankfurter path stays the sole active reader until Federico flips it AFTER the first FxRefreshJob run
    /// populates fx_rates at canary; the upstream FX data provider was swapped from Frankfurter to
    /// ExchangeRate-API 2026-07-28 — see docs/architecture/csharp-migration/fx-provider-swap-2026-07-28.md).
    ///
    /// <para>⚠️ CORRECTION 2026-08-15 — the parenthetical above is now HISTORY, not state. The flip
    /// happened (measured true on the live App Runner service), the FE-consumed TS implementations were
    /// deleted, and the populator is no longer only the FxRefreshJob: see <see cref="FxRefreshEnabled"/>
    /// below for the staleness incident that sequence produced and the API-hosted refresh that ends it.
    /// The original text is kept because it records what was DESIGNED; the incident is precisely the gap
    /// between it and what was deployed.</para>
    /// </summary>
    public bool FxReadsEnabled { get; init; }

    /// <summary>
    /// When true, THIS API host runs the daily FX-rate refresh in-process (<c>FxRefreshHostedService</c>:
    /// one run at startup as a catch-up, then every <c>Fx:RefreshIntervalHours</c>), writing pins into
    /// <c>fx_rates</c> through the SAME <c>RefreshFxRatesUseCase</c> the Workers Quartz job drives.
    /// DEFAULT FALSE (dark), like every other flag here.
    ///
    /// <para><b>Why this exists — the 2026-08-15 staleness incident.</b> The refresh was designed to run
    /// in <c>Tims.Workers</c>, and <see cref="FxReadsEnabled"/>'s own docblock records the intended
    /// sequence: flip the reads AFTER "the first FxRefreshJob run populates fx_rates". What actually
    /// happened: the one-off <c>FxSeedOnce</c> tool satisfied the SUBSTANCE of that precondition on
    /// 2026-07-31 (fx_rates populated — though not its letter, which named a FxRefreshJob run that never
    /// happened), the reads flipped live, and the FE-consumed TS implementations were deleted —
    /// getBandDistribution, getTotalCompBreakdown, getDashboardKpis, plus dei.getPayEquity
    /// (compensation.getPayEquity and simulateAdjustment keep zero-consumer TS twins, so FOUR of the six
    /// live endpoints have no fallback at all). And the Workers host was NEVER DEPLOYED
    /// (one App Runner service exists: <c>tims-platform-api</c>). Every production pin stayed frozen at
    /// <c>as_of 2026-07-31</c>, so the LIVE compensation FX reads and <c>dei.getPayEquity</c> served
    /// progressively staler conversions with no fallback — measured at a 2.4% COP drift after fifteen
    /// days. This flag lets the ALREADY-DEPLOYED host keep the pins fresh with a single env-var flip,
    /// instead of standing up a second service.</para>
    ///
    /// <para>INDEPENDENT of <see cref="FxReadsEnabled"/>, in both directions — reads-on/refresh-off is
    /// exactly the broken state above, and refresh-on/reads-off is a valid warm-up. Multiple API
    /// instances refreshing concurrently is safe by construction: the upsert is
    /// <c>ON CONFLICT (base_currency, quote_currency, as_of) DO UPDATE</c>, so racing writers converge on
    /// the same row.
    /// If the Workers host is ever deployed, BOTH schedulers may run — same idempotent write, no
    /// coordination needed; turn this off at that point for tidiness, not correctness.</para>
    /// </summary>
    public bool FxRefreshEnabled { get; init; }

    /// <summary>
    /// Phase-5 Slice 12 (efcoreStranglerWrite): when true, the C# compensation WRITE surface is mapped and live —
    /// <c>POST /compensation/adjustments</c> (createAdjustment) + <c>POST /compensation/adjustments/{id}/approve</c>
    /// (approveAdjustment). The FIRST WRITE port of the compensation domain. Staff-JWT + <c>compensation:create</c> /
    /// <c>compensation:approve</c>: createAdjustment does <c>assertSubjectInScope</c> on the TARGET userId (out-of-set
    /// → 403) + the currency fallback + a pending INSERT (id+status only, §21); approveAdjustment does
    /// <c>assertScoped('salaryAdjustment', id)</c> (by-id IDOR probe → 404) + a fail-closed audit BEFORE the mutation
    /// + the atomic conditional transaction (pending-only transition → count-0 CONFLICT, then the
    /// employee_compensations propagation — commit/roll-back together). COEXISTENCE write on
    /// <c>salary_adjustments</c> + <c>employee_compensations</c> (still read by CompensationReadDbContext). DEFAULT
    /// false (dark) — TS remains the single active writer until Federico flips it at canary (deploy-gated cutover).
    /// </summary>
    public bool CompensationWriteEnabled { get; init; }

    /// <summary>
    /// Phase-5 Slice 13 (efcoreStranglerWrite): when true, the C# evaluation360 WRITE surface is mapped and live — the
    /// 5 STAFF writes <c>POST /evaluation360/cycles</c> (createCycle), <c>/cycles/{id}/open|close|publish</c>
    /// (open/close/publishCycle), <c>/cycles/{id}/raters</c> (assignRaters), plus the SELF-SERVICE
    /// <c>POST /evaluation360/assignments/{id}/ratings</c> (submitRatings). The WRITE port completing the
    /// evaluation360 domain after Slice-7 (the 5 reads). The STAFF writes use Staff-JWT + <c>evaluation360:create</c>
    /// (createCycle/assignRaters) / <c>evaluation360:update</c> (the three transitions) + the organization/company
    /// org-gate (<c>requireOrgScope</c>, Codex F3); the transitions are guarded conditional ExecuteUpdate (count-0 ⇒
    /// CONFLICT, draft→open→closed→published only) and assignRaters does an in-tx status re-check + org-membership
    /// validation + a skipDuplicates ON CONFLICT insert. submitRatings is IDENTITY-anchored (the Slice-7
    /// Evaluation360SelfServiceGate — any resolved principal, NO grant, NO scope; every query/write HARD-FILTERS on
    /// rater_user_id = caller so an org-scoped admin can never submit forged feedback for another rater → NOT_FOUND),
    /// with an atomic claim-idempotency transition + the 6 rater_responses insert. The three native Prisma enum
    /// columns are filtered/set via the Slice-7 enum-mapped data source (isolated behind Evaluation360WriteDataSourceHolder).
    /// COEXISTENCE write on review_cycles + rater_assignments + rater_responses (still read by Evaluation360ReadDbContext);
    /// the domain is now FLIP-READY (eval360-owned). DEFAULT false (dark) — TS remains the single active writer until
    /// Federico flips it at canary (deploy-gated cutover).
    /// </summary>
    public bool Evaluation360WriteEnabled { get; init; }

    /// <summary>
    /// Phase-5 Slice 14 (efcoreStranglerWrite): when true, the C# succession WRITE surface is mapped and live — the
    /// 5 writes <c>POST /succession/critical-roles</c> (addCriticalRole), <c>POST
    /// /succession/critical-roles/{id}/successors</c> (addSuccessor), <c>DELETE /succession/successors/{id}</c>
    /// (removeSuccessor), <c>PATCH /succession/successors/{id}/readiness</c> (updateSuccessorReadiness),
    /// <c>PATCH /succession/critical-roles/{id}/band</c> (updateCriticalRoleBand). The WRITE port completing the
    /// succession domain after Slice-8 (the 9 reads) — the domain is now FLIP-READY (the cleanest flip candidate:
    /// nothing outside the succession router touches critical_roles/successors). Staff-JWT + <c>succession:create</c>
    /// (addCriticalRole/addSuccessor) / <c>:delete</c> (removeSuccessor) / <c>:update</c> (updateSuccessorReadiness/
    /// updateCriticalRoleBand); the 5 writes carry DIFFERENT scope mechanics on the same grants: addCriticalRole
    /// requires org/company scope (<c>requireOrgScope</c> — narrow → 403), addSuccessor runs
    /// <c>assertScoped('criticalRole')</c> (parent IDOR probe → 404) THEN <c>assertSubjectInScope(userId)</c>
    /// (write-rule subject check → 403), and remove/updateReadiness/updateBand run the by-id <c>assertScoped</c>
    /// probe (→ 404). addSuccessor stamps addedById = caller and maps the <c>@@unique([criticalRoleId, userId])</c>
    /// violation → 409 CONFLICT (documented improvement over the TS 500). criticality/readiness/type are plain-string
    /// enum sets enforced at the endpoint (→ 400 after auth). COEXISTENCE write on critical_roles + successors (still
    /// read by SuccessionReadDbContext). DEFAULT false (dark) — TS remains the single active writer until Federico
    /// flips it at canary (deploy-gated cutover).
    /// </summary>
    public bool SuccessionWriteEnabled { get; init; }

    /// <summary>
    /// Phase-5 Slice 15 (efcoreStranglerWrite): when true, the C# nine-box calibration WRITE surface is mapped and
    /// live — the 5 writes <c>POST /ninebox/calibrations</c> (createCalibration), <c>POST
    /// /ninebox/calibrations/{sessionId}/votes</c> (submitCalibrationVote), <c>POST
    /// /ninebox/calibrations/{sessionId}/members</c> (addCalibrationMember), <c>DELETE
    /// /ninebox/calibrations/{sessionId}/members/{userId}</c> (removeCalibrationMember), <c>POST
    /// /ninebox/calibrations/{sessionId}/finalize</c> (finalizeCalibration). The WRITE port completing the nine-box
    /// domain after Slice-10 (the 11 reads) — the calibration surface is now FLIP-READY (nothing outside the ninebox
    /// router touches calibration_sessions/members/votes). Staff-JWT + <c>ninebox:create</c> (createCalibration) /
    /// <c>ninebox:update</c> (the other four); the 5 writes carry DIFFERENT scope mechanics:
    /// createCalibration/addCalibrationMember/removeCalibrationMember/finalizeCalibration require org/company scope
    /// (<c>requireOrgScope</c> — org governance; a narrow committee grant → 403), while submitCalibrationVote is
    /// MEMBERSHIP+IDENTITY anchored (NO requireOrgScope — the session must exist → 404, the VOTER (caller, never
    /// input) must be a calibration_member → 403, the evaluatedUser must be in-org → 404; voter_id = caller so a
    /// non-member can't forge/overwrite another member's vote). createCalibration also validates every memberId in-org
    /// BEFORE the nested insert (cross-tenant hardening → 400, fixed in BOTH stacks). addCalibrationMember maps the
    /// <c>@@unique([session_id, user_id])</c> violation → 409; removeCalibrationMember/finalizeCalibration map count-0
    /// → 404 (a documented improvement over the TS P2025→500). TENANCY: calibration_members/votes have NO
    /// organization_id — the RLS session-subquery WITH CHECK (session-org) is the tenant guard; the vote upsert is a
    /// raw ON-CONFLICT INSERT (EF has no native upsert). status/quadrant are plain Strings (NOT native enums), so no
    /// NpgsqlDataSource. COEXISTENCE write on calibration_sessions + calibration_members + calibration_votes (still
    /// read by NineBoxReadDbContext). DEFAULT false (dark) — TS remains the single active writer until Federico flips
    /// it at canary (deploy-gated cutover).
    /// </summary>
    public bool NineBoxWriteEnabled { get; init; }

    /// <summary>
    /// Phase-5 Slice 16 (efcoreStranglerWrite): when true, the C# engagement WRITE surface is mapped and live — the
    /// 5 writes <c>POST /engagement/surveys</c> (createSurvey), <c>POST /engagement/surveys/{id}/activate</c>
    /// (activateSurvey), <c>POST /engagement/surveys/{id}/responses</c> (submitSurveyResponse), <c>POST
    /// /engagement/action-plans</c> (createActionPlan), <c>PATCH /engagement/action-plans/{id}</c>
    /// (updateActionPlan). The WRITE port completing the engagement domain after Slice-11 (the 14 reads). Staff-JWT +
    /// <c>engagement:create</c> (createSurvey/activateSurvey/submitSurveyResponse/createActionPlan) /
    /// <c>engagement:update</c> (updateActionPlan); the 5 writes carry DIFFERENT scope mechanics on the same grants:
    /// createSurvey/activateSurvey are grant-only (org via ctx); submitSurveyResponse is IDENTITY-anchored (userId =
    /// caller ALWAYS, never an input — an org-admin cannot forge another user's response; NO requireOrgScope);
    /// createActionPlan runs <c>assertSubjectInScope(responsibleId)</c> (out-of-set → 403); updateActionPlan runs
    /// <c>assertScoped('actionPlan')</c> (by-id IDOR probe → 404) THEN <c>assertSubjectInScope(responsibleId)</c> on a
    /// reassignment (→ 403). createActionPlan AND updateActionPlan(reassign) ALSO reject a cross-org
    /// <c>responsibleId</c> → 403 (the H1 both-stacks hardening — assertSubjectInScope no-ops for org/company scope, so
    /// an in-org existence check under TenantScope is the backstop; fixed in engagement.ts too). submitSurveyResponse
    /// maps the <c>@@unique([surveyId, userId])</c> violation → 409 "Ya respondiste esta encuesta"; the survey
    /// not-found-or-inactive path returns a clean 404 (a documented port improvement over the TS plain-Error 500).
    /// targetGroups is stored as opaque jsonb (NO in-org validation — faithful port; a documented LOW). type/status
    /// are plain-string enum sets enforced at the endpoint (→ 400 after auth). COEXISTENCE write on surveys +
    /// survey_responses + action_plans (still read by EngagementReadDbContext AND by the LIVE TS monitoring.ts /
    /// dei.ts / alert-evaluation cron; leader_commitments + alerts stay read-only). DEFAULT false (dark) — TS remains
    /// the single active writer until Federico flips it at canary (deploy-gated cutover).
    /// </summary>
    public bool EngagementWriteEnabled { get; init; }

    /// <summary>
    /// Phase-5 Slice 24 / #90 (efcoreReadOnly on candidates/vacancies/job_profiles/ai_interview_sessions/
    /// assessment_assignments/assessment_results — reads only): when true, the C# FIT-engine READ surface is
    /// mapped and live — <c>GET /fit-engine/vacancies/{id}/ranking</c> (getRankingForVacancy),
    /// <c>/fit-engine/vacancies/{id}/simulate-weights</c> (simulateWeights),
    /// <c>/fit-engine/weight-profiles</c> (listRoleFamilyWeightProfiles), and
    /// <c>/fit-engine/vacancies/{id}/candidates/{id}/explain-fit</c> (explainFit — every pre-LLM observable
    /// reproduced, then 501: the narrative needs the TS-only Bedrock pipeline). Staff-JWT + fit_engine:read;
    /// the vacancy-scoped reads run the assertScoped('vacancy') by-id IDOR probe. DEFAULT false (dark) —
    /// TS remains the single active reader until Federico flips it at canary (deploy-gated cutover).
    /// </summary>
    public bool FitEngineReadEnabled { get; init; }

    /// <summary>
    /// Phase-5 Slice 24 / #90 (efcoreStranglerWrite on fit_scores + role_family_weight_profiles): when true, the
    /// C# FIT-engine WRITE surface is mapped and live — <c>POST /fit-engine/vacancies/{id}/compute</c>
    /// (computeForVacancy: per-active-pipeline-candidate deterministic scoring + atomic fit_scores upsert; may
    /// bootstrap the 'Default' weight profile) and <c>POST /fit-engine/weight-profiles</c>
    /// (upsertRoleFamilyWeightProfile). Staff-JWT + fit_engine:create/update. DEFAULT false (dark).
    /// ⚠️ This flag is the one-active-writer control for the ROUTER write path ONLY — it is NOT a complete
    /// writer switch for the two tables, and saying so would be false. TWO further TS writers sit outside the
    /// ported router and outside any flag: <c>candidateAiService.screenCandidate</c>
    /// (candidate-ai.service.ts:112) calls <c>fitEngineService.computeFitScore</c>, which upserts
    /// <c>fit_scores</c> AND can bootstrap the <c>Default</c> <c>role_family_weight_profiles</c> row; and
    /// <c>candidateRepository.merge</c> (candidate.repository.ts:458) DELETES <c>fit_scores</c> rows for a
    /// merged-away duplicate. Both must be ported or accounted for BEFORE step 6 moves either table to
    /// <c>efcore[]</c>. <c>efcoreStranglerWrite</c> tolerates exactly this coexistence, which is why the ledger
    /// entry is honest while an unqualified one-active-writer claim would not be.
    /// </summary>
    public bool FitEngineWriteEnabled { get; init; }

    /// <summary>
    /// Phase-5 Slice 18 (efcoreReadOnly on users/roles/user_roles/role_permissions/permissions/
    /// organizations — Phase 2; access_reviews stays Prisma-owned until this flips): when true, the
    /// C# access-review READ surface is mapped and live — <c>GET /access-review</c> (the report),
    /// <c>/access-review/export</c> (CSV), <c>/access-review/attestations</c> (history).
    /// Platform-owner-only (PlatformOwnerGate, reused verbatim from Slice 17 — NO permission grant,
    /// NO tenant scope), org-scoped by a required <c>organizationId</c> query parameter (NOT RLS — see
    /// docs/architecture/csharp-migration/phase-5-slice-18-access-review.md). DEFAULT false (dark) —
    /// TS remains the single active reader until Federico flips it at canary.
    /// </summary>
    public bool AccessReviewReadEnabled { get; init; }

    /// <summary>
    /// Phase-5 Slice 18 (moves `access_reviews` to efcoreStranglerWrite in the table-ownership
    /// ledger, Task 9): when true, the C# access-review WRITE surface is mapped and live —
    /// <c>POST /access-review/attest</c>. The FIRST C# write to `access_reviews`; refuses (412) a
    /// truncated org rather than persist under-counted compliance evidence, matching TS exactly.
    /// DEFAULT false (dark) — TS remains the single active writer until Federico flips it at canary.
    /// </summary>
    public bool AccessReviewWriteEnabled { get; init; }

    /// <summary>
    /// Phase-5 Q0b slice 1 / issue #100 (efcoreReadOnly): when true, the C# monitoring READ surface is
    /// mapped and live — <c>GET /monitoring/executive-kpis</c>, <c>/monitoring/module-health</c>,
    /// <c>/monitoring/alerts</c>, <c>/monitoring/action-plan-alerts</c>,
    /// <c>/monitoring/cross-module-trend</c>, <c>/monitoring/alert-rules</c>. Staff-JWT +
    /// <c>monitoring:read</c>. Only <c>action-plan-alerts</c> carries a scope mechanic
    /// (<c>scopeWhereFor('actionPlan')</c> row filter); the other five are org-wide aggregates with NO
    /// org-gate, faithfully matching the live TS reader, which grants <c>monitoring:read</c> to
    /// <c>hrbp</c> at UNIT scope. <c>executive-kpis.pendingAdjustments</c> and the
    /// <c>engagement</c> trend metric are k-anon floored (the latter ALL-OR-NOTHING across the window).
    ///
    /// This is the prerequisite read surface the ownership-flip runbook §7b calls "the true gating item
    /// for #64": monitoring is the last TS Prisma reader of <c>surveys</c>/<c>survey_responses</c> (#64),
    /// <c>salary_adjustments</c> (#66) and <c>action_plans</c> (#68). The two monitoring WRITES
    /// (<c>dismissAlert</c>, <c>configureAlertRules</c>) are NOT in this flag — separate write slice.
    ///
    /// DEFAULT false (dark) — TS remains the single active reader until Federico flips it at canary.
    /// </summary>
    public bool MonitoringReadEnabled { get; init; }

    /// <summary>
    /// Phase-5 slice 19 (issue #76) — the platform-owner ORGANIZATIONS READ surface: the C# port of
    /// <c>getOrganizationKpis</c>, <c>listOrganizations</c> and <c>getOrganization</c> from
    /// <c>routers/platform/organizations.ts</c>.
    ///
    /// Gated by <c>PlatformOwnerGate</c> and deliberately CROSS-ORG — never wrapped in TenantScope, so
    /// the gate is the entire authorization boundary (RLS restricts nothing on this path, and the prod
    /// role is BYPASSRLS regardless).
    ///
    /// The organization WRITES are NOT in this flag — they need their own one-active-writer discipline
    /// rather than riding a read flag. <c>updateOrganization</c>/<c>suspendOrganization</c> ship behind
    /// <see cref="PlatformOrganizationsWriteEnabled"/> (slice 20) and <c>createOrganization</c> behind
    /// <see cref="PlatformOrganizationsCreateEnabled"/> (slice 21).
    ///
    /// DEFAULT false (dark) — TS remains the single active reader until Federico flips it at canary.
    /// </summary>
    public bool PlatformOrganizationsReadEnabled { get; init; }

    /// <summary>
    /// Phase-5 slice 20 (issue #76) — the platform-owner ORGANIZATIONS WRITE surface: the C# port of
    /// <c>updateOrganization</c> and <c>suspendOrganization</c> from
    /// <c>routers/platform/organizations.ts</c>.
    ///
    /// <c>createOrganization</c> is NOT here. It is a 7-table provisioning transaction with its own
    /// blast radius, so it ships behind its own flag — <see cref="PlatformOrganizationsCreateEnabled"/>
    /// (slice 21), which also carries the shared <c>org-provisioning</c> service #75 depends on.
    ///
    /// THIS FLAG IS THE ONE-ACTIVE-WRITER CONTROL. It moves <c>organizations</c> into
    /// <c>efcoreStranglerWrite</c> in docs/architecture/table-ownership.md: Prisma still owns the DDL and
    /// the TS procedures are still present, so exactly one runtime writer is guaranteed only because the
    /// routes are not mapped while this is false. Turning it on WITHOUT retiring the TS path leaves two
    /// active writers of the same rows.
    ///
    /// Unlike the read flag, this surface DOES run under <c>TenantScope</c>: the target organization id is
    /// known, so RLS stays engaged instead of resting on the prod role being BYPASSRLS. The audit write is
    /// FAIL-CLOSED inside that same transaction — a deliberate divergence from the TS
    /// <c>.catch(() =&gt; {})</c>, decided on #76.
    ///
    /// DEFAULT false (dark) — TS remains the single active writer until Federico flips it at canary.
    /// </summary>
    public bool PlatformOrganizationsWriteEnabled { get; init; }

    /// <summary>
    /// Phase-5 slice 21 (issue #76) — the platform-owner ORGANIZATION CREATE surface: the C# port of
    /// <c>createOrganization</c> from <c>routers/platform/organizations.ts:149-242</c>, together with the
    /// shared <c>org-provisioning</c> service (<c>OrgProvisioningWriter</c>) that #75 also depends on.
    ///
    /// SEPARATE from <see cref="PlatformOrganizationsWriteEnabled"/> on purpose. That flag governs
    /// single-row UPDATEs of one table; this one governs a SEVEN-table provisioning transaction
    /// (organizations + companies + business_units + teams + org_entitlements + roles + subscriptions).
    /// Riding the update flag would make one canary decision cover two wildly different blast radii.
    ///
    /// THIS FLAG IS THE ONE-ACTIVE-WRITER CONTROL, and unlike slice 20 it can NEVER become an ownership
    /// flip: apps/web/app/auth/callback/route.ts (self-serve signup) creates the same seven tables in its
    /// own transaction — FOUR of them (companies, business_units, teams, org_entitlements) through the same
    /// shared helpers at :92-93, and organizations/roles/subscriptions INLINE at :80, :96 and :122 — so the
    /// TS writer cannot be retired by this surface.
    ///
    /// Runs UNDER <c>TenantScope</c> opened on the NEW organization id, generated client-side before the
    /// transaction: <c>organizations</c>' policy is <c>id = current_org_id</c> and the other six are
    /// <c>organization_id = current_org_id</c>, so every WITH CHECK passes for the rows being inserted.
    /// The audit write is FAIL-CLOSED inside that transaction — a deliberate divergence from the TS
    /// <c>.catch(() =&gt; {})</c>, decided on #76. The notification fan-out is outside it, and its failure
    /// PROPAGATES (a 500 after a committed create), which is TS parity: <c>organizations.ts:220</c> awaits
    /// <c>notify</c> with no catch.
    ///
    /// DEFAULT false (dark) — TS remains the single active writer until Federico flips it at canary.
    /// </summary>
    public bool PlatformOrganizationsCreateEnabled { get; init; }

    /// <summary>
    /// Phase-5 slice 22 (issue #75) — the platform-owner INVITATIONS READ surface: the C# port of
    /// <c>getInvitationKpis</c>, <c>listInvitations</c> and <c>exportInvitationsCsv</c> from
    /// <c>routers/platform/invitations.ts</c>.
    ///
    /// Gated by <c>PlatformOwnerGate</c> and deliberately CROSS-ORG — never wrapped in TenantScope, so the
    /// gate is the entire authorization boundary (RLS restricts nothing on this path, and the prod role is
    /// BYPASSRLS regardless). Read-only over Prisma-owned tables: this slice adds no writer and moves
    /// nothing between the ownership ledger's arrays.
    ///
    /// THIS FLAG COVERS THREE OF THAT ROUTER'S TEN PROCEDURES. The remaining seven are deliberately out,
    /// in three groups, because they are three different problems:
    ///   • <c>revokeInvitation</c> + <c>bulkInviteUsers</c> — writes, needing their own one-active-writer
    ///     flag rather than riding a read flag.
    ///   • <c>getInvitationByToken</c> + <c>acceptInvitation</c> — <c>publicProcedure</c>: UNAUTHENTICATED
    ///     and token-credentialed. Every surface ported to this service so far has been authenticated, so
    ///     this is a NEW auth shape that gets its own slice, its own flag and its own threat model. It must
    ///     NOT ride this flag: a reviewer reading "invitations read is on" would have no reason to expect
    ///     two anonymous endpoints to come on with it.
    ///   • <c>createOrgInvitation</c> + <c>createUserInvitation</c> + <c>resendInvitation</c> — all three
    ///     send email via <c>packages/api/src/lib/ses.ts</c>, and this service has NO email capability
    ///     (measured: no AWS SDK, no SMTP, no MailKit, no sender abstraction anywhere in
    ///     <c>services/Tims.Platform</c>). Porting them now would yield endpoints that write the invitation
    ///     row and silently never deliver it — a failure that only becomes visible after a flip.
    ///
    /// DEFAULT false (dark) — TS remains the single active reader until Federico flips it at canary.
    /// </summary>
    public bool PlatformInvitationsReadEnabled { get; init; }

    /// <summary>
    /// Phase-5 slice 23 (issue #81) — the platform-owner DASHBOARD READ surface: the C# port of ALL
    /// THIRTEEN procedures of <c>routers/platform/dashboard*.ts</c>, shipped in four steps.
    ///   • PR 1: <c>getPlanDistribution</c>, <c>getUserGrowth</c>, <c>getRecentActivity</c>.
    ///   • PR 2: <c>getAttentionItems</c>, <c>getMrrTrend</c>, <c>getMrrForecast</c>,
    ///     <c>getCustomerHealth</c>, <c>getUpsellOpportunities</c>, <c>search</c>.
    ///
    /// Gated by <c>PlatformOwnerGate</c> and deliberately CROSS-ORG — never wrapped in TenantScope, so the
    /// gate is the entire authorization boundary (RLS restricts nothing on this path, and the prod role is
    /// BYPASSRLS regardless). Read-only over Prisma-owned tables: this slice adds no writer and moves
    /// nothing between the ownership ledger's arrays.
    ///
    /// ONE FLAG FOR ALL THIRTEEN, deliberately: they are the same surface, the same gate and the same
    /// console page, and a canary that lit up three of thirteen dashboard panels would be harder to judge
    /// than one that lights the whole cluster. The cost is that the flip is all-or-nothing.
    ///
    /// The FOUR reads that shipped after PRs 1-2 (nine live in <c>dashboard.ts</c>, four in its
    /// churn/forecast/upsell siblings, all merged flat into the platform router), completing the cluster:
    ///   • <c>getDashboardKpis</c> + <c>getRevenueByCustomer</c> + <c>getChurnRisk</c> — call
    ///     <c>sumMoney</c> → FX rate resolution (the churn one from <c>dashboard-churn.ts:55</c>); they
    ///     needed fx conversion machinery and a live-rate parity strategy, and shipped in PR 3
    ///     (<c>PlatformDashboardFxReadEndpoints</c>).
    ///   • <c>getAiCostAnomalies</c> — needed EF maps and NEW ledger entries for THREE genuinely unmapped
    ///     tables: <c>ai_agent_org_configs</c>, <c>ai_agent_usage_logs</c>, and <c>ai_agents</c> (its
    ///     <c>agent</c> join). An earlier version counted two and grouped <c>getUpsellOpportunities</c>
    ///     here too; that procedure reads only already-mapped tables and shipped in PR 2. Shipped last
    ///     (<c>PlatformDashboardAiReadEndpoints</c>) — with it, ALL THIRTEEN reads are under this flag.
    ///
    /// THREE ICU / LOCALE HAZARDS ARE LIVE ON THIS SURFACE, all pinned in
    /// <c>contracts/dashboard-fixtures/dashboard-kernels.json</c> rather than trusted:
    /// <c>toLocaleDateString('es', { month: 'short' })</c> emits "sept"; the MRR pair's
    /// <c>{ month: 'short', year: '2-digit' }</c> is a separate format ("sept 26"); and
    /// <c>getAttentionItems</c> bakes <c>Number.toLocaleString()</c> — with NO locale argument, so the
    /// PROCESS DEFAULT — into an invoice description that ships on the wire. The C# port hardcodes the
    /// en-US rule ICU resolves to; a Node process with a different default locale would diverge on every
    /// overdue-invoice description, and the golden test says so out loud.
    ///
    /// DEFAULT false (dark) — TS remains the single active reader until Federico flips it at canary.
    /// </summary>
    public bool PlatformDashboardReadEnabled { get; init; }

    /// <summary>
    /// MFA step-up enforcement (#173) — the platform-service counterpart of the web app's
    /// <c>MFA_ENFORCED</c>. When exactly "true", a PRIVILEGED principal (platform owner or
    /// super_admin) on an <c>aal1</c> session is refused with 403 + <c>{"message":"MFA_REQUIRED"}</c>
    /// by <see cref="Tims.Api.Authentication.MfaStepUpMiddleware"/>.
    ///
    /// A STRING, not a bool, on purpose: <see cref="Tims.Domain.Identity.MfaGate.IsEnforced"/> ports
    /// the TS rule that ONLY the exact "true" enables the gate, so a garbled value fails OPEN and can
    /// never lock privileged operators out of production. Binding it as bool would let the
    /// configuration layer coerce "TRUE"/"1"/"yes" and quietly widen that contract.
    ///
    /// Set it to the SAME value as the web app's MFA_ENFORCED — a session refused by one stack and
    /// served by the other is the exact hole this closes.
    /// </summary>
    public string? MfaEnforced { get; init; }

    /// <summary>
    /// §8 Q0b slice 2 / issue #172: when true, the cross-org alert-metric read surface is mapped and live
    /// — <c>GET /internal/alert-metrics?organizationId=…&amp;metric=…</c>, serving <c>active_surveys</c>
    /// (`surveys`, flip #64) and <c>pending_salary_adjustments</c> (`salary_adjustments`, flip #66) to the
    /// alert-evaluation cron. Authenticated by <see cref="AlertMetricsCronSecret"/>, NOT by any user
    /// identity.
    ///
    /// This is the last prerequisite on flips #64 and #66: the alert cron is the final TS Prisma reader of
    /// both tables once the monitoring surface (<see cref="MonitoringReadEnabled"/>) is live.
    ///
    /// DEFAULT false (dark) — the route is not mapped at all and 404s; TS remains the single active reader
    /// until Federico flips it at canary. Flipping this WITHOUT setting the secret leaves the surface
    /// reachable but permanently 401 (the gate fails closed), which is the safe ordering.
    /// </summary>
    public bool AlertMetricsCronReadEnabled { get; init; }

    /// <summary>
    /// The shared secret the alert-evaluation cron presents in <c>X-Tims-Cron-Secret</c> to authenticate
    /// against the cross-org alert-metric surface (#172). This is the ENTIRE authorization boundary for a
    /// caller that may name any organization, so it must be a high-entropy value from Secrets Manager,
    /// never a literal in configuration.
    ///
    /// Unset/empty/whitespace ⇒ every request to that surface is refused
    /// (<see cref="Tims.Api.AlertMetrics.CronCallerGate"/> fails closed). It must match the web app's
    /// <c>ALERT_METRICS_CRON_SECRET</c>, which is a DIFFERENT secret from the Vercel <c>CRON_SECRET</c>
    /// that authenticates Vercel to the Next.js route: one authenticates the scheduler to the web app,
    /// this one authenticates the web app to the platform service. Reusing a single value across both
    /// hops would mean a leak at either end grants both.
    /// </summary>
    public string? AlertMetricsCronSecret { get; init; }

    /// <summary>
    /// #181: may the inbound <c>x-real-ip</c> header be trusted as the client address? DEFAULT (unset) is
    /// NO — <see cref="Tims.Api.Http.TrustedProxyHeaderMiddleware"/> strips it, and
    /// <see cref="Tims.Domain.Http.ClientIp"/> falls through to the last <c>X-Forwarded-For</c> hop, the
    /// entry an appending proxy controls.
    ///
    /// This service runs on App Runner with no ALB or CloudFront in front, and App Runner does not set or
    /// strip <c>x-real-ip</c> — so trusting it made the forensic IP on every audit row caller-chosen, and
    /// let a caller rotate the anonymous rate-limit key. Set this to the exact string "true" ONLY if an
    /// edge that genuinely writes AND overwrites the header is placed in front of the service.
    ///
    /// A STRING, not a bool, for the same reason as <see cref="MfaEnforced"/>: the configuration layer
    /// must not be able to coerce "1"/"yes"/"TRUE" into widening a trust decision. Note the polarity is
    /// the opposite of MfaEnforced — a garbled value here fails to the SAFE (stripping) side.
    /// </summary>
    public string? TrustXRealIpHeader { get; init; }

    /// <summary>
    /// #181 — the KILL SWITCH for <see cref="Tims.Api.Authentication.SecurityDenialAuditMiddleware"/>.
    /// Exact "true" removes it from the pipeline entirely.
    ///
    /// <para><b>Note the polarity, and why it is not <c>…Enabled</c> like every other surface here.</b>
    /// Those flags gate NEW surfaces that ship dark, so `Enabled = false` is the safe default. This
    /// middleware is ALREADY LIVE in production — it went in with #177 and is unconditional. Expressing
    /// it as `SecurityDenialAuditEnabled` with the house default of `false` would mean the next deploy
    /// silently switched OFF a live security control, which is exactly the class of accident the flag is
    /// meant to protect against. So it is phrased as a disable, and the absent/garbled value keeps the
    /// control ON.</para>
    ///
    /// <para><b>Why a switch at all.</b> It is a global middleware on the auth path that adds a DB write
    /// to every 401/403. The image is deployed by immutable tag with auto-deployments off, so without
    /// this the only way to stop it misbehaving in production is a rebuild, push, tag change and
    /// redeploy. Turning off an audit control is itself a risk, so flipping it logs a startup WARNING
    /// rather than passing silently — an operator who forgets to flip it back should have to explain a
    /// log line.</para>
    /// </summary>
    public string? SecurityDenialAuditDisabled { get; init; }
}
