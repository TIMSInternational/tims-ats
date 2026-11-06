namespace Tims.Application.InterviewTranscription;

/// <summary>
/// Interview transcription (video interviews with AI "listening"), dark by default behind
/// <c>Platform:InterviewTranscriptionEnabled</c>. The platform never records video or audio: it asks Daily for a
/// real-time TRANSCRIPT only, and only after the candidate's explicit consent and the starting evaluator's
/// acknowledgement are on record. Consent evidence is append-only in <c>audit_logs</c> (no schema change; a dedicated
/// table is proposed in docs, not applied).
/// </summary>
public static class InterviewTranscriptionConstants
{
    /// <summary>
    /// The consent/notice text version both screens show (apps/web lib/interview-transcription.ts mirrors it, and a
    /// cross-runtime test pins the two). Bumping it re-asks everyone: a decision recorded against an older version
    /// does not count.
    /// </summary>
    public const string ConsentTextVersion = "interview-transcription-2026-11-06";

    public const string ConsentAction = "interview_recording_consent";
    public const string EventAction = "interview_transcription_event";

    public const string SubjectCandidate = "candidate";
    public const string SubjectStaff = "staff";

    public const string Accepted = "accepted";
    public const string Declined = "declined";
    public const string Pending = "pending";

    /// <summary>The only languages the start endpoint accepts (Daily BCP-47 tags).</summary>
    public static readonly IReadOnlySet<string> Languages = new HashSet<string>(StringComparer.Ordinal) { "es", "en" };

    /// <summary>Statuses in which a call can still be transcribed (a subset of the room's ROOM_STATUSES).</summary>
    public static readonly IReadOnlySet<string> LiveStatuses =
        new HashSet<string>(StringComparer.Ordinal) { "scheduled", "rescheduled", "in_progress" };

    /// <summary>The stable, credential-free reference stored in <c>interviews.transcript_url</c>.</summary>
    public const string TranscriptReferencePrefix = "https://api.daily.co/v1/transcript/";

    public static string TranscriptReference(Guid transcriptId) => TranscriptReferencePrefix + transcriptId.ToString("D");

    /// <summary>The Daily transcript id of a stored reference, or null when the column holds anything else.</summary>
    public static Guid? TranscriptIdOf(string? reference) =>
        reference is not null && reference.StartsWith(TranscriptReferencePrefix, StringComparison.Ordinal) &&
        Guid.TryParseExact(reference[TranscriptReferencePrefix.Length..], "D", out var id)
            ? id
            : null;
}

/// <summary>Transcript lifecycle states as reported to the room (derived from audit events + transcript_url).</summary>
public static class TranscriptStates
{
    public const string None = "none";
    public const string Requested = "requested";
    public const string InProgress = "in_progress";
    public const string Ready = "ready";
    public const string Error = "error";
    public const string Rejected = "rejected";
}

/// <summary>A consent decision or staff acknowledgement, append-only. Never carries the join token.</summary>
public sealed record InterviewConsentRecord(Guid InterviewId, Guid OrganizationId, string Subject, Guid? UserId,
    string Decision, string TextVersion, DateTime? RecordedAt = null, string? IpAddress = null,
    string? UserAgent = null);

/// <summary>A transcription lifecycle event (requested by staff, or reported by the provider webhook).</summary>
public sealed record InterviewTranscriptionEvent(Guid InterviewId, Guid OrganizationId, string State,
    Guid? UserId = null, string? ProviderEventId = null, Guid? TranscriptId = null, string? Language = null,
    DateTime? RecordedAt = null);

/// <summary>The consent ledger: append-only rows in audit_logs, always written under the interview's organization.</summary>
public interface IInterviewConsentLedger
{
    /// <summary>Returns false (never throws) when the row could not be written — callers fail closed.</summary>
    Task<bool> RecordConsentAsync(InterviewConsentRecord record, CancellationToken ct);

    Task<IReadOnlyList<InterviewConsentRecord>> ListConsentsAsync(Guid organizationId, Guid interviewId,
        CancellationToken ct);
}

/// <summary>Whether the transcription feature is on for this deployment (Platform:InterviewTranscriptionEnabled).</summary>
public sealed record InterviewTranscriptionSettings(bool Enabled);

/// <summary>The interview as the transcription surface needs it (always read inside the caller's organization).</summary>
public sealed record TranscriptionInterview(Guid Id, Guid OrganizationId, Guid VacancyId, string Type, string Status,
    string? MeetingUrl, string? TranscriptUrl, string? CandidateFirstName, string? CandidateLastName,
    string? VacancyTitle);

/// <summary>One staff member who may appear as a speaker (assigned evaluators and the creator).</summary>
public sealed record TranscriptionStaffName(Guid UserId, string FirstName, string LastName);

/// <summary>A job-profile competency (validated name + optional level), as the TS resolveCompetencies expects it.</summary>
public sealed record TranscriptCompetency(string Name, int? Level);

public interface IInterviewTranscriptionRepository : IInterviewConsentLedger
{
    /// <summary>The interview inside <paramref name="organizationId"/> (tenant-scoped read), or null.</summary>
    Task<TranscriptionInterview?> FindAsync(Guid organizationId, Guid interviewId, CancellationToken ct);

    /// <summary>
    /// PRE-TENANT lookup by id for the provider webhook only: the signed event names a room derived from the
    /// interview id, and the organization is resolved from this row (the join's hash lookup has the same shape).
    /// </summary>
    Task<(Guid InterviewId, Guid OrganizationId)?> ResolveOrganizationAsync(Guid interviewId, CancellationToken ct);

    Task<IReadOnlyList<InterviewTranscriptionEvent>> ListEventsAsync(Guid organizationId, Guid interviewId,
        CancellationToken ct);

    /// <summary>Returns false (never throws) when the row could not be written.</summary>
    Task<bool> RecordEventAsync(InterviewTranscriptionEvent transcriptionEvent, CancellationToken ct);

    /// <summary>True when an event with this provider id was already recorded for the interview (redelivery).</summary>
    Task<bool> HasProviderEventAsync(Guid organizationId, Guid interviewId, string providerEventId,
        CancellationToken ct);

    /// <summary>Sets transcript_url (tenant-filtered). Idempotent: writing the stored value again is a no-op.</summary>
    Task SetTranscriptReferenceAsync(Guid organizationId, Guid interviewId, string reference, CancellationToken ct);

    Task<IReadOnlyList<TranscriptionStaffName>> ListStaffNamesAsync(Guid organizationId, Guid interviewId,
        CancellationToken ct);

    Task<IReadOnlyList<TranscriptCompetency>> ListCompetenciesAsync(Guid organizationId, Guid vacancyId,
        CancellationToken ct);
}

/// <summary>Provider outcomes the use case can act on without seeing HTTP details.</summary>
public enum TranscriptionStartResult
{
    Started,
    NotConfigured,
    Failed,
}

public interface ITranscriptionProvider
{
    bool IsConfigured { get; }

    /// <summary>Turns on transcript storage for this one room, then starts real-time transcription in it.</summary>
    Task<TranscriptionStartResult> StartAsync(string roomName, string language, CancellationToken ct);

    /// <summary>The WebVTT text of a stored transcript (bounded), or null on any provider failure.</summary>
    Task<string?> DownloadTranscriptAsync(Guid transcriptId, CancellationToken ct);

    /// <summary>Deletes a stored transcript at the provider. Returns false on failure (logged, never thrown).</summary>
    Task<bool> DeleteTranscriptAsync(Guid transcriptId, CancellationToken ct);
}
