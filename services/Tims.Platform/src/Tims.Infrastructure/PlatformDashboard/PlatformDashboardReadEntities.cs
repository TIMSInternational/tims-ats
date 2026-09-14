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

    /// <summary>One subscription per organization (<c>organization_id</c> is UNIQUE in prod), which is why
    /// the accounts roll-ups can key a dictionary on it rather than grouping.</summary>
    public Guid OrganizationId { get; set; }

    /// <summary><c>OrgPlan</c> native enum, read as text. <c>getPlanDistribution</c>'s only projected
    /// column (<c>select: { plan: true }</c>, no <c>where</c> — the distribution counts EVERY subscription
    /// row whatever its status, reproduced exactly).</summary>
    public string Plan { get; set; } = string.Empty;

    /// <summary><c>SubscriptionStatus</c> native enum, read as text (PR 2). Filtered by LITERALS only —
    /// <c>"active"</c>, <c>"trialing"</c>, <c>"past_due"</c> — never by a captured variable, so TRAP 8
    /// (<c>EF.Constant</c>) does not arise; see the data source docblock.</summary>
    public string Status { get; set; } = string.Empty;

    /// <summary>Nullable: only a trialing subscription normally carries one, and
    /// <c>getCustomerHealth</c> guards on it explicitly.</summary>
    public DateTime? TrialEndsAt { get; set; }

    /// <summary>The creation month is what both MRR procedures bucket on (PR 2).</summary>
    public DateTime CreatedAt { get; set; }
}

/// <summary>Backs <c>getRecentActivity</c>'s <c>recentOrgs</c> query —
/// <c>select: { id, name, plan, createdAt }</c>.</summary>
public sealed class DashboardOrganizationEntity
{
    public Guid Id { get; set; }

    public string Name { get; set; } = string.Empty;

    /// <summary><c>OrgPlan</c> native enum, read as text — becomes the activity item's <c>meta</c>, the
    /// <c>search</c> result's <c>plan</c>, and the upsell fallback plan.</summary>
    public string Plan { get; set; } = string.Empty;

    public DateTime CreatedAt { get; set; }

    /// <summary>NOT NULL and UNIQUE; one of <c>search</c>'s three ILIKE targets (PR 2).</summary>
    public string Slug { get; set; } = string.Empty;

    /// <summary>Nullable — an <c>ILIKE</c> against NULL yields NULL, so a domain-less org simply fails
    /// that leg of the OR in both stacks (PR 2).</summary>
    public string? Domain { get; set; }

    /// <summary>Drives <c>getAttentionItems</c>' suspended-org list (<c>false</c>) and
    /// <c>getUpsellOpportunities</c>' population (<c>true</c>) — PR 2.</summary>
    public bool IsActive { get; set; }
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

    /// <summary>Nullable — a platform owner has no organization, and <c>search</c> returns
    /// <c>organization: null</c> for one (PR 2).</summary>
    public Guid? OrganizationId { get; set; }

    /// <summary>PR 2. Note the ASYMMETRY across procedures this column creates:
    /// <c>getCustomerHealth</c> counts only ACTIVE users, while <c>getUpsellOpportunities</c>'
    /// <c>_count.users</c> counts every row and only its separate active-user selection filters. Both are
    /// reproduced.</summary>
    public bool IsActive { get; set; }

    /// <summary>Nullable — "no login ever" is the 999-day sentinel branch in <c>getCustomerHealth</c>
    /// (PR 2).</summary>
    public DateTime? LastLoginAt { get; set; }

    /// <summary>Nullable, returned verbatim by <c>search</c> (PR 2).</summary>
    public string? Avatar { get; set; }
}

/// <summary>
/// Backs <c>getAttentionItems</c>' overdue-invoice list and <c>getCustomerHealth</c>'s overdue count
/// (PR 2). <c>amount</c> is a Prisma <c>Float</c> — <c>double precision</c> — so it stays a
/// <see cref="double"/> here; rounding it to a decimal would change the number
/// <c>toLocaleString</c> formats into the description.
/// </summary>
public sealed class DashboardInvoiceEntity
{
    public Guid Id { get; set; }

    /// <summary>NOT NULL — <c>invoices.organization</c> is a REQUIRED Prisma relation, which is why the
    /// attention query inner-joins rather than left-joins.</summary>
    public Guid OrganizationId { get; set; }

    public double Amount { get; set; }

    /// <summary>Plain <c>text</c> with a <c>'USD'</c> default, NOT an enum.</summary>
    public string Currency { get; set; } = string.Empty;

    /// <summary><c>InvoiceStatus</c> native enum, read as text; filtered by the literal
    /// <c>"pending"</c>.</summary>
    public string Status { get; set; } = string.Empty;

    /// <summary>Nullable even though both consumers filter <c>due_date &lt; now</c> — the kernel's
    /// <c>inv.dueDate ? … : 0</c> guard is reproduced rather than assumed away.</summary>
    public DateTime? DueDate { get; set; }

    /// <summary>
    /// PR 3. <c>getRevenueByCustomer</c>'s paid bucket is <c>status === 'paid' &amp;&amp; inv.paidAt
    /// &amp;&amp; inv.paidAt &gt;= thirtyDaysAgo</c> — note the TRUTHINESS check before the comparison.
    /// Nullable here for the same reason: a row can be <c>paid</c> with no <c>paid_at</c>, and TS excludes
    /// it from the bucket rather than treating the null as an old date. A SQL <c>paid_at &gt;= bound</c>
    /// yields NULL (not true) for such a row and excludes it identically, so the guard survives the
    /// translation without being written twice.
    /// </summary>
    public DateTime? PaidAt { get; set; }
}

/// <summary>Backs <c>getAttentionItems</c>' stale-invitation list (PR 2). The ONLY attention source whose
/// organization is optional. <c>platform_invitations</c> was mapped independently by the slice-22
/// invitations context with a wider column set; narrow per-slice mappings of a shared table are the
/// convention here, not a conflict.</summary>
public sealed class DashboardInvitationEntity
{
    public Guid Id { get; set; }

    public string Email { get; set; } = string.Empty;

    /// <summary><c>InvitationStatus</c> native enum, read as text; filtered by the literals
    /// <c>"pending"</c> and <c>"sent"</c>.</summary>
    public string Status { get; set; } = string.Empty;

    public Guid? OrganizationId { get; set; }

    public DateTime CreatedAt { get; set; }
}

/// <summary>Backs <c>getUpsellOpportunities</c>' <c>_count.featureFlags</c> (PR 2) — a COUNT of EVERY
/// flag row for the organization, enabled or not. Only the FK is mapped: nothing else is read.</summary>
public sealed class DashboardFeatureFlagEntity
{
    public Guid Id { get; set; }

    public Guid OrganizationId { get; set; }
}

/// <summary>Backs <c>getUpsellOpportunities</c>' <c>_count.vacancies</c> (PR 2) — a COUNT of EVERY vacancy
/// row, whatever its status, despite the reason string calling them "active vacancies". Only the FK is
/// mapped.</summary>
public sealed class DashboardVacancyEntity
{
    public Guid Id { get; set; }

    public Guid OrganizationId { get; set; }
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

/// <summary>
/// The unmapped result row for the MRR aggregate (PR 2) — <c>(creation month, plan, count)</c> over
/// ACTIVE subscriptions, materialised by <c>Database.SqlQuery&lt;T&gt;</c> exactly like
/// <see cref="UserGrowthCountRow"/>, with the same EXACT-alias requirement and the same deliberate
/// absence from the model. <c>Plan</c> arrives already cast to <c>text</c> by the SQL, so no enum ever
/// reaches the reader on this path.
/// </summary>
public sealed class ActivePlanMonthCountRow
{
    public string Month { get; set; } = string.Empty;

    public string Plan { get; set; } = string.Empty;

    public long Count { get; set; }
}

/// <summary>
/// The unmapped result row for <c>getDashboardKpis</c>' plan aggregate (PR 3) — <c>(plan, count)</c> over
/// ACTIVE subscriptions, optionally bounded by a creation date. Same <c>Database.SqlQuery&lt;T&gt;</c>
/// mechanics as <see cref="ActivePlanMonthCountRow"/>: EXACT alias matching, deliberately absent from the
/// model, and <c>"plan"::text</c> cast in the SQL so no native enum reaches the reader.
/// </summary>
public sealed class PlanCountRow
{
    public string Plan { get; set; } = string.Empty;

    public long Count { get; set; }
}

// ── getAiCostAnomalies (the FINAL read of the cluster) — the three ai-agent tables ──────────────────
//
// These are the first THREE NEW ledger entries the dashboard surface has needed: `ai_agents`,
// `ai_agent_org_configs` and `ai_agent_usage_logs` were genuinely unmapped by any EF context before
// this, so all three were ADDED to efcoreReadOnly[] (see the platform_dashboard_read_slice23_ai note).
// Every prior PR of this slice could truthfully write "NO ARRAY CHANGES"; this one cannot.
//
// NONE of the three carries a native Postgres enum — `ai_agents.status` is a plain `text` column
// (Prisma `String @default("stub")`), unlike every `plan`/`status` column above — so these entities do
// not depend on PlatformDashboardDataSource's EnableUnmappedTypes and would materialise on a plain
// connection. They still go through the shared data source because they share the context.

/// <summary>Backs the <c>agent</c> half of <c>getAiCostAnomalies</c>' config select —
/// <c>agent: { id, name, slug, costPerCall, status }</c>. `ai_agents` is one of the three GLOBAL,
/// deliberately RLS-EXEMPT catalogs (with `permissions` and `platform_owner_emails`): agent definitions
/// are shared reference data, not tenant data.</summary>
public sealed class DashboardAiAgentEntity
{
    public Guid Id { get; set; }

    public string Slug { get; set; } = string.Empty;

    public string Name { get; set; } = string.Empty;

    /// <summary>Prisma <c>Float</c> — <c>double precision</c>. The zero-usage anomaly's
    /// <c>estimatedWaste</c> is this × 10.</summary>
    public double CostPerCall { get; set; }

    /// <summary>Plain <c>text</c>, NOT an enum. The kernel skips exactly <c>"stub"</c>; every other
    /// value ('active', 'beta', …) participates.</summary>
    public string Status { get; set; } = string.Empty;
}

/// <summary>One enabled/disabled agent activation per organization —
/// <c>@@unique([agentId, organizationId])</c>, so the kernel's pair key is unique by construction.</summary>
public sealed class DashboardAiAgentOrgConfigEntity
{
    public Guid Id { get; set; }

    public Guid AgentId { get; set; }

    public Guid OrganizationId { get; set; }

    public bool Enabled { get; set; }

    /// <summary>Nullable <c>Float</c> — and the JS TRUTHINESS of this value is load-bearing in the
    /// kernel: null and 0 disable the over-budget check, a negative value does not.</summary>
    public double? MonthlyBudget { get; set; }
}

/// <summary>One AI invocation. Only the three columns the group-by touches are mapped —
/// <c>SUM(cost_usd)</c>, <c>COUNT(*)</c> and the <c>created_at &gt;= now−30d</c> window bound.</summary>
public sealed class DashboardAiAgentUsageLogEntity
{
    public Guid Id { get; set; }

    public Guid AgentId { get; set; }

    public Guid OrganizationId { get; set; }

    public double CostUsd { get; set; }

    public DateTime CreatedAt { get; set; }
}
