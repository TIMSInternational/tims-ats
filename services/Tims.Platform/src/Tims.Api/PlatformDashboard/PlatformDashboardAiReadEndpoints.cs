using System.Security.Claims;
using Microsoft.Extensions.Options;
using Tims.Api.Audit;
using Tims.Api.Configuration;
using Tims.Application.Identity;
using Tims.Application.PlatformDashboard;

namespace Tims.Api.PlatformDashboard;

/// <summary>
/// <c>getAiCostAnomalies</c> (Phase-5 slice 23, issue #81) — the THIRTEENTH and FINAL read of the
/// platform dashboard cluster, completing the port that <see cref="PlatformDashboardReadEndpoints"/>
/// (nine FX-free reads) and <see cref="PlatformDashboardFxReadEndpoints"/> (three FX-derived reads)
/// began. Same gate, same flag, same file-per-tier split.
///
/// <para><b>Gate: <see cref="PlatformOwnerGate"/>, reused not re-implemented</b>, running FIRST — the
/// C# analog of TS <c>platformProcedure</c>. No input at all (the TS procedure declares no
/// <c>.input()</c>), so like eight of the nine FX-free reads this endpoint can answer only
/// 200/401/403/404, never 400 — and unlike the three FX reads it can never answer 503 either: it
/// touches no <c>fx_rates</c> pin, only the three ai-agent tables.</para>
///
/// <para>INTERNAL staff read ⇒ RAW procedure shape, NO <c>schemaVersion</c> envelope. Dark-by-default
/// behind <see cref="PlatformOptions.PlatformDashboardReadEnabled"/> — the SAME one flag as the other
/// twelve, so the canary flip exposes the whole cluster at once, now genuinely complete.</para>
/// </summary>
public static class PlatformDashboardAiReadEndpoints
{
    public static void MapPlatformDashboardAiReadEndpoints(this WebApplication app)
    {
        app.MapGet(
                "/platform/dashboard/ai-cost-anomalies",
                async (
                    ClaimsPrincipal user,
                    HttpContext httpContext,
                    PrincipalResolver principalResolver,
                    IOptions<PlatformOptions> options,
                    PlatformDashboardAiUseCase useCase,
                    CancellationToken cancellationToken) =>
                {
                    var gate = await PlatformOwnerGate.AuthorizeAsync(user, httpContext, principalResolver, options.Value, cancellationToken);
                    if (gate.Failure is not null)
                    {
                        return gate.Failure;
                    }

                    // TS: `new Date(Date.now() - …)` at procedure entry — ONE clock read, threaded down,
                    // like the six insight reads.
                    return Results.Ok(await useCase.GetAiCostAnomaliesAsync(PlatformDashboardReadUseCase.JsNow(), cancellationToken));
                })
            .RequireAuthorization()
            .Produces(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status401Unauthorized)
            .Produces(StatusCodes.Status403Forbidden)
            .WithName("GetPlatformDashboardAiCostAnomalies")
            .WithTags("PlatformDashboard");
    }
}
