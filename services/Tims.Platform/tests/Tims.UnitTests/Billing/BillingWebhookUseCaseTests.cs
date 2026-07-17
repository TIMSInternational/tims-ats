using Tims.Application.Billing;
using Tims.Domain.Billing;

namespace Tims.UnitTests.Billing;

/// <summary>
/// Pins the <see cref="BillingWebhookUseCase"/> orchestration (the glue above the pure kernel + the repo)
/// with fake gateway/repo/log — the regression-corpus invariants that live in the composition, not the
/// kernel: the duplicate → cancel-the-NEW-sub-at-Stripe double-bill guard, the <c>resource_missing</c>-ONLY
/// cancel swallow (everything else propagates → 500 → Stripe retries), AUTHORITATIVE org resolution
/// (subscription → customer → metadata precedence; a metadata mismatch is logged and NEVER followed), and
/// event dispatch. A faithful port of the TS <c>handleStripeWebhook</c>/<c>handleCheckoutCompleted</c> flow.
/// </summary>
public sealed class BillingWebhookUseCaseTests
{
    private static readonly StripeBillingEnv Env = new("price_starter", "price_pro");
    private static readonly DateTimeOffset EventAt = new(2021, 7, 1, 0, 0, 0, TimeSpan.Zero);

    // ── event builders ───────────────────────────────────────────────────────────────────────────────────
    private static StripeWebhookEvent CheckoutEvent(string? customerId, string? subscriptionId, string? metaOrgId) =>
        new("checkout.session.completed", EventAt, new StripeCheckoutData("cs_1", customerId, subscriptionId, metaOrgId), Subscription: null);

    private static StripeWebhookEvent SubscriptionEvent(
        string type, string subscriptionId, string? customerId, string? metaOrgId, string status = "active") =>
        new(type, EventAt, Checkout: null, new StripeSubscriptionSnapshot(Like(subscriptionId, status), customerId, metaOrgId));

    private static StripeSubscriptionSnapshot Snapshot(string subscriptionId, string? customerId, string status = "active") =>
        new(Like(subscriptionId, status), customerId, MetaOrgId: null);

    private static StripeSubscriptionLike Like(string id, string status) => new()
    {
        Id = id,
        Status = status,
        CancelAtPeriodEnd = false,
        CancelAt = null,
        CanceledAt = null,
        Items = new StripeSubscriptionItems
        {
            Data = [new StripeSubscriptionItem { Price = new StripePrice { Id = "price_pro" }, CurrentPeriodStart = 1609459200, CurrentPeriodEnd = 1612137600 }],
        },
    };

    private static BillingWebhookUseCase UseCase(FakeGateway gateway, FakeRepo repo, FakeLog? log = null) =>
        new(gateway, repo, Env, log ?? new FakeLog());

    // ── checkout: no subscription → link the customer only ───────────────────────────────────────────────
    [Fact]
    public async Task Checkout_without_subscription_links_customer_only()
    {
        var repo = new FakeRepo(); // no linkage → resolves via metadata
        var gateway = new FakeGateway(CheckoutEvent("cus_1", subscriptionId: null, metaOrgId: "org-1"));

        var result = await UseCase(gateway, repo).HandleAsync("body", "sig", CancellationToken.None);

        Assert.True(result.Handled);
        Assert.Equal(("org-1", "cus_1"), repo.LinkedCustomer);
        Assert.Null(repo.LastApply); // never applied a subscription
    }

    // ── checkout with subscription → retrieve + apply; applied ⇒ handled=true, no cancel ─────────────────
    [Fact]
    public async Task Checkout_with_subscription_applies_and_does_not_cancel()
    {
        var repo = new FakeRepo { OrgBySubscription = { ["sub_1"] = "org-1" }, ApplyResult = ApplyOutcome.Applied };
        var gateway = new FakeGateway(CheckoutEvent("cus_1", "sub_1", metaOrgId: null)) { RetrieveResult = Snapshot("sub_1", "cus_1") };

        var result = await UseCase(gateway, repo).HandleAsync("body", "sig", CancellationToken.None);

        Assert.True(result.Handled);
        Assert.Equal("sub_1", gateway.RetrievedSubscriptionId);
        Assert.Equal("org-1", repo.LastApply!.Value.OrgId);
        Assert.Equal("cus_1", repo.LastApply!.Value.CustomerId); // the SESSION customer id, per TS
        Assert.Null(gateway.CancelledSubscriptionId);
    }

    // ── DUPLICATE at checkout → cancel the NEW sub at Stripe (double-bill guard); handled=false ──────────
    [Fact]
    public async Task Checkout_duplicate_cancels_the_new_subscription_at_stripe()
    {
        var repo = new FakeRepo { OrgBySubscription = { ["sub_dup"] = "org-1" }, ApplyResult = ApplyOutcome.Duplicate };
        var gateway = new FakeGateway(CheckoutEvent("cus_1", "sub_dup", metaOrgId: null)) { RetrieveResult = Snapshot("sub_dup", "cus_1") };

        var result = await UseCase(gateway, repo).HandleAsync("body", "sig", CancellationToken.None);

        Assert.False(result.Handled); // only 'applied' is handled=true
        Assert.Equal("sub_dup", gateway.CancelledSubscriptionId); // the NEW duplicate cancelled at Stripe
    }

    // ── duplicate cancel throws resource_missing → SWALLOWED (already gone); no rethrow ──────────────────
    [Fact]
    public async Task Checkout_duplicate_swallows_resource_missing_on_cancel()
    {
        var repo = new FakeRepo { OrgBySubscription = { ["sub_dup"] = "org-1" }, ApplyResult = ApplyOutcome.Duplicate };
        var gateway = new FakeGateway(CheckoutEvent("cus_1", "sub_dup", metaOrgId: null))
        {
            RetrieveResult = Snapshot("sub_dup", "cus_1"),
            CancelThrows = new StripeResourceMissingException("gone"),
        };
        var log = new FakeLog();

        var result = await UseCase(gateway, repo, log).HandleAsync("body", "sig", CancellationToken.None);

        Assert.False(result.Handled); // returned normally despite the (swallowed) cancel error
        Assert.Equal(1, log.DuplicateAlreadyCancelledCount);
    }

    // ── duplicate cancel throws ANYTHING ELSE → propagates (→ 500 → Stripe retries the cancel) ───────────
    [Fact]
    public async Task Checkout_duplicate_propagates_non_resource_missing_cancel_error()
    {
        var repo = new FakeRepo { OrgBySubscription = { ["sub_dup"] = "org-1" }, ApplyResult = ApplyOutcome.Duplicate };
        var gateway = new FakeGateway(CheckoutEvent("cus_1", "sub_dup", metaOrgId: null))
        {
            RetrieveResult = Snapshot("sub_dup", "cus_1"),
            CancelThrows = new InvalidOperationException("stripe down"),
        };

        await Assert.ThrowsAsync<InvalidOperationException>(() =>
            UseCase(gateway, repo).HandleAsync("body", "sig", CancellationToken.None));
    }

    // ── subscription events dispatch (created/updated/deleted) → apply; a duplicate here does NOT cancel ──
    [Theory]
    [InlineData("customer.subscription.created")]
    [InlineData("customer.subscription.updated")]
    [InlineData("customer.subscription.deleted")]
    public async Task Subscription_event_dispatches_and_applies(string type)
    {
        var repo = new FakeRepo { OrgBySubscription = { ["sub_1"] = "org-1" }, ApplyResult = ApplyOutcome.Applied };
        var gateway = new FakeGateway(SubscriptionEvent(type, "sub_1", "cus_1", metaOrgId: null));

        var result = await UseCase(gateway, repo).HandleAsync("body", "sig", CancellationToken.None);

        Assert.True(result.Handled);
        Assert.Equal(type, result.Type);
        Assert.Equal("org-1", repo.LastApply!.Value.OrgId);
        Assert.Null(gateway.CancelledSubscriptionId); // subscription events never cancel-the-new
        Assert.Null(gateway.RetrievedSubscriptionId); // and never re-retrieve
    }

    [Fact]
    public async Task Subscription_event_duplicate_writes_nothing_and_does_not_cancel()
    {
        var repo = new FakeRepo { OrgBySubscription = { ["sub_1"] = "org-1" }, ApplyResult = ApplyOutcome.Duplicate };
        var gateway = new FakeGateway(SubscriptionEvent("customer.subscription.updated", "sub_1", "cus_1", null));

        var result = await UseCase(gateway, repo).HandleAsync("body", "sig", CancellationToken.None);

        Assert.False(result.Handled);
        Assert.Null(gateway.CancelledSubscriptionId);
    }

    // ── org resolution PRECEDENCE: subscription linkage wins over customer linkage ───────────────────────
    [Fact]
    public async Task Resolves_org_by_subscription_first()
    {
        var repo = new FakeRepo
        {
            OrgBySubscription = { ["sub_1"] = "org-by-sub" },
            OrgByCustomer = { ["cus_1"] = "org-by-cust" },
            ApplyResult = ApplyOutcome.Applied,
        };
        var gateway = new FakeGateway(SubscriptionEvent("customer.subscription.updated", "sub_1", "cus_1", null));

        await UseCase(gateway, repo).HandleAsync("body", "sig", CancellationToken.None);

        Assert.Equal("org-by-sub", repo.LastApply!.Value.OrgId); // subscription linkage, NOT customer
    }

    // ── org resolution: no subscription linkage → customer linkage ───────────────────────────────────────
    [Fact]
    public async Task Resolves_org_by_customer_when_no_subscription_linkage()
    {
        var repo = new FakeRepo { OrgByCustomer = { ["cus_1"] = "org-by-cust" }, ApplyResult = ApplyOutcome.Applied };
        var gateway = new FakeGateway(SubscriptionEvent("customer.subscription.updated", "sub_new", "cus_1", null));

        await UseCase(gateway, repo).HandleAsync("body", "sig", CancellationToken.None);

        Assert.Equal("org-by-cust", repo.LastApply!.Value.OrgId);
    }

    // ── metadata mismatch is LOGGED and NEVER FOLLOWED (the authoritative owner wins) ───────────────────
    [Fact]
    public async Task Metadata_mismatch_is_logged_and_never_followed()
    {
        var repo = new FakeRepo { OrgBySubscription = { ["sub_1"] = "org-owner" }, ApplyResult = ApplyOutcome.Applied };
        var gateway = new FakeGateway(SubscriptionEvent("customer.subscription.updated", "sub_1", "cus_1", metaOrgId: "org-attacker"));
        var log = new FakeLog();

        await UseCase(gateway, repo, log).HandleAsync("body", "sig", CancellationToken.None);

        Assert.Equal("org-owner", repo.LastApply!.Value.OrgId); // NEVER the metadata org
        Assert.Equal(("subscription", "org-attacker", "org-owner"), log.LastMismatch);
    }

    // ── unresolved org (no linkage, no metadata) → skipped, handled=false, nothing written ──────────────
    [Fact]
    public async Task Checkout_unresolved_org_is_skipped()
    {
        var repo = new FakeRepo(); // no linkage
        var gateway = new FakeGateway(CheckoutEvent("cus_x", "sub_x", metaOrgId: null));

        var result = await UseCase(gateway, repo).HandleAsync("body", "sig", CancellationToken.None);

        Assert.False(result.Handled);
        Assert.Null(repo.LastApply);
        Assert.Null(repo.LinkedCustomer);
        Assert.Null(gateway.RetrievedSubscriptionId);
    }

    [Fact]
    public async Task Subscription_event_unresolved_org_is_skipped()
    {
        var repo = new FakeRepo();
        var gateway = new FakeGateway(SubscriptionEvent("customer.subscription.deleted", "sub_x", "cus_x", null));

        var result = await UseCase(gateway, repo).HandleAsync("body", "sig", CancellationToken.None);

        Assert.False(result.Handled);
        Assert.Null(repo.LastApply);
    }

    // ── unhandled event type → handled=false, no repo/gateway work ──────────────────────────────────────
    [Fact]
    public async Task Unhandled_event_type_is_a_no_op()
    {
        var repo = new FakeRepo();
        var gateway = new FakeGateway(new StripeWebhookEvent("invoice.paid", EventAt, Checkout: null, Subscription: null));

        var result = await UseCase(gateway, repo).HandleAsync("body", "sig", CancellationToken.None);

        Assert.False(result.Handled);
        Assert.Equal("invoice.paid", result.Type);
        Assert.Null(repo.LastApply);
    }

    // ── verification failure propagates (the endpoint turns it into 400) ────────────────────────────────
    [Fact]
    public async Task Verification_failure_propagates()
    {
        var repo = new FakeRepo();
        var gateway = new FakeGateway(evt: null) { ConstructThrows = new WebhookVerificationException("bad sig") };

        await Assert.ThrowsAsync<WebhookVerificationException>(() =>
            UseCase(gateway, repo).HandleAsync("body", "sig", CancellationToken.None));
    }

    // ── fakes ────────────────────────────────────────────────────────────────────────────────────────────
    private sealed class FakeGateway(StripeWebhookEvent? evt) : IStripeWebhookGateway
    {
        public StripeSubscriptionSnapshot? RetrieveResult { get; init; }
        public Exception? CancelThrows { get; init; }
        public Exception? ConstructThrows { get; init; }
        public string? RetrievedSubscriptionId { get; private set; }
        public string? CancelledSubscriptionId { get; private set; }

        public StripeWebhookEvent ConstructEvent(string rawBody, string? signature) =>
            ConstructThrows is not null ? throw ConstructThrows : evt!;

        public Task<StripeSubscriptionSnapshot> RetrieveSubscriptionAsync(string subscriptionId, CancellationToken cancellationToken)
        {
            RetrievedSubscriptionId = subscriptionId;
            return Task.FromResult(RetrieveResult!);
        }

        public Task CancelSubscriptionAsync(string subscriptionId, CancellationToken cancellationToken)
        {
            CancelledSubscriptionId = subscriptionId;
            return CancelThrows is not null ? Task.FromException(CancelThrows) : Task.CompletedTask;
        }
    }

    private sealed class FakeRepo : IBillingWebhookRepository
    {
        public Dictionary<string, string> OrgBySubscription { get; } = [];
        public Dictionary<string, string> OrgByCustomer { get; } = [];
        public ApplyOutcome ApplyResult { get; init; } = ApplyOutcome.Applied;
        public (string OrgId, string? CustomerId, string SubscriptionId)? LastApply { get; private set; }
        public (string OrgId, string CustomerId)? LinkedCustomer { get; private set; }

        public Task<string?> FindOrgIdBySubscriptionAsync(string stripeSubscriptionId, CancellationToken cancellationToken) =>
            Task.FromResult(OrgBySubscription.GetValueOrDefault(stripeSubscriptionId));

        public Task<string?> FindOrgIdByCustomerAsync(string stripeCustomerId, CancellationToken cancellationToken) =>
            Task.FromResult(OrgByCustomer.GetValueOrDefault(stripeCustomerId));

        public Task<ApplyOutcome> ApplySubscriptionAsync(
            string organizationId, string? stripeCustomerId, SubscriptionSyncFields fields, DateTimeOffset eventAt, CancellationToken cancellationToken)
        {
            LastApply = (organizationId, stripeCustomerId, fields.StripeSubscriptionId);
            return Task.FromResult(ApplyResult);
        }

        public Task LinkCustomerAsync(string organizationId, string stripeCustomerId, CancellationToken cancellationToken)
        {
            LinkedCustomer = (organizationId, stripeCustomerId);
            return Task.CompletedTask;
        }
    }

    private sealed class FakeLog : IBillingWebhookLog
    {
        public (string By, string MetaOrgId, string Owner)? LastMismatch { get; private set; }
        public int DuplicateAlreadyCancelledCount { get; private set; }

        public void MetadataOrgMismatch(string by, string metaOrgId, string owner) => LastMismatch = (by, metaOrgId, owner);

        public void UnresolvedOrg(string context, string reference)
        {
        }

        public void CancellingDuplicate(string orgId, string duplicateId)
        {
        }

        public void DuplicateAlreadyCancelled(string orgId, string duplicateId) => DuplicateAlreadyCancelledCount++;

        public void EventNotApplied(string orgId, string incoming, string outcome)
        {
        }
    }
}
