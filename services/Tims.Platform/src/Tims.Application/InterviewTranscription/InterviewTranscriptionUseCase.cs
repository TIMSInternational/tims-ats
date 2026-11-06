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
    ITranscriptionProvider provider)
{
    public const string NotFoundMessage = "Entrevista no encontrada";

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

    public static string StateOf(IReadOnlyList<InterviewTranscriptionEvent> events, string? transcriptUrl)
    {
        var latest = events.OrderBy(e => e.RecordedAt ?? DateTime.MinValue).LastOrDefault();
        if (latest is not null) return latest.State;
        return TranscriptIdOf(transcriptUrl) is not null ? TranscriptStates.Ready : TranscriptStates.None;
    }

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
        var state = StateOf(events, interview.TranscriptUrl);
        var canStart = provider.IsConfigured && LiveStatuses.Contains(interview.Status) &&
                       OwnRoomName(interview) is not null && decision == Accepted && acknowledged &&
                       state != TranscriptStates.InProgress;
        return new(ConsentTextVersion, decision, at?.ToUniversalTime().ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'"),
            acknowledged, state, TranscriptIdOf(interview.TranscriptUrl) is not null, canStart);
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
        // Fail closed on the evidence: a start that cannot be recorded leaves the webhook nothing to accept.
        if (!await repository.RecordEventAsync(new InterviewTranscriptionEvent(interviewId, organizationId,
                TranscriptStates.Requested, UserId: userId, Language: language), ct))
            return TranscriptionResult<TranscriptionStatusView>.Fail(503, "event_not_recorded",
                "La transcripción se inició pero no se pudo registrar; no se guardará. Inténtalo de nuevo.");
        return await GetStatusAsync(organizationId, userId, interviewId, ct);
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
        var transcriptId = TranscriptIdOf(interview.TranscriptUrl);
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
        var events = await repository.ListEventsAsync(organizationId, interviewId, ct);
        var language = events.Where(e => e.State == TranscriptStates.Requested && e.Language is not null)
            .OrderBy(e => e.RecordedAt ?? DateTime.MinValue).LastOrDefault()?.Language ?? "es";
        return TranscriptionResult<TranscriptView>.Ok(new TranscriptView(organizationId, interviewId,
            interview.VacancyTitle, language, competencies, parsed.Segments, parsed.Truncated));
    }

    /// <summary>
    /// A VERIFIED Daily event. Idempotent per provider event id; a <c>ready</c> transcript is kept only when this
    /// interview's transcription was started through <see cref="StartAsync"/> and the candidate's latest decision is
    /// still <c>accepted</c> — otherwise it is deleted at the provider and the rejection is recorded. Throws on a
    /// storage failure so the provider retries.
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
        var consents = await repository.ListConsentsAsync(org, interviewId, ct);
        var events = await repository.ListEventsAsync(org, interviewId, ct);
        var requested = events.Any(e => e.State == TranscriptStates.Requested);
        if (!requested || CandidateDecision(consents).Decision != Accepted)
        {
            await provider.DeleteTranscriptAsync(transcriptId, ct);
            Require(await repository.RecordEventAsync(new InterviewTranscriptionEvent(interviewId, org,
                TranscriptStates.Rejected, ProviderEventId: webhookEvent.EventId, TranscriptId: transcriptId), ct));
            return WebhookHandling.Rejected;
        }

        await repository.SetTranscriptReferenceAsync(org, interviewId, TranscriptReference(transcriptId), ct);
        Require(await repository.RecordEventAsync(new InterviewTranscriptionEvent(interviewId, org,
            TranscriptStates.Ready, ProviderEventId: webhookEvent.EventId, TranscriptId: transcriptId), ct));
        return WebhookHandling.Stored;
    }

    private static void Require(bool recorded)
    {
        if (!recorded) throw new InvalidOperationException("Transcription event could not be recorded");
    }
}
