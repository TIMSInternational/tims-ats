namespace Tims.Infrastructure.PlatformOrganizations;

/// <summary>
/// Read entities for Phase-5 slice 19 (issue #76). All Prisma-OWNED tables, read-only
/// (<c>efcoreReadOnly</c>) — this slice adds no writer and moves nothing in the ownership ledger.
///
/// <para>Native Prisma enum columns (<c>OrgPlan</c>, <c>SubscriptionStatus</c>, <c>InvoiceStatus</c>,
/// <c>InvitationStatus</c>) are read into C# <c>string</c>, the convention established by
/// <see cref="Tims.Infrastructure.Billing.BillingReadEntities"/>. Every query is <c>AsNoTracking()</c>,
/// so no enum round-trip is ever written back.</para>
///
/// <para>NO navigation properties, matching <c>AuditReadDbContext</c>'s convention: the repository does
/// batched lookups keyed on organization id rather than deep nested queries. That keeps the SQL
/// predictable for a cross-org list that can span every tenant.</para>
/// </summary>
public sealed class PlatformOrganizationEntity
{
    public Guid Id { get; set; }

    public string Name { get; set; } = string.Empty;

    public string Slug { get; set; } = string.Empty;

    public string? Domain { get; set; }

    public string? Logo { get; set; }

    public string Plan { get; set; } = string.Empty;

    /// <summary>
    /// The <c>settings</c> jsonb carried as its raw JSON text, then re-parsed to a
    /// <c>JsonNode</c> at the model boundary — the same shape
    /// <see cref="PlatformOrganizationWriteEntity"/> already uses. The column is NOT NULL, and the TS
    /// reads use <c>include</c> (not <c>select</c>), so it is on the wire and <c>dropNullish</c> cannot
    /// mask its absence (#211).
    /// </summary>
    public string? Settings { get; set; }

    public string? BillingEmail { get; set; }

    public bool IsActive { get; set; }

    public DateTime CreatedAt { get; set; }

    public DateTime UpdatedAt { get; set; }

    /// <summary>
    /// Mapped, and since #211 also SERIALIZED — the TS <c>include</c> returns it. Still NOT filtered on:
    /// the TS reads do not filter it either (<c>organizations.ts:79,115</c>) and nothing in the codebase
    /// writes it — <c>suspendOrganization</c> uses <c>is_active</c>. Reproducing the absence of the filter
    /// is deliberate parity; see the slice doc's "latent trap" note.
    /// </summary>
    public DateTime? DeletedAt { get; set; }
}

public sealed class PlatformOrganizationSubscriptionEntity
{
    public Guid Id { get; set; }

    public Guid OrganizationId { get; set; }

    public string? StripeCustomerId { get; set; }

    public string? StripeSubscriptionId { get; set; }

    public string Plan { get; set; } = string.Empty;

    public string Status { get; set; } = string.Empty;

    public DateTime? CurrentPeriodStart { get; set; }

    public DateTime? CurrentPeriodEnd { get; set; }

    public DateTime? TrialEndsAt { get; set; }

    public DateTime? CancelledAt { get; set; }

    public DateTime? LastStripeEventAt { get; set; }

    public DateTime CreatedAt { get; set; }

    public DateTime UpdatedAt { get; set; }
}

public sealed class PlatformOrganizationUserEntity
{
    public Guid Id { get; set; }

    /// <summary>Nullable in prod — a platform owner has no organization.</summary>
    public Guid? OrganizationId { get; set; }

    public string FirstName { get; set; } = string.Empty;

    public string LastName { get; set; } = string.Empty;

    public string Email { get; set; } = string.Empty;

    public string? JobTitle { get; set; }

    public bool IsActive { get; set; }

    public DateTime? LastLoginAt { get; set; }

    public bool IsPlatformOwner { get; set; }

    public DateTime CreatedAt { get; set; }
}

public sealed class PlatformOrganizationInvoiceEntity
{
    public Guid Id { get; set; }

    public Guid OrganizationId { get; set; }

    public string Status { get; set; } = string.Empty;

    public DateTime? DueDate { get; set; }
}

/// <summary>Counted only — <c>_count: { vacancies: true }</c> counts every row, deleted included.</summary>
public sealed class PlatformOrganizationVacancyEntity
{
    public Guid Id { get; set; }

    public Guid OrganizationId { get; set; }
}

/// <summary>
/// The FULL <c>companies</c> row. The TS reaches this relation through a bare
/// <c>companies: { include: { businessUnits: { include: { teams: true } } } }</c>
/// (<c>organizations.ts:118</c>), which returns every scalar of all three tables — so every scalar is
/// mapped here too (#211). Narrowing belongs in both stacks at once, not on this side alone.
/// </summary>
public sealed class PlatformOrganizationCompanyEntity
{
    public Guid Id { get; set; }

    public Guid OrganizationId { get; set; }

    public string Name { get; set; } = string.Empty;

    public string Country { get; set; } = string.Empty;

    public string Currency { get; set; } = string.Empty;

    public string Timezone { get; set; } = string.Empty;

    public string Language { get; set; } = string.Empty;

    public string? LegalName { get; set; }

    public string? TaxId { get; set; }

    /// <summary>Raw jsonb text; parsed to a <c>JsonNode</c> at the model boundary.</summary>
    public string? Settings { get; set; }

    public bool IsActive { get; set; }

    public DateTime CreatedAt { get; set; }

    public DateTime UpdatedAt { get; set; }
}

public sealed class PlatformOrganizationBusinessUnitEntity
{
    public Guid Id { get; set; }

    public Guid OrganizationId { get; set; }

    public Guid CompanyId { get; set; }

    public string Name { get; set; } = string.Empty;

    public string? Code { get; set; }

    public Guid? ParentId { get; set; }

    /// <summary>Raw jsonb text; parsed to a <c>JsonNode</c> at the model boundary.</summary>
    public string? Settings { get; set; }

    public bool IsActive { get; set; }

    public DateTime CreatedAt { get; set; }

    public DateTime UpdatedAt { get; set; }
}

public sealed class PlatformOrganizationTeamEntity
{
    public Guid Id { get; set; }

    public Guid OrganizationId { get; set; }

    public Guid BusinessUnitId { get; set; }

    public string Name { get; set; } = string.Empty;

    public Guid? LeaderId { get; set; }

    /// <summary>Raw jsonb text; parsed to a <c>JsonNode</c> at the model boundary.</summary>
    public string? Settings { get; set; }

    public bool IsActive { get; set; }

    public DateTime CreatedAt { get; set; }

    public DateTime UpdatedAt { get; set; }
}

public sealed class PlatformOrganizationFeatureFlagEntity
{
    public Guid Id { get; set; }

    public Guid OrganizationId { get; set; }

    public string Key { get; set; } = string.Empty;

    public bool Enabled { get; set; }

    /// <summary>Raw jsonb text (NULLABLE here, unlike the <c>settings</c> columns).</summary>
    public string? Payload { get; set; }

    public DateTime CreatedAt { get; set; }

    public DateTime UpdatedAt { get; set; }
}

public sealed class PlatformOrganizationBillingProfileEntity
{
    public Guid Id { get; set; }

    public Guid OrganizationId { get; set; }

    public string? CompanyName { get; set; }

    public string? TaxId { get; set; }

    public string? Address { get; set; }

    public string? City { get; set; }

    public string? State { get; set; }

    public string? Country { get; set; }

    public string? ZipCode { get; set; }

    public string? BillingEmail { get; set; }

    public string? BillingPhone { get; set; }

    public DateTime CreatedAt { get; set; }

    public DateTime UpdatedAt { get; set; }
}

/// <summary>
/// Counted only, and only in <c>pending</c>/<c>sent</c> status (<c>organizations.ts:135-142</c>).
/// <c>organization_id</c> is nullable in prod — a platform invitation can precede the org it creates.
/// </summary>
public sealed class PlatformOrganizationInvitationEntity
{
    public Guid Id { get; set; }

    public Guid? OrganizationId { get; set; }

    public string Status { get; set; } = string.Empty;
}
