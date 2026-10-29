namespace Tims.Infrastructure.PlatformAudit;

/// <summary>
/// EF entity for the efcore-OWNED, org-less, append-only <c>platform_audit_events</c> table (WP-03 PR-5a). One row
/// per platform-level governance event (for example a platform-owner grant or revoke) that has no single tenant to
/// file it under. <see cref="OrganizationId"/> is optional context only and deliberately carries no foreign key.
/// The table is append-only at the engine level (the shared <c>tims_append_only_guard()</c> trigger) and tenant
/// roles hold no privileges on it; only the platform (owner) connection writes it.
/// </summary>
public sealed class PlatformAuditEventEntity
{
    public Guid Id { get; set; }

    /// <summary>The acting platform user, when known.</summary>
    public Guid? ActorId { get; set; }

    /// <summary>The event name, e.g. <c>platform_owner_granted</c>.</summary>
    public string Action { get; set; } = string.Empty;

    /// <summary>The kind of thing acted on, e.g. <c>platform_owner</c>.</summary>
    public string Entity { get; set; } = string.Empty;

    public string? EntityId { get; set; }

    /// <summary>Optional organization context. No foreign key: the row must outlive the organization.</summary>
    public Guid? OrganizationId { get; set; }

    /// <summary>Before/after values as JSON.</summary>
    public string? Changes { get; set; }

    /// <summary>Free-form context as JSON.</summary>
    public string? Metadata { get; set; }

    public string? IpAddress { get; set; }

    public string? UserAgent { get; set; }

    /// <summary>Set by the database default (<c>now()</c>).</summary>
    public DateTime CreatedAt { get; set; }
}
