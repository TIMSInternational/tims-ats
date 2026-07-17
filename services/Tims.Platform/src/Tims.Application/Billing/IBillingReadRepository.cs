using Tims.Domain.Billing;

namespace Tims.Application.Billing;

/// <summary>
/// Read port for the billing invoice surface. Both methods, in the infrastructure implementation, run
/// <c>AsNoTracking</c> UNDER <c>TenantScope</c> (SET LOCAL ROLE app_tenant + org GUC → RLS) with an
/// EXPLICIT <c>organizationId</c> filter (defense-in-depth). Billing is org-level: no per-row scope
/// narrowing.
/// </summary>
public interface IBillingReadRepository
{
    /// <summary>
    /// A cursor page ordered <c>createdAt desc, id asc</c> (the unique total order that makes Prisma's
    /// <c>orderBy createdAt desc</c> + <c>cursor:{id}, skip:1</c> deterministic): reads <c>take + 1</c> to
    /// compute <c>hasMore</c>, slices to <paramref name="take"/>, and returns the next cursor (the
    /// take-th row's id) when more remain. An unknown/cross-org cursor yields an empty page. List rows
    /// carry NO subscription.
    /// </summary>
    Task<BillingInvoicePage> ListInvoicesAsync(string organizationId, int take, string? cursor, CancellationToken cancellationToken);

    /// <summary>
    /// A single invoice by id within the caller's org, with its (nullable) subscription LEFT-joined, or
    /// <c>null</c> (→ NOT_FOUND at the caller). A cross-org / missing id returns null (tenant isolation +
    /// RLS), matching the TS <c>findFirstOrThrow</c> throwing NOT_FOUND.
    /// </summary>
    Task<InvoiceRow?> GetInvoiceAsync(string organizationId, string invoiceId, CancellationToken cancellationToken);

    /// <summary>
    /// The org's subscription row (the FULL model) or <c>null</c> — the port of <c>getCurrentPlan</c>'s
    /// <c>db.subscription.findUnique({ where:{ organizationId } })</c> (organizationId is unique). Read-only.
    /// </summary>
    Task<SubscriptionRow?> GetSubscriptionAsync(string organizationId, CancellationToken cancellationToken);

    /// <summary>
    /// The <c>getUsage</c> inputs, gathered under ONE <c>TenantScope</c> (mirroring the TS router's
    /// subscription <c>findUnique</c> + <c>Promise.all</c> of the three counts): the subscription's
    /// plan/status/period plus the real org-scoped counts (active employees; not-deleted vacancies with
    /// status ∉ {closed,cancelled}; assessment assignments gated to <c>assignedAt &gt;= currentPeriodStart</c>
    /// when a period exists). All counts run with an explicit org filter under RLS.
    /// </summary>
    Task<BillingUsageData> GetUsageAsync(string organizationId, CancellationToken cancellationToken);
}
