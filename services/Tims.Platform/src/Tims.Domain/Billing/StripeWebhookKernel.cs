using System.Text.Json.Serialization;
using Tims.Domain.Json;

namespace Tims.Domain.Billing;

/// <summary>
/// The billing self-serve price environment (the subset of Stripe config the pure kernels need) — a faithful
/// port of the TS <c>StripeBillingEnv</c> price fields (packages/api/src/lib/stripe.ts). The secret key is not
/// needed by the pure mappers, so it is intentionally absent here.
/// </summary>
public sealed record StripeBillingEnv(string? StarterPriceId, string? ProfessionalPriceId);

/// <summary>
/// The Stripe subscription fields projected onto our <c>Subscription</c> row — a faithful port of the TS
/// <c>SubscriptionSyncFields</c> (packages/api/src/repositories/billing-webhook.repository.ts). <c>Plan</c>
/// is <c>null</c> when the price is unknown so the repository never DOWNGRADES on an unrecognized price. Dates
/// serialize through the shared Node-ISO converter (…fffZ) so the golden corpus is byte-identical to the TS
/// <c>Date.toISOString()</c> form.
/// </summary>
public sealed record SubscriptionSyncFields
{
    public required string StripeSubscriptionId { get; init; }
    public string? Plan { get; init; }
    public required string Status { get; init; }

    [property: JsonConverter(typeof(NodeIsoNullableDateTimeOffsetConverter))]
    public DateTimeOffset? CurrentPeriodStart { get; init; }

    [property: JsonConverter(typeof(NodeIsoNullableDateTimeOffsetConverter))]
    public DateTimeOffset? CurrentPeriodEnd { get; init; }

    [property: JsonConverter(typeof(NodeIsoNullableDateTimeOffsetConverter))]
    public DateTimeOffset? CancelledAt { get; init; }
}

/// <summary>The org's current stored subscription seen by <see cref="StripeWebhookKernel.IsDuplicateSubscription"/>.</summary>
public sealed record ExistingSubscription
{
    public string? StripeSubscriptionId { get; init; }
    public required string Status { get; init; }
}

/// <summary>The org's current stored subscription seen by <see cref="StripeWebhookKernel.ShouldDropEvent"/>.</summary>
public sealed record CurrentSubscription
{
    public required string Status { get; init; }
    public DateTimeOffset? LastStripeEventAt { get; init; }
}

// ── Stripe's native subscription shape (snake_case) fed to the mapper ─────────────────────────────────────
// A minimal structural mirror of Stripe's Subscription so the kernel stays pure + dependency-free (the
// increment-2 endpoint adapts a real Stripe.net Subscription onto this shape). In recent Stripe API versions
// the billing period lives on the subscription ITEM, not the subscription — so it is read from items.data[0].

/// <summary>Minimal Stripe <c>Subscription</c> shape (snake_case) — input to <see cref="StripeWebhookKernel.MapStripeSubscriptionToFields"/>.</summary>
public sealed record StripeSubscriptionLike
{
    [JsonPropertyName("id")] public required string Id { get; init; }
    [JsonPropertyName("status")] public required string Status { get; init; }
    [JsonPropertyName("cancel_at_period_end")] public bool CancelAtPeriodEnd { get; init; }
    [JsonPropertyName("cancel_at")] public long? CancelAt { get; init; }
    [JsonPropertyName("canceled_at")] public long? CanceledAt { get; init; }
    [JsonPropertyName("items")] public required StripeSubscriptionItems Items { get; init; }
}

/// <summary>The <c>items</c> collection of a <see cref="StripeSubscriptionLike"/>.</summary>
public sealed record StripeSubscriptionItems
{
    [JsonPropertyName("data")] public required IReadOnlyList<StripeSubscriptionItem> Data { get; init; }
}

/// <summary>A single subscription item carrying the price + the billing period (unix seconds).</summary>
public sealed record StripeSubscriptionItem
{
    [JsonPropertyName("price")] public required StripePrice Price { get; init; }
    [JsonPropertyName("current_period_start")] public long CurrentPeriodStart { get; init; }
    [JsonPropertyName("current_period_end")] public long CurrentPeriodEnd { get; init; }
}

/// <summary>The Stripe <c>price</c> of a subscription item; <see cref="Id"/> may be null.</summary>
public sealed record StripePrice
{
    [JsonPropertyName("id")] public string? Id { get; init; }
}

/// <summary>
/// The pure Stripe-webhook state-sync kernels — a faithful, dependency-free port of the TS pure helpers
/// (packages/api/src/services/billing-webhook.service.ts + lib/stripe.ts). Every function is deterministic
/// and network/DB-free; the repository/endpoint (increment 2) composes them under the org advisory lock.
/// Golden-fixtured BOTH stacks (contracts/billing-fixtures/stripe-webhook-kernel.json).
///
/// Load-bearing invariants preserved verbatim:
/// <list type="bullet">
///   <item>ACCESS-SAFETY: any risky/unknown Stripe status maps to <c>past_due</c>, NEVER <c>active</c>
///     (an incorrect mapping would grant paid access).</item>
///   <item>NO-DOWNGRADE: an unknown price yields <c>plan = null</c> so the repository leaves the stored plan
///     untouched (never downgrades on an unrecognized price).</item>
///   <item>SAME-SECOND UN-CANCEL GUARD: <c>event.created</c> is second-granularity, so a tie drops ONLY when
///     it would un-cancel a terminal cancelled state (an out-of-order same-second <c>updated(active)</c>
///     cannot reactivate a <c>deleted(cancelled)</c>).</item>
///   <item>DUPLICATE DETECTION: a different, non-cancelled stored subscription marks an incoming one as a
///     duplicate (drives cancel-the-new-at-Stripe to prevent a double bill, and ignores later events for it).</item>
/// </list>
/// </summary>
public static class StripeWebhookKernel
{
    /// <summary>
    /// Map a Stripe subscription status to our <c>SubscriptionStatus</c> enum (DB string). Anything
    /// risky/unknown maps to <c>past_due</c> — it must NEVER read as <c>active</c> (which would grant access).
    /// </summary>
    public static string MapStripeStatus(string status) => status switch
    {
        "active" => "active",
        "trialing" => "trialing",
        "canceled" or "incomplete_expired" => "cancelled",
        // past_due, unpaid, incomplete, paused, and every unknown/future status.
        _ => "past_due",
    };

    /// <summary>
    /// Reverse-map a Stripe price id to its <c>OrgPlan</c> (DB string), or <c>null</c> for an unknown price.
    /// An empty incoming id never resolves — even if a configured plan price is also empty. Faithful to the
    /// TS iteration order (starter, then professional): the first configured price that matches wins.
    /// </summary>
    public static string? PriceIdToPlan(string? priceId, StripeBillingEnv env)
    {
        if (string.IsNullOrEmpty(priceId))
        {
            return null;
        }

        if (env.StarterPriceId == priceId)
        {
            return "starter";
        }

        if (env.ProfessionalPriceId == priceId)
        {
            return "professional";
        }

        return null;
    }

    /// <summary>
    /// Project a Stripe subscription onto our <see cref="SubscriptionSyncFields"/>. <c>plan</c> is <c>null</c>
    /// for an unknown price (no downgrade); with no items the periods and plan are null (defensive).
    /// </summary>
    public static SubscriptionSyncFields MapStripeSubscriptionToFields(StripeSubscriptionLike sub, StripeBillingEnv env)
    {
        var item = sub.Items.Data.Count > 0 ? sub.Items.Data[0] : null;
        var priceId = item?.Price.Id;
        return new SubscriptionSyncFields
        {
            StripeSubscriptionId = sub.Id,
            Plan = string.IsNullOrEmpty(priceId) ? null : PriceIdToPlan(priceId, env),
            Status = MapStripeStatus(sub.Status),
            CurrentPeriodStart = item is null ? null : ToDate(item.CurrentPeriodStart),
            CurrentPeriodEnd = item is null ? null : ToDate(item.CurrentPeriodEnd),
            CancelledAt = CancelledAtOf(sub),
        };
    }

    /// <summary>
    /// An incoming subscription is a duplicate/foreign one when the org already has a DIFFERENT, non-cancelled
    /// stored subscription. Used (under the org lock) to cancel a duplicate at checkout AND to ignore later
    /// events for it, so they never overwrite the good subscription with the cancelled duplicate's state.
    /// </summary>
    public static bool IsDuplicateSubscription(ExistingSubscription? existing, string incomingSubscriptionId) =>
        !string.IsNullOrEmpty(existing?.StripeSubscriptionId)
        && existing!.StripeSubscriptionId != incomingSubscriptionId
        && existing.Status != "cancelled";

    /// <summary>
    /// Decide whether to DROP an incoming subscription event as stale/regressive. <c>event.created</c> is
    /// second-granularity, so a tie is NOT automatically a duplicate: strictly newer → apply; strictly older
    /// → drop; same second → drop ONLY if it would un-cancel a terminal cancelled state (otherwise apply, e.g.
    /// created→updated or →cancelled). Exact retries re-apply idempotently (the upsert writes identical values).
    /// </summary>
    public static bool ShouldDropEvent(CurrentSubscription? current, string incomingStatus, DateTimeOffset eventAt)
    {
        var lastAt = current?.LastStripeEventAt;
        if (lastAt is null)
        {
            return false;
        }

        var last = lastAt.Value.ToUnixTimeMilliseconds();
        var incoming = eventAt.ToUnixTimeMilliseconds();
        if (incoming > last)
        {
            return false;
        }

        if (incoming < last)
        {
            return true;
        }

        return current!.Status == "cancelled" && incomingStatus != "cancelled";
    }

    // Stripe timestamps are unix SECONDS; a Date is built from seconds*1000. TS treats 0/null/absent as "no
    // date" (0 is falsy), so a zero timestamp is not a cancellation instant.
    private static DateTimeOffset ToDate(long unixSeconds) => DateTimeOffset.FromUnixTimeSeconds(unixSeconds);

    private static DateTimeOffset? CancelledAtOf(StripeSubscriptionLike sub)
    {
        if (sub.CanceledAt is { } canceledAt && canceledAt != 0)
        {
            return ToDate(canceledAt);
        }

        if (sub.CancelAtPeriodEnd && sub.CancelAt is { } cancelAt && cancelAt != 0)
        {
            return ToDate(cancelAt);
        }

        return null;
    }
}
