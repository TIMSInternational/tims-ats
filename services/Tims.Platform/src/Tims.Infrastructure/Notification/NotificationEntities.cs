namespace Tims.Infrastructure.Notification;

/// <summary>
/// <c>notifications</c> — the full column set, because this slice both reads and writes every one of them.
///
/// <para><see cref="OrganizationId"/> is NULLABLE and that is load-bearing: <c>notify()</c> stamps the row with
/// the org the notification is ABOUT, which for the two platform call sites is not the recipient's own org, and
/// the router's <c>create</c> falls back to <c>null</c> for an org-less caller. The RLS policy on this table is
/// <c>organization_id = current_setting('app.current_org_id')</c>, so under
/// <see cref="TenantScope"/> those rows are invisible to their own recipient — see the divergence register in
/// the slice doc. No native enums here (<c>type</c> is plain <c>text</c>), so TRAPs 3 and 8 do not apply.</para>
/// </summary>
public sealed class NotificationEntity
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

    public bool Read { get; set; }

    public DateTime? ReadAt { get; set; }

    public bool Archived { get; set; }

    /// <summary>Filled by the <c>CURRENT_TIMESTAMP</c> column default on INSERT (ValueGeneratedOnAdd).</summary>
    public DateTime CreatedAt { get; set; }
}

/// <summary>
/// <c>notification_preferences</c> — one row per user, unique on <c>user_id</c>.
///
/// <para><see cref="Categories"/> and <see cref="Modules"/> are jsonb NOT NULL carried as raw JSON strings
/// (the <c>FitEngineWriteEntities</c> convention); both have column defaults, so a lazy create omits them.
/// <see cref="UpdatedAt"/> is NOT NULL with <b>NO</b> column default — Prisma's <c>@updatedAt</c> is
/// client-side — so every INSERT and UPDATE here must set it explicitly or Postgres rejects the row.</para>
/// </summary>
public sealed class NotificationPreferenceEntity
{
    public Guid Id { get; set; }

    public Guid UserId { get; set; }

    public bool EmailEnabled { get; set; }

    public bool PushEnabled { get; set; }

    public string Categories { get; set; } = string.Empty;

    public string Modules { get; set; } = string.Empty;

    public string? QuietHoursStart { get; set; }

    public string? QuietHoursEnd { get; set; }

    /// <summary>Filled by the <c>CURRENT_TIMESTAMP</c> column default on INSERT (ValueGeneratedOnAdd).</summary>
    public DateTime CreatedAt { get; set; }

    /// <summary>NOT NULL, no database default — the caller MUST supply this on every write.</summary>
    public DateTime UpdatedAt { get; set; }
}
