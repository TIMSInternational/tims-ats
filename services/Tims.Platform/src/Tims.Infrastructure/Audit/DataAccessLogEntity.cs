namespace Tims.Infrastructure.Audit;

/// <summary>
/// EF row for the Prisma-OWNED, APPEND-ONLY <c>data_access_logs</c> table (docs/architecture/table-ownership.md
/// <c>efcoreAppendOnly</c>). Mirrors the Prisma <c>DataAccessLog</c> model: <c>actor_id</c> is a SOFT reference
/// (no FK) so audit rows survive user deletion. This is the ONE table C# writes; every field is INSERT-only.
/// </summary>
public sealed class DataAccessLogEntity
{
    public Guid Id { get; set; }

    public Guid OrganizationId { get; set; }

    public Guid ActorId { get; set; }

    public string DataType { get; set; } = string.Empty;

    public Guid RecordId { get; set; }

    public string Action { get; set; } = string.Empty;

    public string? IpAddress { get; set; }

    public string? UserAgent { get; set; }

    public DateTime CreatedAt { get; set; }
}
