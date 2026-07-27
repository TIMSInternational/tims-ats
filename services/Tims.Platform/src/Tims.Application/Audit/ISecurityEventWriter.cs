using System.Text.Json.Nodes;

namespace Tims.Application.Audit;

/// <summary>
/// A generic, privileged, fail-soft writer into `audit_logs` — the C# port of TS's
/// `logSecurityEvent`/`logPlatformExport` (`packages/api/src/access/security-audit.ts`). UNLIKE
/// `IBillingAuditWriter` (entity-hardcoded, wraps writes in `TenantScope` — a tenant-attributed
/// write), this is the cross-org/pre-tenant write pattern: no TenantScope, `entity`/`action` supplied
/// by the caller, `organizationId` set explicitly. A lost security-audit row must NEVER fail the
/// caller's request — every implementation must swallow its own failures.
/// </summary>
public interface ISecurityEventWriter
{
    Task WriteAsync(SecurityEvent securityEvent, CancellationToken cancellationToken);
}

public sealed record SecurityEvent(
    Guid OrganizationId,
    Guid? ActorId,
    string Action,
    string Entity,
    string? EntityId,
    JsonObject? Metadata,
    // Populated ONLY for the EXPORT event (matches TS `logPlatformExport`, which reads
    // ipAddress/userAgent off the request); the plain `logSecurityEvent` calls for
    // access_review_viewed/access_recertified correctly leave both null.
    string? IpAddress = null,
    string? UserAgent = null);
