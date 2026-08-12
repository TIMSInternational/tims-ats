using System.Text.Json.Nodes;
using System.Text.Json.Serialization;
using Tims.Domain.Json;

namespace Tims.Application.PlatformOrganizations;

/// <summary>
/// Read models for the platform-owner organizations surface (Phase-5 slice 19, issue #76) — the C# port
/// of the THREE read procedures in <c>routers/platform/organizations.ts</c>:
/// <c>getOrganizationKpis</c>, <c>listOrganizations</c> and <c>getOrganization</c>.
///
/// <para><b>TS IS THE CONTRACT.</b> Both platform-organizations flags are dark, so the tRPC procedures are
/// the LIVE production path and these records must match THEM — not the other way round. That is why the
/// JSON key is <c>_count</c> rather than the C#-natural <c>counts</c>, why <c>lastLoginAt</c> is wrapped in
/// a one-or-zero-element <c>users</c> array, and why every date carries
/// <see cref="NodeIsoDateTimeConverter"/>. Each of those is a shape the TS emits and the harness compares
/// literally: <c>scripts/parity/normalize.ts</c> offers only <c>dropNullish</c> and <c>sortArraysBy</c>, it
/// cannot rename a key, and <c>diff()</c> walks the UNION of both key sets — so a key present on one side
/// only is a FAIL, not a warning.</para>
///
/// <para><b>Why every model reproduces the FULL Prisma scalar set.</b> The TS side uses bare Prisma
/// <c>include</c> (<c>companies</c>, <c>subscription</c>, <c>featureFlags</c>, <c>billingProfile</c> at
/// <c>organizations.ts:118-134</c>) and, for the organization row itself, <c>include</c> rather than
/// <c>select</c> — all of which return EVERY column of those tables. So the wire payload carries
/// <c>settings</c>, <c>deletedAt</c>, the full company/business-unit/team rows,
/// <c>billing_profiles.tax_id</c>, the postal address and <c>billing_phone</c>. CLAUDE.md forbids
/// unselected reads for exactly that reason, and narrowing it here is the right eventual fix — but it must
/// happen in BOTH stacks together, because a C#-only narrowing is invisible to users (the flag is dark) and
/// merely turns a real exposure into a parity FAIL. Written down rather than left implicit; tracked as a
/// deliberate follow-up, not something to slip into a port.</para>
///
/// <para><b>Corrected 2026-08-11 (#211).</b> An earlier version of this docblock claimed these records
/// "reproduce the SAME field set, so there is no behavioural divergence". That was false: <b>27</b>
/// guaranteed non-null scalars and 11 nullable ones were dropped across six nested records, every date
/// serialised without the trailing <c>Z</c>, and three outer keys were misnamed. All were derived from
/// source and none had ever been observed, because <c>verify organization</c> had never successfully
/// run.</para>
///
/// <para><b>The 27 is a counted set, not an estimate</b> (re-counted 2026-08-11 against
/// <c>git show e63ae2cc</c> of this file and the Prisma models): companies 8 + business units 6 + teams 6
/// + subscription 1 + feature flags 3 + billing profile 3. The first version of this very paragraph said
/// <b>29</b>, inherited from the build spec's prose while the spec's own table summed to 27 — the exact
/// uncounted-quantifier failure the correction was written to end
/// (<c>feedback_panels_catch_claims_not_just_code</c>). The nullable count of 11 was and is correct:
/// 1 + 2 + 2 + 5 + 1 + 0.</para>
///
/// <para><b>These shapes are still DERIVED FROM SOURCE, never observed at run time.</b> Both flags are
/// dark, so <c>verify organization</c> cannot be run against production to confirm them.</para>
/// </summary>
public sealed record PlatformOrganizationKpis(int Total, int Active, int Suspended, int Trialing, int ExpiringThisWeek);

/// <summary>Subscription fields the list projects (<c>organizations.ts:87</c>) — an explicit 3-key
/// <c>select</c>, so unlike the detail's subscription this one is genuinely narrow.</summary>
public sealed record PlatformOrganizationListSubscription(
    string Plan,
    string Status,
    [property: JsonConverter(typeof(NodeIsoNullableDateTimeConverter))] DateTime? TrialEndsAt);

/// <summary>A pending invoice as the list projects it (<c>organizations.ts:101-105</c>).</summary>
public sealed record PlatformOrganizationPendingInvoice(
    string Id,
    [property: JsonConverter(typeof(NodeIsoNullableDateTimeConverter))] DateTime? DueDate);

/// <summary>Relation counts the list projects (<c>organizations.ts:86</c>).</summary>
public sealed record PlatformOrganizationCounts(int Users, int Vacancies, int Invoices);

/// <summary>
/// The TS <c>users</c> include on the list (<c>organizations.ts:88-93</c>):
/// <c>{ select: { lastLoginAt }, where: { lastLoginAt: { not: null } }, orderBy: desc, take: 1 }</c>.
///
/// <para><b>It is an ARRAY of zero or one element, not a scalar</b> — <c>take: 1</c> caps the length, it
/// does not flatten the relation. The C# port originally projected a scalar <c>lastLoginAt</c> onto the
/// list item, which is a shape divergence rather than a rename and cannot be normalized away (#211). An
/// org with no logged-in user must emit <c>[]</c>, never <c>null</c>: <c>dropNullish</c> drops a null but
/// keeps an empty array, so a null here would be a FAIL of its own.</para>
/// </summary>
public sealed record PlatformOrganizationListUserLogin(
    [property: JsonConverter(typeof(NodeIsoNullableDateTimeConverter))] DateTime? LastLoginAt);

/// <summary>
/// One row of <c>listOrganizations</c>. The TS uses <c>include</c>, not <c>select</c>, so every
/// Organization scalar is on the wire — <c>settings</c> and <c>deletedAt</c> included.
/// </summary>
public sealed record PlatformOrganizationListItem(
    string Id,
    string Name,
    string Slug,
    string? Domain,
    string? Logo,
    string Plan,
    JsonNode? Settings,
    string? BillingEmail,
    bool IsActive,
    [property: JsonConverter(typeof(NodeIsoDateTimeConverter))] DateTime CreatedAt,
    [property: JsonConverter(typeof(NodeIsoDateTimeConverter))] DateTime UpdatedAt,
    // `deleted_at`. Null on every live org today, so `dropNullish` masks it — but listOrganizations'
    // `where` builder (organizations.ts:61-69) applies NO soft-delete filter, so one soft-deleted org
    // turns this into a hard FAIL. Present for that reason, not for completeness.
    [property: JsonConverter(typeof(NodeIsoNullableDateTimeConverter))] DateTime? DeletedAt,
    [property: JsonPropertyName("_count")] PlatformOrganizationCounts Counts,
    PlatformOrganizationListSubscription? Subscription,
    IReadOnlyList<PlatformOrganizationListUserLogin> Users,
    [property: JsonPropertyName("invoices")] IReadOnlyList<PlatformOrganizationPendingInvoice> PendingInvoices);

public sealed record PlatformOrganizationListResult(IReadOnlyList<PlatformOrganizationListItem> Organizations, int Total);

// ── getOrganization detail ────────────────────────────────────────────────────────────────────────

/// <summary>Full <c>teams</c> row — the TS reaches it via <c>companies.businessUnits.teams: true</c>.</summary>
public sealed record PlatformOrganizationTeam(
    string Id,
    string OrganizationId,
    string BusinessUnitId,
    string Name,
    string? LeaderId,
    JsonNode? Settings,
    bool IsActive,
    [property: JsonConverter(typeof(NodeIsoDateTimeConverter))] DateTime CreatedAt,
    [property: JsonConverter(typeof(NodeIsoDateTimeConverter))] DateTime UpdatedAt);

/// <summary>Full <c>business_units</c> row plus its <c>teams</c> include.</summary>
public sealed record PlatformOrganizationBusinessUnit(
    string Id,
    string OrganizationId,
    string CompanyId,
    string Name,
    string? Code,
    string? ParentId,
    JsonNode? Settings,
    bool IsActive,
    [property: JsonConverter(typeof(NodeIsoDateTimeConverter))] DateTime CreatedAt,
    [property: JsonConverter(typeof(NodeIsoDateTimeConverter))] DateTime UpdatedAt,
    IReadOnlyList<PlatformOrganizationTeam> Teams);

/// <summary>Full <c>companies</c> row plus its <c>businessUnits</c> include.</summary>
public sealed record PlatformOrganizationCompany(
    string Id,
    string OrganizationId,
    string Name,
    string Country,
    string Currency,
    string Timezone,
    string Language,
    string? LegalName,
    string? TaxId,
    JsonNode? Settings,
    bool IsActive,
    [property: JsonConverter(typeof(NodeIsoDateTimeConverter))] DateTime CreatedAt,
    [property: JsonConverter(typeof(NodeIsoDateTimeConverter))] DateTime UpdatedAt,
    IReadOnlyList<PlatformOrganizationBusinessUnit> BusinessUnits);

/// <summary>
/// The detail's <c>users</c>. UNLIKE every other relation on this payload, the TS uses an explicit 8-key
/// <c>select</c> (<c>organizations.ts:119-131</c>), so this record is narrow BY PARITY, not by omission.
/// </summary>
public sealed record PlatformOrganizationUser(
    string Id,
    string FirstName,
    string LastName,
    string Email,
    string? JobTitle,
    bool IsActive,
    [property: JsonConverter(typeof(NodeIsoNullableDateTimeConverter))] DateTime? LastLoginAt,
    bool IsPlatformOwner);

/// <summary>Full <c>subscriptions</c> row — the TS side uses a bare <c>subscription: true</c>.</summary>
public sealed record PlatformOrganizationSubscription(
    string Id,
    string OrganizationId,
    string? StripeCustomerId,
    string? StripeSubscriptionId,
    string Plan,
    string Status,
    [property: JsonConverter(typeof(NodeIsoNullableDateTimeConverter))] DateTime? CurrentPeriodStart,
    [property: JsonConverter(typeof(NodeIsoNullableDateTimeConverter))] DateTime? CurrentPeriodEnd,
    [property: JsonConverter(typeof(NodeIsoNullableDateTimeConverter))] DateTime? TrialEndsAt,
    [property: JsonConverter(typeof(NodeIsoNullableDateTimeConverter))] DateTime? CancelledAt,
    [property: JsonConverter(typeof(NodeIsoNullableDateTimeConverter))] DateTime? LastStripeEventAt,
    [property: JsonConverter(typeof(NodeIsoDateTimeConverter))] DateTime CreatedAt,
    [property: JsonConverter(typeof(NodeIsoDateTimeConverter))] DateTime UpdatedAt);

/// <summary>Full <c>feature_flags</c> row — the TS side uses a bare <c>featureFlags: true</c>.</summary>
public sealed record PlatformOrganizationFeatureFlag(
    string Id,
    string OrganizationId,
    string Key,
    bool Enabled,
    JsonNode? Payload,
    [property: JsonConverter(typeof(NodeIsoDateTimeConverter))] DateTime CreatedAt,
    [property: JsonConverter(typeof(NodeIsoDateTimeConverter))] DateTime UpdatedAt);

/// <summary>
/// Full <c>billing_profiles</c> row — the TS side uses a bare <c>billingProfile: true</c>. Carries
/// <see cref="TaxId"/>, the postal address and <see cref="BillingPhone"/>; see the class docblock on why
/// this is reproduced rather than narrowed here.
/// </summary>
public sealed record PlatformOrganizationBillingProfile(
    string Id,
    string OrganizationId,
    string? CompanyName,
    string? TaxId,
    string? Address,
    string? City,
    string? State,
    string? Country,
    string? ZipCode,
    string? BillingEmail,
    string? BillingPhone,
    [property: JsonConverter(typeof(NodeIsoDateTimeConverter))] DateTime CreatedAt,
    [property: JsonConverter(typeof(NodeIsoDateTimeConverter))] DateTime UpdatedAt);

/// <summary>Detail counts — note <c>Invitations</c> counts only pending+sent (<c>organizations.ts:135-142</c>).</summary>
public sealed record PlatformOrganizationDetailCounts(int Users, int Vacancies, int Invoices, int Invitations);

public sealed record PlatformOrganizationDetail(
    string Id,
    string Name,
    string Slug,
    string? Domain,
    string? Logo,
    string Plan,
    JsonNode? Settings,
    string? BillingEmail,
    bool IsActive,
    [property: JsonConverter(typeof(NodeIsoDateTimeConverter))] DateTime CreatedAt,
    [property: JsonConverter(typeof(NodeIsoDateTimeConverter))] DateTime UpdatedAt,
    [property: JsonConverter(typeof(NodeIsoNullableDateTimeConverter))] DateTime? DeletedAt,
    IReadOnlyList<PlatformOrganizationCompany> Companies,
    IReadOnlyList<PlatformOrganizationUser> Users,
    PlatformOrganizationSubscription? Subscription,
    IReadOnlyList<PlatformOrganizationFeatureFlag> FeatureFlags,
    PlatformOrganizationBillingProfile? BillingProfile,
    [property: JsonPropertyName("_count")] PlatformOrganizationDetailCounts Counts);

/// <summary>
/// Validated input for <c>listOrganizations</c>. Mirrors the Zod schema at
/// <c>organizations.ts:46-57</c>, including its defaults (page 0, limit 20) and bounds
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
