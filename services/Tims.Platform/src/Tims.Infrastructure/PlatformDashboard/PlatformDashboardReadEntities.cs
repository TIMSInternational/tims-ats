namespace Tims.Infrastructure.PlatformDashboard;

/// <summary>
/// Read-only EF entities for the FX-free platform dashboard reads (Phase-5 slice 23, issue #81, PR 1 of 3).
/// Prisma still owns the DDL and the TS procedures remain the only writers; this slice maps three
/// already-ledgered tables (<c>subscriptions</c>, <c>organizations</c>, <c>users</c>) for SELECTs only.
///
/// <para>Native Prisma enum columns (<c>subscriptions.plan</c> and <c>organizations.plan</c>, both
/// <c>OrgPlan</c>) are read into C# <c>string</c>, the convention <c>BillingReadEntities</c> established.
/// That requires <see cref="PlatformDashboardDataSource"/>; without it the first materialised row throws.
/// Every query is <c>AsNoTracking()</c>, so no enum value is ever written back.</para>
///
/// <para>NO navigation properties, matching the <c>AuditReadDbContext</c> convention. Each entity maps
/// EXACTLY the columns its TS <c>select</c> projects — several other read contexts map these same tables
/// with different column subsets (see <c>PlatformInvitationReadEntity</c>'s docblock for why independent
/// narrow mappings are the convention, not a conflict).</para>
/// </summary>
public sealed class DashboardSubscriptionEntity
{
    public Guid Id { get; set; }

    /// <summary><c>OrgPlan</c> native enum, read as text. <c>getPlanDistribution</c>'s only projected
    /// column (<c>select: { plan: true }</c>, no <c>where</c> — the distribution counts EVERY subscription
    /// row whatever its status, reproduced exactly).</summary>
    public string Plan { get; set; } = string.Empty;
}

/// <summary>Backs <c>getRecentActivity</c>'s <c>recentOrgs</c> query —
/// <c>select: { id, name, plan, createdAt }</c>.</summary>
public sealed class DashboardOrganizationEntity
{
    public Guid Id { get; set; }

    public string Name { get; set; } = string.Empty;

    /// <summary><c>OrgPlan</c> native enum, read as text — becomes the activity item's <c>meta</c>.</summary>
    public string Plan { get; set; } = string.Empty;

    public DateTime CreatedAt { get; set; }
}

/// <summary>
/// Backs <c>getRecentActivity</c>'s <c>recentUsers</c> query —
/// <c>select: { id, firstName, lastName, email, createdAt, isPlatformOwner }</c>. Note the TS query has NO
/// <c>where</c>: inactive and soft-deleted users are listed too, reproduced rather than improved.
/// Both names are NOT NULL per <c>user.prisma</c> (<c>String</c>, not <c>String?</c>).
/// </summary>
public sealed class DashboardUserEntity
{
    public Guid Id { get; set; }

    public string FirstName { get; set; } = string.Empty;

    public string LastName { get; set; } = string.Empty;

    public string Email { get; set; } = string.Empty;

    public DateTime CreatedAt { get; set; }

    public bool IsPlatformOwner { get; set; }
}

/// <summary>
/// The unmapped result row for <c>getUserGrowth</c>'s raw month group-by, materialised by
/// <c>DbContext.Database.SqlQuery&lt;T&gt;</c> — the C# analog of the TS <c>$queryRaw</c> row
/// <c>{ month: string; count: bigint }</c>. NOT registered in the model: EF materialises an unmapped type
/// by matching each property name against the column alias EXACTLY, which is why the SQL aliases are the
/// quoted <c>"Month"</c>/<c>"Count"</c> rather than the lowercase names the TS query uses (an alias changes
/// no grouping and no value). <c>Count</c> is <c>long</c> because the SQL casts to <c>::bigint</c>, exactly
/// as TS receives a <c>bigint</c> and converts with <c>Number(r.count)</c>.
/// </summary>
public sealed class UserGrowthCountRow
{
    public string Month { get; set; } = string.Empty;

    public long Count { get; set; }
}
