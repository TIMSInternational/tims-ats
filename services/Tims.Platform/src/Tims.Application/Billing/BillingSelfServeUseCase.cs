using System.Text.Json.Nodes;
using Tims.Domain.Billing;

namespace Tims.Application.Billing;

/// <summary>
/// Tenant self-serve billing — infra-free orchestration (drives <see cref="IBillingSelfServeRepository"/> +
/// <see cref="IStripeBillingGateway"/> + <see cref="IBillingAuditWriter"/>). A faithful port of the TS
/// <c>billingService</c> (packages/api/src/services/billing.service.ts): create a Checkout Session, open the
/// Billing Portal, or schedule a period-end cancel. Config-presence is the gate — every network/DB step is
/// reached only when Stripe is configured, so an unconfigured deploy fails closed with a clean error. Portal +
/// cancel are audited (fail-soft) to <c>audit_logs</c>; checkout is NOT audited (parity with the TS).
/// </summary>
public sealed class BillingSelfServeUseCase(
    IBillingSelfServeRepository repository,
    IStripeBillingGateway gateway,
    IBillingAuditWriter auditWriter,
    BillingSelfServeConfig config)
{
    private const string PortalOpenedAction = "billing.portal_opened";
    private const string CancelScheduledAction = "billing.subscription_cancel_scheduled";

    private readonly IBillingSelfServeRepository _repository = repository;
    private readonly IStripeBillingGateway _gateway = gateway;
    private readonly IBillingAuditWriter _auditWriter = auditWriter;
    private readonly BillingSelfServeConfig _config = config;

    /// <summary>Create a subscription-mode Checkout Session for a self-serve plan; returns its hosted URL.</summary>
    public async Task<string> CreateCheckoutSessionAsync(string organizationId, string plan, CancellationToken cancellationToken)
    {
        AssertConfigured();

        var priceId = _config.PlanToPriceId(plan);
        if (priceId is null)
        {
            throw BillingSelfServeException.PlanUnavailable();
        }

        var context = await _repository.GetOrgBillingContextAsync(organizationId, cancellationToken).ConfigureAwait(false);
        if (context is null)
        {
            throw BillingSelfServeException.OrgNotFound();
        }

        // An org with an existing billing relationship (live Stripe sub OR a paid local/manually-billed plan)
        // must change plans via the portal / sales — never start a SECOND subscription checkout (double bill).
        if (BillingSelfServeKernel.BlocksSelfServeCheckout(ToSelfServeSubscription(context.Subscription)))
        {
            throw BillingSelfServeException.CheckoutConflict();
        }

        var customerId = await EnsureCustomerAsync(context, cancellationToken).ConfigureAwait(false);
        var origin = _config.Origin;

        var url = await _gateway.CreateCheckoutSessionUrlAsync(
            new CheckoutSessionRequest(
                customerId,
                priceId,
                organizationId,
                $"{origin}/settings/billing?checkout=success",
                $"{origin}/settings/billing?checkout=cancelled",
                $"checkout:{organizationId}:{plan}"),
            cancellationToken).ConfigureAwait(false);

        if (string.IsNullOrEmpty(url))
        {
            throw BillingSelfServeException.CheckoutUrlMissing();
        }

        return url;
    }

    /// <summary>Open the Stripe Billing Portal for the org's customer; returns its URL. Audited (fail-soft).</summary>
    public async Task<string> CreatePortalSessionAsync(string organizationId, BillingAuditActor actor, CancellationToken cancellationToken)
    {
        AssertConfigured();

        var context = await _repository.GetOrgBillingContextAsync(organizationId, cancellationToken).ConfigureAwait(false);
        var customerId = context?.Subscription?.StripeCustomerId;
        if (string.IsNullOrEmpty(customerId))
        {
            throw BillingSelfServeException.NoStripeCustomer();
        }

        var url = await _gateway.CreatePortalSessionUrlAsync(
            customerId, $"{_config.Origin}/settings/billing", _config.PortalConfigurationId, cancellationToken).ConfigureAwait(false);

        await RecordAuditAsync(organizationId, actor, PortalOpenedAction, new JsonObject { ["customerId"] = customerId }, cancellationToken)
            .ConfigureAwait(false);
        return url;
    }

    /// <summary>Schedule the org's Stripe subscription to cancel at PERIOD END. No local state flip (the webhook syncs it). Audited (fail-soft).</summary>
    public async Task CancelSubscriptionAsync(string organizationId, BillingAuditActor actor, CancellationToken cancellationToken)
    {
        AssertConfigured();

        var context = await _repository.GetOrgBillingContextAsync(organizationId, cancellationToken).ConfigureAwait(false);
        var subscriptionId = context?.Subscription?.StripeSubscriptionId;
        if (string.IsNullOrEmpty(subscriptionId))
        {
            throw BillingSelfServeException.NoActiveSubscription();
        }

        await _gateway.ScheduleCancelAtPeriodEndAsync(subscriptionId, cancellationToken).ConfigureAwait(false);

        await RecordAuditAsync(
            organizationId,
            actor,
            CancelScheduledAction,
            new JsonObject { ["subscriptionId"] = subscriptionId, ["cancelAtPeriodEnd"] = true },
            cancellationToken).ConfigureAwait(false);
    }

    private void AssertConfigured()
    {
        if (!_config.IsConfigured)
        {
            throw BillingSelfServeException.NotConfigured();
        }
    }

    // Resolve (or lazily create) the org's Stripe Customer id. The idempotency key collapses concurrent creates;
    // the repository compare-and-set returns the authoritative id if another request won the race.
    private async Task<string> EnsureCustomerAsync(OrgBillingContext context, CancellationToken cancellationToken)
    {
        var existing = context.Subscription?.StripeCustomerId;
        if (!string.IsNullOrEmpty(existing))
        {
            return existing;
        }

        var customerId = await _gateway
            .CreateCustomerAsync(context.Id, context.Name, context.BillingEmail, cancellationToken)
            .ConfigureAwait(false);
        return await _repository
            .SetStripeCustomerIdIfAbsentAsync(context.Id, customerId, cancellationToken)
            .ConfigureAwait(false);
    }

    // Attribute to the real operator; carry the impersonated account in metadata (mirrors the TS recordAudit).
    private Task RecordAuditAsync(string organizationId, BillingAuditActor actor, string action, JsonObject metadata, CancellationToken cancellationToken)
    {
        if (actor.ImpersonatedUserId is not null)
        {
            metadata["impersonatedUserId"] = actor.ImpersonatedUserId;
        }

        return _auditWriter.WriteAsync(organizationId, actor.Id, action, metadata, cancellationToken);
    }

    private static SelfServeSubscription? ToSelfServeSubscription(OrgBillingSubscription? subscription) =>
        subscription is null
            ? null
            : new SelfServeSubscription
            {
                StripeSubscriptionId = subscription.StripeSubscriptionId,
                Status = subscription.Status,
                Plan = subscription.Plan,
            };
}
