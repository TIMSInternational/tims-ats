using Tims.Domain.AccessReview;

namespace Tims.Application.AccessReview;

/// <summary>Raw fetch shape for one reviewed user — BEFORE the kernel/service shapes it into an
/// <see cref="AccessReviewRow"/>. Mirrors `access-review.repository.ts`'s `reviewUserSelect` exactly.</summary>
public sealed record AccessReviewUserRecord(
    Guid Id,
    string FirstName,
    string LastName,
    string Email,
    Guid? OrganizationId,
    bool IsActive,
    DateTime? DeletedAt,
    DateTime? LastLoginAt,
    bool IsPlatformOwner,
    string? OrgName,
    IReadOnlyList<AccessReviewUserRoleRecord> Roles);

public sealed record AccessReviewUserRoleRecord(
    string Slug,
    string Name,
    bool RoleActive,
    Guid RoleOrganizationId,
    DateTime AssignedAt,
    Guid? AssignedBy,
    Guid? CompanyScope,
    Guid? UnitScope,
    DateTime? ExpiresAt,
    IReadOnlyList<string> Grants);

public sealed record AccessReviewAttestationInsert(
    Guid OrganizationId,
    Guid ReviewerId,
    int UserCount,
    int PrivilegedCount,
    int StaleCount,
    int DeprovisionGapCount,
    int ExpiredGapCount,
    string? Notes);

public interface IAccessReviewRepository
{
    /// <summary>Bounded `cap + 1` so the caller can report truncation honestly (no silent cap) — matches
    /// Slice-17's cursor-pagination honesty convention.</summary>
    Task<IReadOnlyList<AccessReviewUserRecord>> FetchUsersForReviewAsync(Guid organizationId, int cap, CancellationToken cancellationToken);

    Task<bool> OrgExistsAsync(Guid organizationId, CancellationToken cancellationToken);

    Task<AccessReviewAttestation> InsertAttestationAsync(AccessReviewAttestationInsert data, CancellationToken cancellationToken);

    Task<IReadOnlyList<AccessReviewAttestationHistoryItem>> ListAttestationsAsync(Guid organizationId, int limit, CancellationToken cancellationToken);
}
