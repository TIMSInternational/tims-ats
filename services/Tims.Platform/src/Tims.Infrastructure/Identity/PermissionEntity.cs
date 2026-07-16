namespace Tims.Infrastructure.Identity;

/// <summary>
/// READ-ONLY EF mapping of the Prisma-OWNED `permissions` global catalog. Only the columns the
/// grant fetch needs (<see cref="Module"/>, <see cref="Action"/>) are mapped; EF only SELECTs it.
/// </summary>
public sealed class PermissionEntity
{
    public Guid Id { get; set; }

    public string Module { get; set; } = string.Empty;

    public string Action { get; set; } = string.Empty;
}
