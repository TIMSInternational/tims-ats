using Tims.Domain.Billing;

namespace Tims.Application.Billing;

/// <summary>
/// The Stripe webhook state-sync engine — infra-free orchestration (drives <see cref="IStripeWebhookGateway"/>
/// + <see cref="IBillingWebhookRepository"/> + the pure <see cref="StripeWebhookKernel"/>). A faithful port of
/// the TS <c>handleStripeWebhook</c> (packages/api/src/services/billing-webhook.service.ts):
///
///   verify+parse (→ 400 on failure) → dispatch by event type → resolve the org AUTHORITATIVELY → apply the
///   subscription state atomically (per-org lock) → cancel a duplicate at Stripe.
///
/// Handled events: <c>checkout.session.completed</c>, <c>customer.subscription.created/updated/deleted</c>.
/// Every other type is a no-op (<c>handled = false</c>). Verification failures throw
/// <see cref="WebhookVerificationException"/> (→ 400); handler failures propagate (→ 500 so Stripe retries).
/// </summary>
public sealed class BillingWebhookUseCase(
    IStripeWebhookGateway gateway,
    IBillingWebhookRepository repository,
    StripeBillingEnv billingEnv,
    IBillingWebhookLog? log = null)
{
    private readonly IStripeWebhookGateway _gateway = gateway;
    private readonly IBillingWebhookRepository _repository = repository;
    private readonly StripeBillingEnv _billingEnv = billingEnv;
    private readonly IBillingWebhookLog _log = log ?? NullBillingWebhookLog.Instance;

    public async Task<WebhookResult> HandleAsync(string rawBody, string? signature, CancellationToken cancellationToken)
    {
        // Verify + parse. ConstructEvent throws WebhookVerificationException for ANY sig/secret/header/parse
        // failure → the endpoint returns 400 (an unverified event is never processed).
        var stripeEvent = _gateway.ConstructEvent(rawBody, signature);

        var handled = stripeEvent.Type switch
        {
            "checkout.session.completed" =>
                await HandleCheckoutCompletedAsync(stripeEvent.Checkout!, stripeEvent.CreatedAt, cancellationToken),
            "customer.subscription.created"
                or "customer.subscription.updated"
                or "customer.subscription.deleted" =>
                await HandleSubscriptionEventAsync(stripeEvent.Subscription!, stripeEvent.CreatedAt, cancellationToken),
            _ => false,
        };

        return new WebhookResult(Received: true, Type: stripeEvent.Type, Handled: handled);
    }

    private async Task<bool> HandleCheckoutCompletedAsync(
        StripeCheckoutData session, DateTimeOffset eventAt, CancellationToken cancellationToken)
    {
        var orgId = await ResolveOrgIdAsync(session.CustomerId, session.SubscriptionId, session.MetaOrgId, cancellationToken);
        if (orgId is null)
        {
            _log.UnresolvedOrg("checkout.session.completed", session.SessionId);
            return false;
        }

        // No subscription on the session → just link the customer (a subscription event follows later).
        if (session.SubscriptionId is null)
        {
            if (session.CustomerId is not null)
            {
                await _repository.LinkCustomerAsync(orgId, session.CustomerId, cancellationToken);
            }

            return true;
        }

        // Re-read the subscription authoritatively, then apply it atomically under the org lock.
        var snapshot = await _gateway.RetrieveSubscriptionAsync(session.SubscriptionId, cancellationToken);
        var fields = StripeWebhookKernel.MapStripeSubscriptionToFields(snapshot.Subscription, _billingEnv);
        var outcome = await _repository.ApplySubscriptionAsync(
            orgId, session.CustomerId, fields, eventAt, cancellationToken);

        // Single-subscription enforcement: on 'duplicate' the org already has a different live subscription, so
        // cancel the NEW one at Stripe (no double bill). Swallow ONLY the already-gone case; every other error
        // propagates so the endpoint 500s and Stripe retries the cancel.
        if (outcome == ApplyOutcome.Duplicate)
        {
            _log.CancellingDuplicate(orgId, session.SubscriptionId);
            try
            {
                await _gateway.CancelSubscriptionAsync(session.SubscriptionId, cancellationToken);
            }
            catch (StripeResourceMissingException)
            {
                _log.DuplicateAlreadyCancelled(orgId, session.SubscriptionId);
            }
        }

        return outcome == ApplyOutcome.Applied;
    }

    private async Task<bool> HandleSubscriptionEventAsync(
        StripeSubscriptionSnapshot snapshot, DateTimeOffset eventAt, CancellationToken cancellationToken)
    {
        var orgId = await ResolveOrgIdAsync(
            snapshot.CustomerId, snapshot.Subscription.Id, snapshot.MetaOrgId, cancellationToken);
        if (orgId is null)
        {
            _log.UnresolvedOrg("subscription event", snapshot.Subscription.Id);
            return false;
        }

        // 'duplicate' = an event for a subscription that is NOT the org's current live one (e.g. one we
        // cancelled); applySubscription writes nothing so it can't overwrite the good subscription. 'stale' =
        // an older out-of-order delivery, dropped.
        var fields = StripeWebhookKernel.MapStripeSubscriptionToFields(snapshot.Subscription, _billingEnv);
        var outcome = await _repository.ApplySubscriptionAsync(
            orgId, snapshot.CustomerId, fields, eventAt, cancellationToken);
        if (outcome != ApplyOutcome.Applied)
        {
            _log.EventNotApplied(orgId, snapshot.Subscription.Id, outcome.ToString());
        }

        return outcome == ApplyOutcome.Applied;
    }

    /// <summary>
    /// Resolve the owning org AUTHORITATIVELY by Stripe ownership (our recorded unique columns), never by
    /// attacker- or stale-metadata: subscription linkage first, then customer linkage. <c>metadata.orgId</c>
    /// is trusted only as a last resort when NO linkage exists yet (the first checkout link), and a mismatch
    /// against the recorded owner is logged and never followed. A verified signature proves delivery, not
    /// tenant authorization.
    /// </summary>
    private async Task<string?> ResolveOrgIdAsync(
        string? customerId, string? subscriptionId, string? metaOrgId, CancellationToken cancellationToken)
    {
        if (subscriptionId is not null)
        {
            var bySubscription = await _repository.FindOrgIdBySubscriptionAsync(subscriptionId, cancellationToken);
            if (bySubscription is not null)
            {
                if (metaOrgId is not null && metaOrgId != bySubscription)
                {
                    _log.MetadataOrgMismatch("subscription", metaOrgId, bySubscription);
                }

                return bySubscription;
            }
        }

        if (customerId is not null)
        {
            var byCustomer = await _repository.FindOrgIdByCustomerAsync(customerId, cancellationToken);
            if (byCustomer is not null)
            {
                if (metaOrgId is not null && metaOrgId != byCustomer)
                {
                    _log.MetadataOrgMismatch("customer", metaOrgId, byCustomer);
                }

                return byCustomer;
            }
        }

        return metaOrgId;
    }
}
