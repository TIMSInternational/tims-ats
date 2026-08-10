using Microsoft.Extensions.Options;
using Tims.Api.Configuration;
using Tims.Application.AlertMetrics;
using Tims.Domain.AlertMetrics;

namespace Tims.Api.AlertMetrics;

/// <summary>
/// The CROSS-ORG alert-metric read surface (§8 Q0b slice 2, issue #172) — the C# side of the two metrics
/// the alert-evaluation cron computes over soon-to-flip tables: <c>active_surveys</c> (`surveys`, flip
/// #64) and <c>pending_salary_adjustments</c> (`salary_adjustments`, flip #66). Those two reads are the
/// last blocker on both flips.
///
/// <para>One endpoint, one metric, one org:
/// <c>GET /internal/alert-metrics?organizationId=…&amp;metric=…</c>. That shape is a deliberate 1:1 with
/// the TS <c>computeMetric(orgId, metric)</c> it ports, so parity is a direct comparison rather than a
/// reshaping exercise — and it is what lets each read run RLS-scoped to a single named org
/// (<c>AlertMetricsReadRepository</c>) instead of bypassing row-level security.</para>
///
/// <para><b>Authentication:</b> <see cref="CronCallerGate"/> — a shared cron secret, NOT a user identity.
/// Read that class before changing anything here; it is the entire authorization boundary for a caller
/// that may name any organization.</para>
///
/// <para><b>Response:</b> a scalar outcome, never rows.
/// <c>{ metric, organizationId, status: "value"|"suppressed"|"unavailable", value?, reason? }</c>.
/// <c>suppressed</c> carries NO number: the sensitive metric's min-5 floor is applied server-side in
/// <see cref="AlertMetricsReadUseCase"/> so this surface cannot be used to route around the TS
/// exact-count oracle guard.</para>
///
/// <para>Dark by default (<see cref="PlatformOptions.AlertMetricsCronReadEnabled"/> = false) — mapping is
/// skipped entirely, so the route 404s. TS remains the sole live reader until the flag is flipped.</para>
/// </summary>
public static class AlertMetricsEndpoints
{
    /// <summary>
    /// The route template. Exposed as a constant because <c>RateLimitMiddleware</c> must exempt this exact
    /// path — the cron is a single machine caller hitting an ANONYMOUS route, so the anonymous IP-keyed
    /// limiter would otherwise 429 the surface's only intended caller partway through a platform-wide run.
    /// A literal duplicated in the middleware could drift from the route silently; a shared constant
    /// cannot.
    /// </summary>
    public const string RoutePath = "/internal/alert-metrics";

    public static void MapAlertMetricsEndpoints(this WebApplication app)
    {
        app.MapGet(RoutePath, async (
                // BOTH parameters are bound as raw strings and parsed by hand below. Binding
                // organizationId as Guid? looks tidier but is wrong here: ASP.NET's model binding runs
                // BEFORE the handler, so a malformed value would 400 without ever reaching the auth
                // check, letting an unauthenticated caller probe the surface's parameter types. Binding
                // as string moves every rejection behind the gate. (Caught by
                // AlertMetricsEndpointTests.Auth_is_checked_before_input_validation, which failed against
                // the Guid? version.)
                string? organizationId,
                string? metric,
                HttpContext httpContext,
                IOptions<PlatformOptions> platformOptions,
                AlertMetricsReadUseCase useCase,
                CancellationToken cancellationToken) =>
            {
                // AUTH FIRST — before parsing, before touching the database. A malformed request from an
                // unauthenticated caller must be indistinguishable from a well-formed one (both 401), or
                // the 400/401 split becomes a probe for whether the surface exists and what it accepts.
                var unauthorized = CronCallerGate.Authorize(httpContext, platformOptions.Value);
                if (unauthorized is not null)
                {
                    return unauthorized;
                }

                if (!Guid.TryParse(organizationId, out var orgId) || orgId == Guid.Empty)
                {
                    return Results.BadRequest(new { error = "organizationId is required" });
                }

                if (!AlertMetricKeys.TryParse(metric, out var parsed))
                {
                    // Fail closed on an unknown key rather than defaulting to a metric: returning SOME
                    // number for a key this surface does not implement is how a dead metric looks healthy.
                    return Results.BadRequest(new { error = "unknown metric" });
                }

                var outcome = await useCase.ComputeAsync(orgId, parsed, cancellationToken);
                var key = AlertMetricKeys.ToKey(parsed);

                return outcome switch
                {
                    AlertMetricOutcome.Value value => Results.Ok(
                        new AlertMetricResponse(key, orgId, "value", value.Count, null)),
                    AlertMetricOutcome.Suppressed => Results.Ok(
                        new AlertMetricResponse(key, orgId, "suppressed", null, null)),
                    AlertMetricOutcome.Unavailable unavailable => Results.Ok(
                        new AlertMetricResponse(key, orgId, "unavailable", null, unavailable.Reason)),
                    _ => throw new InvalidOperationException($"Unhandled outcome: {outcome.GetType()}"),
                };
            })
            // ANONYMOUS by design: the cron secret IS the credential, checked in the handler. Attaching
            // .RequireAuthorization() here would be actively WRONG — it would admit every holder of a
            // valid tenant JWT to the authentication stage of a cross-org reader.
            .AllowAnonymous()
            .Produces<AlertMetricResponse>(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status400BadRequest)
            .Produces(StatusCodes.Status401Unauthorized)
            .WithName("GetAlertMetric");
    }
}

/// <summary>
/// The wire shape. <c>Value</c> is null for both <c>suppressed</c> and <c>unavailable</c> — a caller that
/// reads only <c>value</c> and ignores <c>status</c> gets null, not a fabricated 0, so it cannot mistake
/// "could not compute" for "no breach".
/// </summary>
public sealed record AlertMetricResponse(
    string Metric,
    Guid OrganizationId,
    string Status,
    int? Value,
    string? Reason);
