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
/// launch, with the #312 check repeated INSIDE the candidate lock a withdrawal takes and held across the provider call
/// (<see cref="IAssessmentProviderRepository.LaunchUnderCandidateLockAsync"/>). A provider <c>consent_required</c> comes
/// back as the list of missing purposes for the portal to ask for: the launch answers it for a LINK-OUT instrument
/// (PCA), whose sitting has no session to gate. For a native instrument the provider checks consents when the session
/// starts, so the portal asks for the purposes the provider last reported missing BEFORE it launches.</para>
///
/// <para>Owner default D16: every launch is <c>mode: hosted</c>. The candidate gets the TIMS hosted player's single-use
/// URL (native) or the provider's URL (link-out), plus the registered origins that may frame the player; never a
/// candidate token. The URL is returned to the caller only, never stored or logged.</para>
/// </summary>
public sealed class LaunchProviderAttemptUseCase(IAssessmentProviderRepository repository, IAssessmentProvider provider)
{
    public const int MaxConsents = 4;

    private readonly IAssessmentProviderRepository _repository = repository;
    private readonly IAssessmentProvider _provider = provider;

    /// <param name="embedded">
    /// The portal will FRAME the hosted player (its origin is among the player's registered frame ancestors): no
    /// <c>return_url</c> is sent, so the player ends on its own screen inside the frame instead of navigating the frame to
    /// the portal (which refuses to be framed). Top-level (the default): the player returns the candidate to the portal.
    /// </param>
    /// <param name="declinedOptional">
    /// The OPTIONAL purposes (<see cref="OptionalConsents"/>) the candidate was offered and declined. Recorded on the
    /// attempt with the optional purposes granted in <paramref name="consents"/>, once every capture succeeded, so HR can
    /// tell "speaking not assessed (no voice consent)" from a provider-side gap. Purposes the instrument does not offer
    /// as optional are ignored.
    /// </param>
    public async Task<LaunchResult> LaunchAsync(
        Guid attemptId, string verifiedEmail, IReadOnlyList<CapturedConsent> consents, DateTimeOffset now,
        CancellationToken cancellationToken, bool embedded = false, IReadOnlyList<string>? declinedOptional = null)
    {
        ArgumentNullException.ThrowIfNull(consents);
        declinedOptional ??= [];
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

        if (context.Attempt.ErasureRequestedAt is not null)
        {
            // An erasure of the attempt's provider subject was accepted: nothing is captured or launched for it again.
            return LaunchResult.Fail(LaunchOutcome.NotFound);
        }

        if (context.ConsentWithdrawn || context.Attempt.WithdrawalState is not null)
        {
            return LaunchResult.Fail(LaunchOutcome.ConsentWithdrawn);
        }

        var attempt = context.Attempt;
        if (attempt.State == ProviderAttemptStates.PendingCreate || attempt.ProviderAssignmentId is null
            || attempt.ProviderSubjectId is null)
        {
            return LaunchResult.Fail(LaunchOutcome.NotReady);
        }

        // expires_at bounds only when a sitting can START (contract, launchAssignment): a session already in progress
        // stays resumable after it, until its own deadline. So the local clock check applies only to a sitting that has
        // not started; for one in progress the provider decides (410 assignment_expired is handled below).
        if (attempt.State == ProviderAttemptStates.Expired
            || (attempt.State != ProviderAttemptStates.InProgress && attempt.ExpiresAt is { } expiresAt && expiresAt <= now))
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

        // Announced durably BEFORE any capture is sent (and refused for an attempt that entered a #312 withdrawal since
        // the check above): a withdrawal pass cannot complete this attempt while the capture is in flight or after it
        // changed, so a consent stored now is withdrawn by the cascade even if this request is cancelled, fails or
        // crashes before the re-check below (WithdrawalFence).
        if (consents.Count > 0
            && !await _repository.BeginConsentCaptureAsync(found.OrganizationId, attempt.Id, now, cancellationToken)
                .ConfigureAwait(false))
        {
            return LaunchResult.Fail(LaunchOutcome.ConsentWithdrawn);
        }

        // A capture that FAILED may still have been stored by the provider (a timeout after its commit), and an earlier
        // capture in this loop may have succeeded, so the first failure stops the loop but is returned only AFTER the
        // #312 re-check below: every attempted capture is covered by it.
        LaunchResult? captureFailure = null;
        var everyCaptureAnswered = true;
        var captured = new List<string>();
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
                // Without an HTTP answer (timeout, outage) the provider may still store this capture, and so it may
                // after a 409 idempotency_key_in_use (a request with this key is still being processed there).
                everyCaptureAnswered = recorded.Failure!.HttpStatus is not null
                    && recorded.Failure.Code != ProviderFailure.IdempotencyKeyInUse;
                captureFailure = recorded.Failure.Transient
                    ? LaunchResult.Fail(LaunchOutcome.ProviderUnavailable, recorded.Failure.Code)
                    : LaunchResult.Fail(LaunchOutcome.ConsentRejected, recorded.Failure.Code);
                break;
            }

            captured.Add(consent.Purpose);
        }

        if (consents.Count > 0)
        {
            if (everyCaptureAnswered)
            {
                // Nothing of this launch is in flight at the provider any more. Otherwise the announcement stays in flight
                // until it is stale, and the cascade keeps the attempt pending meanwhile.
                await _repository.EndConsentCaptureAsync(found.OrganizationId, attempt.Id, now, cancellationToken)
                    .ConfigureAwait(false);
            }

            // A withdrawal may have run its whole provider cascade between the #312 check above and these consent
            // writes, so a consent just recorded would stay active. Re-checked AFTER the provider recorded it, whether
            // or not every capture succeeded: a withdrawal seen now re-opens this attempt's cascade (durably: the
            // attempt is pending again, and the cascade withdraws every active consent the provider lists); one
            // committed later lists consents after this one exists, so its own cascade withdraws it.
            var recheck = await _repository.LoadLaunchContextAsync(found.OrganizationId, attemptId, cancellationToken)
                .ConfigureAwait(false);
            if (recheck is null || recheck.ConsentWithdrawn || recheck.Attempt.WithdrawalState is not null)
            {
                await _repository.ReopenWithdrawalAsync(found.OrganizationId, attemptId, now, cancellationToken)
                    .ConfigureAwait(false);
                await new ProviderConsentWithdrawalUseCase(_repository, _provider).StageAndPropagateAsync(
                    found.OrganizationId, attempt.CandidateId, now, cancellationToken).ConfigureAwait(false);
                return LaunchResult.Fail(LaunchOutcome.ConsentWithdrawn);
            }
        }

        if (captureFailure is not null)
        {
            return captureFailure;
        }

        var offered = OptionalConsents.For(attempt.Instrument);
        var grantedOptional = captured.Where(offered.Contains).ToList();
        var declinedNow = declinedOptional.Where(offered.Contains).ToList();
        if (grantedOptional.Count > 0 || declinedNow.Count > 0)
        {
            // Recorded under the attempt lock. The provider is made to match the RECORDED declines inside the launch's
            // own locks (LaunchAtProviderAsync), so a concurrent grant from another tab can never interleave between a
            // withdrawal and the launch: whichever decision was recorded last is the one the provider holds at launch.
            await _repository.RecordOptionalConsentDecisionsAsync(
                found.OrganizationId, attempt.Id, grantedOptional, declinedNow, cancellationToken).ConfigureAwait(false);
        }

        if (captured.Count > 0 && attempt.MissingConsents is { Count: > 0 } before)
        {
            // What the portal shows as "consent needed": the purposes just recorded are no longer missing. The provider
            // stays the authority; a poll or a consent_required below replaces this list with its own.
            await _repository.SetMissingConsentsAsync(
                found.OrganizationId, attempt.Id, before.Except(captured, StringComparer.Ordinal).ToList(), cancellationToken)
                .ConfigureAwait(false);
        }

        var slug = await _repository.GetActiveOrganizationSlugAsync(found.OrganizationId, cancellationToken).ConfigureAwait(false);
        var returnPath = !embedded && slug is { Length: > 0 } ? $"/careers/{slug}/dashboard" : null;
        var locked = await _repository.LaunchUnderCandidateLockAsync(
            found.OrganizationId, attempt.Id,
            (fresh, ct) => LaunchAtProviderAsync(fresh, context, returnPath, now, ct), now, cancellationToken).ConfigureAwait(false);
        switch (locked.Outcome)
        {
            case LockedLaunchOutcome.NotFound:
                return LaunchResult.Fail(LaunchOutcome.NotFound);
            case LockedLaunchOutcome.ConsentWithdrawn:
                return LaunchResult.Fail(LaunchOutcome.ConsentWithdrawn);
            case LockedLaunchOutcome.NotLaunchable:
                return locked.State == ProviderAttemptStates.Expired
                    ? LaunchResult.Fail(LaunchOutcome.Expired)
                    : LaunchResult.Fail(LaunchOutcome.NotLaunchable, locked.State);
        }

        var launched = locked.Call!;
        if (!launched.Ok)
        {
            var failure = launched.Failure!;
            if (failure.Code == "consent_required")
            {
                await _repository.SetMissingConsentsAsync(found.OrganizationId, attempt.Id, failure.MissingConsents, cancellationToken)
                    .ConfigureAwait(false);
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

        return new LaunchResult(LaunchOutcome.Launched, launched.Value, [], null);
    }

    // A declined optional purpose must not stay active at the provider (an earlier attempt of this subject may have
    // granted it): every ACTIVE consent of the subject for a declined purpose that COVERS this attempt's vacancy (unscoped,
    // or scoped to it) is withdrawn before the launch. A consent scoped to ANOTHER vacancy is left alone: the provider
    // never counts it toward this assignment, and withdrawing it would void that vacancy's sitting or result. A 404/410
    // means there is nothing to withdraw. False when the provider could not confirm it.
    private async Task<bool> WithdrawDeclinedAsync(
        Guid subjectId, string vacancyRef, IReadOnlyList<string> declined, DateTimeOffset now,
        CancellationToken cancellationToken)
    {
        var consents = await _provider.ListConsentsAsync(subjectId, cancellationToken).ConfigureAwait(false);
        if (!consents.Ok)
        {
            return consents.Failure!.HttpStatus is 404 or 410;
        }

        foreach (var consent in consents.Value!.Where(c => c.Status == "active" && declined.Contains(c.Purpose) && c.Covers(vacancyRef)))
        {
            var withdrawn = await _provider.WithdrawConsentAsync(subjectId, consent.ConsentId, now, cancellationToken)
                .ConfigureAwait(false);
            if (!withdrawn.Ok && withdrawn.Failure!.HttpStatus is not (404 or 410))
            {
                return false;
            }
        }

        return true;
    }

    // Runs inside the candidate lock: the hosted launch, plus the contract's recovery for a link-out sitting that needs the
    // subject's names and email (PATCH the subject from the candidate record, then launch again, once).
    private async Task<ProviderCall<ProviderLaunch>> LaunchAtProviderAsync(
        AttemptRow attempt, LaunchContext context, string? returnPath, DateTimeOffset now, CancellationToken cancellationToken)
    {
        // The candidate's RECORDED optional declines, read fresh under the attempt lock (no decision can change while it is
        // held), are enforced at the provider before the sitting starts: an active consent for a declined purpose (an
        // earlier grant, another tab) is withdrawn, so the provider never administers what HR reads as "not assessed".
        var declined = (attempt.DeclinedOptionalConsents ?? []).Where(OptionalConsents.For(attempt.Instrument).Contains).ToList();
        if (declined.Count > 0 && attempt.CaptureInFlightAt(now))
        {
            // Another launch's capture (another tab) was announced and may still land at the provider AFTER the
            // withdrawal below, re-activating a declined purpose. Captures are announced under this same attempt lock,
            // so none can begin while it is held; one already in flight is waited out (retry) until it is answered (its
            // launch then records its decision) or stale.
            return ProviderCall<ProviderLaunch>.Fail(new ProviderFailure(null, "consent_capture_in_flight", true, []));
        }

        if (declined.Count > 0 && attempt.ProviderSubjectId is { } subjectId
            && !await WithdrawDeclinedAsync(subjectId, attempt.VacancyId.ToString(), declined, now, cancellationToken).ConfigureAwait(false))
        {
            return ProviderCall<ProviderLaunch>.Fail(new ProviderFailure(null, "optional_consent_withdrawal_failed", true, []));
        }

        var launched = await _provider.LaunchAsync(attempt.ProviderAssignmentId!.Value, returnPath, cancellationToken)
            .ConfigureAwait(false);
        if (!launched.Ok && launched.Failure!.Code == ProviderFailure.SubjectDataRequired
            && AssignProviderInstrumentsUseCase.SubjectUpdateFor(new AssignmentContext(
                true, true, true, false, null, context.CandidateFirstName, context.CandidateLastName, context.CandidateEmail))
                is { } update)
        {
            var enriched = await _provider.UpdateSubjectAsync(attempt.ProviderSubjectId!.Value, update, cancellationToken)
                .ConfigureAwait(false);
            if (enriched.Ok)
            {
                launched = await _provider.LaunchAsync(attempt.ProviderAssignmentId!.Value, returnPath, cancellationToken)
                    .ConfigureAwait(false);
            }
        }

        return launched;
    }

    // The same normalisation the #312 email-sibling predicate uses: lower(btrim(email)).
    private static bool SameEmail(string? stored, string verified) =>
        !string.IsNullOrWhiteSpace(stored)
        && string.Equals(stored.Trim(), verified.Trim(), StringComparison.OrdinalIgnoreCase);

    /// <summary>
    /// Strict body: <c>{ "consents"?: [{ "purpose", "textVersion", "locale" }], "embedded"?: boolean }</c>, at most one
    /// consent entry per purpose.
    /// </summary>
    public static bool TryParseBody(JsonNode? node, out IReadOnlyList<CapturedConsent> consents) =>
        TryParseBody(node, out consents, out _);

    public static bool TryParseBody(JsonNode? node, out IReadOnlyList<CapturedConsent> consents, out bool embedded) =>
        TryParseBody(node, out consents, out embedded, out _);

    /// <param name="declined">
    /// The OPTIONAL purposes the candidate saw and left unticked (<c>declinedConsents</c>): known purposes, unique, never
    /// also among <paramref name="consents"/>. Which of them the instrument really offers is checked by the launch.
    /// </param>
    public static bool TryParseBody(
        JsonNode? node, out IReadOnlyList<CapturedConsent> consents, out bool embedded, out IReadOnlyList<string> declined)
    {
        consents = [];
        embedded = false;
        declined = [];
        if (node is null)
        {
            return true;
        }

        if (node is not JsonObject body || body.Any(p => p.Key is not ("consents" or "embedded" or "declinedConsents")))
        {
            return false;
        }

        if (body["declinedConsents"] is { } declinedNode)
        {
            if (declinedNode is not JsonArray declinedArray || declinedArray.Count > MaxConsents)
            {
                return false;
            }

            var parsedDeclined = new List<string>();
            foreach (var entry in declinedArray)
            {
                if (!TryString(entry, 16, out var purpose) || !ConsentPurposes.IsKnown(purpose)
                    || parsedDeclined.Contains(purpose!))
                {
                    return false;
                }

                parsedDeclined.Add(purpose!);
            }

            declined = parsedDeclined;
        }

        if (body["embedded"] is { } flag)
        {
            if (flag is not JsonValue value || !value.TryGetValue(out bool isEmbedded))
            {
                return false;
            }

            embedded = isEmbedded;
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

        var declinedPurposes = declined;
        if (parsed.Any(c => declinedPurposes.Contains(c.Purpose)))
        {
            return false;
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
