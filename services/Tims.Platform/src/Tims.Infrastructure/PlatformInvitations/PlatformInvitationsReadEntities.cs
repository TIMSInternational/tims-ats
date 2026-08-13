namespace Tims.Infrastructure.PlatformInvitations;

/// <summary>
/// Read-only EF entities for the platform-owner invitations surface (Phase-5 slice 22, issue #75).
/// Prisma still owns the DDL and the TS procedures remain the only writers, so
/// <c>platform_invitations</c> stays in the ledger's <c>efcoreReadOnly[]</c> — this slice adds no writer
/// and moves nothing between arrays.
///
/// <para>Native Prisma enum columns (<c>InvitationType</c>, <c>InvitationStatus</c>) are read into C#
/// <c>string</c>, the convention <c>BillingReadEntities</c> established. That requires
/// <see cref="PlatformInvitationsDataSource"/>; without it the first materialised row throws. Every query
/// is <c>AsNoTracking()</c>, so no enum value is ever written back.</para>
///
/// <para>NO navigation properties, matching the <c>AuditReadDbContext</c> convention: the repository does
/// batched lookups keyed on id rather than deep nested queries, which keeps the SQL predictable for a
/// cross-org list that can span every tenant.</para>
///
/// <para><b>A SECOND, NARROWER MAPPING OF THIS TABLE ALREADY EXISTS and the two are not in conflict.</b>
/// <c>PlatformOrganizationsReadDbContext</c> maps <c>platform_invitations</c> with three columns
/// (<c>id</c>, <c>organization_id</c>, <c>status</c>) for <c>getOrganization</c>'s pending-invitation
/// COUNT. This slice needs the full projected set, and a count-only entity cannot serve a list, so it gets
/// its own entity in its own context — the same way <c>users</c> is mapped independently by several read
/// contexts with different column subsets. They can drift only in the sense that either could add a column
/// the other lacks, which is harmless: neither writes, and each is validated against the same Prisma
/// model.</para>
/// </summary>
public sealed class PlatformInvitationReadEntity
{
    public Guid Id { get; set; }

    public string Email { get; set; } = string.Empty;

    /// <summary><c>InvitationType</c> native enum, read as text — <c>org_admin</c> | <c>user</c>.</summary>
    public string Type { get; set; } = string.Empty;

    /// <summary>Nullable in prod: a platform invitation can precede the org it creates.</summary>
    public Guid? OrganizationId { get; set; }

    /// <summary>The DENORMALISED org name captured at invite time. Not the same value as
    /// <c>organizations.name</c> — <c>listInvitations</c> returns BOTH, and the export returns only this
    /// one.</summary>
    public string? OrganizationName { get; set; }

    public string? RoleSlug { get; set; }

    /// <summary><c>InvitationStatus</c> native enum, read as text — one of five values.</summary>
    public string Status { get; set; } = string.Empty;

    /// <summary>Join key for the <c>invitedBy</c> relation. NOT NULL and NOT projected onto the wire:
    /// <c>invitationListSelect</c> returns the nested <c>invitedBy</c> object but never the raw
    /// <c>invitedById</c> scalar.</summary>
    public Guid InvitedById { get; set; }

    public DateTime? SentAt { get; set; }

    public DateTime ExpiresAt { get; set; }

    public DateTime? AcceptedAt { get; set; }

    public DateTime CreatedAt { get; set; }

    // DELIBERATELY UNMAPPED, and the omission is a security property rather than an oversight:
    //   `token`  — the bearer credential for the two UNAUTHENTICATED procedures (getInvitationByToken /
    //              acceptInvitation). A column that is never mapped cannot be projected onto a console
    //              response by a later refactor. It is not in `invitationListSelect` either.
    //   `organization_slug`, `organization_plan`, `updated_at` — not in either TS `select`. Adding a
    //              property here would put the key on the wire and FAIL parity, since diff() walks the
    //              union of both key sets.
}

/// <summary>Minimal read-only mapping of <c>organizations</c>, scoped to this context — backs
/// <c>listInvitations</c>'s nested <c>organization: { id, name }</c> only. The export does not join
/// it.</summary>
public sealed class PlatformInvitationOrganizationEntity
{
    public Guid Id { get; set; }

    public string Name { get; set; } = string.Empty;
}

/// <summary>
/// Minimal read-only mapping of <c>users</c>, scoped to this context — backs the nested
/// <c>invitedBy: { id, firstName, lastName }</c>. Both names are NOT NULL per <c>user.prisma</c>
/// (<c>String</c>, not <c>String?</c>), so neither is modelled nullable.
/// </summary>
public sealed class PlatformInvitationSenderEntity
{
    public Guid Id { get; set; }

    public string FirstName { get; set; } = string.Empty;

    public string LastName { get; set; } = string.Empty;
}
