namespace Tims.Infrastructure.PlatformOrganizations;

/// <summary>
/// Write entities for Phase-5 slice 20 (issue #76). All tables stay Prisma-OWNED; this slice adds a
/// SECOND, deploy-gated writer to <c>organizations</c> and appends to <c>audit_logs</c>/<c>notifications</c>.
///
/// <para>Separate from <see cref="PlatformOrganizationEntity"/> (the slice-19 read entity) on purpose. The
/// read entity is queried <c>AsNoTracking()</c> and deliberately omits <c>settings</c>; a tracked write
/// entity that shares a CLR type with an untracked read one is how a context accidentally starts writing
/// columns nobody asked it to.</para>
/// </summary>
public sealed class PlatformOrganizationWriteEntity
{
    public Guid Id { get; set; }

    public string Name { get; set; } = string.Empty;

    public string Slug { get; set; } = string.Empty;

    public string? Domain { get; set; }

    public string? Logo { get; set; }

    /// <summary>
    /// Native Prisma enum column (<c>OrgPlan</c>) read into a C# string, the house convention. It is never
    /// written THROUGH EF — the update statement casts an explicitly bound text parameter
    /// (<c>{plan}::"OrgPlan"</c>), the same technique <c>BillingWebhookRepository</c> already uses on this
    /// very column, because a raw enum column has no EF store mapping to write back through.
    /// </summary>
    public string Plan { get; set; } = string.Empty;

    /// <summary>
    /// The <c>settings</c> jsonb carried as its raw JSON text. Not a typed record: the column is
    /// <c>Json @default("{}")</c> with nothing constraining its shape, and a typed model would silently
    /// drop keys an organization already has when the row is re-emitted in the response.
    /// </summary>
    public string? Settings { get; set; }

    public string? BillingEmail { get; set; }

    public bool IsActive { get; set; }

    public DateTime CreatedAt { get; set; }

    public DateTime UpdatedAt { get; set; }

    /// <summary>
    /// Mapped so the response carries it (both TS mutations return the whole row), never filtered on.
    /// Nothing in the codebase writes <c>deleted_at</c> today — <c>suspendOrganization</c> uses
    /// <c>is_active</c> — and neither read filters it out. Recorded in the slice-19 doc as a latent trap:
    /// the day something starts soft-deleting organizations, the platform console lists them as live.
    /// </summary>
    public DateTime? DeletedAt { get; set; }
}

/// <summary>
/// The <c>users</c> projection the notification fan-out needs — <c>lib/notify.ts:22-25</c> selects
/// <c>{ id }</c> where <c>isPlatformOwner</c>. Read-only (<c>efcoreReadOnly</c>); this slice never writes
/// <c>users</c>.
/// </summary>
public sealed class PlatformOrganizationOwnerEntity
{
    public Guid Id { get; set; }

    public bool IsPlatformOwner { get; set; }
}

/// <summary>
/// One <c>notifications</c> row, INSERTed only (<c>lib/notify.ts:31-41</c>). <c>id</c> has no DB default
/// (Prisma generates the uuid client-side), so the writer supplies it; <c>read</c>, <c>archived</c> and
/// <c>created_at</c> are left to their DB defaults exactly as Prisma leaves them.
/// </summary>
public sealed class PlatformOrganizationNotificationEntity
{
    public Guid Id { get; set; }

    public Guid? OrganizationId { get; set; }

    public Guid UserId { get; set; }

    public string Type { get; set; } = string.Empty;

    public string Title { get; set; } = string.Empty;

    public string? Message { get; set; }

    public string? Module { get; set; }

    public string? EntityType { get; set; }

    public Guid? EntityId { get; set; }

    public string? ActionUrl { get; set; }

    public DateTime CreatedAt { get; set; }
}
