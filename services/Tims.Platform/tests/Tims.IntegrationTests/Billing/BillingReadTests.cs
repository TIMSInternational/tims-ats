using System.Text.Json;
using Tims.Application.Billing;
using Tims.Infrastructure.Billing;

namespace Tims.IntegrationTests.Billing;

/// <summary>
/// Phase-5 Slice 3 Testcontainers proof (real RLS, NEVER mocked) of the billing invoice READ surface,
/// every read UNDER TenantScope (app_tenant + org GUC): tenant isolation (cross-org list empty /
/// getInvoice → NOT_FOUND), cursor pagination boundary incl. the tied-createdAt id tiebreak (walk both
/// pages + nextCursor), the list OMITS subscription while getInvoice INCLUDES it, and the full-shape
/// round-trip (money-Float + native-enum reads + nested subscription). Also proves the native Prisma enum
/// columns (InvoiceStatus/OrgPlan/SubscriptionStatus) read into C# strings.
/// </summary>
[Collection("BillingRead")]
public sealed class BillingReadTests(BillingReadFixture fixture)
{
    private static readonly JsonSerializerOptions WireOptions = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };

    private readonly BillingReadFixture _fixture = fixture;

    private BillingReadUseCase UseCase() =>
        new(new BillingReadRepository(_fixture.NewReadContext()));

    private static string Org(Guid id) => id.ToString();

    // ---- tenant isolation: OrgA sees only its four invoices, never OrgB's --------------------------
    [Fact]
    public async Task ListInvoices_returns_only_same_org_invoices()
    {
        var result = await UseCase().ListInvoicesAsync(Org(BillingReadFixture.OrgA), 25, null, CancellationToken.None);

        var ids = result.Items.Select(i => i.Id).ToHashSet();
        Assert.Equal(4, result.Items.Count);
        Assert.Contains(BillingReadFixture.InvoiceI1.ToString(), ids);
        Assert.DoesNotContain(BillingReadFixture.InvoiceB1.ToString(), ids);
    }

    [Fact]
    public async Task ListInvoices_other_org_sees_only_its_own_row()
    {
        var result = await UseCase().ListInvoicesAsync(Org(BillingReadFixture.OrgB), 25, null, CancellationToken.None);

        var item = Assert.Single(result.Items);
        Assert.Equal(BillingReadFixture.InvoiceB1.ToString(), item.Id);
    }

    // ---- list OMITS subscription (no include) even for an invoice that HAS a subscriptionId ---------
    [Fact]
    public async Task ListInvoices_items_omit_subscription()
    {
        var result = await UseCase().ListInvoicesAsync(Org(BillingReadFixture.OrgA), 25, null, CancellationToken.None);

        // The list item type structurally has NO subscription property; prove the serialized wire omits
        // the key too (TS listInvoices has no include).
        foreach (var item in result.Items)
        {
            var wire = JsonSerializer.SerializeToNode(item, WireOptions)!.AsObject();
            Assert.False(wire.ContainsKey("subscription"));
        }

        // i1 carries a non-null subscriptionId scalar, but the nested subscription is still omitted.
        var i1 = result.Items.Single(i => i.Id == BillingReadFixture.InvoiceI1.ToString());
        Assert.Equal(BillingReadFixture.SubscriptionA.ToString(), i1.SubscriptionId);
    }

    // ---- getInvoice INCLUDES the nested subscription + full-shape round-trip ------------------------
    [Fact]
    public async Task GetInvoice_includes_subscription_and_full_shape()
    {
        var v1 = await UseCase().GetInvoiceAsync(
            Org(BillingReadFixture.OrgA), BillingReadFixture.InvoiceI1.ToString(), CancellationToken.None);

        Assert.Equal(BillingReadFixture.InvoiceI1.ToString(), v1.Id);
        Assert.Equal(1001, v1.InvoiceNumber);
        Assert.Equal(1234.56, v1.Amount); // money-Float
        Assert.Equal(1234.5, v1.Subtotal);
        Assert.Equal(0.5, v1.TaxRate);
        Assert.Equal("paid", v1.Status); // native InvoiceStatus enum read as string
        Assert.Equal("billing@acme.test", v1.EmailTo);
        Assert.Equal(new DateTimeOffset(2026, 6, 10, 14, 22, 33, 456, TimeSpan.Zero), v1.PaidAt);

        Assert.NotNull(v1.Subscription);
        Assert.Equal(BillingReadFixture.SubscriptionA.ToString(), v1.Subscription!.Id);
        Assert.Equal("professional", v1.Subscription.Plan); // native OrgPlan enum
        Assert.Equal("active", v1.Subscription.Status); // native SubscriptionStatus enum
        Assert.Equal("cus_A", v1.Subscription.StripeCustomerId);
        Assert.Null(v1.Subscription.CancelledAt);
    }

    [Fact]
    public async Task GetInvoice_without_subscription_emits_null()
    {
        var v1 = await UseCase().GetInvoiceAsync(
            Org(BillingReadFixture.OrgA), BillingReadFixture.InvoiceI2.ToString(), CancellationToken.None);

        Assert.Null(v1.SubscriptionId);
        Assert.Null(v1.Subscription);
        Assert.Equal(100, v1.Amount);

        // getInvoice ALWAYS emits the subscription key (Prisma include:{subscription:true}) — null here,
        // never OMITTED. The detail wire distinguishes "no subscription" (key:null) from a list row (no key).
        var wire = JsonSerializer.SerializeToNode(v1, WireOptions)!.AsObject();
        Assert.True(wire.ContainsKey("subscription"));
        Assert.Null(wire["subscription"]);
    }

    // ---- tenant isolation: a cross-org id → NOT_FOUND (IDOR-safe) -----------------------------------
    [Fact]
    public async Task GetInvoice_cross_org_id_is_not_found()
    {
        await Assert.ThrowsAsync<BillingInvoiceNotFoundException>(() =>
            UseCase().GetInvoiceAsync(
                Org(BillingReadFixture.OrgA), BillingReadFixture.InvoiceB1.ToString(), CancellationToken.None));
    }

    [Fact]
    public async Task GetInvoice_unknown_id_is_not_found()
    {
        await Assert.ThrowsAsync<BillingInvoiceNotFoundException>(() =>
            UseCase().GetInvoiceAsync(
                Org(BillingReadFixture.OrgA), Guid.NewGuid().ToString(), CancellationToken.None));
    }

    // ---- cursor pagination boundary (createdAt desc, id asc tiebreak on the i3/i4 tie) -------------
    [Fact]
    public async Task ListInvoices_cursor_pagination_walks_the_ordered_boundary()
    {
        var page1 = await UseCase().ListInvoicesAsync(Org(BillingReadFixture.OrgA), 2, null, CancellationToken.None);
        Assert.Equal(
            new[] { BillingReadFixture.InvoiceI3.ToString(), BillingReadFixture.InvoiceI4.ToString() },
            page1.Items.Select(i => i.Id).ToArray());
        Assert.Equal(BillingReadFixture.InvoiceI4.ToString(), page1.NextCursor);

        var page2 = await UseCase().ListInvoicesAsync(Org(BillingReadFixture.OrgA), 2, page1.NextCursor, CancellationToken.None);
        Assert.Equal(
            new[] { BillingReadFixture.InvoiceI2.ToString(), BillingReadFixture.InvoiceI1.ToString() },
            page2.Items.Select(i => i.Id).ToArray());
        Assert.Null(page2.NextCursor); // last page
    }

    [Fact]
    public async Task ListInvoices_unknown_cursor_is_empty_page()
    {
        var result = await UseCase().ListInvoicesAsync(
            Org(BillingReadFixture.OrgA), 25, Guid.NewGuid().ToString(), CancellationToken.None);

        Assert.Empty(result.Items);
        Assert.Null(result.NextCursor);
    }
}
