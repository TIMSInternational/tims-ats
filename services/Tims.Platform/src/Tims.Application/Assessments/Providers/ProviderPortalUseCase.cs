using Tims.Domain.Assessments.Providers;

namespace Tims.Application.Assessments.Providers;

/// <summary>
/// What the candidate portal shows for one provider attempt. Deliberately coarse (owner default D9: the candidate sees a
/// sitting's status, never its review or validity state):
/// <list type="bullet">
/// <item><see cref="ConsentNeeded"/>: launchable, and the provider still lacks a consent purpose the candidate must give
/// first (the portal shows the provider's consent templates, then launches with them);</item>
/// <item><see cref="Ready"/>: launchable, nothing missing;</item>
/// <item><see cref="InProgress"/>: a sitting has started; relaunching resumes it, even past the start deadline;</item>
/// <item><see cref="Completed"/>: finished at the provider, whatever its result's validity: a result flagged for review,
/// or voided afterwards by a new revision (D12: the attempt then reads <c>voided</c> but HOLDS a result), still shows as
/// completed, so the portal never reveals a review or a later invalidation (D9);</item>
/// <item><see cref="Expired"/>: the start deadline passed before a sitting started;</item>
/// <item><see cref="NeedsReview"/>: the sitting was voided BEFORE any result (D4: it counts as a used attempt, and the
/// organization decides on a new one). The portal tells the candidate the organization will contact them; it never says
/// why.</item>
/// </list>
/// Attempts not created yet, cancelled, erased, in a #312 withdrawal or under an erasure request are not shown.
/// </summary>
public static class ProviderPortalStatuses
{
    public const string ConsentNeeded = "consent_needed";
    public const string Ready = "ready";
    public const string InProgress = "in_progress";
    public const string Completed = "completed";
    public const string Expired = "expired";
    public const string NeedsReview = "needs_review";

    public static string? For(AttemptRow attempt, DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(attempt);
        if (attempt.WithdrawalState is not null || attempt.ErasureRequestedAt is not null)
        {
            return null;
        }

        return attempt.State switch
        {
            ProviderAttemptStates.Created or ProviderAttemptStates.Launched when attempt.ExpiresAt is { } expiresAt && expiresAt <= now
                => Expired,
            ProviderAttemptStates.Created or ProviderAttemptStates.Launched
                => attempt.MissingConsents is { Count: > 0 } ? ConsentNeeded : Ready,
            ProviderAttemptStates.InProgress => InProgress,
            ProviderAttemptStates.Completed or ProviderAttemptStates.ResultReady => Completed,
            ProviderAttemptStates.Voided or ProviderAttemptStates.Expired when attempt.LatestResultId is not null => Completed,
            ProviderAttemptStates.Expired => Expired,
            ProviderAttemptStates.Voided => NeedsReview,
            _ => null, // pending_create, cancelled, erased
        };
    }
}

/// <summary>One attempt as the candidate portal lists it. No scores, validity, reasons or provider ids leave.</summary>
public sealed record PortalAttempt(
    Guid AttemptId, string Instrument, string Status, IReadOnlyList<string> MissingConsents, DateTimeOffset? ExpiresAt,
    string Delivery);

public enum PortalOutcome
{
    Ok,
    NotFound,
    ProviderUnconfigured,
    ProviderUnavailable,
}

public sealed record PortalList(PortalOutcome Outcome, IReadOnlyList<PortalAttempt> Attempts);

public sealed record PortalConsentTemplates(PortalOutcome Outcome, IReadOnlyList<ProviderConsentTemplate> Templates);

/// <summary>
/// The candidate portal's reads over the provider connector (D16). The candidate is identified only by the CONFIRMED email
/// the endpoint verified with the auth service, exactly like the launch: their attempts are those of the organization's
/// active candidates with that email (<c>lower(btrim(email))</c>), and anything else is not found (never 403: no oracle).
/// </summary>
public sealed class ProviderPortalUseCase(IAssessmentProviderRepository repository, IAssessmentProvider provider)
{
    public const int MaxSlugLength = 100;

    private readonly IAssessmentProviderRepository _repository = repository;
    private readonly IAssessmentProvider _provider = provider;

    /// <summary>The candidate's provider attempts at the organization with this public slug, newest first.</summary>
    public async Task<PortalList> ListAsync(
        string organizationSlug, string verifiedEmail, DateTimeOffset now, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(verifiedEmail) || string.IsNullOrWhiteSpace(organizationSlug)
            || organizationSlug.Length > MaxSlugLength)
        {
            return new PortalList(PortalOutcome.NotFound, []);
        }

        var organizationId = await _repository.FindActiveOrganizationBySlugAsync(organizationSlug, cancellationToken)
            .ConfigureAwait(false);
        if (organizationId is not { } org)
        {
            return new PortalList(PortalOutcome.NotFound, []);
        }

        var attempts = await _repository.ListCandidateAttemptsByEmailAsync(org, verifiedEmail, cancellationToken)
            .ConfigureAwait(false);
        var listed = attempts
            .Select(a => (Attempt: a, Status: ProviderPortalStatuses.For(a, now)))
            .Where(x => x.Status is not null)
            .Select(x => new PortalAttempt(
                x.Attempt.Id, x.Attempt.Instrument, x.Status!,
                x.Status == ProviderPortalStatuses.ConsentNeeded ? x.Attempt.MissingConsents ?? [] : [],
                x.Attempt.ExpiresAt, ProviderInstruments.IsLinkOut(x.Attempt.Instrument) ? "link_out" : "native"))
            .ToList();
        return new PortalList(PortalOutcome.Ok, listed);
    }

    /// <summary>
    /// The provider's consent templates (<c>GET /v1/catalog/consent-templates/{purpose}</c>) for each purpose the attempt
    /// still needs, in <paramref name="locale"/>, falling back to the attempt's own locale when the provider does not
    /// offer it. The portal shows them as plain text and launches with the returned <c>text_version</c>s.
    /// </summary>
    public async Task<PortalConsentTemplates> ConsentTemplatesAsync(
        Guid attemptId, string verifiedEmail, string locale, DateTimeOffset now, CancellationToken cancellationToken)
    {
        var owner = await _repository.FindAttemptOwnerAsync(attemptId, cancellationToken).ConfigureAwait(false);
        if (owner is not { } found || string.IsNullOrWhiteSpace(verifiedEmail))
        {
            return new PortalConsentTemplates(PortalOutcome.NotFound, []);
        }

        var context = await _repository.LoadLaunchContextAsync(found.OrganizationId, attemptId, cancellationToken)
            .ConfigureAwait(false);
        if (context is null || !context.CandidateActive || string.IsNullOrWhiteSpace(context.CandidateEmail)
            || !string.Equals(context.CandidateEmail.Trim(), verifiedEmail.Trim(), StringComparison.OrdinalIgnoreCase)
            || context.ConsentWithdrawn || ProviderPortalStatuses.For(context.Attempt, now) != ProviderPortalStatuses.ConsentNeeded)
        {
            // Not this candidate's, or nothing to consent to: the same 404 either way.
            return new PortalConsentTemplates(PortalOutcome.NotFound, []);
        }

        if (!_provider.IsConfigured)
        {
            return new PortalConsentTemplates(PortalOutcome.ProviderUnconfigured, []);
        }

        var templates = new List<ProviderConsentTemplate>();
        foreach (var purpose in context.Attempt.MissingConsents ?? [])
        {
            var template = await _provider.GetConsentTemplateAsync(purpose, locale, cancellationToken).ConfigureAwait(false);
            if (!template.Ok && template.Failure!.Code == "locale_not_supported" && locale != context.Attempt.Locale)
            {
                template = await _provider.GetConsentTemplateAsync(purpose, context.Attempt.Locale, cancellationToken)
                    .ConfigureAwait(false);
            }

            if (!template.Ok)
            {
                return new PortalConsentTemplates(PortalOutcome.ProviderUnavailable, []);
            }

            templates.Add(template.Value!);
        }

        return new PortalConsentTemplates(PortalOutcome.Ok, templates);
    }
}
