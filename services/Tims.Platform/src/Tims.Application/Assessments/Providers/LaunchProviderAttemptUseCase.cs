using System.Text.Json.Nodes;
using Tims.Domain.Assessments.Providers;

namespace Tims.Application.Assessments.Providers;

/// <summary>A consent the candidate just gave in the ATS portal, for one purpose, to one text version.</summary>
public sealed record CapturedConsent(string Purpose, string TextVersion, string Locale);

public enum LaunchOutcome
{
    Launched,
    NotFound,
    ConsentWithdrawn,
    NotLaunchable,
    NotReady,
    Expired,

    /// <summary>The provider still lacks a consent the instrument version requires (<c>missing</c> lists them).</summary>
    ConsentRequired,

    /// <summary>The provider refused a consent record (for example an unknown text version).</summary>
    ConsentRejected,
    ProviderUnconfigured,
    ProviderUnavailable,
    ProviderRefused,
}

public sealed record LaunchResult(LaunchOutcome Outcome, ProviderLaunch? Launch, IReadOnlyList<string> Missing, string? Detail)
{
    public static LaunchResult Fail(LaunchOutcome outcome, string? detail = null) => new(outcome, null, [], detail);
}

/// <summary>
/// The candidate launches one provider attempt from the ATS portal (AS-5 consent gate). The candidate's identity is
/// the CONFIRMED email the endpoint verified with the auth service; it must equal the email of the attempt's
/// candidate, else the attempt does not exist for this caller (404, never 403: no oracle on attempt ids).
///
/// <para>Gate order: identity → #312 withdrawn recruitment consent (409, checked on EVERY launch, not only at assign:
/// TS never re-checked it at start) → launchable state → not expired → the per-purpose consents the candidate just
/// gave are recorded at the provider (each with an ATS audit row whose id is the provider's <c>host_record_ref</c>) →
/// launch. A provider <c>consent_required</c> comes back as the list of missing purposes for the portal to ask for.
/// The candidate token is returned to the caller only and never stored or logged.</para>
/// </summary>
public sealed class LaunchProviderAttemptUseCase(IAssessmentProviderRepository repository, IAssessmentProvider provider)
{
    public const int MaxConsents = 4;

    private readonly IAssessmentProviderRepository _repository = repository;
    private readonly IAssessmentProvider _provider = provider;

    public async Task<LaunchResult> LaunchAsync(
        Guid attemptId, string verifiedEmail, IReadOnlyList<CapturedConsent> consents, DateTimeOffset now,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(consents);
        if (string.IsNullOrWhiteSpace(verifiedEmail))
        {
            return LaunchResult.Fail(LaunchOutcome.NotFound);
        }

        var owner = await _repository.FindAttemptOwnerAsync(attemptId, cancellationToken).ConfigureAwait(false);
        if (owner is not { } found)
        {
            return LaunchResult.Fail(LaunchOutcome.NotFound);
        }

        var context = await _repository.LoadLaunchContextAsync(found.OrganizationId, attemptId, cancellationToken)
            .ConfigureAwait(false);
        if (context is null || !context.CandidateActive || !SameEmail(context.CandidateEmail, verifiedEmail))
        {
            return LaunchResult.Fail(LaunchOutcome.NotFound);
        }

        if (context.ConsentWithdrawn)
        {
            return LaunchResult.Fail(LaunchOutcome.ConsentWithdrawn);
        }

        var attempt = context.Attempt;
        if (attempt.State == ProviderAttemptStates.PendingCreate || attempt.ProviderAssignmentId is null
            || attempt.ProviderSubjectId is null)
        {
            return LaunchResult.Fail(LaunchOutcome.NotReady);
        }

        if (attempt.State == ProviderAttemptStates.Expired || (attempt.ExpiresAt is { } expiresAt && expiresAt <= now))
        {
            return LaunchResult.Fail(LaunchOutcome.Expired);
        }

        if (!ProviderAttemptStates.IsLaunchable(attempt.State))
        {
            return LaunchResult.Fail(LaunchOutcome.NotLaunchable, attempt.State);
        }

        if (!_provider.IsConfigured)
        {
            return LaunchResult.Fail(LaunchOutcome.ProviderUnconfigured);
        }

        foreach (var consent in consents)
        {
            var auditId = Guid.NewGuid();
            var recorded = await _provider.RecordConsentAsync(
                attempt.ProviderSubjectId.Value,
                new ProviderConsentRequest(
                    consent.Purpose, consent.TextVersion, consent.Locale, now, auditId.ToString(), attempt.VacancyId.ToString()),
                IdempotencyKeys.Consent(auditId),
                cancellationToken).ConfigureAwait(false);

            // The capture is audited either way: the candidate did consent in the ATS; whether the provider holds the
            // record is part of the row.
            await _repository.AuditConsentCapturedAsync(
                found.OrganizationId, auditId, attempt.CandidateId, attempt.Id, consent.Purpose, consent.TextVersion,
                consent.Locale, recorded.Ok, cancellationToken).ConfigureAwait(false);
            if (!recorded.Ok)
            {
                return recorded.Failure!.Transient
                    ? LaunchResult.Fail(LaunchOutcome.ProviderUnavailable, recorded.Failure.Code)
                    : LaunchResult.Fail(LaunchOutcome.ConsentRejected, recorded.Failure.Code);
            }
        }

        var launched = await _provider.LaunchAsync(attempt.ProviderAssignmentId.Value, cancellationToken).ConfigureAwait(false);
        if (!launched.Ok)
        {
            var failure = launched.Failure!;
            if (failure.Code == "consent_required")
            {
                return new LaunchResult(LaunchOutcome.ConsentRequired, null, failure.MissingConsents, failure.Code);
            }

            if (failure.Code == "assignment_expired")
            {
                await _repository.MarkExpiredAsync(found.OrganizationId, attempt.Id, now, cancellationToken)
                    .ConfigureAwait(false);
                return LaunchResult.Fail(LaunchOutcome.Expired);
            }

            return failure.Transient
                ? LaunchResult.Fail(LaunchOutcome.ProviderUnavailable, failure.Code)
                : LaunchResult.Fail(LaunchOutcome.ProviderRefused, failure.Code);
        }

        await _repository.MarkLaunchedAsync(
            found.OrganizationId, attempt.Id, attempt.CandidateId, launched.Value!.Delivery, now, cancellationToken)
            .ConfigureAwait(false);
        return new LaunchResult(LaunchOutcome.Launched, launched.Value, [], null);
    }

    // The same normalisation the #312 email-sibling predicate uses: lower(btrim(email)).
    private static bool SameEmail(string? stored, string verified) =>
        !string.IsNullOrWhiteSpace(stored)
        && string.Equals(stored.Trim(), verified.Trim(), StringComparison.OrdinalIgnoreCase);

    /// <summary>
    /// Strict body: <c>{ "consents"?: [{ "purpose", "textVersion", "locale" }] }</c>, at most one entry per purpose.
    /// </summary>
    public static bool TryParseBody(JsonNode? node, out IReadOnlyList<CapturedConsent> consents)
    {
        consents = [];
        if (node is null)
        {
            return true;
        }

        if (node is not JsonObject body || body.Any(p => p.Key != "consents"))
        {
            return false;
        }

        if (body["consents"] is null)
        {
            return true;
        }

        if (body["consents"] is not JsonArray array || array.Count > MaxConsents)
        {
            return false;
        }

        var parsed = new List<CapturedConsent>();
        foreach (var entry in array)
        {
            if (entry is not JsonObject item || item.Any(p => p.Key is not ("purpose" or "textVersion" or "locale"))
                || !TryString(item["purpose"], 16, out var purpose) || !ConsentPurposes.IsKnown(purpose)
                || !TryString(item["textVersion"], 64, out var textVersion) || !ProviderFormats.IsContentVersion(textVersion)
                || !TryString(item["locale"], 5, out var locale) || !ProviderFormats.IsLocale(locale)
                || parsed.Any(c => c.Purpose == purpose))
            {
                return false;
            }

            parsed.Add(new CapturedConsent(purpose!, textVersion!, locale!));
        }

        consents = parsed;
        return true;
    }

    private static bool TryString(JsonNode? node, int maxLength, out string? value)
    {
        value = null;
        if (node is not JsonValue jsonValue || !jsonValue.TryGetValue(out string? raw) || raw is null
            || raw.Length == 0 || raw.Length > maxLength)
        {
            return false;
        }

        value = raw;
        return true;
    }
}
