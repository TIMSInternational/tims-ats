using System.Security.Claims;
using Microsoft.Extensions.Options;
using Tims.Api.Audit;
using Tims.Api.Configuration;
using Tims.Application.Assessments.Providers;
using Tims.Application.Identity;

namespace Tims.Api.Assessments;

/// <summary>
/// AS-5 data-subject rights over the provider connector (owner default D15, 2026-11-08), platform owner only (the DSAR
/// workflow's own gate), dark behind <c>Platform:AssessmentProvidersEnabled</c>:
/// <list type="bullet">
///   <item><description><c>GET .../candidates/{candidateId}/export</c> — the candidate's provider attempts and stored
///   results from the ATS's own tables (DSAR access), audited fail-closed. <c>no-store</c>.</description></item>
///   <item><description><c>POST .../candidates/{candidateId}/erasure</c> — asks the provider to erase every provider
///   subject of the candidate (<c>DELETE /v1/subjects/{id}</c>); the ATS's stored results go when the provider's
///   <c>subject.erased</c> arrives. 202 when every subject's erasure was accepted, 503 when some must be retried.
///   </description></item>
/// </list>
/// The org is a path parameter (a platform owner acts across orgs); an unknown candidate or org is a 404.
/// </summary>
public static class ProviderSubjectRightsEndpoints
{
    public const string CandidatePath = "/platform/assessment-providers/organizations/{organizationId:guid}/candidates/{candidateId:guid}";

    public static void MapProviderSubjectRightsEndpoints(this WebApplication app)
    {
        app.MapGet(CandidatePath + "/export", async (
                Guid organizationId, Guid candidateId, ClaimsPrincipal user, HttpContext httpContext,
                PrincipalResolver principalResolver, IOptions<PlatformOptions> platformOptions,
                ProviderSubjectRightsUseCase useCase, TimeProvider timeProvider, CancellationToken cancellationToken) =>
            {
                httpContext.Response.Headers.CacheControl = "no-store";
                var gate = await PlatformOwnerGate.AuthorizeAsync(
                    user, httpContext, principalResolver, platformOptions.Value, cancellationToken);
                if (gate.Failure is not null)
                {
                    return gate.Failure;
                }

                if (!Guid.TryParse(gate.Context!.UserId, out var actorId))
                {
                    return Results.StatusCode(StatusCodes.Status401Unauthorized);
                }

                var export = await useCase.ExportAsync(
                    organizationId, candidateId, actorId, timeProvider.GetUtcNow(), cancellationToken);
                return export is null ? Results.NotFound() : Results.Ok(export);
            })
            .RequireAuthorization()
            .Produces<ProviderSubjectExport>(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status401Unauthorized).Produces(StatusCodes.Status403Forbidden)
            .Produces(StatusCodes.Status404NotFound)
            .WithName("AssessmentProviderSubjectExport")
            .WithTags("AssessmentProviders");

        app.MapPost(CandidatePath + "/erasure", async (
                Guid organizationId, Guid candidateId, ClaimsPrincipal user, HttpContext httpContext,
                PrincipalResolver principalResolver, IOptions<PlatformOptions> platformOptions,
                ProviderSubjectRightsUseCase useCase, TimeProvider timeProvider, CancellationToken cancellationToken) =>
            {
                var gate = await PlatformOwnerGate.AuthorizeAsync(
                    user, httpContext, principalResolver, platformOptions.Value, cancellationToken);
                if (gate.Failure is not null)
                {
                    return gate.Failure;
                }

                if (!Guid.TryParse(gate.Context!.UserId, out var actorId))
                {
                    return Results.StatusCode(StatusCodes.Status401Unauthorized);
                }

                var result = await useCase.EraseAsync(
                    organizationId, candidateId, actorId, timeProvider.GetUtcNow(), cancellationToken);
                var view = new ProviderErasureView(result.Subjects, result.Requested);
                return result.Outcome switch
                {
                    ProviderErasureOutcome.Requested => Results.Json(view, statusCode: StatusCodes.Status202Accepted),
                    ProviderErasureOutcome.CandidateNotFound => Results.NotFound(),
                    ProviderErasureOutcome.ProviderUnconfigured => Results.Json(
                        new { error = "provider_unconfigured" }, statusCode: StatusCodes.Status503ServiceUnavailable),
                    _ => Results.Json(view, statusCode: StatusCodes.Status503ServiceUnavailable),
                };
            })
            .RequireAuthorization()
            .Produces<ProviderErasureView>(StatusCodes.Status202Accepted)
            .Produces(StatusCodes.Status401Unauthorized).Produces(StatusCodes.Status403Forbidden)
            .Produces(StatusCodes.Status404NotFound)
            .Produces<ProviderErasureView>(StatusCodes.Status503ServiceUnavailable)
            .WithName("AssessmentProviderSubjectErasure")
            .WithTags("AssessmentProviders");
    }
}

/// <summary>How many provider subjects the candidate had and how many erasures the provider accepted.</summary>
public sealed record ProviderErasureView(int Subjects, int Requested);
