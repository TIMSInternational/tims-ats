using Microsoft.EntityFrameworkCore;
using Tims.Application.Billing;

namespace Tims.Infrastructure.Billing;

/// <summary>
/// EF implementation of <see cref="IBillingSelfServeRepository"/> — a faithful port of the TS
/// <c>billing.repository.ts</c>. Every read/write runs UNDER <see cref="TenantScope"/> (SET LOCAL ROLE
/// app_tenant + org GUC) so RLS isolates the org, with an EXPLICIT organizationId filter (defense in depth).
/// The customer link is a COMPARE-AND-SET (ensure-row-then-claim-if-unset), never clobbering an existing linkage.
/// </summary>
public sealed class BillingSelfServeRepository(BillingSelfServeDbContext db) : IBillingSelfServeRepository
{
    private readonly BillingSelfServeDbContext _db = db;

    public async Task<OrgBillingContext?> GetOrgBillingContextAsync(string organizationId, CancellationToken cancellationToken)
    {
        var orgGuid = Guid.Parse(organizationId);

        await using var scope = await TenantScope.BeginAsync(_db, orgGuid, cancellationToken).ConfigureAwait(false);

        var org = await _db.Organizations
            .AsNoTracking()
            .Where(o => o.Id == orgGuid)
            .Select(o => new { o.Id, o.Name, o.BillingEmail })
            .FirstOrDefaultAsync(cancellationToken)
            .ConfigureAwait(false);

        if (org is null)
        {
            await scope.CommitAsync(cancellationToken).ConfigureAwait(false);
            return null;
        }

        var subscription = await _db.Subscriptions
            .AsNoTracking()
            .Where(s => s.OrganizationId == orgGuid)
            .Select(s => new OrgBillingSubscription(
                s.Id.ToString(), s.StripeCustomerId, s.StripeSubscriptionId, s.Plan, s.Status))
            .FirstOrDefaultAsync(cancellationToken)
            .ConfigureAwait(false);

        await scope.CommitAsync(cancellationToken).ConfigureAwait(false);
        return new OrgBillingContext(org.Id.ToString(), org.Name, org.BillingEmail, subscription);
    }

    public async Task<string> SetStripeCustomerIdIfAbsentAsync(string organizationId, string stripeCustomerId, CancellationToken cancellationToken)
    {
        var orgGuid = Guid.Parse(organizationId);

        await using var scope = await TenantScope.BeginAsync(_db, orgGuid, cancellationToken).ConfigureAwait(false);

        // Ensure a row exists WITHOUT overwriting an existing one (Prisma upsert create/update:{}).
        await _db.Database.ExecuteSqlInterpolatedAsync(
            $"""
             INSERT INTO subscriptions (id, organization_id, stripe_customer_id, created_at, updated_at)
             VALUES (gen_random_uuid(), {orgGuid}, {stripeCustomerId}, now(), now())
             ON CONFLICT (organization_id) DO NOTHING
             """,
            cancellationToken).ConfigureAwait(false);

        // Claim ONLY if still unset (no-op when a concurrent request already linked a customer).
        await _db.Database.ExecuteSqlInterpolatedAsync(
            $"""
             UPDATE subscriptions SET stripe_customer_id = {stripeCustomerId}, updated_at = now()
             WHERE organization_id = {orgGuid} AND stripe_customer_id IS NULL
             """,
            cancellationToken).ConfigureAwait(false);

        // Return the AUTHORITATIVE id (the existing one if another request won the race).
        var authoritative = await _db.Subscriptions
            .AsNoTracking()
            .Where(s => s.OrganizationId == orgGuid)
            .Select(s => s.StripeCustomerId)
            .FirstOrDefaultAsync(cancellationToken)
            .ConfigureAwait(false);

        await scope.CommitAsync(cancellationToken).ConfigureAwait(false);
        return authoritative ?? stripeCustomerId;
    }
}
