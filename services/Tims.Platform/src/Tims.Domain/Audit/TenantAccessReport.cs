using System.Text.Json.Serialization;

namespace Tims.Domain.Audit;

/// <summary>Tenant audit.getAccessReport wire contract; only grouped counts leave the database.</summary>
public sealed record TenantAccessReportRow(
    Guid? ActorId,
    string Entity,
    [property: JsonPropertyName("_count")] TenantAccessCount Count);

public sealed record TenantAccessCount(int Id);
