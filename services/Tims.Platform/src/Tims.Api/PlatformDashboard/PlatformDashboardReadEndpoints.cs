using System.Security.Claims;
using Microsoft.Extensions.Options;
using Tims.Api.Audit;
using Tims.Api.Configuration;
using Tims.Application.Identity;
using Tims.Application.PlatformDashboard;

namespace Tims.Api.PlatformDashboard;

/// <summary>
/// The FX-free platform dashboard READ endpoints (Phase-5 slice 23, issue #81, PR 1 of 3) — the C# port of
/// THREE of the platform dashboard cluster's thirteen reads (<c>routers/platform/dashboard*.ts</c> — nine
/// live in <c>dashboard.ts</c> itself, four in its churn/forecast/upsell siblings, all merged flat into the
/// platform router): <c>getPlanDistribution</c>, <c>getUserGrowth</c> and <c>getRecentActivity</c>.
///
/// <para><b>Gate: <see cref="PlatformOwnerGate"/>, reused not re-implemented</b> — the documented C# analog
/// of TS <c>platformProcedure</c>, which already denies an impersonated owner correctly (they resolve to
/// <c>PrincipalType.OrgUser</c>). It runs FIRST on every endpoint. There is no second line of defence, and
/// that is deliberate: this surface is cross-org by design, never wrapped in <c>TenantScope</c>, so the
/// gate IS the authorization boundary — the same disposition as the invitations and organizations reads.</para>
///
/// <para><b>None of the three procedures takes ANY input</b>, so TRAP 9 (minimal-API binding 400s before
/// the gate) has no surface here: there are no parameters to bind, and every response is 200/401/403/404 —
/// never 400. That absence is itself parity: the TS procedures declare no <c>.input()</c>.</para>
///
/// <para><b>The other TEN dashboard procedures are NOT here, deliberately, in three groups.</b>
/// <c>getDashboardKpis</c>, <c>getRevenueByCustomer</c> and <c>getChurnRisk</c> call <c>sumMoney</c>
/// (<c>lib/currency.ts</c> — the churn one from <c>dashboard-churn.ts:55</c>) → LIVE Frankfurter FX rates;
/// they need the fx conversion machinery plus a live-rate parity strategy, and port LAST. An earlier
/// version of this list swapped <c>getChurnRisk</c> with <c>getCustomerHealth</c> — the panel counted the
/// call sites. <c>getAiCostAnomalies</c> needs EF maps + ledger entries for THREE genuinely unmapped
/// tables (<c>ai_agent_org_configs</c>, <c>ai_agent_usage_logs</c>, and <c>ai_agents</c> via its
/// <c>agent</c> join — an earlier version said two and also grouped <c>getUpsellOpportunities</c> here,
/// which reads only already-mapped tables). The remaining SIX FX-free reads (<c>getAttentionItems</c>,
/// <c>getMrrTrend</c>, <c>getMrrForecast</c>, <c>getCustomerHealth</c>, <c>getUpsellOpportunities</c>,
/// <c>search</c> — MRR from <c>PLAN_PRICES</c> USD constants, no live FX) are portable under this same
/// flag in follow-up sub-slices.</para>
///
/// <para><b>No caching, faithfully.</b> Unlike <c>getDashboardKpis</c> (45s cache), NONE of these three TS
/// procedures touches <c>cacheGet</c>/<c>cacheSet</c> — every call hits the database. Adding a cache here
/// would be an improvement, and improvements make step-5 parity uninterpretable.</para>
///
/// <para>INTERNAL staff read ⇒ RAW procedure shape, NO <c>schemaVersion</c> envelope. Dark-by-default
/// behind <see cref="PlatformOptions.PlatformDashboardReadEnabled"/>.</para>
/// </summary>
public static class PlatformDashboardReadEndpoints
{
    public static void MapPlatformDashboardReadEndpoints(this WebApplication app)
    {
        app.MapGet(
                "/platform/dashboard/plan-distribution",
                async (
                    ClaimsPrincipal user,
                    HttpContext httpContext,
                    PrincipalResolver principalResolver,
                    IOptions<PlatformOptions> options,
                    PlatformDashboardReadUseCase useCase,
                    CancellationToken cancellationToken) =>
                {
                    var gate = await PlatformOwnerGate.AuthorizeAsync(user, httpContext, principalResolver, options.Value, cancellationToken);
                    if (gate.Failure is not null)
                    {
                        return gate.Failure;
                    }

                    return Results.Ok(await useCase.GetPlanDistributionAsync(cancellationToken));
                })
            .RequireAuthorization()
            .Produces(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status401Unauthorized)
            .Produces(StatusCodes.Status403Forbidden)
            .WithName("GetPlatformDashboardPlanDistribution")
            .WithTags("PlatformDashboard");

        app.MapGet(
                "/platform/dashboard/user-growth",
                async (
                    ClaimsPrincipal user,
                    HttpContext httpContext,
                    PrincipalResolver principalResolver,
                    IOptions<PlatformOptions> options,
                    PlatformDashboardReadUseCase useCase,
                    CancellationToken cancellationToken) =>
                {
                    var gate = await PlatformOwnerGate.AuthorizeAsync(user, httpContext, principalResolver, options.Value, cancellationToken);
                    if (gate.Failure is not null)
                    {
                        return gate.Failure;
                    }

                    // TS: `const now = new Date()` at procedure entry. The window is derived from the wall
                    // clock at request time in both stacks; a parity run straddling a month boundary
                    // between the two calls diffs spuriously. That is a RE-RUN situation, recorded in the
                    // registry's surface header — deliberately NOT a normalize rule (none can absorb a
                    // whole-array shift, and surfaces.test.ts pins normalize as absent) and not a code change.
                    return Results.Ok(await useCase.GetUserGrowthAsync(DateTime.UtcNow, cancellationToken));
                })
            .RequireAuthorization()
            .Produces(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status401Unauthorized)
            .Produces(StatusCodes.Status403Forbidden)
            .WithName("GetPlatformDashboardUserGrowth")
            .WithTags("PlatformDashboard");

        app.MapGet(
                "/platform/dashboard/recent-activity",
                async (
                    ClaimsPrincipal user,
                    HttpContext httpContext,
                    PrincipalResolver principalResolver,
                    IOptions<PlatformOptions> options,
                    PlatformDashboardReadUseCase useCase,
                    CancellationToken cancellationToken) =>
                {
                    var gate = await PlatformOwnerGate.AuthorizeAsync(user, httpContext, principalResolver, options.Value, cancellationToken);
                    if (gate.Failure is not null)
                    {
                        return gate.Failure;
                    }

                    return Results.Ok(await useCase.GetRecentActivityAsync(cancellationToken));
                })
            .RequireAuthorization()
            .Produces(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status401Unauthorized)
            .Produces(StatusCodes.Status403Forbidden)
            .WithName("GetPlatformDashboardRecentActivity")
            .WithTags("PlatformDashboard");
    }
}
