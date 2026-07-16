namespace Tims.Infrastructure.Identity;

/// <summary>
/// READ-ONLY EF mapping of the Prisma-OWNED `role_permissions` join table (Role ↔ Permission +
/// <see cref="Scope"/>). <see cref="Scope"/> is the RAW DB string (incl. the legacy 'all'): the
/// downstream <c>AccessKernel</c> maps 'all'→'organization' and re-validates every other value.
/// EF only SELECTs this table.
/// </summary>
public sealed class RolePermissionEntity
{
    public Guid Id { get; set; }

    public Guid RoleId { get; set; }

    public Guid PermissionId { get; set; }

    public string Scope { get; set; } = string.Empty;
}
