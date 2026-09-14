using System.Text.Json.Nodes;
using System.Text.Json.Serialization;
using Tims.Domain.Json;

namespace Tims.Domain.Audit;

public sealed record TenantAuditPerson(Guid Id, string FirstName, string LastName, string Email);

public sealed record TenantAuditDetail(
    Guid Id, Guid OrganizationId, Guid? UserId, Guid? ActorId,
    string Action, string Entity, string? EntityId, JsonNode? Changes, JsonNode? Metadata,
    string? IpAddress, string? UserAgent,
    [property: JsonConverter(typeof(NodeIsoDateTimeConverter))] DateTime CreatedAt,
    TenantAuditPerson? Actor, TenantAuditPerson? User);
