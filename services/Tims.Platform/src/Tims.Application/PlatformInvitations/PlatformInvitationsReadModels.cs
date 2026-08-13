using System.Text.Json.Serialization;
using Tims.Domain.Json;

namespace Tims.Application.PlatformInvitations;

/// <summary>
/// Read models for the platform-owner invitations surface (Phase-5 slice 22, issue #75) — the C# port of
/// the THREE READ procedures in <c>routers/platform/invitations.ts</c>: <c>getInvitationKpis</c>,
/// <c>listInvitations</c> and <c>exportInvitationsCsv</c>.
///
/// <para><b>TS IS THE CONTRACT.</b> Every flag in this domain is dark, so the tRPC procedures are the LIVE
/// production path and these records must match THEM. <c>scripts/parity/normalize.ts</c> offers only
/// <c>dropNullish</c> and <c>sortArraysBy</c> — it cannot rename a key — and <c>diff()</c> walks the UNION
/// of both key sets, so a key present on one side only is a FAIL rather than a warning.</para>
///
/// <para><b>Every date carries <see cref="NodeIsoDateTimeConverter"/>, and that is not optional.</b> All
/// five <c>platform_invitations</c> timestamp columns are <c>timestamp(3) without time zone</c>, so Npgsql
/// materialises <c>DateTimeKind.Unspecified</c> and default STJ emits <c>2026-08-12T12:00:00.123</c> — no
/// <c>Z</c>, and <c>.000</c> dropped entirely when milliseconds are zero. The TS side goes through
/// superjson and <c>Date.prototype.toISOString()</c>: always 3-digit ms, always <c>Z</c>.
/// <c>expiresAt</c> and <c>createdAt</c> are NOT NULL on every row, so a bare <c>DateTime</c> here would be
/// a GUARANTEED parity failure on the first row returned, before a single key name was compared. This is
/// the defect that cost #211/#216 five of its nine divergences; it is written down here so slice 22 does
/// not re-pay for it.</para>
///
/// <para><b>Unlike slice 19, this surface's TS side uses explicit <c>select</c> everywhere</b> — there is
/// no bare <c>include</c> in <c>invitations.ts</c> (verified: <c>grep -n 'include:'</c> returns nothing).
/// So the TRAP-7 "an <c>include</c> means every scalar and an explicit C# projection drops most of them"
/// hazard does not apply here, and the field sets below are the TS <c>select</c> literals rather than the
/// Prisma models' full column lists. The five columns <c>invitationListSelect</c> deliberately omits
/// (<c>organizationSlug</c>, <c>organizationPlan</c>, <c>token</c>, <c>invitedById</c>, <c>updatedAt</c>)
/// must stay omitted — <c>token</c> most of all: it is the bearer credential for the two unauthenticated
/// procedures, and adding it to a list projection would publish every live invitation's credential to any
/// platform-owner console response.</para>
///
/// <para><b>These shapes are DERIVED FROM SOURCE, never observed at run time.</b> The flag is dark, so
/// <c>verify invitations</c> cannot be run against production to confirm them — the same standing caveat
/// #216 carries.</para>
/// </summary>
public sealed record PlatformInvitationKpis(int Total, int Pending, int Accepted, int Expired);

/// <summary>
/// The nested <c>organization</c> relation as <c>invitationListSelect</c> projects it
/// (<c>{ select: { id: true, name: true } }</c>).
///
/// <para><b>Nullable, and the null is reachable in production.</b>
/// <c>platform_invitations.organization_id</c> is nullable (<c>platform.prisma</c>:
/// <c>organizationId String?</c>) and the relation is <c>Organization?</c>, so a row whose org was never
/// set — or was deleted — emits <c>organization: null</c>. <c>dropNullish</c> masks that difference in the
/// parity harness, which means a wrong disposition here stays invisible until the first row that HAS an
/// org; it is modelled correctly rather than left to that discovery.</para>
/// </summary>
public sealed record PlatformInvitationOrganizationRef(string Id, string Name);

/// <summary>
/// The nested <c>invitedBy</c> relation (<c>{ select: { id, firstName, lastName } }</c>).
///
/// <para>NON-nullable, unlike <see cref="PlatformInvitationOrganizationRef"/>:
/// <c>invitedById</c> is a required column and the Prisma relation is <c>User</c>, not <c>User?</c>. So
/// this object is always present, and <c>firstName</c>/<c>lastName</c> are themselves NOT NULL
/// (<c>user.prisma</c>). Emitting <c>null</c> here would be a divergence, not a defensive default.</para>
/// </summary>
public sealed record PlatformInvitationInvitedByRef(string Id, string FirstName, string LastName);

/// <summary>
/// One row of <c>listInvitations</c> — the <c>invitationListSelect</c> field set, in the TS declaration
/// order. Eleven scalars plus the two nested relations.
/// </summary>
public sealed record PlatformInvitationListItem(
    string Id,
    string Email,
    string Type,
    string? OrganizationId,
    string? OrganizationName,
    string? RoleSlug,
    string Status,
    [property: JsonConverter(typeof(NodeIsoNullableDateTimeConverter))] DateTime? SentAt,
    [property: JsonConverter(typeof(NodeIsoDateTimeConverter))] DateTime ExpiresAt,
    [property: JsonConverter(typeof(NodeIsoNullableDateTimeConverter))] DateTime? AcceptedAt,
    [property: JsonConverter(typeof(NodeIsoDateTimeConverter))] DateTime CreatedAt,
    PlatformInvitationOrganizationRef? Organization,
    PlatformInvitationInvitedByRef InvitedBy);

/// <summary>The <c>listInvitations</c> envelope — <c>{ invitations, total }</c>.</summary>
public sealed record PlatformInvitationListResult(
    IReadOnlyList<PlatformInvitationListItem> Invitations,
    int Total);

/// <summary>
/// The <c>exportInvitationsCsv</c> envelope — <c>{ csv, count }</c>.
///
/// <para><b>The key is <c>csv</c>, not the <c>{ format, data, count }</c> shape the audit-log export
/// uses.</b> Two platform-owner CSV exports, two different envelopes, because the TS procedures differ:
/// <c>exportAuditLogsCsv</c> takes a <c>format</c> param and returns <c>data</c>, while
/// <c>exportInvitationsCsv</c> has no format param and returns <c>csv</c>. Copying the audit envelope here
/// would be the natural mistake and a guaranteed parity FAIL on all three keys.</para>
/// </summary>
public sealed record PlatformInvitationExportResult(string Csv, int Count);

/// <summary>
/// One export row — the <c>exportInvitationsCsv</c> <c>select</c>, which is a DIFFERENT and narrower set
/// than <c>invitationListSelect</c>: no <c>id</c>, no <c>organizationId</c>, no <c>createdAt</c>, and no
/// nested relations. <c>organizationName</c> is the denormalised column, NOT
/// <c>organization.name</c> — the export never joins <c>organizations</c> at all.
/// </summary>
public sealed record PlatformInvitationExportRow(
    string Email,
    string Type,
    string? OrganizationName,
    string? RoleSlug,
    string Status,
    DateTime? SentAt,
    DateTime ExpiresAt,
    DateTime? AcceptedAt);

/// <summary>
/// The validated <c>listInvitations</c> query. Construction is the endpoint's job; the bounds live on
/// <see cref="PlatformInvitationsReadUseCase"/> so they unit-test without a web host.
/// </summary>
public sealed record PlatformInvitationListQuery(
    int Page,
    int Limit,
    string? Type,
    string? Status,
    string? Search);

/// <summary>The validated <c>exportInvitationsCsv</c> filter — <c>type</c> and <c>status</c> only. No
/// page, no limit: the TS export is an UNBOUNDED cross-org read of every matching row.</summary>
public sealed record PlatformInvitationExportQuery(string? Type, string? Status);
