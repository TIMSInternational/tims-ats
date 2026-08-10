namespace Tims.Application.PlatformOrganizations;

/// <summary>
/// Read models for the platform-owner organizations surface (Phase-5 slice 19, issue #76) — the C# port
/// of the THREE read procedures in <c>routers/platform/organizations.ts</c>:
/// <c>getOrganizationKpis</c>, <c>listOrganizations</c> and <c>getOrganization</c>.
///
/// <para><b>Shapes mirror the tRPC responses field-for-field.</b> This is an INTERNAL staff read, so
/// there is no <c>schemaVersion</c> envelope — the same convention as
/// <see cref="Tims.Application.Monitoring"/>. Any field added or dropped here is a parity divergence and
/// must be recorded in the slice doc, not discovered by the parity harness.</para>
///
/// <para><b>Why every model projects explicitly.</b> The TS side uses bare Prisma <c>include</c>
/// (<c>subscription: true</c>, <c>featureFlags: true</c>, <c>billingProfile: true</c> at
/// <c>organizations.ts:94-96</c>), which returns every column of those relations — including
/// <c>billing_profiles.tax_id</c>, the full postal address and <c>billing_phone</c>. CLAUDE.md forbids
/// unselected reads for exactly this reason. These records reproduce the SAME field set, so there is no
/// behavioural divergence, but they write the exposure down instead of leaving it implicit. Narrowing
/// it is a deliberate follow-up, not something to slip into a port.</para>
/// </summary>
public sealed record PlatformOrganizationKpis(int Total, int Active, int Suspended, int Trialing, int ExpiringThisWeek);

/// <summary>Subscription fields the list projects (<c>organizations.ts:67</c>).</summary>
public sealed record PlatformOrganizationListSubscription(string Plan, string Status, DateTime? TrialEndsAt);

/// <summary>A pending invoice as the list projects it (<c>organizations.ts:74-77</c>).</summary>
public sealed record PlatformOrganizationPendingInvoice(string Id, DateTime? DueDate);

/// <summary>Relation counts the list projects (<c>organizations.ts:66</c>).</summary>
public sealed record PlatformOrganizationCounts(int Users, int Vacancies, int Invoices);

/// <summary>
/// One row of <c>listOrganizations</c>. <paramref name="LastLoginAt"/> flattens the TS
/// <c>users: { select: { lastLoginAt }, where: { lastLoginAt: { not: null } }, orderBy: desc, take: 1 }</c>
/// — the most recent non-null login across the org's users, or null when no user has ever logged in.
/// </summary>
public sealed record PlatformOrganizationListItem(
    string Id,
    string Name,
    string Slug,
    string? Domain,
    string? Logo,
    string Plan,
    string? BillingEmail,
    bool IsActive,
    DateTime CreatedAt,
    DateTime UpdatedAt,
    PlatformOrganizationCounts Counts,
    PlatformOrganizationListSubscription? Subscription,
    DateTime? LastLoginAt,
    IReadOnlyList<PlatformOrganizationPendingInvoice> PendingInvoices);

public sealed record PlatformOrganizationListResult(IReadOnlyList<PlatformOrganizationListItem> Organizations, int Total);

// ── getOrganization detail ────────────────────────────────────────────────────────────────────────

public sealed record PlatformOrganizationTeam(string Id, string Name);

public sealed record PlatformOrganizationBusinessUnit(string Id, string Name, IReadOnlyList<PlatformOrganizationTeam> Teams);

public sealed record PlatformOrganizationCompany(
    string Id,
    string Name,
    string Country,
    IReadOnlyList<PlatformOrganizationBusinessUnit> BusinessUnits);

public sealed record PlatformOrganizationUser(
    string Id,
    string FirstName,
    string LastName,
    string Email,
    string? JobTitle,
    bool IsActive,
    DateTime? LastLoginAt,
    bool IsPlatformOwner);

/// <summary>Full subscription row — the TS side uses a bare <c>subscription: true</c>.</summary>
public sealed record PlatformOrganizationSubscription(
    string Id,
    string Plan,
    string Status,
    DateTime? TrialEndsAt,
    DateTime? CurrentPeriodEnd,
    DateTime CreatedAt,
    DateTime UpdatedAt);

public sealed record PlatformOrganizationFeatureFlag(string Id, string Key, bool Enabled);

/// <summary>
/// Full billing profile — the TS side uses a bare <c>billingProfile: true</c>. Carries
/// <see cref="TaxId"/>, the postal address and <see cref="BillingPhone"/>; see the class docblock on why
/// this is reproduced rather than narrowed here.
/// </summary>
public sealed record PlatformOrganizationBillingProfile(
    string Id,
    string? CompanyName,
    string? TaxId,
    string? Address,
    string? City,
    string? State,
    string? Country,
    string? ZipCode,
    string? BillingEmail,
    string? BillingPhone);

/// <summary>Detail counts — note <c>Invitations</c> counts only pending+sent (<c>organizations.ts:97</c>).</summary>
public sealed record PlatformOrganizationDetailCounts(int Users, int Vacancies, int Invoices, int Invitations);

public sealed record PlatformOrganizationDetail(
    string Id,
    string Name,
    string Slug,
    string? Domain,
    string? Logo,
    string Plan,
    string? BillingEmail,
    bool IsActive,
    DateTime CreatedAt,
    DateTime UpdatedAt,
    IReadOnlyList<PlatformOrganizationCompany> Companies,
    IReadOnlyList<PlatformOrganizationUser> Users,
    PlatformOrganizationSubscription? Subscription,
    IReadOnlyList<PlatformOrganizationFeatureFlag> FeatureFlags,
    PlatformOrganizationBillingProfile? BillingProfile,
    PlatformOrganizationDetailCounts Counts);

/// <summary>
/// Validated input for <c>listOrganizations</c>. Mirrors the Zod schema at
/// <c>organizations.ts:32-41</c>, including its defaults (page 0, limit 20) and bounds
/// (limit 1..50, search &lt;= 200, plan/status &lt;= 50).
/// </summary>
public sealed record PlatformOrganizationListQuery(
    Guid? Cursor,
    int Page,
    int Limit,
    string? Search,
    string? Plan,
    string? Status,
    string? SortBy,
    string? SortDir);
