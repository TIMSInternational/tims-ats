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

public sealed record CandidateConsentResult(CandidateConsentOutcome Outcome, CandidateConsentView? View)
{
    public static readonly CandidateConsentResult NotFound = new(CandidateConsentOutcome.NotFound, null);

    public static CandidateConsentResult Ok(CandidateConsentView view) => new(CandidateConsentOutcome.Ok, view);
}

/// <summary>Self-service result. The response to the candidate is uniform; the counts are for tests and logs only.</summary>
public sealed record PortalWithdrawalResult(bool OrganizationFound, int CandidatesWithdrawn, int DeletionRequestsCreated);
