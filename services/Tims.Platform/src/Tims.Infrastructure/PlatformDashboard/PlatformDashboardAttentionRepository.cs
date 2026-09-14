using Microsoft.EntityFrameworkCore;
using Tims.Application.PlatformDashboard;

namespace Tims.Infrastructure.PlatformDashboard;

/// <summary>
/// EF Core implementation of <c>getAttentionItems</c>' five source reads (Phase-5 slice 23, issue #81,
/// PR 2 of 3). Cross-org by construction and never tenant-scoped — see
/// <see cref="PlatformDashboardReadDbContext"/> for why that is the requirement rather than a gap.
///
/// <para><b>Every status predicate is a LITERAL, and that is load-bearing.</b> <c>invoices.status</c>,
/// <c>subscriptions.status</c> and <c>platform_invitations.status</c> are all NATIVE Postgres enums.
/// EF Core renders a literal into the SQL, where Postgres coerces the unknown-typed literal to the
/// column's enum type; a CAPTURED VARIABLE would instead be parameterised as <c>text</c>, and
/// <c>"InvoiceStatus" = text</c> has no operator — a 500, not a wrong answer (slice 22's TRAP 8). None of
/// these five filters is caller-controlled, so none needs <c>EF.Constant</c>; if one ever becomes a
/// parameter, it does.</para>
///
/// <para><b>Organizations are joined, not batch-looked-up.</b> The invitations repository resolves its
/// relations with a second keyed query because it pages a filtered list; here each source is a capped
/// 20-row read whose relation is 1:1, so a join adds no rows and saves a round trip. The invitation join
/// is a LEFT join — its <c>organization_id</c> is nullable, and Prisma's optional-relation select is
/// likewise a left join yielding <c>null</c>.</para>
/// </summary>
public sealed class PlatformDashboardAttentionRepository(PlatformDashboardReadDbContext db)
    : IPlatformDashboardAttentionRepository
{
    public async Task<IReadOnlyList<OverdueInvoiceRow>> GetOverdueInvoicesAsync(
        DateTime nowUtc,
        int take,
        CancellationToken cancellationToken)
    {
        var now = PlatformDashboardTimestamps.ToNaive(nowUtc);

        var rows = await (from invoice in db.Invoices.AsNoTracking()
                          join organization in db.Organizations.AsNoTracking()
                              on invoice.OrganizationId equals organization.Id
                          where invoice.Status == "pending" && invoice.DueDate < now
                          orderby invoice.DueDate
                          select new
                          {
                              invoice.Id,
                              invoice.Amount,
                              invoice.Currency,
                              invoice.DueDate,
                              OrgId = organization.Id,
                              OrgName = organization.Name,
                          })
            .Take(take)
            .ToListAsync(cancellationToken)
            .ConfigureAwait(false);

        return rows
            .Select(r => new OverdueInvoiceRow(r.Id.ToString(), r.Amount, r.Currency, r.DueDate, r.OrgId.ToString(), r.OrgName))
            .ToList();
    }

    public async Task<IReadOnlyList<ExpiringTrialRow>> GetExpiringTrialsAsync(
        DateTime nowUtc,
        DateTime sevenDaysFromNowUtc,
        int take,
        CancellationToken cancellationToken)
    {
        var now = PlatformDashboardTimestamps.ToNaive(nowUtc);
        var sevenDaysFromNow = PlatformDashboardTimestamps.ToNaive(sevenDaysFromNowUtc);

        var rows = await (from subscription in db.Subscriptions.AsNoTracking()
                          join organization in db.Organizations.AsNoTracking()
                              on subscription.OrganizationId equals organization.Id
                          where subscription.Status == "trialing"
                              && subscription.TrialEndsAt <= sevenDaysFromNow
                              && subscription.TrialEndsAt >= now
                          orderby subscription.TrialEndsAt
                          select new
                          {
                              subscription.Id,
                              subscription.TrialEndsAt,
                              OrgId = organization.Id,
                              OrgName = organization.Name,
                          })
            .Take(take)
            .ToListAsync(cancellationToken)
            .ConfigureAwait(false);

        return rows
            .Select(r => new ExpiringTrialRow(r.Id.ToString(), r.TrialEndsAt, r.OrgId.ToString(), r.OrgName))
            .ToList();
    }

    /// <summary>No ORDER BY: TS declares none, so WHICH twenty past-due subscriptions come back is
    /// unspecified in both stacks, not merely their order. A tie-free <c>ORDER BY id</c> would make the
    /// C# side deterministic and the TS side still not — the divergence would just become
    /// harder to recognise.</summary>
    public async Task<IReadOnlyList<PastDueSubscriptionRow>> GetPastDueSubscriptionsAsync(
        int take,
        CancellationToken cancellationToken)
    {
        var rows = await (from subscription in db.Subscriptions.AsNoTracking()
                          join organization in db.Organizations.AsNoTracking()
                              on subscription.OrganizationId equals organization.Id
                          where subscription.Status == "past_due"
                          select new
                          {
                              subscription.Id,
                              subscription.Plan,
                              OrgId = organization.Id,
                              OrgName = organization.Name,
                          })
            .Take(take)
            .ToListAsync(cancellationToken)
            .ConfigureAwait(false);

        return rows
            .Select(r => new PastDueSubscriptionRow(r.Id.ToString(), r.Plan, r.OrgId.ToString(), r.OrgName))
            .ToList();
    }

    public async Task<IReadOnlyList<StaleInvitationRow>> GetStaleInvitationsAsync(
        DateTime createdBeforeUtc,
        int take,
        CancellationToken cancellationToken)
    {
        var createdBefore = PlatformDashboardTimestamps.ToNaive(createdBeforeUtc);

        // `status: { in: [pending, sent] }` written as two literal comparisons rather than a
        // `Contains` over an array — an array would be parameterised as text[] and hit the enum-operator
        // failure the class docblock describes.
        var rows = await (from invitation in db.Invitations.AsNoTracking()
                          join organization in db.Organizations.AsNoTracking()
                              on invitation.OrganizationId equals organization.Id into organizations
                          from organization in organizations.DefaultIfEmpty()
                          where (invitation.Status == "pending" || invitation.Status == "sent")
                              && invitation.CreatedAt < createdBefore
                          orderby invitation.CreatedAt
                          select new
                          {
                              invitation.Id,
                              invitation.Email,
                              invitation.CreatedAt,
                              OrgId = (Guid?)organization.Id,
                              OrgName = organization.Name,
                          })
            .Take(take)
            .ToListAsync(cancellationToken)
            .ConfigureAwait(false);

        return rows
            .Select(r => new StaleInvitationRow(r.Id.ToString(), r.Email, r.CreatedAt, r.OrgId?.ToString(), r.OrgName))
            .ToList();
    }

    /// <summary>No ORDER BY, same disposition as <see cref="GetPastDueSubscriptionsAsync"/>.</summary>
    public async Task<IReadOnlyList<SuspendedOrgRow>> GetSuspendedOrganizationsAsync(
        int take,
        CancellationToken cancellationToken)
    {
        var rows = await db.Organizations
            .AsNoTracking()
            .Where(o => !o.IsActive)
            .Select(o => new { o.Id, o.Name })
            .Take(take)
            .ToListAsync(cancellationToken)
            .ConfigureAwait(false);

        return rows.Select(o => new SuspendedOrgRow(o.Id.ToString(), o.Name)).ToList();
    }
}
