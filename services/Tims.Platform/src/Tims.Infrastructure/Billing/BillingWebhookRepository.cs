using System.Globalization;
using Microsoft.EntityFrameworkCore;
using Tims.Application.Billing;
using Tims.Domain.Billing;

namespace Tims.Infrastructure.Billing;

/// <summary>
/// EF implementation of <see cref="IBillingWebhookRepository"/> — a faithful port of the TS
/// <c>billing-webhook.repository.ts</c>. Runs on the PRIVILEGED connection (NOT <see cref="TenantScope"/>):
/// the webhook has no org GUC, so every operation is scoped by EXPLICIT <c>organization_id</c> and the
/// connection role bypasses RLS. The apply is serialized per-org by a transaction-scoped advisory lock — the
/// same lock guards concurrent deliveries even when the subscription row does NOT exist yet (a <c>FOR
/// UPDATE</c> cannot lock a missing row). The upsert is a TRUE atomic <c>INSERT … ON CONFLICT
/// (organization_id) DO UPDATE</c> (faithful to Prisma's <c>upsert</c>), fully parameterized.
/// </summary>
public sealed class BillingWebhookRepository(BillingWebhookDbContext db) : IBillingWebhookRepository
{
    private readonly BillingWebhookDbContext _db = db;

    public async Task<string?> FindOrgIdBySubscriptionAsync(string stripeSubscriptionId, CancellationToken cancellationToken)
    {
        // Privileged read (no TenantScope): the recorded unique column is the authoritative owner.
        var orgId = await _db.Subscriptions
            .AsNoTracking()
            .Where(s => s.StripeSubscriptionId == stripeSubscriptionId)
            .Select(s => (Guid?)s.OrganizationId)
            .FirstOrDefaultAsync(cancellationToken)
            .ConfigureAwait(false);
        return orgId?.ToString();
    }

    public async Task<string?> FindOrgIdByCustomerAsync(string stripeCustomerId, CancellationToken cancellationToken)
    {
        var orgId = await _db.Subscriptions
            .AsNoTracking()
            .Where(s => s.StripeCustomerId == stripeCustomerId)
            .Select(s => (Guid?)s.OrganizationId)
            .FirstOrDefaultAsync(cancellationToken)
            .ConfigureAwait(false);
        return orgId?.ToString();
    }

    public async Task<ApplyOutcome> ApplySubscriptionAsync(
        string organizationId,
        string? stripeCustomerId,
        SubscriptionSyncFields fields,
        DateTimeOffset eventAt,
        CancellationToken cancellationToken)
    {
        var orgGuid = Guid.Parse(organizationId);

        await using var transaction = await _db.Database.BeginTransactionAsync(cancellationToken).ConfigureAwait(false);

        // Per-org advisory lock: serializes concurrent deliveries even when the row doesn't exist yet (a
        // FOR UPDATE can't lock a missing row). hashtext(text) — the org id is bound as a real parameter.
        await _db.Database
            .ExecuteSqlInterpolatedAsync($"SELECT pg_advisory_xact_lock(hashtext({organizationId}))", cancellationToken)
            .ConfigureAwait(false);

        // Read-once the current stored subscription (the decision fields only).
        var current = await _db.Subscriptions
            .AsNoTracking()
            .Where(s => s.OrganizationId == orgGuid)
            .Select(s => new CurrentRow(s.StripeSubscriptionId, s.Status, s.LastStripeEventAt))
            .FirstOrDefaultAsync(cancellationToken)
            .ConfigureAwait(false);

        var existing = current is null
            ? null
            : new ExistingSubscription { StripeSubscriptionId = current.StripeSubscriptionId, Status = current.Status };
        if (StripeWebhookKernel.IsDuplicateSubscription(existing, fields.StripeSubscriptionId))
        {
            await transaction.CommitAsync(cancellationToken).ConfigureAwait(false);
            return ApplyOutcome.Duplicate;
        }

        var currentForDrop = current is null
            ? null
            : new CurrentSubscription { Status = current.Status, LastStripeEventAt = ToInstant(current.LastStripeEventAt) };
        if (StripeWebhookKernel.ShouldDropEvent(currentForDrop, fields.Status, eventAt))
        {
            await transaction.CommitAsync(cancellationToken).ConfigureAwait(false);
            return ApplyOutcome.Stale;
        }

        var customerId = stripeCustomerId; // set only when provided (COALESCE keeps an existing linkage)
        var subscriptionId = fields.StripeSubscriptionId;
        var plan = fields.Plan; // null → keep stored plan (no downgrade on an unknown price)
        var status = fields.Status;
        // Timestamps are bound as text + cast ::timestamp in the SQL: a raw command (unlike an EF entity with
        // HasColumnType("timestamp")) carries no column-type hint, so Npgsql would default a DateTime param to
        // `timestamptz` and reject the Unspecified UTC wall-clock. A text → ::timestamp cast is unambiguous
        // (no session-timezone shift) and stores the exact UTC wall-clock Prisma writes for `timestamp(3)`.
        var periodStart = ToTimestampText(fields.CurrentPeriodStart);
        var periodEnd = ToTimestampText(fields.CurrentPeriodEnd);
        var cancelledAt = ToTimestampText(fields.CancelledAt);
        var lastEventAt = ToTimestampText(eventAt);

        // Atomic upsert by the unique organization_id (faithful to Prisma's upsert). Enum columns are cast to
        // their Prisma type; the conditional plan/customer COALESCE reproduce the "set only if provided" /
        // "no downgrade on unknown price" semantics. On INSERT an absent plan defaults to 'trial' (the Prisma
        // @default), and id/created_at/updated_at are DB-generated here.
        await _db.Database.ExecuteSqlInterpolatedAsync(
            $"""
             INSERT INTO subscriptions
                 (id, organization_id, stripe_customer_id, stripe_subscription_id, plan, status,
                  current_period_start, current_period_end, cancelled_at, last_stripe_event_at, created_at, updated_at)
             VALUES
                 (gen_random_uuid(), {orgGuid}, {customerId}, {subscriptionId},
                  COALESCE({plan}::"OrgPlan", 'trial'::"OrgPlan"), {status}::"SubscriptionStatus",
                  {periodStart}::timestamp, {periodEnd}::timestamp, {cancelledAt}::timestamp, {lastEventAt}::timestamp, now(), now())
             ON CONFLICT (organization_id) DO UPDATE SET
                 stripe_customer_id = COALESCE({customerId}, subscriptions.stripe_customer_id),
                 stripe_subscription_id = {subscriptionId},
                 plan = COALESCE({plan}::"OrgPlan", subscriptions.plan),
                 status = {status}::"SubscriptionStatus",
                 current_period_start = {periodStart}::timestamp,
                 current_period_end = {periodEnd}::timestamp,
                 cancelled_at = {cancelledAt}::timestamp,
                 last_stripe_event_at = {lastEventAt}::timestamp,
                 updated_at = now()
             """,
            cancellationToken).ConfigureAwait(false);

        // Mirror the plan onto organizations.plan ONLY when it is known (never downgrade on an unknown price).
        if (plan is not null)
        {
            await _db.Database.ExecuteSqlInterpolatedAsync(
                $"""UPDATE organizations SET plan = {plan}::"OrgPlan" WHERE id = {orgGuid}""",
                cancellationToken).ConfigureAwait(false);
        }

        await transaction.CommitAsync(cancellationToken).ConfigureAwait(false);
        return ApplyOutcome.Applied;
    }

    public async Task LinkCustomerAsync(string organizationId, string stripeCustomerId, CancellationToken cancellationToken)
    {
        var orgGuid = Guid.Parse(organizationId);

        await using var transaction = await _db.Database.BeginTransactionAsync(cancellationToken).ConfigureAwait(false);

        // Same per-org advisory lock so a concurrent subscription delivery can't race the customer link.
        await _db.Database
            .ExecuteSqlInterpolatedAsync($"SELECT pg_advisory_xact_lock(hashtext({organizationId}))", cancellationToken)
            .ConfigureAwait(false);

        // Upsert the customer id ONLY (plan/status take their Prisma DB defaults on insert; an existing row
        // keeps everything else). Faithful to the TS linkCustomer upsert (create {org, customer} / update {customer}).
        await _db.Database.ExecuteSqlInterpolatedAsync(
            $"""
             INSERT INTO subscriptions (id, organization_id, stripe_customer_id, created_at, updated_at)
             VALUES (gen_random_uuid(), {orgGuid}, {stripeCustomerId}, now(), now())
             ON CONFLICT (organization_id) DO UPDATE SET
                 stripe_customer_id = {stripeCustomerId},
                 updated_at = now()
             """,
            cancellationToken).ConfigureAwait(false);

        await transaction.CommitAsync(cancellationToken).ConfigureAwait(false);
    }

    // Prisma `timestamp(3) without time zone` stores a UTC wall-clock with no offset. Render it as an
    // invariant text literal (millisecond precision) so the SQL `::timestamp` cast stores that exact UTC
    // wall-clock — no client-DateTime-Kind ambiguity and no session-timezone shift.
    private static string? ToTimestampText(DateTimeOffset? value) =>
        value is { } instant
            ? instant.UtcDateTime.ToString("yyyy-MM-dd HH:mm:ss.fff", CultureInfo.InvariantCulture)
            : null;

    // The stored last_stripe_event_at is an Unspecified-kind UTC wall-clock; lift it back to a UTC instant so
    // the pure ShouldDropEvent compares epoch-ms against the incoming eventAt consistently.
    private static DateTimeOffset? ToInstant(DateTime? value) =>
        value is { } wallClock ? new DateTimeOffset(DateTime.SpecifyKind(wallClock, DateTimeKind.Utc)) : null;

    private sealed record CurrentRow(string? StripeSubscriptionId, string Status, DateTime? LastStripeEventAt);
}
