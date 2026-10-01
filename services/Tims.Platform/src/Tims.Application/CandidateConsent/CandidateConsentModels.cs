namespace Tims.Application.CandidateConsent;

/// <summary>Constants shared by the candidate consent surface and its tests (#312, #313).</summary>
public static class CandidateConsentConstants
{
    /// <summary>The recruitment data-processing consent type (TS <c>APPLICATION_CONSENT_TYPE</c>).</summary>
    public const string ConsentType = "recruitment_data_processing";

    /// <summary>
    /// <c>text_version</c> of a status row created by a withdrawal when the candidate had NO consent row (a
    /// staff-entered candidate, or one that predates #302). It is a withdrawal marker, never evidence of consent:
    /// its <c>agreed_at</c> equals the withdrawal time and must not be read as an authorization date.
    /// </summary>
    public const string WithdrawalOnlyTextVersion = "none:withdrawal-only";

    public const string PortalChannel = "portal";
    public const string DeletionRequestType = "deletion";
    public const string PendingStatus = "pending";
    public const string StaffSource = "staff";
    public const string CandidatePortalSource = "candidate_portal";

    public const string AuditEntity = "candidate";
    public const string WithdrawnAuditAction = "candidate_consent_withdrawn";

    public const int MaxReasonLength = 500;
    public const int MaxEvidenceRows = 100;
    public const int MaxListRows = 200;

    /// <summary>Statuses the staff list may filter on.</summary>
    public static readonly IReadOnlySet<string> RequestStatuses =
        new HashSet<string>(StringComparer.Ordinal) { "pending", "completed", "rejected" };

    /// <summary>Role slugs whose ACTIVE holders are told about a new data subject request.</summary>
    public static readonly IReadOnlyList<string> RequestNotifyRoleSlugs = ["hr_admin", "super_admin"];

    public const string NotificationType = "data_subject_request";
    public const string NotificationModule = "candidate";
    public const string NotificationEntityType = "data_subject_request";
    public const string StaffListPath = "/settings/data-requests";
    public const string NotificationTitle = "Nueva solicitud de supresión de datos";
    public const string NotificationMessage =
        "Un candidato solicitó la supresión de sus datos personales. Debe responderse dentro de 15 días hábiles.";

    /// <summary>Channels a STAFF member may record (TS <c>CONSENT_WITHDRAWAL_CHANNELS</c>); <c>portal</c> is self-service only.</summary>
    public static readonly IReadOnlySet<string> StaffChannels =
        new HashSet<string>(StringComparer.Ordinal) { "email", "phone", "in_person", "letter", "other" };
}

/// <summary>A staff-recorded withdrawal: how it was received, an optional reason, and whether to open a deletion request.</summary>
public sealed record StaffWithdrawalInput(string Channel, string? Reason, bool RequestDeletion);

/// <summary>Who performed a withdrawal: a staff user (by id) or the data subject (null).</summary>
public sealed record WithdrawalActor(Guid? StaffUserId, string Channel, string? Reason, bool RequestDeletion, string RequestSource);

public enum CandidateConsentOutcome
{
    Ok,
    NotFound,
}

/// <summary>The subject-level consent status of one candidate.</summary>
public sealed record CandidateConsentStatus(
    string Status,
    string? TextVersion,
    string? AgreedAt,
    string? WithdrawnAt,
    string? WithdrawalChannel,
    string? WithdrawalReason,
    string? WithdrawnBy);

/// <summary>One application's consent evidence, without the pseudonymous request metadata itself.</summary>
public sealed record CandidateConsentEvidenceItem(
    string ApplicationId,
    string TextVersion,
    string? TextSha256,
    string? Locale,
    string AgreedAt,
    bool? CaptchaVerified,
    bool HasRequestMetadata,
    bool IsBackfilled);

/// <summary>The candidate's most recent deletion request, if any.</summary>
public sealed record CandidateDeletionRequest(string Id, string Status, string Source, string CreatedAt);

/// <summary>GET /tenant/candidates/{id}/consent — status, per-application evidence and the deletion request.</summary>
public sealed record CandidateConsentView(
    string CandidateId,
    CandidateConsentStatus Consent,
    IReadOnlyList<CandidateConsentEvidenceItem> Evidence,
    CandidateDeletionRequest? DeletionRequest);

/// <param name="Notice">Set only when this call filed a NEW data subject request: whom to email after commit.</param>
public sealed record CandidateConsentResult(
    CandidateConsentOutcome Outcome, CandidateConsentView? View, DataSubjectRequestNotice? Notice = null)
{
    public static readonly CandidateConsentResult NotFound = new(CandidateConsentOutcome.NotFound, null);

    public static CandidateConsentResult Ok(CandidateConsentView view, DataSubjectRequestNotice? notice = null) =>
        new(CandidateConsentOutcome.Ok, view, notice);
}

/// <summary>Self-service result. The response to the candidate is uniform; the counts are for tests and logs only.</summary>
public sealed record PortalWithdrawalResult(
    bool OrganizationFound, int CandidatesWithdrawn, int DeletionRequestsCreated, DataSubjectRequestNotice? Notice = null);

/// <summary>One org admin (active user holding <c>hr_admin</c> or <c>super_admin</c>) to tell about a new request.</summary>
public sealed record DataSubjectRequestRecipient(Guid UserId, string Email, string FirstName);

/// <summary>
/// Returned by the repository AFTER commit when a withdrawal filed at least one NEW data subject request: the
/// in-app notifications are already written (same transaction); the email to <see cref="Recipients"/> is sent
/// by the caller. <see cref="DueAt"/> is the earliest response deadline (UTC) of the requests filed.
/// </summary>
public sealed record DataSubjectRequestNotice(IReadOnlyList<DataSubjectRequestRecipient> Recipients, DateTime DueAt);

/// <summary>One row of GET /tenant/data-subject-requests. Ids and instants are strings (ISO-8601 UTC, ms).</summary>
/// <param name="DueAt">createdAt + 15 business days (<see cref="BusinessDays.DueAt"/>), same time of day, ISO-8601 UTC.
/// Colombian holidays are not excluded, so it can be earlier than the legal deadline, never later.</param>
public sealed record DataSubjectRequestListItem(
    string Id,
    string CandidateId,
    string? CandidateFirstName,
    string? CandidateLastName,
    string RequestType,
    string Status,
    string Source,
    string CreatedAt,
    string DueAt);

/// <summary>GET /tenant/data-subject-requests — oldest first, at most <see cref="CandidateConsentConstants.MaxListRows"/>.</summary>
public sealed record DataSubjectRequestListView(IReadOnlyList<DataSubjectRequestListItem> Items);
