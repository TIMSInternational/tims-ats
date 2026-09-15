namespace Tims.Domain.Audit;

public sealed record TenantAuditExportRow(DateTime CreatedAt, string ActorName, string ActorEmail,
    string Action, string Entity, string? EntityId, string? IpAddress, string? UserAgent);

public sealed record TenantAuditExport(string Data, int Count, bool Truncated, string Format);
