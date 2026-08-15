using System.Security.Claims;
using Microsoft.Extensions.Options;
using Tims.Api.Audit;
using Tims.Api.Configuration;
using Tims.Application.Identity;
using Tims.Application.PlatformDashboard;

namespace Tims.Api.PlatformDashboard;

/// <summary>
/// The FX-free platform dashboard READ endpoints (Phase-5 slice 23, issue #81, PRs 1 and 2 of 3) — the C#
/// port of NINE of the platform dashboard cluster's thirteen reads (<c>routers/platform/dashboard*.ts</c>
/// — nine live in <c>dashboard.ts</c> itself, four in its churn/forecast/upsell siblings, all merged flat
/// into the platform router). PR 1 shipped <c>getPlanDistribution</c>, <c>getUserGrowth</c> and
/// <c>getRecentActivity</c>; PR 2 adds <c>getAttentionItems</c>, <c>getMrrTrend</c>,
/// <c>getMrrForecast</c>, <c>getCustomerHealth</c>, <c>getUpsellOpportunities</c> and <c>search</c> under
/// the SAME flag.
///
/// <para><b>Gate: <see cref="PlatformOwnerGate"/>, reused not re-implemented</b> — the documented C# analog
/// of TS <c>platformProcedure</c>, which already denies an impersonated owner correctly (they resolve to
/// <c>PrincipalType.OrgUser</c>). It runs FIRST on every endpoint. There is no second line of defence, and
/// that is deliberate: this surface is cross-org by design, never wrapped in <c>TenantScope</c>, so the
/// gate IS the authorization boundary — the same disposition as the invitations and organizations reads.</para>
///
/// <para><b>Eight of the nine procedures take NO input</b>, so TRAP 9 (minimal-API binding 400s before the
/// gate) has almost no surface here, and those eight can answer only 200/401/403/404 — never 400. That
/// absence is itself parity: the TS procedures declare no <c>.input()</c>. <c>search</c> is the single
/// exception (<c>z.object({ query: z.string().min(1).max(100) })</c>), and it is bound as <c>string?</c>
/// precisely so the gate still runs first.</para>
///
/// <para><b>The other FOUR dashboard procedures are NOT here, deliberately, in two groups.</b>
/// <c>getDashboardKpis</c>, <c>getRevenueByCustomer</c> and <c>getChurnRisk</c> call <c>sumMoney</c>
/// (<c>lib/currency.ts</c> — the churn one from <c>dashboard-churn.ts:55</c>) → LIVE Frankfurter FX rates;
/// they need the fx conversion machinery plus a live-rate parity strategy, and port LAST in PR 3. An
/// earlier version of this list swapped <c>getChurnRisk</c> with <c>getCustomerHealth</c> — the panel
/// counted the call sites. <c>getAiCostAnomalies</c> needs EF maps + ledger entries for THREE genuinely
/// unmapped tables (<c>ai_agent_org_configs</c>, <c>ai_agent_usage_logs</c>, and <c>ai_agents</c> via its
/// <c>agent</c> join — an earlier version said two and also grouped <c>getUpsellOpportunities</c> here,
/// which reads only already-mapped tables).</para>
///
/// <para><b>No caching, faithfully.</b> Unlike <c>getDashboardKpis</c> (45s cache), NONE of these nine TS
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

        MapFxFreeInsightEndpoints(app);
    }

    /// <summary>
    /// PR 2 of 3: the remaining SIX FX-free reads, under the SAME
    /// <see cref="PlatformOptions.PlatformDashboardReadEnabled"/> flag and the same gate-first shape.
    ///
    /// <para>Five of the six take no input, exactly like PR 1's three. <c>search</c> is the exception and
    /// is the only endpoint in the whole cluster that can answer 400 — see its handler for why the
    /// parameter is bound as <c>string?</c>.</para>
    ///
    /// <para>All six capture the request instant ONCE, through
    /// <see cref="PlatformDashboardReadUseCase.JsNow"/>, and thread it down rather than letting layers
    /// call the clock independently. TS does the same (<c>const now = new Date()</c> at procedure entry),
    /// and it matters here: <c>getAttentionItems</c> derives a query bound AND a day count from the same
    /// instant, so two clock reads could report an invoice as overdue by a number of days computed
    /// against a different "now" than the one that selected it.</para>
    /// </summary>
    private static void MapFxFreeInsightEndpoints(WebApplication app)
    {
        app.MapGet(
                "/platform/dashboard/attention-items",
                async (
                    ClaimsPrincipal user,
                    HttpContext httpContext,
                    PrincipalResolver principalResolver,
                    IOptions<PlatformOptions> options,
                    PlatformDashboardAttentionUseCase useCase,
                    CancellationToken cancellationToken) =>
                {
                    var gate = await PlatformOwnerGate.AuthorizeAsync(user, httpContext, principalResolver, options.Value, cancellationToken);
                    if (gate.Failure is not null)
                    {
                        return gate.Failure;
                    }

                    return Results.Ok(await useCase.GetAttentionItemsAsync(PlatformDashboardReadUseCase.JsNow(), cancellationToken));
                })
            .RequireAuthorization()
            .Produces(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status401Unauthorized)
            .Produces(StatusCodes.Status403Forbidden)
            .WithName("GetPlatformDashboardAttentionItems")
            .WithTags("PlatformDashboard");

        app.MapGet(
                "/platform/dashboard/mrr-trend",
                async (
                    ClaimsPrincipal user,
                    HttpContext httpContext,
                    PrincipalResolver principalResolver,
                    IOptions<PlatformOptions> options,
                    PlatformDashboardMrrUseCase useCase,
                    CancellationToken cancellationToken) =>
                {
                    var gate = await PlatformOwnerGate.AuthorizeAsync(user, httpContext, principalResolver, options.Value, cancellationToken);
                    if (gate.Failure is not null)
                    {
                        return gate.Failure;
                    }

                    return Results.Ok(await useCase.GetMrrTrendAsync(PlatformDashboardReadUseCase.JsNow(), cancellationToken));
                })
            .RequireAuthorization()
            .Produces(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status401Unauthorized)
            .Produces(StatusCodes.Status403Forbidden)
            .WithName("GetPlatformDashboardMrrTrend")
            .WithTags("PlatformDashboard");

        app.MapGet(
                "/platform/dashboard/mrr-forecast",
                async (
                    ClaimsPrincipal user,
                    HttpContext httpContext,
                    PrincipalResolver principalResolver,
                    IOptions<PlatformOptions> options,
                    PlatformDashboardMrrUseCase useCase,
                    CancellationToken cancellationToken) =>
                {
                    var gate = await PlatformOwnerGate.AuthorizeAsync(user, httpContext, principalResolver, options.Value, cancellationToken);
                    if (gate.Failure is not null)
                    {
                        return gate.Failure;
                    }

                    return Results.Ok(await useCase.GetMrrForecastAsync(PlatformDashboardReadUseCase.JsNow(), cancellationToken));
                })
            .RequireAuthorization()
            .Produces(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status401Unauthorized)
            .Produces(StatusCodes.Status403Forbidden)
            .WithName("GetPlatformDashboardMrrForecast")
            .WithTags("PlatformDashboard");

        app.MapGet(
                "/platform/dashboard/customer-health",
                async (
                    ClaimsPrincipal user,
                    HttpContext httpContext,
                    PrincipalResolver principalResolver,
                    IOptions<PlatformOptions> options,
                    PlatformDashboardAccountsUseCase useCase,
                    CancellationToken cancellationToken) =>
                {
                    var gate = await PlatformOwnerGate.AuthorizeAsync(user, httpContext, principalResolver, options.Value, cancellationToken);
                    if (gate.Failure is not null)
                    {
                        return gate.Failure;
                    }

                    return Results.Ok(await useCase.GetCustomerHealthAsync(PlatformDashboardReadUseCase.JsNow(), cancellationToken));
                })
            .RequireAuthorization()
            .Produces(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status401Unauthorized)
            .Produces(StatusCodes.Status403Forbidden)
            .WithName("GetPlatformDashboardCustomerHealth")
            .WithTags("PlatformDashboard");

        app.MapGet(
                "/platform/dashboard/upsell-opportunities",
                async (
                    ClaimsPrincipal user,
                    HttpContext httpContext,
                    PrincipalResolver principalResolver,
                    IOptions<PlatformOptions> options,
                    PlatformDashboardAccountsUseCase useCase,
                    CancellationToken cancellationToken) =>
                {
                    var gate = await PlatformOwnerGate.AuthorizeAsync(user, httpContext, principalResolver, options.Value, cancellationToken);
                    if (gate.Failure is not null)
                    {
                        return gate.Failure;
                    }

                    return Results.Ok(await useCase.GetUpsellOpportunitiesAsync(PlatformDashboardReadUseCase.JsNow(), cancellationToken));
                })
            .RequireAuthorization()
            .Produces(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status401Unauthorized)
            .Produces(StatusCodes.Status403Forbidden)
            .WithName("GetPlatformDashboardUpsellOpportunities")
            .WithTags("PlatformDashboard");

        app.MapGet(
                "/platform/dashboard/search",
                async (
                    ClaimsPrincipal user,
                    HttpContext httpContext,
                    PrincipalResolver principalResolver,
                    IOptions<PlatformOptions> options,
                    PlatformDashboardSearchUseCase useCase,
                    // TRAP 9, and this is the whole reason the parameter is `string?`: minimal-API model
                    // binding runs BEFORE the handler body, so declaring a non-nullable `string query`
                    // would make a MISSING query string 400 before PlatformOwnerGate ever ran — handing an
                    // unauthenticated caller a 400 where tRPC gives 401, because tRPC runs middleware
                    // before Zod. Bound loose, validated below, after the gate.
                    string? query,
                    CancellationToken cancellationToken) =>
                {
                    var gate = await PlatformOwnerGate.AuthorizeAsync(user, httpContext, principalResolver, options.Value, cancellationToken);
                    if (gate.Failure is not null)
                    {
                        return gate.Failure;
                    }

                    // `z.object({ query: z.string().min(1).max(100) })` — REJECT, do not clamp: tRPC
                    // throws BAD_REQUEST on an out-of-range input rather than truncating it.
                    if (!PlatformDashboardSearchUseCase.IsValidQuery(query))
                    {
                        return Results.BadRequest();
                    }

                    return Results.Ok(await useCase.SearchAsync(query!, cancellationToken));
                })
            .RequireAuthorization()
            .Produces(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status400BadRequest)
            .Produces(StatusCodes.Status401Unauthorized)
            .Produces(StatusCodes.Status403Forbidden)
            .WithName("SearchPlatformDashboard")
            .WithTags("PlatformDashboard");
    }
}
