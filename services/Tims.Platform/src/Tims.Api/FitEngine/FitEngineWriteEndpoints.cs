using System.ComponentModel.DataAnnotations;
using System.Globalization;
using System.Security.Claims;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.Extensions.Options;
using Tims.Api.Configuration;
using Tims.Application.Access;
using Tims.Application.FitEngine;
using Tims.Application.Identity;
using Tims.Domain.FitEngine;
using Tims.Infrastructure.Access;

namespace Tims.Api.FitEngine;

/// <summary>
/// The FIT-engine WRITE endpoints (Phase-5 Slice 24) — the C# port of the two mutations of the TS
/// <c>fitEngine</c> router: <c>computeForVacancy</c> (<c>permissionProcedure('fit_engine','create')</c> +
/// <c>assertScoped('vacancy')</c>, scores every active-pipeline candidate, response <c>{ computed }</c>) and
/// <c>upsertRoleFamilyWeightProfile</c> (<c>permissionProcedure('fit_engine','update')</c>, grant-only —
/// no scoped input, TS parity). Body validation runs AFTER auth (tRPC middleware-before-Zod parity):
/// name 1..100 chars, five weights each in [0,1] summing to 1 ± 0.001. Every write runs UNDER TenantScope with
/// explicit org values. Dark-by-default behind <see cref="PlatformOptions.FitEngineWriteEnabled"/> (mapped only
/// when on, or at build-time OpenAPI generation).
/// </summary>
public static class FitEngineWriteEndpoints
{
    private const string CreateAction = "create";
    private const string UpdateAction = "update";

    private const int MaxProfileNameLength = 100;

    public static void MapFitEngineWriteEndpoints(this WebApplication app)
    {
        // ---- computeForVacancy — POST /fit-engine/vacancies/{vacancyId}/compute. gate(create) → probe →
        //      per-candidate compute + upsert. 200 { computed } / 401 / 403 / 404. ----
        app.MapPost("/fit-engine/vacancies/{vacancyId:guid}/compute", async (
                Guid vacancyId,
                ClaimsPrincipal user,
                HttpContext httpContext,
                PrincipalResolver principalResolver,
                PermissionService permissionService,
                IOptions<PlatformOptions> platformOptions,
                IAnchorLoaderFactory anchorLoaderFactory,
                ScopedProbe scopedProbe,
                FitEngineWriteUseCase useCase,
                TimeProvider timeProvider,
                CancellationToken cancellationToken) =>
            {
                var gate = await FitEngineStaffGate.AuthorizeAsync(
                    user, httpContext, principalResolver, permissionService, platformOptions.Value, CreateAction,
                    cancellationToken);
                if (gate.Failure is not null)
                {
                    return gate.Failure;
                }

                if (await FitEngineReadEndpoints.AssertVacancyScopeAsync(
                        gate, vacancyId, anchorLoaderFactory, scopedProbe, cancellationToken)
                    is { } notFound)
                {
                    return notFound;
                }

                var result = await useCase.ComputeForVacancyAsync(
                    Guid.Parse(gate.Context!.OrganizationId), vacancyId, timeProvider.GetUtcNow(), cancellationToken);
                return Results.Ok(result);
            })
            .RequireAuthorization()
            .Produces<ComputeForVacancyResult>(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status401Unauthorized)
            .Produces(StatusCodes.Status403Forbidden)
            .Produces(StatusCodes.Status404NotFound)
            .WithName("FitEngineComputeForVacancy");

        // ---- upsertRoleFamilyWeightProfile — POST /fit-engine/weight-profiles. gate(update), grant-only.
        //      200 { id, name, weights } / 400 / 401 / 403. ----
        app.MapPost("/fit-engine/weight-profiles", async (
                ClaimsPrincipal user,
                HttpContext httpContext,
                PrincipalResolver principalResolver,
                PermissionService permissionService,
                IOptions<PlatformOptions> platformOptions,
                FitEngineWriteUseCase useCase,
                TimeProvider timeProvider,
                CancellationToken cancellationToken) =>
            {
                var gate = await FitEngineStaffGate.AuthorizeAsync(
                    user, httpContext, principalResolver, permissionService, platformOptions.Value, UpdateAction,
                    cancellationToken);
                if (gate.Failure is not null)
                {
                    return gate.Failure;
                }

                var (ok, node) = await TryReadJsonAsync(httpContext, cancellationToken);
                if (!ok || TryBuildUpsertInput(node) is not { } input)
                {
                    return Results.BadRequest(new { error = "invalid_input" });
                }

                var row = await useCase.UpsertWeightProfileAsync(
                    Guid.Parse(gate.Context!.OrganizationId), input.Name, input.Weights, timeProvider.GetUtcNow(),
                    cancellationToken);
                return Results.Ok(row);
            })
            .RequireAuthorization()
            .Accepts<UpsertWeightProfileBody>("application/json")
            .Produces<WeightProfileRow>(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status400BadRequest)
            .Produces(StatusCodes.Status401Unauthorized)
            .Produces(StatusCodes.Status403Forbidden)
            .WithName("FitEngineUpsertWeightProfile");
    }

    // Zod parity: { name: z.string().min(1).max(100), weights: weightsSchema }. Unknown body keys are IGNORED
    // (Zod default strip) — the stored weights are rebuilt from the five validated values only.
    private static (string Name, IReadOnlyDictionary<string, double> Weights)? TryBuildUpsertInput(JsonNode? node)
    {
        if (node is not JsonObject body)
        {
            return null;
        }

        if (!body.TryGetPropertyValue("name", out var nameNode)
            || nameNode is not JsonValue nameValue
            || !nameValue.TryGetValue<string>(out var name)
            || name.Length is < 1 or > MaxProfileNameLength)
        {
            return null;
        }

        if (!body.TryGetPropertyValue("weights", out var weightsNode) || weightsNode is not JsonObject weightsObj)
        {
            return null;
        }

        var weights = FitEngineReadEndpoints.TryBuildWeights(
            ReadNumber(weightsObj, "assessment"),
            ReadNumber(weightsObj, "interview"),
            ReadNumber(weightsObj, "experience"),
            ReadNumber(weightsObj, "education"),
            ReadNumber(weightsObj, "languages"));
        return weights is null ? null : (name, weights);
    }

    // z.number() — a JSON-number-kind value only (a string "0.2" or a bool must NOT parse). Rendered back to
    // an invariant string because TryBuildWeights now takes strings (TRAP 9 on the query side); "R" round-trips
    // the double exactly, so the JSON body path still validates the same values it always did.
    private static string? ReadNumber(JsonObject obj, string key) =>
        obj.TryGetPropertyValue(key, out var node)
        && node is JsonValue value
        && value.GetValueKind() == JsonValueKind.Number
            ? value.GetValue<double>().ToString("R", CultureInfo.InvariantCulture)
            : null;

    // Malformed/empty JSON body → 400 (ReadFromJsonAsync rejects an empty body as malformed; a duplicate-key
    // body throws JsonException from the parse, not from inside the handler).
    private static async Task<(bool Ok, JsonNode? Node)> TryReadJsonAsync(
        HttpContext httpContext, CancellationToken cancellationToken)
    {
        try
        {
            var node = await httpContext.Request.ReadFromJsonAsync<JsonNode>(cancellationToken);
            return (true, node);
        }
        catch (JsonException)
        {
            return (false, null);
        }
        catch (InvalidOperationException)
        {
            return (false, null);
        }
    }
}

/// <summary>
/// OpenAPI request schema for upsertRoleFamilyWeightProfile (the body is hand-parsed; this shapes the contract
/// only — init-only non-nullable properties so nothing emits as nullable, TRAP 5).
/// </summary>
public sealed record UpsertWeightProfileBody(
    [property: Required, MaxLength(100)] string Name,
    [property: Required] UpsertWeightProfileWeightsBody Weights);

/// <summary>The five weight dimensions — each required, in [0,1], summing to 1 ± 0.001.</summary>
public sealed record UpsertWeightProfileWeightsBody(
    [property: Required] double Assessment,
    [property: Required] double Interview,
    [property: Required] double Experience,
    [property: Required] double Education,
    [property: Required] double Languages);
