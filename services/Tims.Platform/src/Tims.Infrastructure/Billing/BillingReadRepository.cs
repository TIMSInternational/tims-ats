using Microsoft.EntityFrameworkCore;
using Tims.Application.Billing;
using Tims.Domain.Billing;

namespace Tims.Infrastructure.Billing;

/// <summary>
/// Read-only EF implementation of <see cref="IBillingReadRepository"/> — a faithful port of the TS
/// <c>billing.listInvoices</c>/<c>billing.getInvoice</c> queries. Every query is <c>AsNoTracking()</c> and
/// runs UNDER <see cref="TenantScope"/> (SET LOCAL ROLE app_tenant + org GUC) so RLS engages, with an
/// EXPLICIT <c>organizationId</c> filter (defense-in-depth). Billing is org-level — no per-row scope
/// narrowing. NEVER logs row content (invoices carry emails/PII).
/// </summary>
public sealed class BillingReadRepository(BillingReadDbContext db) : IBillingReadRepository
{
    // The TS getUsage vacancy count is `status notIn ['closed','cancelled']` — EF translates
    // `!Contains(status)` to `status NOT IN ('closed','cancelled')`. status is a plain (non-enum) column.
    private static readonly string[] ExcludedVacancyStatuses = ["closed", "cancelled"];

    private readonly BillingReadDbContext _db = db;

    public async Task<BillingInvoicePage> ListInvoicesAsync(
        string organizationId, int take, string? cursor, CancellationToken cancellationToken)
    {
        var orgId = Guid.Parse(organizationId);
        await using var scope = await TenantScope.BeginAsync(_db, orgId, cancellationToken).ConfigureAwait(false);

        var query = _db.Invoices.AsNoTracking().Where(i => i.OrganizationId == orgId);

        if (cursor is not null)
        {
            var cursorId = Guid.Parse(cursor);
            // Look up the cursor invoice's createdAt within the SAME visible set (same org). An
            // unknown/cross-org cursor yields no boundary → an empty page, never a leak. Reproduces
            // Prisma's cursor+skip:1 within the UNIQUE total order [createdAt desc, id asc]: return rows
            // strictly AFTER the cursor in that ordering.
            var cursorCreatedAt = await query
                .Where(i => i.Id == cursorId)
                .Select(i => (DateTime?)i.CreatedAt)
                .FirstOrDefaultAsync(cancellationToken)
                .ConfigureAwait(false);
            if (cursorCreatedAt is null)
            {
                return new BillingInvoicePage([], null);
            }

            var boundary = cursorCreatedAt.Value;
            query = query.Where(i =>
                i.CreatedAt < boundary ||
                (i.CreatedAt == boundary && i.Id.CompareTo(cursorId) > 0));
        }

        var page = await query
            .OrderByDescending(i => i.CreatedAt)
            .ThenBy(i => i.Id)
            .Take(take + 1)
            .ToListAsync(cancellationToken)
            .ConfigureAwait(false);

        var hasMore = page.Count > take;
        // List rows carry NO subscription (no include) → the v1 wire OMITS the subscription key.
        var rows = page.Take(take).Select(e => MapInvoice(e, subscription: null)).ToList();
        var nextCursor = hasMore ? rows[take - 1].Id : null;
        return new BillingInvoicePage(rows, nextCursor);
    }

    public async Task<InvoiceRow?> GetInvoiceAsync(
        string organizationId, string invoiceId, CancellationToken cancellationToken)
    {
        var orgId = Guid.Parse(organizationId);
        var invId = Guid.Parse(invoiceId);
        await using var scope = await TenantScope.BeginAsync(_db, orgId, cancellationToken).ConfigureAwait(false);

        // By id within the caller's org, with the (nullable) subscription LEFT-joined. A cross-org / missing
        // id returns null → NOT_FOUND at the caller (IDOR-safe; RLS + explicit org filter).
        var projected = await _db.Invoices.AsNoTracking()
            .Where(i => i.Id == invId && i.OrganizationId == orgId)
            .Select(i => new ProjectedInvoice(i, i.Subscription))
            .FirstOrDefaultAsync(cancellationToken)
            .ConfigureAwait(false);

        return projected is null ? null : MapInvoice(projected.Invoice, projected.Subscription);
    }

    public async Task<SubscriptionRow?> GetSubscriptionAsync(
        string organizationId, CancellationToken cancellationToken)
    {
        var orgId = Guid.Parse(organizationId);
        await using var scope = await TenantScope.BeginAsync(_db, orgId, cancellationToken).ConfigureAwait(false);

        // organizationId is unique on subscriptions → at most one row (Prisma findUnique). Full-model read.
        var entity = await _db.Subscriptions.AsNoTracking()
            .Where(s => s.OrganizationId == orgId)
            .FirstOrDefaultAsync(cancellationToken)
            .ConfigureAwait(false);

        return entity is null ? null : MapSubscription(entity);
    }

    public async Task<BillingUsageData> GetUsageAsync(string organizationId, CancellationToken cancellationToken)
    {
        var orgId = Guid.Parse(organizationId);
        await using var scope = await TenantScope.BeginAsync(_db, orgId, cancellationToken).ConfigureAwait(false);

        // Subscription plan/status/period (select-only, like the TS `select`). Missing sub → all null → trial.
        var sub = await _db.Subscriptions.AsNoTracking()
            .Where(s => s.OrganizationId == orgId)
            .Select(s => new SubscriptionUsageProjection(s.Plan, s.Status, s.CurrentPeriodStart, s.CurrentPeriodEnd))
            .FirstOrDefaultAsync(cancellationToken)
            .ConfigureAwait(false);

        // The billing-period boundary that gates the assessments count (the raw timestamp wall-clock).
        var periodStart = sub?.CurrentPeriodStart;

        var employees = await _db.UsageUsers.AsNoTracking()
            .CountAsync(u => u.OrganizationId == orgId && u.IsActive, cancellationToken)
            .ConfigureAwait(false);

        var vacancies = await _db.UsageVacancies.AsNoTracking()
            .CountAsync(
                v => v.OrganizationId == orgId && v.DeletedAt == null && !ExcludedVacancyStatuses.Contains(v.Status),
                cancellationToken)
            .ConfigureAwait(false);

        var assignments = _db.UsageAssignments.AsNoTracking().Where(a => a.OrganizationId == orgId);
        if (periodStart is { } boundary)
        {
            assignments = assignments.Where(a => a.AssignedAt >= boundary);
        }

        var assessments = await assignments.CountAsync(cancellationToken).ConfigureAwait(false);

        return new BillingUsageData(
            sub?.Plan,
            sub?.Status,
            ToUtcNullable(sub?.CurrentPeriodStart),
            ToUtcNullable(sub?.CurrentPeriodEnd),
            employees,
            vacancies,
            assessments);
    }

    private static InvoiceRow MapInvoice(InvoiceReadEntity e, SubscriptionReadEntity? subscription) => new(
        e.Id.ToString(),
        e.InvoiceNumber,
        e.OrganizationId.ToString(),
        e.SubscriptionId?.ToString(),
        e.StripeInvoiceId,
        e.Amount,
        e.Subtotal,
        e.TaxRate,
        e.Currency,
        e.Status,
        e.Description,
        ToUtc(e.InvoiceDate),
        ToUtcNullable(e.DueDate),
        e.PoNumber,
        e.Notes,
        e.Memo,
        e.EmailTo,
        e.EmailCc,
        ToUtcNullable(e.PaidAt),
        e.InvoiceUrl,
        ToUtcNullable(e.PeriodStart),
        ToUtcNullable(e.PeriodEnd),
        ToUtc(e.CreatedAt),
        subscription is null ? null : MapSubscription(subscription));

    private static SubscriptionRow MapSubscription(SubscriptionReadEntity s) => new(
        s.Id.ToString(),
        s.OrganizationId.ToString(),
        s.StripeCustomerId,
        s.StripeSubscriptionId,
        s.Plan,
        s.Status,
        ToUtcNullable(s.CurrentPeriodStart),
        ToUtcNullable(s.CurrentPeriodEnd),
        ToUtcNullable(s.TrialEndsAt),
        ToUtcNullable(s.CancelledAt),
        ToUtcNullable(s.LastStripeEventAt),
        ToUtc(s.CreatedAt),
        ToUtc(s.UpdatedAt));

    // Prisma `timestamp(3)` columns store UTC wall-clock (Npgsql reads them Kind=Unspecified); represent
    // the instant explicitly as UTC. The v1 HTTP wire form (Node `.toISOString()` = `…fffZ`) is pinned on
    // the DTO via the shared NodeIsoDateTimeOffsetConverter + the golden fixture.
    private static DateTimeOffset ToUtc(DateTime value) =>
        new(DateTime.SpecifyKind(value, DateTimeKind.Utc));

    private static DateTimeOffset? ToUtcNullable(DateTime? value) =>
        value is null ? null : ToUtc(value.Value);

    private sealed record ProjectedInvoice(InvoiceReadEntity Invoice, SubscriptionReadEntity? Subscription);

    // The getUsage subscription projection (plan/status/period only — the TS `select`). Enum columns
    // (plan/status) read as strings via the unmapped-types data source; period columns are `timestamp`
    // wall-clock (Kind=Unspecified). CurrentPeriodStart also gates the assessments count.
    private sealed record SubscriptionUsageProjection(
        string Plan,
        string Status,
        DateTime? CurrentPeriodStart,
        DateTime? CurrentPeriodEnd);
}
