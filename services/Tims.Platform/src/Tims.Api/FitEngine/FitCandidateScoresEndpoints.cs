using System.Security.Claims;
using Microsoft.Extensions.Options;
using Tims.Api.Configuration;
using Tims.Application.Access;
using Tims.Application.FitEngine;
using Tims.Application.Identity;
using Tims.Domain.FitEngine;
using Tims.Infrastructure.Access;

namespace Tims.Api.FitEngine;

/// <summary>
/// FIT v2: <c>GET /fit-engine/candidates/{candidateId}/fit-scores</c> — the candidate's stored fit scores for the
/// candidate page, which reads them here (not from the TS <c>candidate.getById</c> payload) under
/// <c>NEXT_PUBLIC_FIT_ENGINE_V2_VIA_CSHARP</c>. <c>fit_engine:read</c>; the org filter + RLS; the #312 hidden rows
/// excluded; the vacancy scope probe per distinct vacancy (an out-of-scope vacancy's row is simply omitted, as in the
/// review-state read); owner default D6 for a narrow-scoped reader (<see cref="FitV2Visibility"/>: a team leader sees
/// "below minimum", never the level, and an overall that cannot be inverted back to it). An unknown candidate is an
/// empty list, so the route confirms nothing. Mapped with <see cref="PlatformOptions.FitEngineReadEnabled"/> (or at
/// OpenAPI generation).
/// </summary>
public static class FitCandidateScoresEndpoints
{
    public static void MapFitCandidateScoresEndpoints(this WebApplication app)
    {
        app.MapGet("/fit-engine/candidates/{candidateId:guid}/fit-scores", async (
                Guid candidateId,
                ClaimsPrincipal user,
                HttpContext httpContext,
                PrincipalResolver principalResolver,
                PermissionService permissionService,
                IOptions<PlatformOptions> platformOptions,
                IAnchorLoaderFactory anchorLoaderFactory,
                ScopedProbe scopedProbe,
                FitEngineReadUseCase useCase,
                CancellationToken cancellationToken) =>
            {
                var gate = await FitEngineStaffGate.AuthorizeAsync(
                    user, httpContext, principalResolver, permissionService, platformOptions.Value, "read",
                    cancellationToken);
                if (gate.Failure is not null)
                {
                    return gate.Failure;
                }

                var items = await useCase.GetCandidateFitScoresAsync(
                    Guid.Parse(gate.Context!.OrganizationId), candidateId,
                    FitV2Visibility.HidesBelowMinimum(gate.Scope!.Value),
                    async vacancyId => await FitEngineReadEndpoints.AssertVacancyScopeAsync(
                        gate, vacancyId, anchorLoaderFactory, scopedProbe, cancellationToken) is null,
                    cancellationToken);
                return Results.Ok(new CandidateFitScoresResponse(items));
            })
            .RequireAuthorization()
            .Produces<CandidateFitScoresResponse>(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status401Unauthorized)
            .Produces(StatusCodes.Status403Forbidden)
            .WithName("FitEngineGetCandidateFitScores");
    }
}

/// <summary>200: the candidate's fit scores this reader may see, most recent first.</summary>
public sealed record CandidateFitScoresResponse(IReadOnlyList<CandidateFitScoreRow> Items);
