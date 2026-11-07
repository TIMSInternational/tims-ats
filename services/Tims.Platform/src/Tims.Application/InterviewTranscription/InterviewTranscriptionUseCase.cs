using Tims.Application.InterviewJoin;
using static Tims.Application.InterviewTranscription.InterviewTranscriptionConstants;

namespace Tims.Application.InterviewTranscription;

/// <summary>What the interview room shows about transcription. Never names, never the transcript itself.</summary>
public sealed record TranscriptionStatusView(string ConsentVersion, string CandidateDecision,
    string? CandidateDecidedAt, bool ViewerAcknowledged, string TranscriptState, bool TranscriptAvailable,
    bool CanStart);

/// <summary>The pseudonymized transcript plus the context the AI analysis needs (slice 3).</summary>
public sealed record TranscriptView(Guid OrganizationId, Guid InterviewId, string? VacancyTitle, string Language,
    IReadOnlyList<TranscriptCompetency> Competencies, IReadOnlyList<TranscriptSegment> Segments, bool Truncated);

/// <summary>A use-case answer: a value, or an HTTP-mappable failure with a stable code.</summary>
public sealed record TranscriptionResult<T>(T? Value, int Status, string? Code = null, string? Message = null)
{
    public static TranscriptionResult<T> Ok(T value) => new(value, 200);

    public static TranscriptionResult<T> Fail(int status, string code, string message) => new(default, status, code, message);
}

public enum WebhookHandling
{
    Test,
    Ignored,
    Duplicate,
    Recorded,
    Stored,
    Rejected,
}

/// <summary>
/// Staff-side transcription use cases + the provider webhook. Every read and write is scoped to the caller's
/// (or, for the webhook, the row's) organization; the gate and the scope probe run in the endpoint before this.
/// </summary>
public sealed class InterviewTranscriptionUseCase(IInterviewTranscriptionRepository repository,
    ITranscriptionProvider provider, TimeProvider? clock = null)
{
    public const string NotFoundMessage = "Entrevista no encontrada";

    /// <summary>A start authorizes a transcript that began within this window around it (when Daily gives the times).</summary>
    public static readonly TimeSpan StartSkewBefore = TimeSpan.FromMinutes(2);
    public static readonly TimeSpan StartSkewAfter = TimeSpan.FromMinutes(10);

    /// <summary>Without timing data, a start authorizes only a transcript reported within this long after it.</summary>
    public static readonly TimeSpan UntimedWindow = TimeSpan.FromHours(6);

    private readonly TimeProvider _clock = clock ?? TimeProvider.System;

    /// <summary>
    /// The ONE platform start that authorizes this transcript, or null: an unconsumed <c>requested</c> event (no
    /// earlier <c>ready</c> names it) that happened just before the transcript began — or, when Daily did not send
    /// the timing, within <see cref="UntimedWindow"/> before now. The latest qualifying start wins.
    /// </summary>
    public static InterviewTranscriptionEvent? AuthorizingStart(IReadOnlyList<InterviewTranscriptionEvent> events,
        DateTime? transcriptStartedUtc, DateTime nowUtc)
    {
        var consumed = events.Where(e => e.State == TranscriptStates.Ready && e.AuthorizedBy is not null)
            .Select(e => e.AuthorizedBy!.Value).ToHashSet();
        return events
            .Where(e => e.State == TranscriptStates.Requested && e.Id is { } id && !consumed.Contains(id) &&
                        e.RecordedAt is { } at && (transcriptStartedUtc is { } started
                            ? at >= started - StartSkewAfter && at <= started + StartSkewBefore
                            : at >= nowUtc - UntimedWindow && at <= nowUtc))
            .OrderBy(e => e.RecordedAt)
            .LastOrDefault();
    }

    public static string? OwnRoomName(TranscriptionInterview interview) =>
        CandidateInterviewJoin.TryDailyRoom(interview.MeetingUrl, out var room) &&
        string.Equals(room, CandidateInterviewJoin.RoomNameFor(interview.Id), StringComparison.Ordinal)
            ? room
            : null;

    /// <summary>The candidate's LATEST decision against the CURRENT text version (older versions do not count).</summary>
    public static (string Decision, DateTime? At) CandidateDecision(IEnumerable<InterviewConsentRecord> consents)
    {
        var latest = consents
            .Where(c => c.Subject == SubjectCandidate && c.TextVersion == ConsentTextVersion)
            .OrderBy(c => c.RecordedAt ?? DateTime.MinValue)
            .LastOrDefault();
        return latest is null ? (Pending, null) : (latest.Decision == Accepted ? Accepted : Declined, latest.RecordedAt);
    }

    public static bool HasAcknowledged(IEnumerable<InterviewConsentRecord> consents, Guid userId) =>
        consents.Any(c => c.Subject == SubjectStaff && c.UserId == userId && c.Decision == Accepted &&
                          c.TextVersion == ConsentTextVersion);

    /// <summary>
    /// The latest lifecycle state. A transcript reference with no lifecycle evidence is NOT "ready": the column is
    /// also writable by staff (legacy saveTranscript), so it proves nothing on its own (see <see cref="ClaimedTranscriptId"/>).
    /// </summary>
    public static string StateOf(IReadOnlyList<InterviewTranscriptionEvent> events) =>
        events.OrderBy(e => e.RecordedAt ?? DateTime.MinValue).LastOrDefault()?.State ?? TranscriptStates.None;

    /// <summary>
    /// The Daily transcript id the interview's reference names, ONLY when this interview's own tenant-scoped
    /// lifecycle evidence holds a <c>ready</c> claim for exactly that id (written by the verified webhook, which
    /// resolves the interview from its own room name, together with the reference, consuming a platform start).
    /// Otherwise null: <c>interviews.transcript_url</c> alone is never trusted, because staff could point it at
    /// another tenant's transcript id and the download uses the deployment-wide Daily key.
    /// </summary>
    public static Guid? ClaimedTranscriptId(TranscriptionInterview interview,
        IReadOnlyList<InterviewTranscriptionEvent> events) =>
        TranscriptIdOf(interview.TranscriptUrl) is { } id &&
        events.Any(e => e.State == TranscriptStates.Ready && e.TranscriptId == id && e.AuthorizedBy is not null &&
                        e.InterviewId == interview.Id && e.OrganizationId == interview.OrganizationId)
            ? id
            : null;

    public async Task<TranscriptionResult<TranscriptionStatusView>> GetStatusAsync(Guid organizationId, Guid userId,
        Guid interviewId, CancellationToken ct)
    {
        var interview = await repository.FindAsync(organizationId, interviewId, ct);
        if (interview is null) return TranscriptionResult<TranscriptionStatusView>.Fail(404, "not_found", NotFoundMessage);
        var consents = await repository.ListConsentsAsync(organizationId, interviewId, ct);
        var events = await repository.ListEventsAsync(organizationId, interviewId, ct);
        return TranscriptionResult<TranscriptionStatusView>.Ok(BuildStatus(interview, consents, events, userId));
    }

    internal TranscriptionStatusView BuildStatus(TranscriptionInterview interview,
        IReadOnlyList<InterviewConsentRecord> consents, IReadOnlyList<InterviewTranscriptionEvent> events, Guid userId)
    {
        var (decision, at) = CandidateDecision(consents);
        var acknowledged = HasAcknowledged(consents, userId);
        var state = StateOf(events);
        var canStart = provider.IsConfigured && LiveStatuses.Contains(interview.Status) &&
                       OwnRoomName(interview) is not null && decision == Accepted && acknowledged &&
                       state != TranscriptStates.InProgress;
        return new(ConsentTextVersion, decision, at?.ToUniversalTime().ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'"),
            acknowledged, state, ClaimedTranscriptId(interview, events) is not null, canStart);
    }

    /// <summary>The evaluator's acknowledgement of the transcription notice (employees: notice, not consent).</summary>
    public async Task<TranscriptionResult<TranscriptionStatusView>> AcknowledgeAsync(Guid organizationId, Guid userId,
        Guid interviewId, string textVersion, string? ipAddress, string? userAgent, CancellationToken ct)
    {
        if (!string.Equals(textVersion, ConsentTextVersion, StringComparison.Ordinal))
            return TranscriptionResult<TranscriptionStatusView>.Fail(409, "consent_version_mismatch",
                "El aviso cambió. Recarga la sala para leer la versión vigente.");
        var interview = await repository.FindAsync(organizationId, interviewId, ct);
        if (interview is null) return TranscriptionResult<TranscriptionStatusView>.Fail(404, "not_found", NotFoundMessage);
        var recorded = await repository.RecordConsentAsync(new InterviewConsentRecord(interviewId, organizationId,
            SubjectStaff, userId, Accepted, ConsentTextVersion, IpAddress: ipAddress, UserAgent: userAgent), ct);
        if (!recorded)
            return TranscriptionResult<TranscriptionStatusView>.Fail(503, "consent_not_recorded",
                "No se pudo registrar tu aceptación. Inténtalo de nuevo.");
        return await GetStatusAsync(organizationId, userId, interviewId, ct);
    }

    /// <summary>
    /// Starts the TRANSCRIPT (never a recording) in this interview's own Daily room, only when the candidate's
    /// latest decision is <c>accepted</c> and the starting evaluator acknowledged the notice. Storage is enabled
    /// on the room HERE, after those checks, so a transcript started any other way is not stored by Daily.
    /// </summary>
    public async Task<TranscriptionResult<TranscriptionStatusView>> StartAsync(Guid organizationId, Guid userId,
        Guid interviewId, string language, CancellationToken ct)
    {
        if (!Languages.Contains(language))
            return TranscriptionResult<TranscriptionStatusView>.Fail(400, "invalid_language", "Idioma no admitido.");
        var interview = await repository.FindAsync(organizationId, interviewId, ct);
        if (interview is null) return TranscriptionResult<TranscriptionStatusView>.Fail(404, "not_found", NotFoundMessage);
        if (!LiveStatuses.Contains(interview.Status))
            return TranscriptionResult<TranscriptionStatusView>.Fail(409, "interview_closed",
                "Esta entrevista ya no está en curso.");
        var room = OwnRoomName(interview);
        if (room is null)
            return TranscriptionResult<TranscriptionStatusView>.Fail(409, "no_platform_room",
                "La transcripción solo funciona en la sala de video de la plataforma.");
        // From the consent read to the `requested` record, under the interview's transcription lock — which the
        // candidate's join also takes to record a decision and read the transcription state. A decline therefore
        // either commits before this reads consent (refused below) or reads the `requested` written here (and the
        // join stops the transcription before admitting the candidate). It can no longer land in between, where it
        // saw no transcription, was admitted, and the start then began transcribing a declined candidate.
        var refused = await repository.WithTranscriptionLockAsync(organizationId, interviewId,
            () => StartUnderLockAsync(organizationId, userId, interviewId, room, language, ct), ct);
        return refused ?? await GetStatusAsync(organizationId, userId, interviewId, ct);
    }

    /// <summary>The start itself, run under the interview's transcription lock; null when it started and is on record.</summary>
    private async Task<TranscriptionResult<TranscriptionStatusView>?> StartUnderLockAsync(Guid organizationId,
        Guid userId, Guid interviewId, string room, string language, CancellationToken ct)
    {
        var consents = await repository.ListConsentsAsync(organizationId, interviewId, ct);
        if (CandidateDecision(consents).Decision != Accepted)
            return TranscriptionResult<TranscriptionStatusView>.Fail(409, "candidate_consent_missing",
                "El candidato no ha aceptado la transcripción. La entrevista puede continuar sin ella.");
        if (!HasAcknowledged(consents, userId))
            return TranscriptionResult<TranscriptionStatusView>.Fail(409, "acknowledgement_missing",
                "Primero acepta el aviso de transcripción.");
        if (!provider.IsConfigured)
            return TranscriptionResult<TranscriptionStatusView>.Fail(503, "provider_unavailable",
                "La transcripción no está configurada.");

        var started = await provider.StartAsync(room, language, ct);
        if (started != TranscriptionStartResult.Started)
            return TranscriptionResult<TranscriptionStatusView>.Fail(502, "provider_failed",
                "No se pudo iniciar la transcripción. Verifica que el candidato esté en la llamada e inténtalo de nuevo.");
        // Fail closed on the evidence: a start that cannot be recorded is stopped again (best effort; if even that
        // fails, the webhook finds no start to account for the transcript and deletes it).
        if (!await repository.RecordEventAsync(new InterviewTranscriptionEvent(interviewId, organizationId,
                TranscriptStates.Requested, UserId: userId, Language: language), ct))
        {
            await provider.StopAsync(room, ct);
            return TranscriptionResult<TranscriptionStatusView>.Fail(503, "event_not_recorded",
                "No se pudo registrar el inicio; la transcripción se detuvo. Inténtalo de nuevo.");
        }
        // Defense in depth: a decline recorded WITHOUT the lock (no such path exists today) still surfaces here. Its
        // stop result is not ignored: when the stop fails, `requested` stays the latest state, so every declining
        // join retries the stop and refuses admission until it succeeds, and the webhook deletes the transcript.
        if (CandidateDecision(await repository.ListConsentsAsync(organizationId, interviewId, ct)).Decision != Accepted)
        {
            return await provider.StopAsync(room, ct)
                ? TranscriptionResult<TranscriptionStatusView>.Fail(409, "candidate_consent_missing",
                    "El candidato no ha aceptado la transcripción. La entrevista puede continuar sin ella.")
                : TranscriptionResult<TranscriptionStatusView>.Fail(503, "transcription_not_stopped",
                    "El candidato rechazó la transcripción y no se pudo detener. Finaliza la llamada; la transcripción no se conservará.");
        }
        return null;
    }

    /// <summary>
    /// The stored transcript, pseudonymized, for the evaluator's AI analysis. Refused when the candidate's latest
    /// decision is no longer <c>accepted</c> (withdrawal wins over an earlier transcript).
    /// </summary>
    public async Task<TranscriptionResult<TranscriptView>> GetTranscriptAsync(Guid organizationId, Guid interviewId,
        CancellationToken ct)
    {
        var interview = await repository.FindAsync(organizationId, interviewId, ct);
        if (interview is null) return TranscriptionResult<TranscriptView>.Fail(404, "not_found", NotFoundMessage);
        // Ownership before anything reaches the provider: only a transcript this interview's own `ready` claim names.
        var events = await repository.ListEventsAsync(organizationId, interviewId, ct);
        var transcriptId = ClaimedTranscriptId(interview, events);
        if (transcriptId is null)
            return TranscriptionResult<TranscriptView>.Fail(409, "transcript_not_ready",
                "La transcripción todavía no está disponible.");
        var consents = await repository.ListConsentsAsync(organizationId, interviewId, ct);
        if (CandidateDecision(consents).Decision != Accepted)
            return TranscriptionResult<TranscriptView>.Fail(409, "candidate_consent_missing",
                "El candidato no autorizó (o retiró) la transcripción.");
        var vtt = await provider.DownloadTranscriptAsync(transcriptId.Value, ct);
        if (vtt is null)
            return TranscriptionResult<TranscriptView>.Fail(502, "provider_failed",
                "No se pudo obtener la transcripción. Inténtalo de nuevo.");
        var staff = await repository.ListStaffNamesAsync(organizationId, interviewId, ct);
        var parsed = WebVttTranscript.Parse(vtt, interview.CandidateFirstName, interview.CandidateLastName, staff);
        var competencies = await repository.ListCompetenciesAsync(organizationId, interview.VacancyId, ct);
        var language = events.Where(e => e.State == TranscriptStates.Requested && e.Language is not null)
            .OrderBy(e => e.RecordedAt ?? DateTime.MinValue).LastOrDefault()?.Language ?? "es";
        return TranscriptionResult<TranscriptView>.Ok(new TranscriptView(organizationId, interviewId,
            interview.VacancyTitle, language, competencies, parsed.Segments, parsed.Truncated));
    }

    /// <summary>
    /// A VERIFIED Daily event. Idempotent per provider event id; a <c>ready</c> transcript is kept only when ONE
    /// unconsumed platform start (<see cref="AuthorizingStart"/>) accounts for it and the candidate's latest decision
    /// is still <c>accepted</c> — otherwise it is deleted at the provider (confirmed) and the rejection recorded.
    /// Consumption is atomic (<see cref="IInterviewTranscriptionRepository.ClaimTranscriptAsync"/>): two deliveries
    /// with different transcript ids can never both be stored against the same start.
    /// Throws when the deletion or any evidence write fails, so the provider retries the delivery.
    /// </summary>
    public async Task<WebhookHandling> HandleWebhookAsync(DailyWebhookEvent webhookEvent, CancellationToken ct)
    {
        if (webhookEvent.IsTest) return WebhookHandling.Test;
        if (!webhookEvent.IsTranscriptEvent) return WebhookHandling.Ignored;
        if (DailyWebhookEvents.InterviewIdOf(webhookEvent.RoomName) is not { } interviewId) return WebhookHandling.Ignored;
        if (await repository.ResolveOrganizationAsync(interviewId, ct) is not { } resolved) return WebhookHandling.Ignored;
        var org = resolved.OrganizationId;
        if (webhookEvent.EventId is { } eventId && await repository.HasProviderEventAsync(org, interviewId, eventId, ct))
            return WebhookHandling.Duplicate;

        if (webhookEvent.Type != DailyWebhookEvent.TranscriptReady)
        {
            var state = webhookEvent.Type == DailyWebhookEvent.TranscriptStarted
                ? TranscriptStates.InProgress
                : TranscriptStates.Error;
            Require(await repository.RecordEventAsync(new InterviewTranscriptionEvent(interviewId, org, state,
                ProviderEventId: webhookEvent.EventId, TranscriptId: webhookEvent.TranscriptId), ct));
            return WebhookHandling.Recorded;
        }

        if (webhookEvent.TranscriptId is not { } transcriptId) return WebhookHandling.Ignored;
        // The decision below reads committed events; the claim re-checks it atomically under the interview's lock. A
        // concurrent delivery that consumed the chosen start in between sends us round again with fresh events.
        for (var attempt = 0; attempt < MaxClaimAttempts; attempt++)
        {
            var consents = await repository.ListConsentsAsync(org, interviewId, ct);
            var events = await repository.ListEventsAsync(org, interviewId, ct);
            // The same transcript reported again (a redelivery under another event id, or a concurrent duplicate that
            // lost the race) is never deleted once it was accepted.
            if (events.Any(e => e.State == TranscriptStates.Ready && e.TranscriptId == transcriptId))
                return WebhookHandling.Duplicate;
            var start = AuthorizingStart(events, webhookEvent.StartedAtUtc, _clock.GetUtcNow().UtcDateTime);
            if (start is null || CandidateDecision(consents).Decision != Accepted)
            {
                // Not "handled" until the provider confirms the deletion: a failure throws, nothing is recorded, and
                // Daily's retry runs this again (the event id was never stored, so it is not a duplicate).
                if (!await provider.DeleteTranscriptAsync(transcriptId, ct))
                    throw new InvalidOperationException("Unauthorized transcript could not be deleted at the provider");
                Require(await repository.RecordEventAsync(new InterviewTranscriptionEvent(interviewId, org,
                    TranscriptStates.Rejected, ProviderEventId: webhookEvent.EventId, TranscriptId: transcriptId), ct));
                return WebhookHandling.Rejected;
            }

            // The reference and the `ready` event that consumes the start are written together or not at all, so a
            // failed write leaves the start unconsumed AND the reference unchanged for Daily's retry.
            switch (await repository.ClaimTranscriptAsync(org, interviewId, transcriptId, start.Id!.Value,
                        webhookEvent.EventId, ct))
            {
                case TranscriptClaim.Stored:
                    return WebhookHandling.Stored;
                case TranscriptClaim.AlreadyStored:
                    return WebhookHandling.Duplicate;
                case TranscriptClaim.StartConsumed:
                    continue;
                default:
                    throw new InvalidOperationException("Transcript reference could not be recorded");
            }
        }
        throw new InvalidOperationException("Transcript authorization kept losing to concurrent deliveries");
    }

    /// <summary>How many times one delivery re-decides after a concurrent delivery consumed the start it chose.</summary>
    internal const int MaxClaimAttempts = 3;

    private static void Require(bool recorded)
    {
        if (!recorded) throw new InvalidOperationException("Transcription event could not be recorded");
    }
}
