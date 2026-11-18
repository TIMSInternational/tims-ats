using Microsoft.EntityFrameworkCore;
using Tims.Application.Identity;
using Tims.Domain.Identity;

namespace Tims.Infrastructure.Identity;

/// <summary>
/// EF Core implementation of <see cref="IIdentityRepository"/> over <see cref="IdentityDbContext"/>.
/// Strictly read-only: every query is <c>AsNoTracking</c> and eagerly loads the user's role slugs
/// (raw, unfiltered — the resolver applies <see cref="RoleSlugs.FilterStaffRoleSlugs"/>).
/// </summary>
public sealed class IdentityRepository(IdentityDbContext db) : IIdentityRepository
{
    private readonly IdentityDbContext _db = db;

    public async Task<AppUserRow?> FindBySupabaseUserIdAsync(string supabaseUserId, CancellationToken ct)
    {
        var user = await _db.Users
            .AsNoTracking()
            .Include(u => u.UserRoles)
                .ThenInclude(ur => ur.Role)
            .FirstOrDefaultAsync(u => u.SupabaseUserId == supabaseUserId, ct);

        return user is null ? null : Map(user, await OrganizationIsActiveAsync(user, ct));
    }

    public async Task<AppUserRow?> FindByIdAsync(string userId, CancellationToken ct)
    {
        if (!Guid.TryParse(userId, out var id))
        {
            return null;
        }

        var user = await _db.Users
            .AsNoTracking()
            .Include(u => u.UserRoles)
                .ThenInclude(ur => ur.Role)
            .FirstOrDefaultAsync(u => u.Id == id, ct);

        return user is null ? null : Map(user, await OrganizationIsActiveAsync(user, ct));
    }

    /// <summary>
    /// False only when the user's organization row exists and is deactivated (`is_active = false`;
    /// Pilot UX re-audit platform-owner access-3). Platform owners and org-less rows skip the lookup —
    /// the resolver exempts owners and already refuses org-less non-owners. The FK guarantees the row
    /// exists in production, so "no row" never widens access there.
    /// </summary>
    private async Task<bool> OrganizationIsActiveAsync(UserEntity user, CancellationToken ct)
    {
        if (user.IsPlatformOwner || user.OrganizationId is not { } organizationId)
        {
            return true;
        }

        return !await _db.Organizations
            .AsNoTracking()
            .AnyAsync(o => o.Id == organizationId && !o.IsActive, ct);
    }

    private static AppUserRow Map(UserEntity user, bool organizationIsActive) => new(
        Id: user.Id.ToString(),
        SupabaseUserId: user.SupabaseUserId,
        Email: user.Email,
        OrganizationId: user.OrganizationId?.ToString(),
        IsActive: user.IsActive,
        IsPlatformOwner: user.IsPlatformOwner,
        RoleSlugs: user.UserRoles.Select(ur => ur.Role.Slug).ToList(),
        OrganizationIsActive: organizationIsActive);
}
