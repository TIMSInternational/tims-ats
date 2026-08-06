using Microsoft.Extensions.Options;
using Tims.Api.Configuration;
using Tims.Application.AlertMetrics;
using Tims.Domain.AlertMetrics;

namespace Tims.Api.AlertMetrics;

/// <summary>
/// The PRIVILEGED CROSS-ORG alert-metric read surface (Q0b slice 2) — the C# side of the two metrics the
/// alert-evaluation cron computes over soon-to-flip tables: <c>active_surveys</c> (`surveys`, flip #64) and
/// <c>pending_salary_adjustments</c> (`salary_adjustments`, flip #66).
///
/// One endpoint, one metric, one org: <c>GET /internal/alert-metrics?organizationId=…&amp;metric=…</c>. That
/// shape is a deliberate 1:1 with the TS <c>computeMetric(orgId, metric)</c> it ports, so parity is a
/// direct comparison rather than a reshaping exercise. The cron already issues one query per (org, metric).
///
/// <b>Authentication:</b> <see cref="CronCallerGate"/> — the shared cron secret, NOT a user identity. Read
/// that class before changing anything here; it is the entire tenant-isolation boundary for a reader that
/// runs outside RLS.
///
/// <b>Response:</b> a scalar outcome, never rows.
/// <c>{ metric, organizationId, status: "value"|"suppressed"|"unavailable", value?, reason? }</c>.
/// `suppressed` carries NO number: the sensitive metric's min-5 floor is applied server-side
/// (<see cref="AlertMetricsReadUseCase"/>) so this surface cannot be used to route around the TS
/// exact-count oracle guard.
///
/// Dark by default (<see cref="PlatformOptions.AlertMetricsCronReadEnabled"/> = false) — mapping is skipped
/// entirely, so the route 404s. Steps 1-4 of the strangler recipe only: TS remains the sole live reader.
/// </summary>
public static class AlertMetricsEndpoints
{
    public static void MapAlertMetricsEndpoints(this WebApplication app)
    {
        app.MapGet("/internal/alert-metrics", async (
                Guid? organizationId,
                string? metric,
                HttpContext httpContext,
                IOptions<PlatformOptions> platformOptions,
                AlertMetricsReadUseCase useCase,
                CancellationToken cancellationToken) =>
            {
                // AUTH FIRST — before parsing, before touching the database. A malformed request from an
                // unauthenticated caller must be indistinguishable from a well-formed one (both 401), or the
                // 400/401 split becomes a probe for whether the surface exists and what it accepts.
                var unauthorized = CronCallerGate.Authorize(httpContext, platformOptions.Value);
                if (unauthorized is not null)
                {
                    return unauthorized;
                }

                if (organizationId is null || organizationId.Value == Guid.Empty)
                {
                    return Results.BadRequest(new { error = "organizationId is required" });
                }

                if (!AlertMetricKeys.TryParse(metric, out var parsed))
                {
                    // Fail closed on an unknown key rather than defaulting to a metric: returning SOME
                    // number for a key this surface does not implement is how a dead metric looks healthy.
                    return Results.BadRequest(new { error = "unknown metric" });
                }

                var outcome = await useCase.ComputeAsync(organizationId.Value, parsed, cancellationToken);
                var key = AlertMetricKeys.ToKey(parsed);

                return outcome switch
                {
                    AlertMetricOutcome.Value value => Results.Ok(
                        new AlertMetricResponse(key, organizationId.Value, "value", value.Count, null)),
                    AlertMetricOutcome.Suppressed => Results.Ok(
                        new AlertMetricResponse(key, organizationId.Value, "suppressed", null, null)),
                    AlertMetricOutcome.Unavailable unavailable => Results.Ok(
                        new AlertMetricResponse(key, organizationId.Value, "unavailable", null, unavailable.Reason)),
                    _ => throw new InvalidOperationException($"Unhandled outcome: {outcome.GetType()}"),
                };
            })
            // ANONYMOUS by design: the cron secret IS the credential, checked in the handler. Same pattern as
            // the Stripe webhook (BillingWebhookEndpoints). Attaching .RequireAuthorization() here would be
            // actively WRONG — it would admit every holder of a valid tenant JWT to a cross-org reader.
            .AllowAnonymous()
            .Produces<AlertMetricResponse>(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status400BadRequest)
            .Produces(StatusCodes.Status401Unauthorized)
            .WithName("GetAlertMetric");
    }
}

/// <summary>
/// The wire shape. <c>Value</c> is null for both `suppressed` and `unavailable` — a caller that reads only
/// <c>value</c> and ignores <c>status</c> gets null, not a fabricated 0, so it cannot mistake "could not
/// compute" for "no breach".
/// </summary>
public sealed record AlertMetricResponse(
    string Metric,
    Guid OrganizationId,
    string Status,
    int? Value,
    string? Reason);
