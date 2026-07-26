using Microsoft.Extensions.Logging;
using Tims.Application.Audit;

namespace Tims.Infrastructure.Audit;

/// <summary>
/// See <see cref="ISecurityEventWriter"/>'s doc comment for the full rationale (new sibling to
/// <see cref="BillingAuditWriter"/>'s implementation, not a replacement). NO <see cref="TenantScope"/>
/// — the caller is always a resolved platform owner, never a tenant context. Reuses
/// <see cref="AuditLogEntity"/>/<see cref="AuditLogDbContext"/> verbatim.
/// </summary>
public sealed class SecurityEventWriter(AuditLogDbContext db, ILogger<SecurityEventWriter>? logger = null) : ISecurityEventWriter
{
    private readonly AuditLogDbContext _db = db;
    private readonly ILogger<SecurityEventWriter>? _logger = logger;

    public async Task WriteAsync(SecurityEvent securityEvent, CancellationToken cancellationToken)
    {
        try
        {
            _db.AuditLogs.Add(new AuditLogEntity
            {
                Id = Guid.NewGuid(),
                OrganizationId = securityEvent.OrganizationId,
                ActorId = securityEvent.ActorId,
                Action = securityEvent.Action,
                Entity = securityEvent.Entity,
                EntityId = securityEvent.EntityId,
                Metadata = securityEvent.Metadata?.ToJsonString(),
            });

            await _db.SaveChangesAsync(cancellationToken).ConfigureAwait(false);
        }
        catch (Exception ex)
        {
            // fail-soft: a lost security-audit row must never block the caller's mutation/read.
            _logger?.LogWarning(ex, "security event write dropped (fail-soft): action={Action} entity={Entity} org={OrganizationId}",
                securityEvent.Action, securityEvent.Entity, securityEvent.OrganizationId);
        }
    }
}
