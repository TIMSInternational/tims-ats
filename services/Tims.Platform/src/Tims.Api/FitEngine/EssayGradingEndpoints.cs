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
/// Owner default D5 (2026-11-08): minimal manual grading of essays on a native ATS quiz, so a result awaiting a grade
/// (needs review in FIT v2) can be completed by a recruiter.
///   GET  /fit-engine/assignments/{id}/essays — <c>assessment:read</c>; the essays still pending (prompt, answer,
///        max points);
///   POST /fit-engine/assignments/{id}/essays/{questionId}/grade — <c>assessment:update</c>; body <c>{ points }</c>,
///        0..the question's points. 200 { remainingPending, normalizedScore } / 400 / 404 / 409 (already graded, or a question's points
///        were edited below an awarded score, so no honest score can be computed).
/// Both run the assignment's vacancy scope probe (assignments are scoped via their vacancy, as in TS). Mapped only
/// with <see cref="PlatformOptions.FitEngineV2Enabled"/> (or at OpenAPI generation). A FIT score is not recomputed
/// here: the next compute reads the graded result.
/// </summary>
public static class EssayGradingEndpoints
{
    private const string AssessmentModule = "assessment";

    public static void MapEssayGradingEndpoints(this WebApplication app)
    {
        app.MapGet("/fit-engine/assignments/{assignmentId:guid}/essays", async (
                Guid assignmentId,
                ClaimsPrincipal user,
                HttpContext httpContext,
                PrincipalResolver principalResolver,
                PermissionService permissionService,
                IOptions<PlatformOptions> platformOptions,
                IAnchorLoaderFactory anchorLoaderFactory,
                ScopedProbe scopedProbe,
                IEssayGradingRepository repository,
                CancellationToken cancellationToken) =>
            {
                var gate = await FitEngineStaffGate.AuthorizeAsync(
                    user, httpContext, principalResolver, permissionService, platformOptions.Value, AssessmentModule,
                    "read", cancellationToken);
                if (gate.Failure is not null)
                {
                    return gate.Failure;
                }

                var orgId = Guid.Parse(gate.Context!.OrganizationId);
                if (await AssertAssignmentScopeAsync(
                        gate, orgId, assignmentId, repository, anchorLoaderFactory, scopedProbe, cancellationToken)
                    is { } notFound)
                {
                    return notFound;
                }

                var essays = await repository.GetPendingEssaysAsync(orgId, assignmentId, cancellationToken);
                return Results.Ok(new PendingEssaysResponse(essays));
            })
            .RequireAuthorization()
            .Produces<PendingEssaysResponse>(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status401Unauthorized)
            .Produces(StatusCodes.Status403Forbidden)
            .Produces(StatusCodes.Status404NotFound)
            .WithName("FitEngineListPendingEssays");

        app.MapPost("/fit-engine/assignments/{assignmentId:guid}/essays/{questionId:guid}/grade", async (
                Guid assignmentId,
                Guid questionId,
                ClaimsPrincipal user,
                HttpContext httpContext,
                PrincipalResolver principalResolver,
                PermissionService permissionService,
                IOptions<PlatformOptions> platformOptions,
                IAnchorLoaderFactory anchorLoaderFactory,
                ScopedProbe scopedProbe,
                IEssayGradingRepository repository,
                TimeProvider timeProvider,
                CancellationToken cancellationToken) =>
            {
                var gate = await FitEngineStaffGate.AuthorizeAsync(
                    user, httpContext, principalResolver, permissionService, platformOptions.Value, AssessmentModule,
                    "update", cancellationToken);
                if (gate.Failure is not null)
                {
                    return gate.Failure;
                }

                var orgId = Guid.Parse(gate.Context!.OrganizationId);
                if (await AssertAssignmentScopeAsync(
                        gate, orgId, assignmentId, repository, anchorLoaderFactory, scopedProbe, cancellationToken)
                    is { } notFound)
                {
                    return notFound;
                }

                double points;
                try
                {
                    var body = await httpContext.Request.ReadFromJsonAsync<JsonNode>(cancellationToken);
                    if (body is not JsonObject obj || obj["points"] is not JsonValue value
                        || value.GetValueKind() != JsonValueKind.Number)
                    {
                        return Results.BadRequest(new { error = "invalid_points" });
                    }

                    points = value.GetValue<double>();
                }
                catch (Exception ex) when (ex is JsonException or InvalidOperationException)
                {
                    return Results.BadRequest(new { error = "invalid_points" });
                }

                var outcome = await repository.GradeEssayAsync(
                    orgId, assignmentId, questionId, points, Guid.Parse(gate.Context!.UserId), timeProvider.GetUtcNow(),
                    cancellationToken);
                return outcome.Status switch
                {
                    EssayGradeStatus.Graded => Results.Ok(
                        new EssayGradedResponse(outcome.RemainingPending, outcome.NormalizedScore)),
                    EssayGradeStatus.PointsOutOfRange => Results.BadRequest(new { error = "invalid_points" }),
                    EssayGradeStatus.NotPending => Results.Conflict(new { error = "not_pending" }),
                    EssayGradeStatus.QuestionsChanged => Results.Conflict(new { error = "questions_changed" }),
                    EssayGradeStatus.ConsentWithdrawn => Results.Conflict(new { error = "consent_withdrawn" }),
                    _ => Results.NotFound(new { message = "Asignación no encontrada" }),
                };
            })
            .RequireAuthorization()
            .Accepts<GradeEssayBody>("application/json")
            .Produces<EssayGradedResponse>(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status400BadRequest)
            .Produces(StatusCodes.Status401Unauthorized)
            .Produces(StatusCodes.Status403Forbidden)
            .Produces(StatusCodes.Status404NotFound)
            .Produces(StatusCodes.Status409Conflict)
            .WithName("FitEngineGradeEssay");
    }

    // Assignments are scoped via their vacancy (ScopeWhereFor: AssessmentAssignment → ViaVacancy).
    private static async Task<IResult?> AssertAssignmentScopeAsync(
        FitEngineGateResult gate, Guid orgId, Guid assignmentId, IEssayGradingRepository repository,
        IAnchorLoaderFactory anchorLoaderFactory, ScopedProbe scopedProbe, CancellationToken cancellationToken)
    {
        var vacancyId = await repository.GetAssignmentVacancyAsync(orgId, assignmentId, cancellationToken);
        if (vacancyId is null)
        {
            return Results.NotFound(new { message = "Asignación no encontrada" });
        }

        return await FitEngineReadEndpoints.AssertVacancyScopeAsync(
            gate, vacancyId.Value, anchorLoaderFactory, scopedProbe, cancellationToken) is null
            ? null
            : Results.NotFound(new { message = "Asignación no encontrada" });
    }
}

/// <summary>200 for the essay list.</summary>
public sealed record PendingEssaysResponse(IReadOnlyList<PendingEssay> Essays);

/// <summary>The grade request: points between 0 and the question's points.</summary>
public sealed record GradeEssayBody([property: Required] double Points);

/// <summary>200 after a grade.</summary>
public sealed record EssayGradedResponse(int RemainingPending, double? NormalizedScore);
