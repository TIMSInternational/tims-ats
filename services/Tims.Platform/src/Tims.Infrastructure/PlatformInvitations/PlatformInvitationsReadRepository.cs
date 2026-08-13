using Microsoft.EntityFrameworkCore;
using Tims.Application.PlatformInvitations;

namespace Tims.Infrastructure.PlatformInvitations;

/// <summary>
/// EF Core implementation of the platform-owner invitations READ surface (Phase-5 slice 22, issue #75).
/// Cross-org by construction and never tenant-scoped — see
/// <see cref="PlatformInvitationsReadDbContext"/> for why that is the requirement rather than a gap.
/// </summary>
public sealed class PlatformInvitationsReadRepository(PlatformInvitationsReadDbContext db)
    : IPlatformInvitationsReadRepository
{
    /// <summary>
    /// <c>getInvitationKpis</c>. FOUR counts over the whole table, no org predicate.
    ///
    /// <para><b>Sequential, where TS uses <c>Promise.all</c>.</b> EF Core forbids concurrent operations on
    /// one <c>DbContext</c>, so these run one after another. The RESULT is identical — four independent
    /// COUNTs with no interdependency — but the read is no longer a single instant: a row whose status
    /// changes mid-sequence can be counted under both its old and new status, so <c>pending + accepted +
    /// expired</c> may not reconcile with <c>total</c> under concurrent writes. TS has the same property for
    /// a different reason (<c>Promise.all</c> issues four separate statements on the same pool, in no
    /// transaction), so this is parity, not a regression introduced here. Neither stack wraps the four in a
    /// snapshot transaction.</para>
    /// </summary>
    public async Task<PlatformInvitationKpis> GetKpisAsync(CancellationToken cancellationToken)
    {
        var invitations = db.Invitations.AsNoTracking();

        var total = await invitations.CountAsync(cancellationToken).ConfigureAwait(false);

        // `status: { in: [pending, sent] }` — TWO statuses under the single `pending` KPI key. The name is
        // the TS key's name, not the status literal's; a reader who assumes `status == 'pending'` here
        // would silently under-count every invitation that has actually been dispatched.
        var pending = await invitations
            .Where(i => i.Status == "pending" || i.Status == "sent")
            .CountAsync(cancellationToken)
            .ConfigureAwait(false);

        var accepted = await invitations
            .Where(i => i.Status == "accepted")
            .CountAsync(cancellationToken)
            .ConfigureAwait(false);

        var expired = await invitations
            .Where(i => i.Status == "expired")
            .CountAsync(cancellationToken)
            .ConfigureAwait(false);

        return new PlatformInvitationKpis(total, pending, accepted, expired);
    }

    /// <summary>
    /// <c>listInvitations</c> — one filtered page plus the unpaged <c>total</c> for the same filter.
    /// </summary>
    public async Task<PlatformInvitationListResult> ListAsync(
        PlatformInvitationListQuery query,
        CancellationToken cancellationToken)
    {
        var filtered = ApplyFilters(db.Invitations.AsNoTracking(), query.Type, query.Status, query.Search);

        // TS runs the page and the count in a `Promise.all`; sequential here for the same DbContext reason
        // as GetKpisAsync, with the same "both stacks are non-transactional anyway" consequence.
        var total = await filtered.CountAsync(cancellationToken).ConfigureAwait(false);

        // `skip: page * limit`. Computed in `long` because Zod bounds `limit` but NOT `page` — see
        // PlatformInvitationsReadUseCase.MaxExpressibleOffset for why an inexpressible offset answers with
        // an empty page rather than overflowing Skip() into a negative argument.
        var offset = (long)query.Page * query.Limit;
        if (offset > PlatformInvitationsReadUseCase.MaxExpressibleOffset)
        {
            return new PlatformInvitationListResult([], total);
        }

        var rows = await filtered
            // `orderBy: { createdAt: 'desc' }` — reproduced with NO tiebreaker, because TS has none. Ties on
            // created_at therefore have an unspecified order in BOTH stacks and can legitimately differ
            // between them; that is a parity-flake risk to absorb with a `sortArraysBy` normalize rule in the
            // registry, never by adding an ORDER BY column that TS does not send.
            .OrderByDescending(i => i.CreatedAt)
            .Skip((int)offset)
            .Take(query.Limit)
            .ToListAsync(cancellationToken)
            .ConfigureAwait(false);

        // Batched lookups keyed on id, rather than navigation properties — the AuditReadDbContext
        // convention. Two extra statements, bounded at `limit` (<= 50) ids each, and the SQL stays flat for
        // a list that can span every tenant.
        var organizationIds = rows
            .Where(r => r.OrganizationId.HasValue)
            .Select(r => r.OrganizationId!.Value)
            .Distinct()
            .ToList();

        var organizations = organizationIds.Count == 0
            ? []
            : await db.Organizations
                .AsNoTracking()
                .Where(o => organizationIds.Contains(o.Id))
                .ToDictionaryAsync(o => o.Id, cancellationToken)
                .ConfigureAwait(false);

        var senderIds = rows.Select(r => r.InvitedById).Distinct().ToList();
        var senders = senderIds.Count == 0
            ? []
            : await db.Senders
                .AsNoTracking()
                .Where(u => senderIds.Contains(u.Id))
                .ToDictionaryAsync(u => u.Id, cancellationToken)
                .ConfigureAwait(false);

        var items = rows.Select(row => new PlatformInvitationListItem(
            row.Id.ToString(),
            row.Email,
            row.Type,
            row.OrganizationId?.ToString(),
            row.OrganizationName,
            row.RoleSlug,
            row.Status,
            row.SentAt,
            row.ExpiresAt,
            row.AcceptedAt,
            row.CreatedAt,
            ResolveOrganization(row, organizations),
            ResolveSender(row, senders))).ToList();

        return new PlatformInvitationListResult(items, total);
    }

    /// <summary>
    /// <c>exportInvitationsCsv</c> — every matching row, no page and no cap, ordered the same way as the
    /// list. Filtered by <c>type</c>/<c>status</c> only: the export takes no <c>search</c> param, so the
    /// third filter argument is deliberately <c>null</c> rather than threaded through.
    /// </summary>
    public async Task<IReadOnlyList<PlatformInvitationExportRow>> ExportAsync(
        PlatformInvitationExportQuery query,
        CancellationToken cancellationToken)
    {
        return await ApplyFilters(db.Invitations.AsNoTracking(), query.Type, query.Status, null)
            .OrderByDescending(i => i.CreatedAt)
            // The projection is the TS export `select`, which is NARROWER than the list's: no id, no
            // organizationId, no createdAt, no joins. Projecting in SQL keeps the unbounded read as small as
            // it can be, since this query has no LIMIT at all.
            .Select(i => new PlatformInvitationExportRow(
                i.Email,
                i.Type,
                i.OrganizationName,
                i.RoleSlug,
                i.Status,
                i.SentAt,
                i.ExpiresAt,
                i.AcceptedAt))
            .ToListAsync(cancellationToken)
            .ConfigureAwait(false);
    }

    /// <summary>
    /// The shared TS <c>where</c> builder, used by both the list and the export.
    ///
    /// <para>Each filter is applied only when present, matching <c>if (type) …</c> / <c>if (status) …</c> /
    /// <c>if (search?.trim()) …</c>. Unknown <c>type</c>/<c>status</c> values never reach here: unlike
    /// <c>listOrganizations</c>'s tri-state <c>status</c>, these are <c>z.enum().optional()</c> and the
    /// endpoint rejects an unknown value with 400 before calling the repository.</para>
    ///
    /// <para><b>The search term is NOT wildcard-escaped, on purpose.</b> Prisma's <c>contains</c> does not
    /// escape <c>%</c> or <c>_</c> either, so a search for <c>%</c> matches every row in both stacks.
    /// Escaping here would be a silent behaviour change (and a parity FAIL on any search containing a
    /// wildcard).</para>
    ///
    /// <para><b>WHY <see cref="EF.Constant{T}"/> AND NOT THE CAPTURED VARIABLE — a native-enum trap this
    /// repo had never hit, found by this slice's own integration tests (both filter endpoints returned
    /// 500).</b> <c>type</c> and <c>status</c> are NATIVE Postgres enum columns. EF Core parameterises a
    /// captured variable, Npgsql types that parameter as <c>text</c>, and Postgres then has no
    /// <c>"InvitationStatus" = text</c> operator — the query fails with <c>operator does not exist</c>. A
    /// LITERAL is different: Postgres coerces an unknown-typed literal to the column's enum type, so it
    /// works. <see cref="EF.Constant{T}"/> forces the literal form.</para>
    ///
    /// <para>This is a DIFFERENT failure from the materialisation one that
    /// <see cref="PlatformInvitationsDataSource"/> fixes, and <c>EnableUnmappedTypes</c> does NOT solve it —
    /// that setting governs READING an unmapped enum into a CLR string, not binding a parameter into one.
    /// Both are needed. Note the exact shape of the near-miss: <c>GetKpisAsync</c>'s
    /// <c>i.Status == "pending"</c> writes a literal in the expression tree and therefore WORKS, which is
    /// why a KPI-only test suite would have reported this surface healthy. The slice-19/20 data-source
    /// docblock predicted precisely this — "whether its <c>status == 'trialing'</c> predicate against an
    /// enum column also fails is a DIFFERENT failure mode and is untested either way" — and it does fail.
    /// Declaring the store type via <c>HasColumnType("\"InvitationStatus\"")</c> was tried first and does
    /// NOT fix it.</para>
    ///
    /// <para>Inlining is safe here specifically because both values are validated against a CLOSED
    /// allowlist before the repository is reached (<c>IsValidType</c>/<c>IsValidStatus</c>), so no
    /// caller-controlled string can reach the literal — and EF escapes literals regardless. Do NOT copy this
    /// pattern for an unvalidated free-text filter; <c>search</c> above deliberately stays a parameter,
    /// which is both safe and correct since <c>email</c> is plain <c>text</c>.</para>
    ///
    /// <para>The regression proof is the test titled
    /// <c>A_parameterised_enum_comparison_fails_which_is_why_the_repository_uses_EF_Constant</c>. Without
    /// it, someone "simplifying" <c>EF.Constant(status)</c> back to <c>status</c> would reintroduce a 500 on
    /// two endpoints, and only a filter-bearing integration test would catch it.</para>
    /// </summary>
    private static IQueryable<PlatformInvitationReadEntity> ApplyFilters(
        IQueryable<PlatformInvitationReadEntity> source,
        string? type,
        string? status,
        string? search)
    {
        // EF.Constant, not the captured variable, and this is NOT a style choice — see EnumFilterNote.
        if (type is not null)
        {
            source = source.Where(i => i.Type == EF.Constant(type));
        }

        if (status is not null)
        {
            source = source.Where(i => i.Status == EF.Constant(status));
        }

        // `email: { contains: search.trim(), mode: 'insensitive' }` → ILIKE %term%. The caller passes the
        // already-trimmed, already-emptiness-checked value (PlatformInvitationsReadUseCase.NormalizeSearch).
        if (search is not null)
        {
            var pattern = "%" + search + "%";
            source = source.Where(i => EF.Functions.ILike(i.Email, pattern));
        }

        return source;
    }

    /// <summary>
    /// The nullable nested <c>organization</c>. Emits <c>null</c> both when the invitation has no
    /// <c>organization_id</c> AND when it points at a row that is not present — which is what a Prisma
    /// LEFT JOIN on an optional relation does.
    /// </summary>
    private static PlatformInvitationOrganizationRef? ResolveOrganization(
        PlatformInvitationReadEntity row,
        IReadOnlyDictionary<Guid, PlatformInvitationOrganizationEntity> organizations) =>
        row.OrganizationId.HasValue && organizations.TryGetValue(row.OrganizationId.Value, out var organization)
            ? new PlatformInvitationOrganizationRef(organization.Id.ToString(), organization.Name)
            : null;

    /// <summary>
    /// The non-nullable nested <c>invitedBy</c>.
    ///
    /// <para><b>The fallback is unreachable while the FK exists, and is not a silent default.</b>
    /// <c>invited_by_id</c> is NOT NULL and carries an FK to <c>users(id)</c> with Prisma's default
    /// <c>Restrict</c> for a required relation, so the sender row cannot be missing or deleted out from
    /// under an invitation. If it somehow were, TS's <c>select</c> would yield <c>invitedBy: null</c> where
    /// this yields empty strings — a divergence on a row that a foreign key says cannot exist. It is
    /// written this way rather than throwing so one corrupt row cannot 500 the whole platform console, and
    /// the difference is recorded here rather than discovered.</para>
    /// </summary>
    private static PlatformInvitationInvitedByRef ResolveSender(
        PlatformInvitationReadEntity row,
        IReadOnlyDictionary<Guid, PlatformInvitationSenderEntity> senders) =>
        senders.TryGetValue(row.InvitedById, out var sender)
            ? new PlatformInvitationInvitedByRef(sender.Id.ToString(), sender.FirstName, sender.LastName)
            : new PlatformInvitationInvitedByRef(row.InvitedById.ToString(), string.Empty, string.Empty);
}
