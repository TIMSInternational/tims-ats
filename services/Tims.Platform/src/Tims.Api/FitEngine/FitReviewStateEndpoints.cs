using System.ComponentModel.DataAnnotations;
using System.Security.Claims;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.Extensions.Options;
using Tims.Api.Configuration;
using Tims.Application.Access;
using Tims.Application.FitEngine;
using Tims.Application.Identity;
using Tims.Infrastructure.Access;

namespace Tims.Api.FitEngine;

/// <summary>
/// FIT v2: <c>POST /fit-engine/scores/review-state</c> — whether each given fit_scores row is provisional
/// (<c>reviewPending</c>), for list views that hold the ids but not the breakdown (the candidate and talent-pool
/// tables read <c>candidate.list</c>, a packages/api query this repo no longer extends). <c>fit_engine:read</c>, the
/// org filter + RLS, the #312 hidden rows excluded, and the vacancy scope probe per distinct vacancy: an id the caller
/// cannot reach is simply omitted. Returns a boolean only, never a score. Mapped with
/// <see cref="PlatformOptions.FitEngineReadEnabled"/> (or at OpenAPI generation).
/// </summary>
public static class FitReviewStateEndpoints
{
    /// <summary>Most ids per request (one table page).</summary>
    public const int MaxIds = 100;

    public static void MapFitReviewStateEndpoints(this WebApplication app)
    {
        app.MapPost("/fit-engine/scores/review-state", async (
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

                JsonNode? body;
                try
                {
                    body = await httpContext.Request.ReadFromJsonAsync<JsonNode>(cancellationToken);
                }
                catch (Exception ex) when (ex is JsonException or InvalidOperationException)
                {
                    return Results.BadRequest(new { error = "invalid_input" });
                }

                if (TryReadIds(body) is not { } ids)
                {
                    return Results.BadRequest(new { error = "invalid_input" });
                }

                var items = await useCase.GetReviewStatesAsync(
                    Guid.Parse(gate.Context!.OrganizationId), ids,
                    async vacancyId => await FitEngineReadEndpoints.AssertVacancyScopeAsync(
                        gate, vacancyId, anchorLoaderFactory, scopedProbe, cancellationToken) is null,
                    cancellationToken);
                return Results.Ok(new FitReviewStateResponse(items));
            })
            .RequireAuthorization()
            .Accepts<FitReviewStateBody>("application/json")
            .Produces<FitReviewStateResponse>(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status400BadRequest)
            .Produces(StatusCodes.Status401Unauthorized)
            .Produces(StatusCodes.Status403Forbidden)
            .WithName("FitEngineGetReviewStates");
    }

    // { fitScoreIds: uuid[1..100] } — anything else is a 400.
    internal static IReadOnlyList<Guid>? TryReadIds(JsonNode? body)
    {
        if (body is not JsonObject obj || obj["fitScoreIds"] is not JsonArray list || list.Count is 0 or > MaxIds)
        {
            return null;
        }

        var ids = new List<Guid>(list.Count);
        foreach (var item in list)
        {
            if (item is not JsonValue v || !v.TryGetValue<string>(out var text) || !Guid.TryParse(text, out var id))
            {
                return null;
            }

            ids.Add(id);
        }

        return ids;
    }
}

/// <summary>OpenAPI request schema: the fit_scores ids to look up.</summary>
public sealed record FitReviewStateBody([property: Required, MinLength(1), MaxLength(100)] IReadOnlyList<Guid> FitScoreIds);

/// <summary>200: one item per reachable id.</summary>
public sealed record FitReviewStateResponse(IReadOnlyList<FitReviewStateRow> Items);
