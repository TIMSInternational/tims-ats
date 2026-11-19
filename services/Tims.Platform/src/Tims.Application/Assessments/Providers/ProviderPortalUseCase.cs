using Tims.Domain.Assessments.Providers;

namespace Tims.Application.Assessments.Providers;

/// <summary>
/// What the candidate portal shows for one provider attempt. Deliberately coarse (owner default D9: the candidate sees a
/// sitting's status, never its review or validity state):
/// <list type="bullet">
/// <item><see cref="ConsentNeeded"/>: launchable, and the provider still lacks a consent purpose the candidate must give
/// first, or the instrument offers an OPTIONAL purpose the candidate has not decided on yet (English speaking: voice and
/// ai_scoring). The portal shows the provider's consent templates, the optional ones unticked and separately, then
/// launches with what was accepted and what was declined;</item>
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
                => attempt.MissingConsents is { Count: > 0 } || attempt.PendingOptionalConsents.Count > 0
                    ? ConsentNeeded
                    : Ready,
            ProviderAttemptStates.InProgress => InProgress,
            ProviderAttemptStates.Completed or ProviderAttemptStates.ResultReady => Completed,
            ProviderAttemptStates.Voided or ProviderAttemptStates.Expired when attempt.LatestResultId is not null => Completed,
            ProviderAttemptStates.Expired => Expired,
            ProviderAttemptStates.Voided => NeedsReview,
            _ => null, // pending_create, cancelled, erased
        };
    }
}

/// <summary>
/// One attempt as the candidate portal lists it. No scores, validity, reasons or provider ids leave. The vacancy id is the
/// candidate's own application's: the portal names the vacancy in the consent notice (purpose "selection for vacancy X").
/// <c>Locale</c> is the language the test is administered in (the attempt's own): the portal's frame around it speaks that
/// language too, whatever language the portal itself is shown in.
/// </summary>
public sealed record PortalAttempt(
    Guid AttemptId, string Instrument, string Status, IReadOnlyList<string> MissingConsents, DateTimeOffset? ExpiresAt,
    string Delivery, string Locale, Guid VacancyId = default, IReadOnlyList<string>? OptionalConsents = null);

public enum PortalOutcome
{
    Ok,
    NotFound,
    ProviderUnconfigured,
    ProviderUnavailable,
}

public sealed record PortalList(PortalOutcome Outcome, IReadOnlyList<PortalAttempt> Attempts);

/// <param name="OptionalPurposes">The purposes among <paramref name="Templates"/> the candidate may decline.</param>
public sealed record PortalConsentTemplates(
    PortalOutcome Outcome, IReadOnlyList<ProviderConsentTemplate> Templates, IReadOnlyList<string>? OptionalPurposes = null);

/// <summary>
/// The candidate portal's reads over the provider connector (D16). The candidate is identified only by the CONFIRMED email
/// the endpoint verified with the auth service, exactly like the launch: their attempts are those of the organization's
/// active candidates with that email (<c>lower(btrim(email))</c>), and anything else is not found (never 403: no oracle).
/// </summary>
/// <param name="refreshBudgetForTests">TEST-ONLY: replaces <see cref="PortalRefreshBudget"/>.</param>
public sealed class ProviderPortalUseCase(
    IAssessmentProviderRepository repository, IAssessmentProvider provider, TimeSpan? refreshBudgetForTests = null)
{
    public const int MaxSlugLength = 100;

    /// <summary>
    /// The most the list spends refreshing link-out attempts from the provider before it answers (claims, provider reads
    /// and the guarded writes together); the poll in hand is cancelled at that point. Above the provider's usual answer
    /// for a PCA sitting (it probes the survey with its own 4-second limit) and small next to the portal's 15-second
    /// frame poll.
    /// </summary>
    public static readonly TimeSpan PortalRefreshBudget = TimeSpan.FromSeconds(5);

    /// <summary>
    /// The most one lease release may take after the budget (its own token: the budget's may be spent). A release that
    /// does not land leaves the lease to expire after <see cref="ProviderAttemptPolling.PortalRefreshLease"/>.
    /// </summary>
    public static readonly TimeSpan ReleaseTimeout = TimeSpan.FromSeconds(1);

    /// <summary>At most this many attempts are refreshed per list (a candidate normally has one PCA per application).</summary>
    public const int MaxRefreshesPerList = 3;

    private readonly IAssessmentProviderRepository _repository = repository;
    private readonly IAssessmentProvider _provider = provider;
    private readonly TimeSpan _refreshBudget = refreshBudgetForTests ?? PortalRefreshBudget;

    /// <summary>
    /// The candidate's provider attempts at the organization with this public slug, newest first.
    /// <para>
    /// Link-out attempts the candidate may be sitting are first refreshed from the provider
    /// (<see cref="RefreshLinkOutAsync"/>, production 2026-11-19): the portal polls this list every 15 s while the PCA
    /// frame is open and closes the frame once the attempt reads completed, but the ATS otherwise learned of a completion
    /// only from the provider's webhook (sent from a 10-minute cron) or the D17 poller (stale attempts only), so the frame
    /// stayed open for up to ten minutes after the candidate finished. The provider's <c>GET /v1/assignments/{id}</c> on
    /// an in-progress PCA sitting asks the survey whether it is complete and records it, so reading it here closes the
    /// frame on the next poll. When anything changed the list is read again; otherwise the first read stands.
    /// </para>
    /// </summary>
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
        if (await RefreshLinkOutAsync(org, attempts, now, cancellationToken).ConfigureAwait(false))
        {
            attempts = await _repository.ListCandidateAttemptsByEmailAsync(org, verifiedEmail, cancellationToken)
                .ConfigureAwait(false);
        }

        var listed = attempts
            .Select(a => (Attempt: a, Status: ProviderPortalStatuses.For(a, now)))
            .Where(x => x.Status is not null)
            .Select(x => new PortalAttempt(
                x.Attempt.Id, x.Attempt.Instrument, x.Status!,
                x.Status == ProviderPortalStatuses.ConsentNeeded ? x.Attempt.MissingConsents ?? [] : [],
                x.Attempt.ExpiresAt, ProviderInstruments.IsLinkOut(x.Attempt.Instrument) ? "link_out" : "native",
                x.Attempt.Locale, x.Attempt.VacancyId,
                x.Status == ProviderPortalStatuses.ConsentNeeded ? x.Attempt.PendingOptionalConsents : []))
            .ToList();
        return new PortalList(PortalOutcome.Ok, listed);
    }

    /// <summary>
    /// Refreshes, from the provider, the candidate's link-out attempts in
    /// <see cref="ProviderAttemptPolling.PortalRefreshStates"/> that the portal shows as launchable or in progress. Only
    /// attempts from the list just read under this candidate's verified email and this organization's tenant scope are
    /// considered, so the refresh reaches nothing the list would not show. Each one is:
    /// <list type="number">
    /// <item>claimed with <see cref="IAssessmentProviderRepository.ClaimAttemptForPortalRefreshAsync"/>: the D17 poller's
    /// own lease columns, so the poller and any other App Runner instance never poll it at the same time, and only when
    /// it was not polled within <see cref="ProviderAttemptPolling.PortalRefreshInterval"/> (the rate limit, database
    /// clock). Not claimed means skipped;</item>
    /// <item>polled with <see cref="ProviderAttemptPollUseCase.PollOneAsync"/>, the poller's single-attempt step, so the
    /// assignment is checked against the attempt and its status and result go through the same forward-only, guarded
    /// writes a webhook uses (no second state machine);</item>
    /// <item>released with <see cref="IAssessmentProviderRepository.ReleasePollLeaseAsync"/>, which stamps
    /// <c>last_polled_at</c>: a provider that fails or hangs is asked again only after the interval.</item>
    /// </list>
    /// Everything runs inside <see cref="PortalRefreshBudget"/> (each release then gets at most
    /// <see cref="ReleaseTimeout"/>), and no failure, provider or database, ever fails the list: the candidate then sees
    /// the last known state, and the webhook and the D17 poller remain the paths that guarantee delivery. Only a
    /// cancellation of the request itself propagates. True when any refresh changed something.
    /// </summary>
    private async Task<bool> RefreshLinkOutAsync(
        Guid organizationId, IReadOnlyList<AttemptRow> attempts, DateTimeOffset now, CancellationToken cancellationToken)
    {
        if (!_provider.IsConfigured)
        {
            return false;
        }

        var refreshable = attempts
            .Where(a => ProviderInstruments.IsLinkOut(a.Instrument)
                &&ProviderAttemptPolling.PortalRefreshStates.Contains(a.State)
                && ProviderPortalStatuses.For(a, now) is ProviderPortalStatuses.Ready or ProviderPortalStatuses.ConsentNeeded
                    or ProviderPortalStatuses.InProgress)
            .Take(MaxRefreshesPerList)
            .ToList();
        if (refreshable.Count == 0)
        {
            return false;
        }

        var owner = Guid.NewGuid();
        var poll = new ProviderAttemptPollUseCase(_repository, _provider);
        var changed = false;
        using var budget = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        budget.CancelAfter(_refreshBudget);
        foreach (var attempt in refreshable)
        {
            if (budget.IsCancellationRequested)
            {
                break;
            }

            PolledAttempt? claimed = null;
            try
            {
                claimed = await _repository.ClaimAttemptForPortalRefreshAsync(organizationId, attempt.Id, owner, budget.Token)
                    .ConfigureAwait(false);
                if (claimed is not null)
                {
                    changed |= await poll.PollOneAsync(organizationId, claimed, now, budget.Token).ConfigureAwait(false);
                }
            }
            catch (Exception ex) when (ex is not OperationCanceledException || !cancellationToken.IsCancellationRequested)
            {
                // A provider or database failure, or the budget running out: the last known state is listed.
            }

            cancellationToken.ThrowIfCancellationRequested();
            if (claimed is not null)
            {
                await ReleaseAsync(organizationId, attempt.Id, owner, cancellationToken).ConfigureAwait(false);
            }
        }

        return changed;
    }

    private async Task ReleaseAsync(Guid organizationId, Guid attemptId, Guid owner, CancellationToken cancellationToken)
    {
        using var release = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        release.CancelAfter(ReleaseTimeout);
        try
        {
            await _repository.ReleasePollLeaseAsync(organizationId, attemptId, owner, release.Token).ConfigureAwait(false);
        }
        catch (Exception ex) when (ex is not OperationCanceledException || !cancellationToken.IsCancellationRequested)
        {
            // The lease expires on its own (PortalRefreshLease).
        }
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

        // Required purposes first (the provider's missing_consents), then each OPTIONAL purpose the candidate has not
        // decided on yet. An optional purpose the provider already reports missing is required for this version.
        var required = context.Attempt.MissingConsents ?? [];
        var optional = context.Attempt.PendingOptionalConsents.Where(p => !required.Contains(p)).ToList();
        var templates = new List<ProviderConsentTemplate>();
        foreach (var purpose in required.Concat(optional))
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

        return new PortalConsentTemplates(PortalOutcome.Ok, templates, optional);
    }
}
