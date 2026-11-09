using System.Security.Claims;
using Tims.Application.Assessments.Providers;
using Tims.Application.CandidateConsent;
using Tims.Application.PlatformInvitations;
using Tims.Domain.Assessments.Providers;

namespace Tims.Api.Assessments;

/// <summary>
/// The candidate portal's reads over the provider connector (owner default D16), dark behind
/// <c>Platform:AssessmentProvidersEnabled</c>. The candidate is the CONFIRMED email of the Supabase session
/// (<see cref="ProviderPortalIdentity"/>), never input; both answer <c>Cache-Control: no-store</c>.
/// <list type="bullet">
///   <item><description><c>GET /portal/assessment-attempts?organizationSlug=</c> — the candidate's provider attempts at
///   that organization, each with a coarse status (<see cref="ProviderPortalStatuses"/>: consent needed, ready, in progress,
///   completed, expired, needs review), the consent purposes still needed, the start deadline and the delivery. No scores,
///   validity or provider ids. An unknown slug is a 404.</description></item>
///   <item><description><c>GET /portal/assessment-attempts/{attemptId}/consent-templates?locale=</c> — the provider's
///   consent templates for the purposes that attempt still needs (plain-text blocks). 404 unless the attempt is the
///   candidate's and needs consent; 503 when the provider cannot serve them.</description></item>
/// </list>
/// </summary>
public static class ProviderPortalEndpoints
{
    public const string AttemptsPath = "/portal/assessment-attempts";

    private static readonly string[] PortalLocales = ["es", "en"];

    public static void MapProviderPortalEndpoints(this WebApplication app)
    {
        app.MapGet(AttemptsPath, async (
                string? organizationSlug, ClaimsPrincipal user, HttpContext httpContext, IInvitationIdentityProvider identities,
                IAuthSettingsProbe authSettings, ProviderPortalUseCase useCase, TimeProvider timeProvider,
                CancellationToken cancellationToken) =>
            {
                httpContext.Response.Headers.CacheControl = "no-store";
                var (email, failure) = await ProviderPortalIdentity.VerifyAsync(
                    user, httpContext, identities, authSettings, cancellationToken);
                if (failure is not null)
                {
                    return failure;
                }

                if (string.IsNullOrWhiteSpace(organizationSlug) || organizationSlug.Length > ProviderPortalUseCase.MaxSlugLength)
                {
                    return Results.BadRequest(new { error = "invalid_input" });
                }

                var list = await useCase.ListAsync(organizationSlug, email!, timeProvider.GetUtcNow(), cancellationToken);
                return list.Outcome == PortalOutcome.Ok
                    ? Results.Ok(new PortalAttemptsResponse(list.Attempts.Select(PortalAttemptView.From).ToList()))
                    : Results.NotFound();
            })
            .RequireAuthorization()
            .Produces<PortalAttemptsResponse>(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status400BadRequest).Produces(StatusCodes.Status401Unauthorized)
            .Produces(StatusCodes.Status403Forbidden).Produces(StatusCodes.Status404NotFound)
            .Produces(StatusCodes.Status503ServiceUnavailable)
            .WithName("AssessmentProviderPortalAttempts")
            .WithTags("AssessmentProviders");

        app.MapGet(AttemptsPath + "/{attemptId:guid}/consent-templates", async (
                Guid attemptId, string? locale, ClaimsPrincipal user, HttpContext httpContext,
                IInvitationIdentityProvider identities, IAuthSettingsProbe authSettings, ProviderPortalUseCase useCase,
                TimeProvider timeProvider, CancellationToken cancellationToken) =>
            {
                httpContext.Response.Headers.CacheControl = "no-store";
                var (email, failure) = await ProviderPortalIdentity.VerifyAsync(
                    user, httpContext, identities, authSettings, cancellationToken);
                if (failure is not null)
                {
                    return failure;
                }

                var requested = locale ?? "es";
                if (!PortalLocales.Contains(requested, StringComparer.Ordinal))
                {
                    return Results.BadRequest(new { error = "invalid_input" });
                }

                var templates = await useCase.ConsentTemplatesAsync(
                    attemptId, email!, requested, timeProvider.GetUtcNow(), cancellationToken);
                return templates.Outcome switch
                {
                    PortalOutcome.Ok => Results.Ok(new PortalConsentTemplatesResponse(
                        templates.Templates, templates.OptionalPurposes ?? [])),
                    PortalOutcome.NotFound => Results.NotFound(),
                    PortalOutcome.ProviderUnconfigured => Results.Json(
                        new { error = "provider_unconfigured" }, statusCode: StatusCodes.Status503ServiceUnavailable),
                    _ => Results.Json(new { error = "provider_unavailable" }, statusCode: StatusCodes.Status503ServiceUnavailable),
                };
            })
            .RequireAuthorization()
            .Produces<PortalConsentTemplatesResponse>(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status400BadRequest).Produces(StatusCodes.Status401Unauthorized)
            .Produces(StatusCodes.Status403Forbidden).Produces(StatusCodes.Status404NotFound)
            .Produces(StatusCodes.Status503ServiceUnavailable)
            .WithName("AssessmentProviderPortalConsentTemplates")
            .WithTags("AssessmentProviders");
    }
}

public sealed record PortalAttemptsResponse(IReadOnlyList<PortalAttemptView> Attempts);

/// <summary>One attempt in the candidate portal. <c>Status</c> is one of <see cref="ProviderPortalStatuses"/>.</summary>
/// <param name="OptionalConsents">
/// OPTIONAL purposes the candidate has not decided on yet (English speaking: voice, ai_scoring); empty unless the status is
/// consent_needed.
/// </param>
public sealed record PortalAttemptView(
    Guid AttemptId, string Instrument, string Status, IReadOnlyList<string> MissingConsents, DateTimeOffset? ExpiresAt,
    string Delivery, Guid VacancyId, IReadOnlyList<string> OptionalConsents)
{
    public static PortalAttemptView From(PortalAttempt attempt) =>
        new(attempt.AttemptId, attempt.Instrument, attempt.Status, attempt.MissingConsents, attempt.ExpiresAt, attempt.Delivery,
            attempt.VacancyId, attempt.OptionalConsents ?? []);
}

/// <param name="OptionalPurposes">The purposes among the templates the candidate may decline (separate, unticked).</param>
public sealed record PortalConsentTemplatesResponse(
    IReadOnlyList<ProviderConsentTemplate> Templates, IReadOnlyList<string> OptionalPurposes);
