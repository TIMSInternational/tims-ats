using System.Text.Json.Nodes;
using Tims.Application.Billing;

namespace Tims.UnitTests.Billing;

/// <summary>
/// Pins the <see cref="BillingSelfServeUseCase"/> orchestration with fake repo/gateway/audit — the invariants
/// that live in the composition (not the pure kernel): fail-closed config gate (no network on an unconfigured
/// deploy), the double-billing CONFLICT, ensureCustomer create-vs-reuse + the compare-and-set customer id, the
/// error mapping (412/404/409/500), the period-end cancel with NO local flip, checkout is NOT audited while
/// portal/cancel ARE (fail-soft), and impersonation attribution (real operator + impersonated in metadata).
/// </summary>
public sealed class BillingSelfServeUseCaseTests
{
    private static readonly BillingSelfServeConfig Configured =
        new("sk_test", "price_starter", "price_pro", "https://app.example/", "portal_cfg");

    private static readonly BillingSelfServeConfig Unconfigured =
        new(SecretKey: null, PriceStarter: null, PriceProfessional: null, "https://app.example", PortalConfigurationId: null);

    private const string Org = "11111111-1111-1111-1111-111111111111";

    private static OrgBillingContext Context(OrgBillingSubscription? subscription) =>
        new(Org, "Acme", "billing@acme.example", subscription);

    private static OrgBillingSubscription Subscription(string? customerId, string? subscriptionId, string status = "active", string plan = "professional") =>
        new("sub-row-id", customerId, subscriptionId, plan, status);

    private static BillingSelfServeUseCase UseCase(FakeRepo repo, FakeGateway gateway, FakeAudit audit, BillingSelfServeConfig? config = null) =>
        new(repo, gateway, audit, config ?? Configured);

    // ── fail-closed config gate: unconfigured → 412 BEFORE any network/DB ─────────────────────────────────
    [Fact]
    public async Task Checkout_unconfigured_throws_412_and_touches_nothing()
    {
        var repo = new FakeRepo();
        var gateway = new FakeGateway();

        var ex = await Assert.ThrowsAsync<BillingSelfServeException>(() =>
            UseCase(repo, gateway, new FakeAudit(), Unconfigured).CreateCheckoutSessionAsync(Org, "professional", CancellationToken.None));

        Assert.Equal(412, ex.StatusCode);
        Assert.False(repo.ContextRequested); // never reached the DB
        Assert.Null(gateway.CreatedCustomerOrg); // never reached Stripe
    }

    // ── unknown plan → 412 ────────────────────────────────────────────────────────────────────────────────
    [Fact]
    public async Task Checkout_unknown_plan_throws_412()
    {
        var ex = await Assert.ThrowsAsync<BillingSelfServeException>(() =>
            UseCase(new FakeRepo(), new FakeGateway(), new FakeAudit()).CreateCheckoutSessionAsync(Org, "enterprise", CancellationToken.None));
        Assert.Equal(412, ex.StatusCode);
    }

    // ── org not found → 404 ───────────────────────────────────────────────────────────────────────────────
    [Fact]
    public async Task Checkout_org_not_found_throws_404()
    {
        var repo = new FakeRepo { OrgContext = null };
        var ex = await Assert.ThrowsAsync<BillingSelfServeException>(() =>
            UseCase(repo, new FakeGateway(), new FakeAudit()).CreateCheckoutSessionAsync(Org, "professional", CancellationToken.None));
        Assert.Equal(404, ex.StatusCode);
    }

    // ── an existing live billing relationship BLOCKS a second checkout → 409, no customer/checkout ─────────
    [Fact]
    public async Task Checkout_blocked_by_existing_subscription_throws_409()
    {
        var repo = new FakeRepo { OrgContext = Context(Subscription("cus_1", "sub_1")) }; // live sub
        var gateway = new FakeGateway();

        var ex = await Assert.ThrowsAsync<BillingSelfServeException>(() =>
            UseCase(repo, gateway, new FakeAudit()).CreateCheckoutSessionAsync(Org, "professional", CancellationToken.None));

        Assert.Equal(409, ex.StatusCode);
        Assert.Null(gateway.CreatedCustomerOrg); // never created a customer / checkout
        Assert.Null(gateway.CheckoutRequest);
    }

    // ── happy checkout, NO existing customer: create + CAS + checkout url; uses the CAS-returned id ────────
    [Fact]
    public async Task Checkout_creates_customer_then_returns_url()
    {
        var repo = new FakeRepo
        {
            OrgContext = Context(Subscription(customerId: null, subscriptionId: null, status: "trialing", plan: "trial")),
            CasResult = "cus_authoritative",
        };
        var gateway = new FakeGateway { CheckoutUrl = "https://stripe/checkout" };

        var url = await UseCase(repo, gateway, new FakeAudit()).CreateCheckoutSessionAsync(Org, "professional", CancellationToken.None);

        Assert.Equal("https://stripe/checkout", url);
        Assert.Equal(Org, gateway.CreatedCustomerOrg); // a customer was created
        Assert.Equal("cus_authoritative", repo.CasStoredCustomerId is null ? null : "cus_authoritative"); // CAS ran
        Assert.Equal("cus_authoritative", gateway.CheckoutRequest!.CustomerId); // checkout uses the AUTHORITATIVE id
        Assert.Equal("price_pro", gateway.CheckoutRequest.PriceId);
        Assert.Equal("checkout:11111111-1111-1111-1111-111111111111:professional", gateway.CheckoutRequest.IdempotencyKey);
    }

    // ── happy checkout, existing customer: reuse it (no create) ───────────────────────────────────────────
    [Fact]
    public async Task Checkout_reuses_existing_customer()
    {
        var repo = new FakeRepo { OrgContext = Context(Subscription("cus_existing", subscriptionId: null, status: "cancelled", plan: "starter")) };
        var gateway = new FakeGateway { CheckoutUrl = "https://stripe/checkout" };

        await UseCase(repo, gateway, new FakeAudit()).CreateCheckoutSessionAsync(Org, "starter", CancellationToken.None);

        Assert.Null(gateway.CreatedCustomerOrg); // no customer created
        Assert.Equal("cus_existing", gateway.CheckoutRequest!.CustomerId);
    }

    // ── checkout returns no URL → 500 ─────────────────────────────────────────────────────────────────────
    [Fact]
    public async Task Checkout_missing_url_throws_500()
    {
        var repo = new FakeRepo { OrgContext = Context(Subscription("cus_1", subscriptionId: null, status: "trialing", plan: "trial")) };
        var gateway = new FakeGateway { CheckoutUrl = null };

        var ex = await Assert.ThrowsAsync<BillingSelfServeException>(() =>
            UseCase(repo, gateway, new FakeAudit()).CreateCheckoutSessionAsync(Org, "professional", CancellationToken.None));
        Assert.Equal(500, ex.StatusCode);
    }

    // ── checkout is NOT audited (parity with the TS) ──────────────────────────────────────────────────────
    [Fact]
    public async Task Checkout_does_not_write_an_audit_row()
    {
        var repo = new FakeRepo { OrgContext = Context(Subscription("cus_1", subscriptionId: null, status: "trialing", plan: "trial")) };
        var audit = new FakeAudit();

        await UseCase(repo, new FakeGateway { CheckoutUrl = "u" }, audit).CreateCheckoutSessionAsync(Org, "professional", CancellationToken.None);

        Assert.Empty(audit.Writes);
    }

    // ── portal: no customer → 412 ─────────────────────────────────────────────────────────────────────────
    [Fact]
    public async Task Portal_without_customer_throws_412()
    {
        var repo = new FakeRepo { OrgContext = Context(Subscription(customerId: null, subscriptionId: null)) };
        var ex = await Assert.ThrowsAsync<BillingSelfServeException>(() =>
            UseCase(repo, new FakeGateway(), new FakeAudit()).CreatePortalSessionAsync(Org, new BillingAuditActor("u1", null), CancellationToken.None));
        Assert.Equal(412, ex.StatusCode);
    }

    // ── portal happy: url + a fail-soft audit row (billing.portal_opened { customerId }) ──────────────────
    [Fact]
    public async Task Portal_returns_url_and_audits()
    {
        var repo = new FakeRepo { OrgContext = Context(Subscription("cus_p", "sub_p")) };
        var gateway = new FakeGateway { PortalUrl = "https://stripe/portal" };
        var audit = new FakeAudit();

        var url = await UseCase(repo, gateway, audit).CreatePortalSessionAsync(Org, new BillingAuditActor("u1", null), CancellationToken.None);

        Assert.Equal("https://stripe/portal", url);
        Assert.Equal(("cus_p", "https://app.example/settings/billing", "portal_cfg"), gateway.PortalRequest);
        var write = Assert.Single(audit.Writes);
        Assert.Equal(("11111111-1111-1111-1111-111111111111", "u1", "billing.portal_opened"), (write.Org, write.Actor, write.Action));
        Assert.Equal("cus_p", write.Metadata["customerId"]!.GetValue<string>());
    }

    // ── cancel: no subscription → 412 ─────────────────────────────────────────────────────────────────────
    [Fact]
    public async Task Cancel_without_subscription_throws_412()
    {
        var repo = new FakeRepo { OrgContext = Context(Subscription("cus_1", subscriptionId: null)) };
        var ex = await Assert.ThrowsAsync<BillingSelfServeException>(() =>
            UseCase(repo, new FakeGateway(), new FakeAudit()).CancelSubscriptionAsync(Org, new BillingAuditActor("u1", null), CancellationToken.None));
        Assert.Equal(412, ex.StatusCode);
    }

    // ── cancel happy: schedules period-end at Stripe (no local flip) + audits ─────────────────────────────
    [Fact]
    public async Task Cancel_schedules_period_end_and_audits()
    {
        var repo = new FakeRepo { OrgContext = Context(Subscription("cus_c", "sub_c")) };
        var gateway = new FakeGateway();
        var audit = new FakeAudit();

        await UseCase(repo, gateway, audit).CancelSubscriptionAsync(Org, new BillingAuditActor("u1", null), CancellationToken.None);

        Assert.Equal("sub_c", gateway.CancelledSubscriptionId); // scheduled at Stripe
        var write = Assert.Single(audit.Writes);
        Assert.Equal("billing.subscription_cancel_scheduled", write.Action);
        Assert.Equal("sub_c", write.Metadata["subscriptionId"]!.GetValue<string>());
        Assert.True(write.Metadata["cancelAtPeriodEnd"]!.GetValue<bool>());
    }

    // ── impersonation: attributed to the real operator; the impersonated account is carried in metadata ───
    [Fact]
    public async Task Impersonation_attributes_to_operator_and_records_target_in_metadata()
    {
        var repo = new FakeRepo { OrgContext = Context(Subscription("cus_i", "sub_i")) };
        var audit = new FakeAudit();

        await UseCase(repo, new FakeGateway { PortalUrl = "u" }, audit)
            .CreatePortalSessionAsync(Org, new BillingAuditActor("operator-real", "target-impersonated"), CancellationToken.None);

        var write = Assert.Single(audit.Writes);
        Assert.Equal("operator-real", write.Actor); // the real operator
        Assert.Equal("target-impersonated", write.Metadata["impersonatedUserId"]!.GetValue<string>());
    }

    // ── fakes ────────────────────────────────────────────────────────────────────────────────────────────
    private sealed class FakeRepo : IBillingSelfServeRepository
    {
        public OrgBillingContext? OrgContext { get; init; } = new(Org, "Acme", "billing@acme.example", null);
        public string CasResult { get; init; } = "cus_default";
        public bool ContextRequested { get; private set; }
        public string? CasStoredCustomerId { get; private set; }

        public Task<OrgBillingContext?> GetOrgBillingContextAsync(string organizationId, CancellationToken cancellationToken)
        {
            ContextRequested = true;
            return Task.FromResult(OrgContext);
        }

        public Task<string> SetStripeCustomerIdIfAbsentAsync(string organizationId, string stripeCustomerId, CancellationToken cancellationToken)
        {
            CasStoredCustomerId = stripeCustomerId;
            return Task.FromResult(CasResult);
        }
    }

    private sealed class FakeGateway : IStripeBillingGateway
    {
        public string? CheckoutUrl { get; init; }
        public string PortalUrl { get; init; } = "https://stripe/portal";
        public string? CreatedCustomerOrg { get; private set; }
        public CheckoutSessionRequest? CheckoutRequest { get; private set; }
        public (string Customer, string ReturnUrl, string? Config)? PortalRequest { get; private set; }
        public string? CancelledSubscriptionId { get; private set; }

        public Task<string> CreateCustomerAsync(string organizationId, string name, string? email, CancellationToken cancellationToken)
        {
            CreatedCustomerOrg = organizationId;
            return Task.FromResult("cus_created");
        }

        public Task<string?> CreateCheckoutSessionUrlAsync(CheckoutSessionRequest request, CancellationToken cancellationToken)
        {
            CheckoutRequest = request;
            return Task.FromResult(CheckoutUrl);
        }

        public Task<string> CreatePortalSessionUrlAsync(string customerId, string returnUrl, string? configurationId, CancellationToken cancellationToken)
        {
            PortalRequest = (customerId, returnUrl, configurationId);
            return Task.FromResult(PortalUrl);
        }

        public Task ScheduleCancelAtPeriodEndAsync(string subscriptionId, CancellationToken cancellationToken)
        {
            CancelledSubscriptionId = subscriptionId;
            return Task.CompletedTask;
        }
    }

    private sealed class FakeAudit : IBillingAuditWriter
    {
        public List<(string Org, string Actor, string Action, JsonObject Metadata)> Writes { get; } = [];

        public Task WriteAsync(string organizationId, string actorId, string action, JsonObject metadata, CancellationToken cancellationToken)
        {
            Writes.Add((organizationId, actorId, action, metadata));
            return Task.CompletedTask;
        }
    }
}
