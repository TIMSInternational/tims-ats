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
    /// Phase-5 Slice 11c: when true, the C# FX-derived READ surface is mapped and live — the FIVE deferred
    /// compensation FX reads (<c>GET /compensation/band-distribution</c>, <c>/compensation/pay-equity</c>,
    /// <c>/compensation/simulate-adjustment</c>, <c>/compensation/total-comp-breakdown</c>,
    /// <c>/compensation/dashboard-kpis</c>) PLUS <c>GET /dei/pay-equity</c>. Each resolves its conversion rate
    /// from the DB-pinned <c>fx_rates</c> via <see cref="Tims.Application.Fx.IFxRateProvider"/> (latest
    /// effective-dated pin, cross-rate via USD) and shapes money through the pure convertMoney/sumMoney kernels;
    /// a cold-start missing pin FAILS SOFT (the FX-derived field is omitted/suppressed, never a 500). The
    /// k-anon min-5 + scope/field-auth mechanics mirror Slice-9/11b. Dark-by-default (TS's live currency.ts +
    /// frankfurter path stays the sole active reader until Federico flips it AFTER the first FxRefreshJob run
    /// populates fx_rates at canary).
    /// </summary>
    public bool FxReadsEnabled { get; init; }

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
}
