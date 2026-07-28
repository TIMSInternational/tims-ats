using System.Text.Json.Nodes;
using System.Text.Json.Serialization;
using Tims.Domain.Json;

namespace Tims.Domain.Audit;

/// <summary>
/// Read-side shapes for the two audit-log endpoints (Phase-5 Slice 17) — independent of any EF
/// entity so the repository/endpoint layers don't depend on Tims.Infrastructure. Field sets match
/// the TS query selects EXACTLY (verified against real Prisma selects, not hand-mirrored — see
/// Task 1's fixtures, which pin these same shapes on the TS side):
///   - List (`getCrossOrgAuditLogs`, `auditLogSelect` in system.helpers.ts): id, action, entity,
///     entityId, userId, metadata, createdAt, ipAddress, actor (nested, nullable). NO flat
///     organizationId or userAgent — the real select never returns them.
///   - Export (`exportAuditLogsCsv`, system.ts:314-326): action, entity, entityId, ipAddress,
///     createdAt, organization.name, actor.{firstName,lastName,email}. NO raw ids at all.
/// </summary>
public sealed record AuditLogActorView(Guid Id, string FirstName, string LastName, string Email, string? Avatar);

public sealed record AuditLogListItem(
    Guid Id,
    string Action,
    string Entity,
    string? EntityId,
    Guid? UserId,
    JsonNode? Metadata,
    [property: JsonConverter(typeof(NodeIsoDateTimeConverter))] DateTime CreatedAt,
    string? IpAddress,
    AuditLogActorView? Actor);

public sealed record AuditLogExportRow(
    string Action,
    string Entity,
    string? EntityId,
    string? IpAddress,
    DateTime CreatedAt,
    string OrganizationName,
    string? ActorFirstName,
    string? ActorLastName,
    string? ActorEmail);
