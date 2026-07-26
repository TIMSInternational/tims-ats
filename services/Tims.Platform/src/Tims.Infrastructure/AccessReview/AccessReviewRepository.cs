using Microsoft.EntityFrameworkCore;
using Tims.Application.AccessReview;
using Tims.Domain.AccessReview;

namespace Tims.Infrastructure.AccessReview;

/// <summary>
/// Read-only port of `access-review.repository.ts`'s four methods. Batched lookups (fetch users →
/// batch-fetch their user_roles → batch-fetch those roles → batch-fetch role_permissions+permissions
/// for those roles), never one deep nested query — matches `AuditReadRepository`'s "batch, not N+1"
/// discipline, scaled up one more join level. `InsertAttestationAsync`/`ListAttestationsAsync` are the
/// ONLY writes/reads against `access_reviews` in this slice.
/// </summary>
public sealed class AccessReviewRepository(AccessReviewDbContext db) : IAccessReviewRepository
{
    private readonly AccessReviewDbContext _db = db;

    public async Task<IReadOnlyList<AccessReviewUserRecord>> FetchUsersForReviewAsync(
        Guid organizationId, int cap, CancellationToken cancellationToken)
    {
        var org = await _db.Organizations.AsNoTracking()
            .FirstOrDefaultAsync(o => o.Id == organizationId, cancellationToken).ConfigureAwait(false);

        var users = await _db.Users.AsNoTracking()
            .Where(u => u.OrganizationId == organizationId)
            .OrderByDescending(u => u.CreatedAt)
            .Take(cap + 1)
            .ToListAsync(cancellationToken).ConfigureAwait(false);

        var userIds = users.Select(u => u.Id).ToList();
        var userRoles = await _db.UserRoles.AsNoTracking()
            .Where(ur => userIds.Contains(ur.UserId))
            .ToListAsync(cancellationToken).ConfigureAwait(false);

        var roleIds = userRoles.Select(ur => ur.RoleId).Distinct().ToList();
        var roles = await _db.Roles.AsNoTracking()
            .Where(r => roleIds.Contains(r.Id))
            .ToDictionaryAsync(r => r.Id, cancellationToken).ConfigureAwait(false);

        var rolePermissions = await _db.RolePermissions.AsNoTracking()
            .Where(rp => roleIds.Contains(rp.RoleId))
            .ToListAsync(cancellationToken).ConfigureAwait(false);

        var permissionIds = rolePermissions.Select(rp => rp.PermissionId).Distinct().ToList();
        var permissions = await _db.Permissions.AsNoTracking()
            .Where(p => permissionIds.Contains(p.Id))
            .ToDictionaryAsync(p => p.Id, cancellationToken).ConfigureAwait(false);

        var rolePermissionsByRole = rolePermissions
            .GroupBy(rp => rp.RoleId)
            .ToDictionary(g => g.Key, g => g
                .Select(rp => $"{permissions[rp.PermissionId].Module}:{permissions[rp.PermissionId].Action}:{rp.Scope}")
                .ToList() as IReadOnlyList<string>);

        var userRolesByUser = userRoles.GroupBy(ur => ur.UserId).ToDictionary(g => g.Key, g => g.ToList());

        return users.Select(u => new AccessReviewUserRecord(
            u.Id, u.FirstName, u.LastName, u.Email, u.OrganizationId, u.IsActive, u.DeletedAt,
            u.LastLoginAt, u.IsPlatformOwner, org?.Name,
            userRolesByUser.TryGetValue(u.Id, out var ownRoles)
                ? ownRoles.Select(ur =>
                {
                    var role = roles[ur.RoleId];
                    return new AccessReviewUserRoleRecord(
                        role.Slug, role.Name, role.IsActive, role.OrganizationId,
                        ur.AssignedAt, ur.AssignedBy, ur.CompanyScope, ur.UnitScope, ur.ExpiresAt,
                        rolePermissionsByRole.TryGetValue(role.Id, out var grants) ? grants : []);
                }).ToList()
                : [])).ToList();
    }

    public Task<bool> OrgExistsAsync(Guid organizationId, CancellationToken cancellationToken) =>
        _db.Organizations.AsNoTracking().AnyAsync(o => o.Id == organizationId, cancellationToken);

    public async Task<AccessReviewAttestation> InsertAttestationAsync(
        AccessReviewAttestationInsert data, CancellationToken cancellationToken)
    {
        var entity = new AccessReviewEntity
        {
            Id = Guid.NewGuid(),
            OrganizationId = data.OrganizationId,
            ReviewerId = data.ReviewerId,
            UserCount = data.UserCount,
            PrivilegedCount = data.PrivilegedCount,
            StaleCount = data.StaleCount,
            DeprovisionGapCount = data.DeprovisionGapCount,
            ExpiredGapCount = data.ExpiredGapCount,
            Notes = data.Notes,
        };
        _db.AccessReviews.Add(entity);
        await _db.SaveChangesAsync(cancellationToken).ConfigureAwait(false);

        return new AccessReviewAttestation(
            entity.Id, entity.OrganizationId, entity.ReviewerId, entity.ReviewedAt,
            entity.UserCount, entity.PrivilegedCount, entity.StaleCount, entity.DeprovisionGapCount,
            entity.ExpiredGapCount, entity.Notes);
    }

    public async Task<IReadOnlyList<AccessReviewAttestationHistoryItem>> ListAttestationsAsync(
        Guid organizationId, int limit, CancellationToken cancellationToken)
    {
        var attestations = await _db.AccessReviews.AsNoTracking()
            .Where(a => a.OrganizationId == organizationId)
            .OrderByDescending(a => a.ReviewedAt)
            .Take(limit)
            .ToListAsync(cancellationToken).ConfigureAwait(false);

        var reviewerIds = attestations.Select(a => a.ReviewerId).Distinct().ToList();
        var reviewers = await _db.Users.AsNoTracking()
            .Where(u => reviewerIds.Contains(u.Id))
            .ToDictionaryAsync(u => u.Id, cancellationToken).ConfigureAwait(false);

        return attestations.Select(a =>
        {
            var reviewer = reviewers[a.ReviewerId];
            return new AccessReviewAttestationHistoryItem(
                a.Id, a.ReviewedAt, a.UserCount, a.PrivilegedCount, a.StaleCount,
                a.DeprovisionGapCount, a.ExpiredGapCount, a.Notes,
                new AccessReviewReviewerView(reviewer.FirstName, reviewer.LastName, reviewer.Email));
        }).ToList();
    }
}
