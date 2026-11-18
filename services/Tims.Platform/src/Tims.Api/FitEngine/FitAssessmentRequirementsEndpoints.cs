using System.ComponentModel.DataAnnotations;
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
/// FIT v2: the vacancy assessments editor's two routes, C#-only (no TS twin, survival rule):
/// <list type="bullet">
/// <item><description><c>GET /fit-engine/vacancies/{id}/requirements/assessments</c> — <c>vacancy:read</c> +
/// assertScoped('vacancy'). The vacancy's <c>assessments[]</c> as FIT v2 parses them, the version token the editor must
/// send back, and the stored entries FIT would ignore (reported, never shown as configured).</description></item>
/// <item><description><c>PUT /fit-engine/vacancies/{id}/requirements/assessments</c> — <c>vacancy:update</c> +
/// assertScoped('vacancy'). Replaces ONLY <c>assessments[]</c> (the v1 keys the requirements card owns are kept in the
/// same statement), strictly (<see cref="FitAssessmentRequirementsInput"/>: a dropped entry or a missing job-relatedness
/// reason refuses the whole write), and only if the stored version is still the one the editor read: 409
/// <c>requirements_changed</c> with the current array otherwise.</description></item>
/// </list>
/// Mapped with the requirements writer (<see cref="PlatformOptions.FitEngineWriteEnabled"/> AND
/// <see cref="PlatformOptions.FitEngineV2Enabled"/>, or at OpenAPI generation). Order: auth (401/403) → vacancy scope
/// (404) → body (400) → conditional write (409).
/// </summary>
public static class FitAssessmentRequirementsEndpoints
{
    public const string Path = "/fit-engine/vacancies/{vacancyId:guid}/requirements/assessments";

    public static void MapFitAssessmentRequirementsEndpoints(this WebApplication app)
    {
        app.MapGet(Path, async (
                Guid vacancyId, ClaimsPrincipal user, HttpContext httpContext, PrincipalResolver principalResolver,
                PermissionService permissionService, IOptions<PlatformOptions> platformOptions,
                IAnchorLoaderFactory anchorLoaderFactory, ScopedProbe scopedProbe,
                FitAssessmentRequirementsUseCase useCase, CancellationToken cancellationToken) =>
            {
                var gate = await FitEngineStaffGate.AuthorizeAsync(
                    user, httpContext, principalResolver, permissionService, platformOptions.Value, "vacancy", "read",
                    cancellationToken);
                if (gate.Failure is not null)
                {
                    return gate.Failure;
                }

                if (await FitEngineReadEndpoints.AssertVacancyScopeAsync(
                        gate, vacancyId, anchorLoaderFactory, scopedProbe, cancellationToken) is { } notFound)
                {
                    return notFound;
                }

                var view = await useCase.GetAsync(
                    Guid.Parse(gate.Context!.OrganizationId), vacancyId, platformOptions.Value.FitEngineLiaScoredEnabled,
                    cancellationToken);
                return Results.Ok(ToResponse(view));
            })
            .RequireAuthorization()
            .Produces<FitAssessmentRequirementsResponse>(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status401Unauthorized)
            .Produces(StatusCodes.Status403Forbidden)
            .Produces(StatusCodes.Status404NotFound)
            .WithName("FitEngineGetAssessmentRequirements");

        app.MapPut(Path, async (
                Guid vacancyId, ClaimsPrincipal user, HttpContext httpContext, PrincipalResolver principalResolver,
                PermissionService permissionService, IOptions<PlatformOptions> platformOptions,
                IAnchorLoaderFactory anchorLoaderFactory, ScopedProbe scopedProbe,
                FitAssessmentRequirementsUseCase useCase, TimeProvider timeProvider, CancellationToken cancellationToken) =>
            {
                var gate = await FitEngineStaffGate.AuthorizeAsync(
                    user, httpContext, principalResolver, permissionService, platformOptions.Value, "vacancy", "update",
                    cancellationToken);
                if (gate.Failure is not null)
                {
                    return gate.Failure;
                }

                if (await FitEngineReadEndpoints.AssertVacancyScopeAsync(
                        gate, vacancyId, anchorLoaderFactory, scopedProbe, cancellationToken) is { } notFound)
                {
                    return notFound;
                }

                JsonNode? body;
                try
                {
                    body = await httpContext.Request.ReadFromJsonAsync<JsonNode>(cancellationToken);
                }
                catch (Exception ex) when (ex is JsonException or InvalidOperationException)
                {
                    return Results.BadRequest(new FitRequirementsError("invalid_input", []));
                }

                var result = await useCase.ReplaceAsync(
                    Guid.Parse(gate.Context!.OrganizationId), vacancyId, body,
                    platformOptions.Value.FitEngineLiaScoredEnabled, timeProvider.GetUtcNow(), cancellationToken);
                return result.Outcome switch
                {
                    AssessmentRequirementsOutcome.Saved => Results.Ok(ToResponse(result.View!)),
                    AssessmentRequirementsOutcome.Conflict => Results.Conflict(
                        new FitAssessmentRequirementsConflict("requirements_changed", ToResponse(result.View!))),
                    _ => Results.BadRequest(new FitRequirementsError(
                        result.Error ?? "invalid_input", result.Issues.Select(ToDto).ToList())),
                };
            })
            .RequireAuthorization()
            .Accepts<FitAssessmentRequirementsBody>("application/json")
            .Produces<FitAssessmentRequirementsResponse>(StatusCodes.Status200OK)
            .Produces<FitRequirementsError>(StatusCodes.Status400BadRequest)
            .Produces(StatusCodes.Status401Unauthorized)
            .Produces(StatusCodes.Status403Forbidden)
            .Produces(StatusCodes.Status404NotFound)
            .Produces<FitAssessmentRequirementsConflict>(StatusCodes.Status409Conflict)
            .WithName("FitEngineReplaceAssessmentRequirements");
    }

    private static FitAssessmentRequirementsResponse ToResponse(AssessmentRequirementsView view) =>
        new(
            view.Assessments.Select(a => new FitAssessmentRequirementDto(
                a.Instrument, a.Use,
                a.Min is { } m ? new FitAssessmentMinimumDto(m.GlobalPercentile, m.Cefr, m.Level, m.Score, m.JobFit) : null,
                a.Weight, a.Reason, a.JobCode)).ToList(),
            view.Version,
            view.Issues.Select(ToDto).ToList());

    private static FitRequirementIssueDto ToDto(FitRequirementIssue issue) =>
        new(issue.Index, issue.Instrument, issue.Code, issue.Dropped);
}

/// <summary>
/// One configured instrument, exactly as FIT v2 reads it. <c>JobCode</c> is PCA's only: the vacancy's TIMS position
/// code, against which the provider reports the PCA-vs-JCA fit (null elsewhere).
/// </summary>
public sealed record FitAssessmentRequirementDto(
    string Instrument, string Use, FitAssessmentMinimumDto? Min, double? Weight, string? Reason, string? JobCode);

/// <summary>The minimum: one field, by instrument (LIA percentile, English CEFR, ITC-IA level, quiz score, PCA job fit).</summary>
public sealed record FitAssessmentMinimumDto(double? GlobalPercentile, string? Cefr, int? Level, double? Score, double? JobFit);

/// <summary>
/// 200: the stored array, the version to send back on the next write, and the findings (stored entries FIT ignores on a
/// read; field changes on a write, e.g. <c>lia_threshold_only</c>).
/// </summary>
public sealed record FitAssessmentRequirementsResponse(
    IReadOnlyList<FitAssessmentRequirementDto> Assessments, string Version, IReadOnlyList<FitRequirementIssueDto> Issues);

/// <summary>409: the array changed since the editor read it; nothing was written. <c>Current</c> is what is stored now.</summary>
public sealed record FitAssessmentRequirementsConflict(string Error, FitAssessmentRequirementsResponse Current);

/// <summary>OpenAPI request schema (the body is hand-parsed strictly by <see cref="FitAssessmentRequirementsInput"/>).</summary>
public sealed record FitAssessmentRequirementsBody(
    [property: Required, MaxLength(32)] IReadOnlyList<FitAssessmentRequirementBody> Assessments,
    [property: Required, StringLength(32, MinimumLength = 32)] string ExpectedVersion);
