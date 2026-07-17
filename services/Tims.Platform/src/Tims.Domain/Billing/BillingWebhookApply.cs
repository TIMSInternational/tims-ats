namespace Tims.Domain.Billing;

/// <summary>
/// The outcome of applying a Stripe subscription state-sync to the org's stored subscription — a faithful
/// port of the TS <c>ApplyOutcome</c> (packages/api/src/repositories/billing-webhook.repository.ts).
/// <list type="bullet">
///   <item><see cref="Applied"/> — the upsert wrote the incoming state.</item>
///   <item><see cref="Stale"/> — an older/regressive out-of-order delivery, dropped (nothing written).</item>
///   <item><see cref="Duplicate"/> — an event for a subscription that is NOT the org's current live one
///     (a different, non-cancelled sub); nothing written, and at checkout the NEW sub is cancelled at Stripe.</item>
/// </list>
/// </summary>
public enum ApplyOutcome
{
    Applied,
    Stale,
    Duplicate,
}
