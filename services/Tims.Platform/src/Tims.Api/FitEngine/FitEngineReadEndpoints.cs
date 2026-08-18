using System.Globalization;
using System.Security.Claims;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;
using Tims.Api.Configuration;
using Tims.Application.Access;
using Tims.Application.FitEngine;
using Tims.Application.Identity;
using Tims.Domain.Access;
using Tims.Domain.FitEngine;
using Tims.Infrastructure.Access;

namespace Tims.Api.FitEngine;

/// <summary>
/// The FIT-engine READ endpoints (Phase-5 Slice 24) — the C# port of the four read procedures of the TS
/// <c>fitEngine</c> router: <c>getRankingForVacancy</c>, <c>simulateWeights</c>,
/// <c>listRoleFamilyWeightProfiles</c>, <c>explainFit</c>. All are
/// <c>permissionProcedure('fit_engine','read')</c> via <see cref="FitEngineStaffGate"/>; the vacancy-scoped
/// three then run the <c>assertScoped('vacancy')</c> by-id IDOR probe (out-of-scope/missing/soft-deleted →
/// 404 "Vacante no encontrada", never confirms the id). listProfiles is grant-only (no scoped input — TS
/// parity). <c>explainFit</c> reproduces every pre-LLM observable (gate → probe → fetch → null ⇒ 404
/// "No hay FIT score calculado para este candidato") and answers <b>501</b> for the LLM half — the narrative
/// comes from the TS <c>invokeAgent</c> Bedrock pipeline, which has no C# plane (the team-intel honest-stub
/// precedent). Input validation runs AFTER auth (tRPC middleware-before-Zod parity). Dark-by-default behind
/// <see cref="PlatformOptions.FitEngineReadEnabled"/> (mapped only when on, or at build-time OpenAPI
/// generation).
/// </summary>
public static class FitEngineReadEndpoints
{
    private const string ReadAction = "read";

    private const string NoFitScoreMessage = "No hay FIT score calculado para este candidato";

    private const string ExplainNotImplementedMessage =
        "explainFit no esta portado: la narrativa viene del pipeline de IA (Bedrock) que solo existe en TS";

    public static void MapFitEngineReadEndpoints(this WebApplication app)
    {
        // 1. getRankingForVacancy — gate → assertScoped('vacancy') → stored rows, overallScore DESC.
        app.MapGet("/fit-engine/vacancies/{vacancyId:guid}/ranking", async (
                Guid vacancyId,
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
                    user, httpContext, principalResolver, permissionService, platformOptions.Value, ReadAction,
                    cancellationToken);
                if (gate.Failure is not null)
                {
                    return gate.Failure;
                }

                if (await AssertVacancyScopeAsync(gate, vacancyId, anchorLoaderFactory, scopedProbe, cancellationToken)
                    is { } notFound)
                {
                    return notFound;
                }

                var rows = await useCase.GetRankingForVacancyAsync(
                    Guid.Parse(gate.Context!.OrganizationId), vacancyId, cancellationToken);
                return Results.Ok(rows);
            })
            .RequireAuthorization()
            .Produces<IReadOnlyList<FitRankingRow>>(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status401Unauthorized)
            .Produces(StatusCodes.Status403Forbidden)
            .Produces(StatusCodes.Status404NotFound)
            .WithName("FitEngineGetRankingForVacancy");

        // 2. simulateWeights — gate → weights validated AFTER auth (each [0,1], sum within 0.001 of 1) →
        //    assertScoped('vacancy') → kernel re-run over stored breakdowns, simulatedScore DESC.
        app.MapGet("/fit-engine/vacancies/{vacancyId:guid}/simulate-weights", async (
                Guid vacancyId,
                [FromQuery(Name = "assessment")] string? assessment,
                [FromQuery(Name = "interview")] string? interview,
                [FromQuery(Name = "experience")] string? experience,
                [FromQuery(Name = "education")] string? education,
                [FromQuery(Name = "languages")] string? languages,
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
                    user, httpContext, principalResolver, permissionService, platformOptions.Value, ReadAction,
                    cancellationToken);
                if (gate.Failure is not null)
                {
                    return gate.Failure;
                }

                if (TryBuildWeights(assessment, interview, experience, education, languages) is not { } weights)
                {
                    return Results.BadRequest(new { error = "invalid_weights" });
                }

                if (await AssertVacancyScopeAsync(gate, vacancyId, anchorLoaderFactory, scopedProbe, cancellationToken)
                    is { } notFound)
                {
                    return notFound;
                }

                var rows = await useCase.SimulateWeightsAsync(
                    Guid.Parse(gate.Context!.OrganizationId), vacancyId, weights, cancellationToken);
                return Results.Ok(rows);
            })
            .RequireAuthorization()
            .Produces<IReadOnlyList<SimulatedRankingRow>>(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status400BadRequest)
            .Produces(StatusCodes.Status401Unauthorized)
            .Produces(StatusCodes.Status403Forbidden)
            .Produces(StatusCodes.Status404NotFound)
            .WithName("FitEngineSimulateWeights");

        // 3. listRoleFamilyWeightProfiles — gate only (no scoped input, matching the TS procedure), name ASC.
        app.MapGet("/fit-engine/weight-profiles", async (
                ClaimsPrincipal user,
                HttpContext httpContext,
                PrincipalResolver principalResolver,
                PermissionService permissionService,
                IOptions<PlatformOptions> platformOptions,
                FitEngineReadUseCase useCase,
                CancellationToken cancellationToken) =>
            {
                var gate = await FitEngineStaffGate.AuthorizeAsync(
                    user, httpContext, principalResolver, permissionService, platformOptions.Value, ReadAction,
                    cancellationToken);
                if (gate.Failure is not null)
                {
                    return gate.Failure;
                }

                var rows = await useCase.ListWeightProfilesAsync(
                    Guid.Parse(gate.Context!.OrganizationId), cancellationToken);
                return Results.Ok(rows);
            })
            .RequireAuthorization()
            .Produces<IReadOnlyList<WeightProfileRow>>(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status401Unauthorized)
            .Produces(StatusCodes.Status403Forbidden)
            .WithName("FitEngineListWeightProfiles");

        // 4. explainFit — gate → assertScoped('vacancy') → fetch (null ⇒ 404, the TS NOT_FOUND) → 501 (the LLM
        //    half; honest stub after every pre-LLM observable, per the team-intel precedent).
        app.MapGet("/fit-engine/vacancies/{vacancyId:guid}/candidates/{candidateId:guid}/explain-fit", async (
                Guid vacancyId,
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
                    user, httpContext, principalResolver, permissionService, platformOptions.Value, ReadAction,
                    cancellationToken);
                if (gate.Failure is not null)
                {
                    return gate.Failure;
                }

                if (await AssertVacancyScopeAsync(gate, vacancyId, anchorLoaderFactory, scopedProbe, cancellationToken)
                    is { } notFound)
                {
                    return notFound;
                }

                var data = await useCase.GetExplainDataAsync(
                    Guid.Parse(gate.Context!.OrganizationId), candidateId, vacancyId, cancellationToken);
                if (data is null)
                {
                    return Results.NotFound(new { message = NoFitScoreMessage });
                }

                return Results.Json(
                    new { message = ExplainNotImplementedMessage }, statusCode: StatusCodes.Status501NotImplemented);
            })
            .RequireAuthorization()
            .Produces(StatusCodes.Status401Unauthorized)
            .Produces(StatusCodes.Status403Forbidden)
            .Produces(StatusCodes.Status404NotFound)
            .Produces(StatusCodes.Status501NotImplemented)
            .WithName("FitEngineExplainFit");
    }

    // The by-id IDOR probe on the vacancy: a narrow-scoped caller must not reach an out-of-scope vacancy by
    // id-guessing → ScopedNotFoundException (404 "Vacante no encontrada", the shared cross-stack message),
    // which also carries the TS soft-delete guard (deleted_at IS NULL — vacancy is SOFT_DELETABLE).
    internal static async Task<IResult?> AssertVacancyScopeAsync(
        FitEngineGateResult gate,
        Guid vacancyId,
        IAnchorLoaderFactory anchorLoaderFactory,
        ScopedProbe scopedProbe,
        CancellationToken cancellationToken)
    {
        var orgId = Guid.Parse(gate.Context!.OrganizationId);
        var userId = Guid.Parse(gate.Context!.UserId);
        var anchors = anchorLoaderFactory.Create(orgId, userId);
        try
        {
            await scopedProbe.AssertScopedAsync(
                ScopedEntity.Vacancy, vacancyId, gate.Scope!.Value, anchors, orgId, userId, cancellationToken);
            return null;
        }
        catch (ScopedNotFoundException ex)
        {
            return Results.NotFound(new { message = ex.Message });
        }
        finally
        {
            if (anchors is IAsyncDisposable disposableAnchors)
            {
                await disposableAnchors.DisposeAsync();
            }
        }
    }

    // Zod parity for weightsSchema: five required numbers, each z.number().min(0).max(1), then the refine
    // |a+i+e+ed+l − 1| < 0.001 in the SAME operand order (double addition is order-dependent at the boundary).
    //
    // TRAP 9 — the parameters are bound as `string?` and parsed HERE, never as `double?` at the signature.
    // Minimal-API parameter binding runs INSIDE the endpoint delegate but BEFORE the handler body, so a
    // `double?` that fails to parse short-circuits with 400 before FitEngineStaffGate ever runs. That would
    // (a) break tRPC parity — TS's requirePermission middleware precedes the Zod parse, so an ungranted
    // caller gets 403 — and (b) let an ungranted caller suppress every authz_denied audit row by appending
    // `&assessment=abc`, since SecurityDenialAuditMiddleware only records 401/403. Binding as string keeps
    // ALL input handling after the gate. Pinned by Simulate_UnparseableWeight_NoGrant_Is403_NotBindingError.
    internal static IReadOnlyDictionary<string, double>? TryBuildWeights(
        string? assessment, string? interview, string? experience, string? education, string? languages)
    {
        if (!TryParseWeight(assessment, out var a) || !TryParseWeight(interview, out var i)
            || !TryParseWeight(experience, out var e) || !TryParseWeight(education, out var ed)
            || !TryParseWeight(languages, out var l))
        {
            return null;
        }

        if (!InUnitRange(a) || !InUnitRange(i) || !InUnitRange(e) || !InUnitRange(ed) || !InUnitRange(l))
        {
            return null;
        }

        if (!(Math.Abs(a + i + e + ed + l - 1) < 0.001))
        {
            return null;
        }

        return new Dictionary<string, double>(StringComparer.Ordinal)
        {
            ["assessment"] = a,
            ["interview"] = i,
            ["experience"] = e,
            ["education"] = ed,
            ["languages"] = l,
        };
    }

    // A present, numeric query value. Absent/empty/non-numeric are all "invalid input" → 400 AFTER the gate.
    // InvariantCulture + Float|AllowThousands mirrors what the default `double?` binder would have accepted,
    // so moving the parse here changes WHEN it runs, never WHAT it accepts.
    private static bool TryParseWeight(string? raw, out double value)
    {
        value = 0;
        return !string.IsNullOrEmpty(raw)
            && double.TryParse(
                raw, NumberStyles.Float | NumberStyles.AllowThousands, CultureInfo.InvariantCulture, out value);
    }

    // z.number().min(0).max(1) — NaN fails both comparisons, matching Zod's rejection.
    private static bool InUnitRange(double value) => value is >= 0 and <= 1;
}
