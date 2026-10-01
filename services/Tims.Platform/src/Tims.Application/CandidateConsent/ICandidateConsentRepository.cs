namespace Tims.Application.CandidateConsent;

/// <summary>
/// Candidate data-processing consent (#312, #313). Every tenant method runs UNDER TenantScope for
/// <paramref name="organizationId"/> AND filters on it explicitly; every withdrawal writes its <c>audit_logs</c> row
/// in the SAME transaction (fail-closed). Nothing here deletes candidate data.
/// </summary>
public interface ICandidateConsentRepository
{
    Task<CandidateConsentResult> GetAsync(Guid organizationId, Guid candidateId, CancellationToken cancellationToken);

    /// <summary>Records a staff withdrawal for one candidate. Idempotent: an already-withdrawn consent is returned unchanged.</summary>
    Task<CandidateConsentResult> WithdrawAsync(
        Guid organizationId, Guid candidateId, WithdrawalActor actor, DateTime now, CancellationToken cancellationToken);

    /// <summary>Pre-tenant: the id of the ACTIVE organization with this slug, or null.</summary>
    Task<Guid?> FindActiveOrganizationBySlugAsync(string slug, CancellationToken cancellationToken);

    /// <summary>
    /// Self-service: withdraws for EVERY candidate of the org whose email is exactly <paramref name="email"/> ignoring
    /// case (soft-deleted included, like the public apply flow's withdrawal check), each with a deletion request.
    /// </summary>
    Task<PortalWithdrawalResult> WithdrawByEmailAsync(
        Guid organizationId, string email, WithdrawalActor actor, DateTime now, CancellationToken cancellationToken);
}
