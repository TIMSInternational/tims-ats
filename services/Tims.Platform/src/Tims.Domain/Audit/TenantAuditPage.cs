using System.Text.Json.Nodes;
using System.Text.Json.Serialization;
using Tims.Domain.Json;

namespace Tims.Domain.Audit;

public sealed record TenantAuditFilter(Guid? ActorId = null, string? Entity = null, string? Action = null,
    DateTimeOffset? DateFrom = null, DateTimeOffset? DateTo = null, string? EntityId = null);

public sealed record TenantAuditListActor(Guid Id, string FirstName, string LastName, string? Avatar);
public sealed record TenantAuditHistoryActor(Guid Id, string FirstName, string LastName);

public sealed record TenantAuditItem<TActor>(
    Guid Id, Guid OrganizationId, Guid? UserId, Guid? ActorId, string Action, string Entity,
    string? EntityId, JsonNode? Changes, JsonNode? Metadata, string? IpAddress, string? UserAgent,
    [property: JsonConverter(typeof(NodeIsoDateTimeConverter))] DateTime CreatedAt, TActor? Actor);

public sealed record TenantAuditPage<TActor>(IReadOnlyList<TenantAuditItem<TActor>> Items,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] Guid? NextCursor);
