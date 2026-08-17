using System.Security.Claims;
using Microsoft.Extensions.Options;
using Tims.Api.Audit;
using Tims.Api.Configuration;
using Tims.Application.Identity;
using Tims.Application.PlatformDashboard;

namespace Tims.Api.PlatformDashboard;

/// <summary>
/// The THREE FX-DERIVED platform dashboard READ endpoints (Phase-5 slice 23, issue #81, PR 3 of 3) —
/// <c>getDashboardKpis</c>, <c>getRevenueByCustomer</c> and <c>getChurnRisk</c>. They are the cluster's
/// TENTH, ELEVENTH and TWELFTH reads (PR 1 ported three, PR 2 six). The thirteenth,
/// <c>getAiCostAnomalies</c>, shipped after this file as <see cref="PlatformDashboardAiReadEndpoints"/>,
/// completing the cluster.
///
/// <para><b>Same flag, same gate, same darkness as the other nine.</b> They map under
/// <see cref="PlatformOptions.PlatformDashboardReadEnabled"/> alongside PR 1's and PR 2's routes — one
/// all-or-nothing flip for the whole cluster — and <see cref="PlatformOwnerGate"/> runs FIRST on each. A
/// separate FILE rather than a separate flag: the read endpoints file was already at three hundred lines,
/// and nothing about these three warrants an independent cutover.</para>
///
/// <para><b>They are the only dashboard endpoints that can answer 503.</b> Every other read in the cluster
/// depends on nothing outside its own tables; these three must first resolve a currency rate. When the pin
/// is missing the request FAILS — see <see cref="PlatformDashboardFxResultKind"/> for why a fail-soft
/// suppression would have to invent a response shape TS cannot produce. This is a deliberate divergence in
/// the ERROR path only: TS throws <c>fx_rate_unavailable</c> and tRPC renders it 500, where this renders
/// 503. A 5xx either way, and 503 is the honest one for a dependency that is temporarily unresolvable.</para>
///
/// <para><b>No cache, including on <c>getDashboardKpis</c>, which HAS one in TS.</b> That is the single
/// recorded behavioural divergence of this PR; the argument and who made the call are on
/// <see cref="PlatformDashboardFxUseCase"/>. Nothing about it is visible in the payload.</para>
///
/// <para>All three take NO input, so TRAP 9 has no surface here and none of them can answer 400. They
/// capture the request instant once through <see cref="PlatformDashboardReadUseCase.JsNow"/> and thread it
/// down, exactly as PR 2's six do and as the TS procedures' <c>const now = new Date()</c> does.</para>
/// </summary>
public static class PlatformDashboardFxReadEndpoints
{
    public static void MapPlatformDashboardFxReadEndpoints(this WebApplication app)
    {
        app.MapGet(
                "/platform/dashboard/kpis",
                async (
                    ClaimsPrincipal user,
                    HttpContext httpContext,
                    PrincipalResolver principalResolver,
                    IOptions<PlatformOptions> options,
                    PlatformDashboardFxUseCase useCase,
                    CancellationToken cancellationToken) =>
                {
                    var gate = await PlatformOwnerGate.AuthorizeAsync(user, httpContext, principalResolver, options.Value, cancellationToken);
                    if (gate.Failure is not null)
                    {
                        return gate.Failure;
                    }

                    var result = await useCase.GetDashboardKpisAsync(PlatformDashboardReadUseCase.JsNow(), cancellationToken);
                    return FxResult(result);
                })
            .RequireAuthorization()
            .Produces(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status401Unauthorized)
            .Produces(StatusCodes.Status403Forbidden)
            .Produces(StatusCodes.Status503ServiceUnavailable)
            .WithName("GetPlatformDashboardKpis")
            .WithTags("PlatformDashboard");

        app.MapGet(
                "/platform/dashboard/revenue-by-customer",
                async (
                    ClaimsPrincipal user,
                    HttpContext httpContext,
                    PrincipalResolver principalResolver,
                    IOptions<PlatformOptions> options,
                    PlatformDashboardFxUseCase useCase,
                    CancellationToken cancellationToken) =>
                {
                    var gate = await PlatformOwnerGate.AuthorizeAsync(user, httpContext, principalResolver, options.Value, cancellationToken);
                    if (gate.Failure is not null)
                    {
                        return gate.Failure;
                    }

                    var result = await useCase.GetRevenueByCustomerAsync(PlatformDashboardReadUseCase.JsNow(), cancellationToken);
                    return FxResult(result);
                })
            .RequireAuthorization()
            .Produces(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status401Unauthorized)
            .Produces(StatusCodes.Status403Forbidden)
            .Produces(StatusCodes.Status503ServiceUnavailable)
            .WithName("GetPlatformDashboardRevenueByCustomer")
            .WithTags("PlatformDashboard");

        app.MapGet(
                "/platform/dashboard/churn-risk",
                async (
                    ClaimsPrincipal user,
                    HttpContext httpContext,
                    PrincipalResolver principalResolver,
                    IOptions<PlatformOptions> options,
                    PlatformDashboardFxUseCase useCase,
                    CancellationToken cancellationToken) =>
                {
                    var gate = await PlatformOwnerGate.AuthorizeAsync(user, httpContext, principalResolver, options.Value, cancellationToken);
                    if (gate.Failure is not null)
                    {
                        return gate.Failure;
                    }

                    var result = await useCase.GetChurnRiskAsync(PlatformDashboardReadUseCase.JsNow(), cancellationToken);
                    return FxResult(result);
                })
            .RequireAuthorization()
            .Produces(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status401Unauthorized)
            .Produces(StatusCodes.Status403Forbidden)
            .Produces(StatusCodes.Status503ServiceUnavailable)
            .WithName("GetPlatformDashboardChurnRisk")
            .WithTags("PlatformDashboard");
    }

    /// <summary>The one place the FX outcome becomes an HTTP response, so the 503 body cannot drift between
    /// the three endpoints. The payload mirrors the compensation surface's
    /// <c>{ "error": "fx_unavailable" }</c>.</summary>
    private static IResult FxResult<T>(PlatformDashboardFxResult<T> result)
        where T : class =>
        result.Kind switch
        {
            PlatformDashboardFxResultKind.Ok => Results.Ok(result.Value),
            _ => Results.Json(new { error = "fx_unavailable" }, statusCode: StatusCodes.Status503ServiceUnavailable),
        };
}
