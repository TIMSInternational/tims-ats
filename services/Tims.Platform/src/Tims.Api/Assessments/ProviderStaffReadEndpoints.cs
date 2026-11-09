using System.Security.Claims;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;
using Tims.Api.AssessmentTypes;
using Tims.Api.Configuration;
using Tims.Application.Access;
using Tims.Application.Assessments.Providers;
using Tims.Application.Identity;
using Tims.Domain.Access;
using Tims.Domain.FitEngine;
using Tims.Infrastructure.Access;

namespace Tims.Api.Assessments;

/// <summary>
/// AS-7 / AS-14 staff reads of the TIMS Assessments provider connector, dark behind
/// <see cref="PlatformOptions.AssessmentProvidersEnabled"/>, both <c>assessment:read</c>:
/// <list type="bullet">
///   <item><description><c>GET /assessments/provider-catalog?vacancyId=</c> — the instruments this org may assign
///   (enabled on its binding AND offered by the provider for selection), with each one's delivery, locales, consent
///   purposes and versions; with <c>vacancyId</c> (vacancy scope probe: 404) also the version the vacancy is pinned to.
///   <c>connected: false</c> when the org has no binding. 503 when the provider is unconfigured or down.</description></item>
///   <item><description><c>GET /assessments/provider-attempts?candidateId=</c> — the candidate's attempts with a status
///   chip each, how the vacancy counts the instrument (D3: English in languages; D20: LIA as a threshold) and the result
///   (validity, reviewPending, the minimum met or not). Owner default D6: a reader below company scope never gets the
///   level, the validity reasons or the accommodation. An attempt of an out-of-scope vacancy is omitted; an unknown
///   candidate is an empty list (no oracle); a #312-withdrawn candidate is <c>consentWithdrawn: true</c> with no
///   attempts.</description></item>
/// </list>
/// Query values are bound as strings and parsed after the gate (TRAP 9): 401/403 before 400.
/// </summary>
public static class ProviderStaffReadEndpoints
{
    public const string CatalogPath = "/assessments/provider-catalog";
    public const string AttemptsPath = "/assessments/provider-attempts";

    public static void MapProviderStaffReadEndpoints(this WebApplication app)
    {
        app.MapGet(CatalogPath, async (
                [FromQuery(Name = "vacancyId")] string? vacancyIdRaw, ClaimsPrincipal user, HttpContext httpContext,
                PrincipalResolver principalResolver, PermissionService permissionService,
                IOptions<PlatformOptions> platformOptions, IAnchorLoaderFactory anchorLoaderFactory, ScopedProbe scopedProbe,
                ProviderStaffReadUseCase useCase, CancellationToken cancellationToken) =>
            {
                var gate = await AssessmentStaffGate.AuthorizeAsync(
                    user, httpContext, principalResolver, permissionService, platformOptions.Value, "read", cancellationToken);
                if (gate.Failure is not null)
                {
                    return gate.Failure;
                }

                Guid? vacancyId = null;
                if (vacancyIdRaw is not null)
                {
                    if (!Guid.TryParseExact(vacancyIdRaw, "D", out var parsed) || parsed == Guid.Empty)
                    {
                        return Results.BadRequest(new { error = "invalid_input" });
                    }

                    if (!await InScopeAsync(parsed, gate, anchorLoaderFactory, scopedProbe, cancellationToken))
                    {
                        return Results.NotFound(new { message = "Vacante no encontrada" });
                    }

                    vacancyId = parsed;
                }

                var result = await useCase.GetCatalogAsync(gate.OrganizationId, vacancyId, cancellationToken);
                return result.Outcome switch
                {
                    StaffReadOutcome.Ok => Results.Ok(result.Catalog),
                    StaffReadOutcome.ProviderUnconfigured => Unavailable("provider_unconfigured"),
                    _ => Unavailable("provider_unavailable"),
                };
            })
            .RequireAuthorization()
            .Produces<StaffCatalog>(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status400BadRequest).Produces(StatusCodes.Status401Unauthorized)
            .Produces(StatusCodes.Status403Forbidden).Produces(StatusCodes.Status404NotFound)
            .Produces(StatusCodes.Status503ServiceUnavailable)
            .WithName("AssessmentProviderStaffCatalog")
            .WithTags("AssessmentProviders");

        app.MapGet(AttemptsPath, async (
                [FromQuery(Name = "candidateId")] string? candidateIdRaw, ClaimsPrincipal user, HttpContext httpContext,
                PrincipalResolver principalResolver, PermissionService permissionService,
                IOptions<PlatformOptions> platformOptions, IAnchorLoaderFactory anchorLoaderFactory, ScopedProbe scopedProbe,
                ProviderStaffReadUseCase useCase, TimeProvider timeProvider, CancellationToken cancellationToken) =>
            {
                var gate = await AssessmentStaffGate.AuthorizeAsync(
                    user, httpContext, principalResolver, permissionService, platformOptions.Value, "read", cancellationToken);
                if (gate.Failure is not null)
                {
                    return gate.Failure;
                }

                if (candidateIdRaw is null || !Guid.TryParseExact(candidateIdRaw, "D", out var candidateId)
                    || candidateId == Guid.Empty)
                {
                    return Results.BadRequest(new { error = "invalid_input" });
                }

                var list = await useCase.ListCandidateAttemptsAsync(
                    gate.OrganizationId, candidateId, FitV2Visibility.HidesBelowMinimum(gate.Scope!.Value),
                    platformOptions.Value.FitEngineLiaScoredEnabled,
                    vacancyId => InScopeAsync(vacancyId, gate, anchorLoaderFactory, scopedProbe, cancellationToken),
                    timeProvider.GetUtcNow(), cancellationToken);
                return Results.Ok(list);
            })
            .RequireAuthorization()
            .Produces<StaffCandidateAttemptList>(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status400BadRequest).Produces(StatusCodes.Status401Unauthorized)
            .Produces(StatusCodes.Status403Forbidden)
            .WithName("AssessmentProviderStaffAttempts")
            .WithTags("AssessmentProviders");
    }

    private static async Task<bool> InScopeAsync(
        Guid vacancyId, AssessmentGateResult gate, IAnchorLoaderFactory anchorLoaderFactory, ScopedProbe scopedProbe,
        CancellationToken cancellationToken)
    {
        var anchors = anchorLoaderFactory.Create(gate.OrganizationId, gate.UserId);
        try
        {
            await scopedProbe.AssertScopedAsync(ScopedEntity.Vacancy, vacancyId, gate.Scope!.Value, anchors,
                gate.OrganizationId, gate.UserId, cancellationToken);
            return true;
        }
        catch (ScopedNotFoundException)
        {
            return false;
        }
        finally
        {
            if (anchors is IAsyncDisposable disposable)
            {
                await disposable.DisposeAsync();
            }
        }
    }

    private static IResult Unavailable(string error) =>
        Results.Json(new { error }, statusCode: StatusCodes.Status503ServiceUnavailable);
}
