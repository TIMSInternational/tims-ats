using System.Security.Claims;
using Microsoft.Extensions.Options;
using Tims.Api.Audit;
using Tims.Api.Configuration;
using Tims.Application.Identity;
using Tims.Application.PlatformHealth;

namespace Tims.Api.PlatformHealth;

/// <summary>
/// <c>GET /platform/health/dependencies</c> — live, read-only dependency probes for the platform Health page:
/// the C# API's readiness, Supabase Auth, the CV bucket, Tims.Workers' heartbeat, the Bedrock guardrail, SES and
/// realtime. Platform-owner only (<see cref="PlatformOwnerGate"/>: unresolvable → 401, anyone else — including an
/// impersonating owner — → 403). No input, so no 400 is reachable.
///
/// <para>Probe results are cached server-side (30–60s) and every probe has a ~2s deadline, so this endpoint is
/// cheap to poll and bounded in latency. The body carries status/reason CODES and plain numbers only: no
/// hostnames, bucket names, ARNs, exception text or upstream bodies. <c>Cache-Control: no-store</c> keeps the
/// owner-only answer out of shared caches.</para>
///
/// <para>Dark unless <see cref="PlatformOptions.PlatformHealthProbesEnabled"/>.</para>
/// </summary>
public static class PlatformHealthEndpoints
{
    public const string Path = "/platform/health/dependencies";

    public static void MapPlatformHealthEndpoints(this WebApplication app)
    {
        app.MapGet(Path, async (
                ClaimsPrincipal user,
                HttpContext httpContext,
                PrincipalResolver principalResolver,
                IOptions<PlatformOptions> platformOptions,
                DependencyHealthUseCase useCase,
                CancellationToken cancellationToken) =>
            {
                var gate = await PlatformOwnerGate.AuthorizeAsync(
                    user, httpContext, principalResolver, platformOptions.Value, cancellationToken);
                if (gate.Failure is not null)
                {
                    return gate.Failure;
                }

                httpContext.Response.Headers.CacheControl = "no-store";
                return Results.Ok(await useCase.GetAsync(cancellationToken));
            })
            .RequireAuthorization()
            .Produces<DependencyHealthView>(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status401Unauthorized)
            .Produces(StatusCodes.Status403Forbidden)
            .WithName("PlatformHealthGetDependencies");
    }
}
