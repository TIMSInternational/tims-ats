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

        return user is null ? null : Map(user);
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

        return user is null ? null : Map(user);
    }

    private static AppUserRow Map(UserEntity user) => new(
        Id: user.Id.ToString(),
        SupabaseUserId: user.SupabaseUserId,
        Email: user.Email,
        OrganizationId: user.OrganizationId?.ToString(),
        IsActive: user.IsActive,
        IsPlatformOwner: user.IsPlatformOwner,
        RoleSlugs: user.UserRoles.Select(ur => ur.Role.Slug).ToList());
}
