using System.Globalization;
using System.Text.Json.Nodes;
using Tims.Domain.Assessments.Providers;

namespace Tims.Application.Assessments.Providers;

public sealed record AssignInstrumentItem(string Instrument, string? Reason);

public sealed record AssignProviderInstrumentsInput(
    Guid CandidateId,
    Guid VacancyId,
    IReadOnlyList<AssignInstrumentItem> Instruments,
    string? Locale,
    decimal TimeMultiplier,
    IReadOnlyList<string> Aids,
    DateTimeOffset? ExpiresAt);

/// <summary>
/// One attempt as HR sees it. <see cref="Locale"/>, <see cref="TimeMultiplier"/> and <see cref="Aids"/> are the terms
/// IN FORCE on the attempt (for an attempt that already existed, its own, not the request's), so a dropped change is
/// visible.
/// </summary>
public sealed record ProviderAssignItem(
    string AttemptId,
    string Instrument,
    string State,
    string? InstrumentVersion,
    IReadOnlyList<string> RequiredConsents,
    string? ExpiresAt,
    string? Error,
    string Locale,
    decimal TimeMultiplier,
    IReadOnlyList<string> Aids);

public sealed record ProviderAssignResponse(bool Complete, IReadOnlyList<ProviderAssignItem> Items);

public enum ProviderAssignOutcome
{
    Ok,
    InvalidInput,
    ProviderUnconfigured,
    NotEnabled,
    InstrumentNotEnabled,
    CandidateNotFound,
    VacancyNotFound,
    NoActiveApplication,
    ConsentWithdrawn,
    InstrumentNotListedByVacancy,
    ReasonRequired,

    /// <summary>The ATS attempts exist, but the provider did not create every assignment. Retrying is safe.</summary>
    Incomplete,

    /// <summary>
    /// An open attempt for one instrument carries other terms (accommodation, locale or reason) than the request:
    /// nothing was written. Cancel that attempt first, then assign again with the corrected terms.
    /// </summary>
    OpenAttemptTermsDiffer,
}

public sealed record ProviderAssignResult(ProviderAssignOutcome Outcome, ProviderAssignResponse? Response, string? Detail)
{
    public static ProviderAssignResult Fail(ProviderAssignOutcome outcome, string? detail = null) => new(outcome, null, detail);
}

/// <summary>
/// HR assigns one or more provider instruments to a candidate for a vacancy (AS-5). The hiring guardrails, in order:
/// <list type="number">
/// <item>The org has an active provider binding and each instrument is enabled for it.</item>
/// <item>The candidate and the vacancy exist in the caller's org and the candidate has an ACTIVE application to it
/// (TS <c>assessment.assign</c> parity).</item>
/// <item>#312: no new processing for a candidate whose recruitment consent is withdrawn — checked here and re-checked
/// inside the reserve transaction under the withdrawal's own advisory lock.</item>
/// <item>Job-relatedness: the vacancy lists the instrument in <c>fit_requirements.assessments[]</c>, and a reason exists.</item>
/// </list>
/// Then the attempts are reserved atomically (all instruments or none, idempotent per candidate + vacancy + instrument
/// while open — an open attempt with OTHER terms is refused with <see cref="ProviderAssignOutcome.OpenAttemptTermsDiffer"/>,
/// never kept silently), and only then is the provider called, with external_ref = the attempt id and an idempotency key
/// derived from it. An attempt already sent once is first looked up by that external_ref (owner default D11, 2026-11-08),
/// so a crash or a retry, even after the 24 h key window, recovers the provider assignment instead of creating a second
/// one. Nothing here rejects a candidate: an assessment ranks and flags, a person decides.
/// </summary>
public sealed class AssignProviderInstrumentsUseCase(IAssessmentProviderRepository repository, IAssessmentProvider provider)
{
    public const int MaxInstruments = 6;
    public const int MaxExpiryDays = 90;
    public const string OpenAttemptTermsDifferCode = "open_attempt_terms_differ";
    public const string AttemptCancelledCode = "attempt_cancelled";

    private readonly IAssessmentProviderRepository _repository = repository;
    private readonly IAssessmentProvider _provider = provider;

    public async Task<ProviderAssignResult> AssignAsync(
        Guid organizationId, Guid actorId, AssignProviderInstrumentsInput input, DateTimeOffset now,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(input);
        if (input.ExpiresAt is { } expires && (expires <= now || expires > now.AddDays(MaxExpiryDays)))
        {
            return ProviderAssignResult.Fail(ProviderAssignOutcome.InvalidInput, "expires_at_out_of_range");
        }

        if (!_provider.IsConfigured)
        {
            return ProviderAssignResult.Fail(ProviderAssignOutcome.ProviderUnconfigured);
        }

        var binding = await _repository.GetActiveBindingAsync(organizationId, cancellationToken).ConfigureAwait(false);
        if (binding is null)
        {
            return ProviderAssignResult.Fail(ProviderAssignOutcome.NotEnabled);
        }

        var notEnabled = input.Instruments.FirstOrDefault(i => !binding.EnabledInstruments.Contains(i.Instrument, StringComparer.Ordinal));
        if (notEnabled is not null)
        {
            return ProviderAssignResult.Fail(ProviderAssignOutcome.InstrumentNotEnabled, notEnabled.Instrument);
        }

        var context = await _repository.LoadAssignmentContextAsync(
            organizationId, input.CandidateId, input.VacancyId, cancellationToken).ConfigureAwait(false);
        if (!context.CandidateFound)
        {
            return ProviderAssignResult.Fail(ProviderAssignOutcome.CandidateNotFound);
        }

        if (!context.VacancyFound)
        {
            return ProviderAssignResult.Fail(ProviderAssignOutcome.VacancyNotFound);
        }

        if (!context.HasActiveApplication)
        {
            return ProviderAssignResult.Fail(ProviderAssignOutcome.NoActiveApplication);
        }

        if (context.ConsentWithdrawn)
        {
            return ProviderAssignResult.Fail(ProviderAssignOutcome.ConsentWithdrawn);
        }

        var listed = JobRelatedness.ParseListedInstruments(context.FitRequirementsJson);
        var locale = input.Locale ?? binding.DefaultLocale;
        var attempts = new List<NewAttempt>();
        foreach (var item in input.Instruments)
        {
            if (!listed.TryGetValue(item.Instrument, out var vacancyReason))
            {
                return ProviderAssignResult.Fail(ProviderAssignOutcome.InstrumentNotListedByVacancy, item.Instrument);
            }

            if (JobRelatedness.EffectiveReason(vacancyReason, item.Reason) is not { } reason)
            {
                return ProviderAssignResult.Fail(ProviderAssignOutcome.ReasonRequired, item.Instrument);
            }

            attempts.Add(new NewAttempt(item.Instrument, reason, locale, input.TimeMultiplier, input.Aids, input.ExpiresAt));
        }

        var reserved = await _repository.ReserveAttemptsAsync(
            organizationId, actorId, binding, input.CandidateId, input.VacancyId, attempts, now, cancellationToken)
            .ConfigureAwait(false);
        if (reserved.ConsentWithdrawn)
        {
            return ProviderAssignResult.Fail(ProviderAssignOutcome.ConsentWithdrawn);
        }

        if (reserved.TermsConflict is { } conflict)
        {
            // A re-send with a corrected accommodation must never answer 200 while the old terms stay in force.
            return new ProviderAssignResult(
                ProviderAssignOutcome.OpenAttemptTermsDiffer,
                new ProviderAssignResponse(false, [ToItem(conflict, OpenAttemptTermsDifferCode)]),
                conflict.Instrument);
        }

        var items = new List<ProviderAssignItem>();
        foreach (var attempt in reserved.Attempts)
        {
            items.Add(attempt.State == ProviderAttemptStates.PendingCreate
                ? await CreateAtProviderAsync(organizationId, binding, attempt, context, input, now, cancellationToken)
                    .ConfigureAwait(false)
                : ToItem(attempt, null));
        }

        var complete = items.All(i => i.Error is null);
        return new ProviderAssignResult(
            complete ? ProviderAssignOutcome.Ok : ProviderAssignOutcome.Incomplete,
            new ProviderAssignResponse(complete, items),
            null);
    }

    private async Task<ProviderAssignItem> CreateAtProviderAsync(
        Guid organizationId, ProviderBindingRow binding, AttemptRow attempt, AssignmentContext context,
        AssignProviderInstrumentsInput input, DateTimeOffset now, CancellationToken cancellationToken)
    {
        // PII minimisation, per BINDING: names and email go to the provider only for an org that enables a link-out
        // instrument (PCA, the provider's own questionnaire site needs them). A subject is created once per (tenant,
        // candidate) and a repeated create returns it unchanged, so a subject first created without names (before the
        // org enabled PCA) is enriched below with PATCH /v1/subjects/{id} when a PCA needs them.
        var needsPii = binding.EnabledInstruments.Any(ProviderInstruments.IsLinkOut);
        var subjectRequest = new ProviderSubjectRequest(
            binding.ProviderTenantId,
            attempt.CandidateId.ToString(),
            needsPii ? Bound(context.CandidateFirstName, 100) : null,
            needsPii ? Bound(context.CandidateLastName, 100) : null,
            needsPii ? Bound(context.CandidateEmail?.Trim(), 254) : null,
            PreferredLocale: null);
        var subject = await _provider.EnsureSubjectAsync(
            subjectRequest, IdempotencyKeys.Subject(organizationId, subjectRequest), cancellationToken)
            .ConfigureAwait(false);
        if (!subject.Ok)
        {
            return await FailAsync(organizationId, attempt, subject.Failure!, now, cancellationToken).ConfigureAwait(false);
        }

        if (ProviderInstruments.IsLinkOut(attempt.Instrument) && !subject.Value!.HasNamesAndEmail)
        {
            // The provider kept a subject created before this org enabled a link-out instrument: its launch would refuse
            // with subject_data_required. Enrich it (the contract's recovery path); refuse locally, before an assignment
            // exists, only when the candidate record has no usable names or email to send.
            if (SubjectUpdateFor(context) is not { } update)
            {
                return await FailAsync(organizationId, attempt,
                    ProviderFailure.Local(ProviderFailure.SubjectDataRequired, transient: false), now, cancellationToken)
                    .ConfigureAwait(false);
            }

            var enriched = await _provider.UpdateSubjectAsync(subject.Value.SubjectId, update, cancellationToken)
                .ConfigureAwait(false);
            if (!enriched.Ok || !enriched.Value!.HasNamesAndEmail)
            {
                // A failed enrichment proves nothing about the assignment (none was sent yet), so it is never a refusal
                // that cancels the attempt by itself: the attempt stays pending and a re-send retries the PATCH.
                return await KeepPendingAsync(organizationId, attempt,
                    enriched.Ok ? ProviderFailure.ContractViolation : enriched.Failure!.Code, now, cancellationToken)
                    .ConfigureAwait(false);
            }
        }

        // Owner default D11 (2026-11-08): an attempt that was already sent (not reserved by THIS request) may have been
        // created at the provider even though no answer was recorded (a timeout, a crash before the commit). It is
        // recovered by a lookup on its external_ref (= the attempt id), never by sending the create again: the
        // Idempotency-Key is kept only 24 hours, the external_ref forever. Only an empty lookup sends the create.
        ProviderAssignment? existing = null;
        if (!attempt.IsNew)
        {
            var lookup = await _provider.FindAssignmentByExternalRefAsync(
                binding.ProviderTenantId, attempt.Id.ToString(), cancellationToken).ConfigureAwait(false);
            if (!lookup.Ok)
            {
                // A failed lookup proves nothing either way: keep the attempt pending, never cancel it, never create.
                return await KeepPendingAsync(organizationId, attempt, lookup.Failure!.Code, now, cancellationToken)
                    .ConfigureAwait(false);
            }

            existing = lookup.Value!.Assignment;
        }

        if (existing is not null)
        {
            return await RecordAsync(organizationId, binding, attempt, existing, now, cancellationToken).ConfigureAwait(false);
        }

        var request = new ProviderAssignmentRequest(
            binding.ProviderTenantId,
            subject.Value!.SubjectId,
            attempt.Instrument,
            attempt.Locale,
            attempt.VacancyId.ToString(),
            attempt.Reason,
            attempt.TimeMultiplier,
            attempt.Aids,
            attempt.RequestedExpiresAt,
            attempt.Id.ToString());
        var created = await _provider.CreateAssignmentAsync(request, IdempotencyKeys.Assignment(attempt.Id), cancellationToken)
            .ConfigureAwait(false);
        if (!created.Ok)
        {
            return await FailAsync(organizationId, attempt, created.Failure!, now, cancellationToken).ConfigureAwait(false);
        }

        return await RecordAsync(organizationId, binding, attempt, created.Value!, now, cancellationToken).ConfigureAwait(false);
    }

    private async Task<ProviderAssignItem> RecordAsync(
        Guid organizationId, ProviderBindingRow binding, AttemptRow attempt, ProviderAssignment assignment, DateTimeOffset now,
        CancellationToken cancellationToken)
    {
        if (assignment.Instrument != attempt.Instrument || assignment.TenantId != binding.ProviderTenantId)
        {
            return await FailAsync(organizationId, attempt,
                ProviderFailure.Local(ProviderFailure.ContractViolation, transient: false), now, cancellationToken)
                .ConfigureAwait(false);
        }

        var state = await _repository.MarkCreatedAsync(organizationId, attempt.Id, assignment, now, cancellationToken)
            .ConfigureAwait(false);
        if (state == ProviderAttemptStates.Cancelled)
        {
            // Staff cancelled the attempt while this create was in flight. The repository recorded the provider's
            // assignment on it with the cleanup marker, so this cancel at the provider is durable: if it fails here, the
            // staff cancel route and any webhook for that assignment retry it. Only a confirmed cancel clears the marker.
            var cancelled = await _provider.CancelAssignmentAsync(assignment.AssignmentId, cancellationToken).ConfigureAwait(false);
            if (cancelled.Ok || cancelled.Failure!.HttpStatus is 404 or 410)
            {
                await _repository.MarkProviderCancelledAsync(organizationId, attempt.Id, now, cancellationToken).ConfigureAwait(false);
            }

            return new ProviderAssignItem(attempt.Id.ToString(), attempt.Instrument, ProviderAttemptStates.Cancelled, null, [],
                null, AttemptCancelledCode, attempt.Locale, attempt.TimeMultiplier, attempt.Aids);
        }

        return new ProviderAssignItem(
            attempt.Id.ToString(), attempt.Instrument, state ?? ProviderAttemptStates.Created, assignment.InstrumentVersion,
            assignment.RequiredConsents, FormatTimestamp(assignment.ExpiresAt), null, attempt.Locale, attempt.TimeMultiplier,
            attempt.Aids);
    }

    private async Task<ProviderAssignItem> FailAsync(
        Guid organizationId, AttemptRow attempt, ProviderFailure failure, DateTimeOffset now,
        CancellationToken cancellationToken)
    {
        // Only a refusal that proves the provider created nothing cancels the attempt, so a corrected request can create
        // a fresh one. Anything else (an outage, a timeout, a concurrent request still creating it under the same key,
        // an off-contract answer) keeps it pending: re-sending re-drives the provider call with the same idempotency key
        // instead of orphaning an assignment the provider may already hold.
        var cancel = failure.IsDefinitiveRefusal;
        await _repository.MarkCreateFailedAsync(organizationId, attempt.Id, failure.Code, cancel, now, cancellationToken)
            .ConfigureAwait(false);
        var state = cancel ? ProviderAttemptStates.Cancelled : ProviderAttemptStates.PendingCreate;
        return new ProviderAssignItem(attempt.Id.ToString(), attempt.Instrument, state, null, [], null, failure.Code,
            attempt.Locale, attempt.TimeMultiplier, attempt.Aids);
    }

    private async Task<ProviderAssignItem> KeepPendingAsync(
        Guid organizationId, AttemptRow attempt, string code, DateTimeOffset now, CancellationToken cancellationToken)
    {
        await _repository.MarkCreateFailedAsync(organizationId, attempt.Id, code, cancel: false, now, cancellationToken)
            .ConfigureAwait(false);
        return new ProviderAssignItem(attempt.Id.ToString(), attempt.Instrument, ProviderAttemptStates.PendingCreate, null, [],
            null, code, attempt.Locale, attempt.TimeMultiplier, attempt.Aids);
    }

    /// <summary>The names and email for a PATCH, or null when the candidate record lacks a usable one.</summary>
    internal static ProviderSubjectUpdate? SubjectUpdateFor(AssignmentContext context) =>
        Bound(context.CandidateFirstName, 100) is { } given && Bound(context.CandidateLastName, 100) is { } family
        && Bound(context.CandidateEmail?.Trim(), 254) is { } email
            ? new ProviderSubjectUpdate(given, family, email)
            : null;

    internal static ProviderAssignItem ToItem(AttemptRow attempt, string? error) =>
        new(attempt.Id.ToString(), attempt.Instrument, attempt.State, attempt.InstrumentVersion, attempt.RequiredConsents,
            attempt.ExpiresAt is { } e ? FormatTimestamp(e) : null, error, attempt.Locale, attempt.TimeMultiplier, attempt.Aids);

    private static string? Bound(string? value, int max) =>
        string.IsNullOrWhiteSpace(value) ? null : value.Length <= max ? value : null;

    internal static string FormatTimestamp(DateTimeOffset value) =>
        value.UtcDateTime.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", CultureInfo.InvariantCulture);

    /// <summary>
    /// Strict body parse (unknown keys rejected, every string and array bounded). Runs AFTER the auth gate (TRAP 9).
    /// </summary>
    public static bool TryParseBody(JsonNode? node, out AssignProviderInstrumentsInput input)
    {
        input = null!;
        if (node is not JsonObject body)
        {
            return false;
        }

        string[] allowed = ["candidateId", "vacancyId", "instruments", "locale", "timeMultiplier", "aids", "expiresAt"];
        if (body.Any(p => !allowed.Contains(p.Key, StringComparer.Ordinal)))
        {
            return false;
        }

        if (!TryGuid(body["candidateId"], out var candidateId) || !TryGuid(body["vacancyId"], out var vacancyId)
            || body["instruments"] is not JsonArray instrumentNodes
            || instrumentNodes.Count is < 1 or > MaxInstruments)
        {
            return false;
        }

        var instruments = new List<AssignInstrumentItem>();
        foreach (var entry in instrumentNodes)
        {
            if (entry is not JsonObject item || item.Any(p => p.Key is not ("instrument" or "reason"))
                || !TryString(item["instrument"], 32, out var instrument) || !ProviderInstruments.IsKnown(instrument)
                || instruments.Any(i => i.Instrument == instrument))
            {
                return false;
            }

            string? reason = null;
            if (item["reason"] is { } reasonNode && (!TryString(reasonNode, ProviderFormats.MaxReasonLength, out reason)))
            {
                return false;
            }

            instruments.Add(new AssignInstrumentItem(instrument!, reason));
        }

        string? locale = null;
        if (body["locale"] is { } localeNode && (!TryString(localeNode, 5, out locale) || !ProviderFormats.IsLocale(locale)))
        {
            return false;
        }

        var multiplier = AccommodationAids.MinTimeMultiplier;
        if (body["timeMultiplier"] is { } multiplierNode)
        {
            if (multiplierNode is not JsonValue value || !value.TryGetValue(out decimal parsed)
                || parsed < AccommodationAids.MinTimeMultiplier || parsed > AccommodationAids.MaxTimeMultiplier
                || decimal.Round(parsed, 2) != parsed)
            {
                return false;
            }

            multiplier = parsed;
        }

        var aids = new List<string>();
        if (body["aids"] is { } aidsNode)
        {
            if (aidsNode is not JsonArray aidArray || aidArray.Count > AccommodationAids.All.Count)
            {
                return false;
            }

            foreach (var aidNode in aidArray)
            {
                if (!TryString(aidNode, 32, out var aid) || !AccommodationAids.IsKnown(aid) || aids.Contains(aid!))
                {
                    return false;
                }

                aids.Add(aid!);
            }
        }

        DateTimeOffset? expiresAt = null;
        if (body["expiresAt"] is { } expiresNode)
        {
            if (!TryString(expiresNode, 40, out var raw)
                || !DateTimeOffset.TryParse(raw, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal, out var parsed))
            {
                return false;
            }

            expiresAt = parsed.ToUniversalTime();
        }

        input = new AssignProviderInstrumentsInput(candidateId, vacancyId, instruments, locale, multiplier, aids, expiresAt);
        return true;
    }

    private static bool TryGuid(JsonNode? node, out Guid value)
    {
        value = Guid.Empty;
        return TryString(node, 36, out var raw) && Guid.TryParseExact(raw, "D", out value) && value != Guid.Empty;
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

/// <summary>
/// Idempotency keys sent to the provider. Derived from ATS ids so a retry after a crash replays the original request
/// (the provider keeps keys 24 h; past that, its own natural keys hold: tenant per org, subject per candidate, and
/// assignment per external_ref = attempt id, which the ATS also looks up before re-sending a create, owner default D11).
/// Where the request body can legitimately change between calls (names, display name, locale), a hash of the body is
/// part of the key: the contract answers 422 <c>idempotency_key_reused</c> for one key with two different bodies.
/// A new key does NOT update anything: a tenant or subject that already exists is returned unchanged; a subject's names
/// and email change only through <c>PATCH /v1/subjects/{id}</c>.
/// </summary>
public static class IdempotencyKeys
{
    public static string Tenant(Guid organizationId, ProviderTenantRequest request)
    {
        ArgumentNullException.ThrowIfNull(request);
        return $"ats-tenant-{organizationId:N}-{BodyHash(request.ExternalOrgRef, request.DisplayName, request.DefaultLocale)}";
    }

    public static string Subject(Guid organizationId, ProviderSubjectRequest request)
    {
        ArgumentNullException.ThrowIfNull(request);
        return $"ats-subject-{organizationId:N}-{BodyHash(request.ExternalRef, request.GivenName, request.FamilyName, request.Email, request.PreferredLocale)}";
    }

    /// <summary>The assignment body is built only from the stored attempt row, so the attempt id alone is stable.</summary>
    public static string Assignment(Guid attemptId) => $"ats-attempt-{attemptId:N}";

    /// <summary>One key per consent capture (its audit row id): a re-launch records a fresh consent.</summary>
    public static string Consent(Guid captureAuditId) => $"ats-consent-{captureAuditId:N}";

    private static string BodyHash(params string?[] parts)
    {
        var canonical = string.Join("\u001f", parts.Select(p => p ?? "\u0000"));
        var digest = System.Security.Cryptography.SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(canonical));
        return Convert.ToHexStringLower(digest.AsSpan(0, 12));
    }
}
