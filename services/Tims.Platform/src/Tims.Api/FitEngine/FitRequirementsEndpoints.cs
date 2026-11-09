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
/// The C#-owned <c>job_profiles.fit_requirements</c> writer for FIT v2: <c>PUT /fit-engine/vacancies/{id}/requirements</c>.
/// Same authorization as the TS <c>vacancy.updateFitRequirements</c> (<c>vacancy:update</c> + assertScoped('vacancy')),
/// body validated after auth. Unlike the TS mutation it MERGES <c>assessments[]</c>: a body without the key keeps the
/// stored array (atomically, in one statement), and it reports every dropped or changed entry. Mapped only when
/// <see cref="PlatformOptions.FitEngineWriteEnabled"/> AND <see cref="PlatformOptions.FitEngineV2Enabled"/> are on
/// (or at build-time OpenAPI generation), so that with the flag on there is one active writer that knows the key.
/// </summary>
public static class FitRequirementsEndpoints
{
    private const string VacancyModule = "vacancy";
    private const string UpdateAction = "update";

    public static void MapFitRequirementsEndpoints(this WebApplication app)
    {
        app.MapPut("/fit-engine/vacancies/{vacancyId:guid}/requirements", async (
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
                    user, httpContext, principalResolver, permissionService, platformOptions.Value, VacancyModule,
                    UpdateAction, cancellationToken);
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

                JsonNode? body;
                try
                {
                    body = await httpContext.Request.ReadFromJsonAsync<JsonNode>(cancellationToken);
                }
                catch (Exception ex) when (ex is JsonException or InvalidOperationException)
                {
                    return Results.BadRequest(new FitRequirementsError("invalid_input", []));
                }

                FitRequirementsError? invalid = null;
                var saved = await useCase.UpdateFitRequirementsAsync(
                    Guid.Parse(gate.Context!.OrganizationId), vacancyId, body, timeProvider.GetUtcNow(),
                    cancellationToken,
                    (error, issues) => invalid = new FitRequirementsError(error, issues.Select(ToDto).ToList()),
                    liaScoredAllowed: platformOptions.Value.FitEngineLiaScoredEnabled);
                if (invalid is not null)
                {
                    return Results.BadRequest(invalid);
                }

                return saved is null
                    ? Results.NotFound(new { message = "Vacante no encontrada" })
                    : Results.Ok(new FitRequirementsResponse(saved.FitRequirements, saved.Issues.Select(ToDto).ToList()));
            })
            .RequireAuthorization()
            .Accepts<FitRequirementsBody>("application/json")
            .Produces<FitRequirementsResponse>(StatusCodes.Status200OK)
            .Produces<FitRequirementsError>(StatusCodes.Status400BadRequest)
            .Produces(StatusCodes.Status401Unauthorized)
            .Produces(StatusCodes.Status403Forbidden)
            .Produces(StatusCodes.Status404NotFound)
            .WithName("FitEngineUpdateFitRequirements");
    }

    private static FitRequirementIssueDto ToDto(FitRequirementIssue issue) =>
        new(issue.Index, issue.Instrument, issue.Code, issue.Dropped);
}

/// <summary>One dropped or changed <c>assessments[]</c> entry.</summary>
public sealed record FitRequirementIssueDto(int Index, string? Instrument, string Code, bool Dropped);

/// <summary>200: the stored requirements and the findings about the submitted <c>assessments[]</c>.</summary>
public sealed record FitRequirementsResponse(JsonNode? FitRequirements, IReadOnlyList<FitRequirementIssueDto> Issues);

/// <summary>400: why nothing was written.</summary>
public sealed record FitRequirementsError(string Error, IReadOnlyList<FitRequirementIssueDto> Issues);

/// <summary>
/// OpenAPI request schema (the body is hand-parsed by <see cref="FitRequirementsInput"/>). <c>Assessments</c> absent
/// keeps the stored array; null removes it.
/// </summary>
public sealed record FitRequirementsBody(
    [property: Range(0, 60)] double? MinYearsExperience,
    string? RequiredEducationLevel,
    [property: MaxLength(20)] IReadOnlyList<string>? RequiredLanguages,
    [property: MaxLength(64)] IReadOnlyList<FitAssessmentRequirementBody>? Assessments);

/// <summary>One <c>assessments[]</c> entry as a client sends it.</summary>
public sealed record FitAssessmentRequirementBody(
    [property: Required, MaxLength(32)] string Instrument,
    [property: MaxLength(16)] string? Use,
    FitAssessmentMinimumBody? Min,
    double? Weight,
    [property: MaxLength(500)] string? Reason);

/// <summary>The minimum: exactly one field, by instrument.</summary>
public sealed record FitAssessmentMinimumBody(double? GlobalPercentile, string? Cefr, int? Level, double? Score);
