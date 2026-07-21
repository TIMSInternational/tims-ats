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

    /// <summary>JWKS metadata address (the .well-known/jwks.json URL) for asymmetric verification.</summary>
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
}
