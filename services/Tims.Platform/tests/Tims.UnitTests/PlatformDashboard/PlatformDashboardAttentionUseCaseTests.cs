using System.Text.Json;
using Tims.Application.PlatformDashboard;

namespace Tims.UnitTests.PlatformDashboard;

/// <summary>
/// Unit coverage for <c>buildAttentionItems</c> (Phase-5 slice 23 / issue #81, PR 2 of 3) — the five-source
/// merge, its severity/urgency ordering, the exact Spanish description strings, and the per-item-type JSON
/// key sets the custom converter exists to reproduce.
/// </summary>
public sealed class PlatformDashboardAttentionUseCaseTests
{
    private static readonly DateTime Now = new(2026, 8, 14, 12, 0, 0, DateTimeKind.Utc);

    /// <summary>The wire shape, serialised the way the minimal-API pipeline serialises it.</summary>
    private static readonly JsonSerializerOptions Web = new(JsonSerializerDefaults.Web);

    private static JsonElement Serialize(AttentionItem item) =>
        JsonDocument.Parse(JsonSerializer.Serialize(item, Web)).RootElement;

    // ── the five item shapes, string for string ─────────────────────────────────────────────────────
    [Fact]
    public void OverdueInvoice_carries_the_locale_formatted_amount_and_a_negative_daysUntil()
    {
        var items = PlatformDashboardAttentionUseCase.BuildAttentionItems(
            Now,
            [new OverdueInvoiceRow("inv-1", 1234.5, "USD", Now.AddDays(-3), "org-1", "Acme Corp")],
            [], [], [], []);

        var item = Assert.Single(items);
        Assert.Equal("overdue_invoice", item.Type);
        Assert.Equal("critical", item.Severity);
        Assert.Equal("Factura vencida - Acme Corp", item.Title);
        // The grouping separator is the whole point: a bare ToString() would emit "1234.5".
        Assert.Equal("$1,234.5 USD vencida hace 3 dias", item.Description);
        Assert.Equal("/platform/invoices?org=org-1", item.ActionUrl);
        Assert.Equal("Ver factura", item.ActionLabel);
        Assert.Equal(1234.5, item.Amount);
        Assert.Equal("USD", item.Currency);
        Assert.Equal(-3, item.DaysUntil); // negated, so overdue sorts ahead of expiring
    }

    [Fact]
    public void OverdueInvoice_withNoDueDate_reports_zero_days()
    {
        var items = PlatformDashboardAttentionUseCase.BuildAttentionItems(
            Now,
            [new OverdueInvoiceRow("inv-1", 100, "COP", null, "org-1", "Acme Corp")],
            [], [], [], []);

        // `inv.dueDate ? … : 0` — the guard the column's nullability requires even though the query
        // filters on it.
        Assert.Equal("$100 COP vencida hace 0 dias", items[0].Description);
        Assert.Equal(0, items[0].DaysUntil);
    }

    [Theory]
    [InlineData(1, "El periodo de prueba expira en 1 dia")]
    [InlineData(2, "El periodo de prueba expira en 2 dias")]
    [InlineData(0, "El periodo de prueba expira en 0 dias")]
    public void ExpiringTrial_pluralises_on_anything_but_exactly_one(int daysLeft, string expected)
    {
        // Math.ceil means "ends in n days minus a minute" still reads as n; seed exactly n whole days
        // minus nothing so ceil is the identity.
        var items = PlatformDashboardAttentionUseCase.BuildAttentionItems(
            Now,
            [],
            [new ExpiringTrialRow("sub-1", Now.AddDays(daysLeft), "org-1", "Globex")],
            [], [], []);

        Assert.Equal(expected, items[0].Description);
        Assert.Equal(daysLeft, items[0].DaysUntil);
    }

    [Fact]
    public void ExpiringTrial_rounds_a_partial_day_UP()
    {
        var items = PlatformDashboardAttentionUseCase.BuildAttentionItems(
            Now,
            [],
            [new ExpiringTrialRow("sub-1", Now.AddHours(12), "org-1", "Globex")],
            [], [], []);

        // Math.ceil, not floor: half a day left is "1 dia", never "0 dias".
        Assert.Equal("El periodo de prueba expira en 1 dia", items[0].Description);
    }

    [Fact]
    public void FailedPayment_uses_the_plan_price_with_no_grouping_separator_and_a_hardcoded_USD()
    {
        var items = PlatformDashboardAttentionUseCase.BuildAttentionItems(
            Now, [], [],
            [new PastDueSubscriptionRow("sub-9", "enterprise", "org-3", "Initech")],
            [], []);

        var item = Assert.Single(items);
        // 2499 — a bare `${price}` interpolation, NOT toLocaleString, so NO comma. The two number
        // formats live four lines apart in the TS helper and this is the assertion that keeps them apart.
        Assert.Equal("Suscripcion enterprise con pago pendiente ($2499/mes)", item.Description);
        Assert.Equal("Pago fallido - Initech", item.Title);
        Assert.Equal(2499, item.Amount);
        Assert.Equal("USD", item.Currency);
        Assert.Null(item.DaysUntil);
    }

    [Fact]
    public void FailedPayment_onAnUnknownPlan_prices_at_zero()
    {
        var items = PlatformDashboardAttentionUseCase.BuildAttentionItems(
            Now, [], [],
            [new PastDueSubscriptionRow("sub-9", "legacy", "org-3", "Initech")],
            [], []);

        // `PLAN_PRICES[plan] || 0` — reproduced rather than throwing on an unmapped plan.
        Assert.Equal("Suscripcion legacy con pago pendiente ($0/mes)", items[0].Description);
        Assert.Equal(0d, items[0].Amount);
    }

    [Fact]
    public void PendingInvitation_appends_the_org_clause_only_when_there_is_an_org()
    {
        var items = PlatformDashboardAttentionUseCase.BuildAttentionItems(
            Now, [], [], [],
            [
                new StaleInvitationRow("i-1", "a@x.test", Now.AddDays(-9), "org-1", "Acme Corp"),
                new StaleInvitationRow("i-2", "b@x.test", Now.AddDays(-6), null, null),
            ],
            []);

        Assert.Equal("Invitacion sin aceptar - a@x.test", items[0].Title);
        Assert.Equal("Enviada hace 9 dias para Acme Corp", items[0].Description);
        // No organization ⇒ the trailing clause vanishes entirely, and the org fields are null.
        Assert.Equal("Enviada hace 6 dias", items[1].Description);
        Assert.Null(items[1].OrgId);
        Assert.Null(items[1].OrgName);
    }

    [Fact]
    public void SuspendedOrg_is_a_fixed_sentence_with_no_numbers()
    {
        var items = PlatformDashboardAttentionUseCase.BuildAttentionItems(
            Now, [], [], [], [],
            [new SuspendedOrgRow("org-7", "Wayne Enterprises")]);

        var item = Assert.Single(items);
        Assert.Equal("Organizacion suspendida - Wayne Enterprises", item.Title);
        Assert.Equal("La organizacion esta desactivada y sus usuarios no pueden acceder", item.Description);
        Assert.Equal("/platform/organizations/org-7", item.ActionUrl);
        Assert.Equal("Revisar", item.ActionLabel);
        Assert.Equal("warning", item.Severity);
    }

    // ── ordering ────────────────────────────────────────────────────────────────────────────────────
    [Fact]
    public void Items_sort_by_severity_then_by_daysUntil_ascending()
    {
        var items = PlatformDashboardAttentionUseCase.BuildAttentionItems(
            Now,
            [new OverdueInvoiceRow("inv-old", 10, "USD", Now.AddDays(-30), "o", "O")],   // critical, -30
            [new ExpiringTrialRow("trial-2", Now.AddDays(2), "o", "O")],                  // warning, +2
            [new PastDueSubscriptionRow("pay-1", "starter", "o", "O")],                   // critical, null→0
            [new StaleInvitationRow("inv-8", "a@x.test", Now.AddDays(-8), null, null)],   // info
            [new SuspendedOrgRow("org-s", "S")]);                                         // warning, null→0

        Assert.Equal(["inv-old", "pay-1", "org-s", "trial-2", "inv-8"], items.Select(i => i.Id));
        // The middle pair proves the `daysUntil ?? 0` rule: a suspended org (no key) sorts BEFORE a trial
        // expiring in 2 days, because a missing urgency reads as 0, not as "last".
    }

    [Fact]
    public void Items_tying_on_severity_and_urgency_keep_SOURCE_order()
    {
        // Both critical, both urgency 0 — so only the append order (invoices before past-due) decides.
        var items = PlatformDashboardAttentionUseCase.BuildAttentionItems(
            Now,
            [new OverdueInvoiceRow("inv-today", 10, "USD", Now, "o", "O")],
            [],
            [new PastDueSubscriptionRow("pay-1", "starter", "o", "O")],
            [], []);

        Assert.Equal(["inv-today", "pay-1"], items.Select(i => i.Id));
    }

    [Fact]
    public void Empty_sources_yield_an_empty_list()
    {
        Assert.Empty(PlatformDashboardAttentionUseCase.BuildAttentionItems(Now, [], [], [], [], []));
    }

    [Fact]
    public void The_merged_list_is_NOT_capped_unlike_recent_activity()
    {
        // Each source caps at 20, but there is no final slice — 5 × 20 = 100 items is a legal response.
        var overdue = Enumerable.Range(0, 20)
            .Select(i => new OverdueInvoiceRow($"i{i}", 1, "USD", Now.AddDays(-i), "o", "O"))
            .ToList();
        var suspended = Enumerable.Range(0, 20).Select(i => new SuspendedOrgRow($"s{i}", "S")).ToList();

        Assert.Equal(40, PlatformDashboardAttentionUseCase.BuildAttentionItems(Now, overdue, [], [], [], suspended).Count);
    }

    // ── the wire key sets, which are per-TYPE and cannot be expressed as a single nullable record ────
    [Fact]
    public void OverdueInvoice_serialises_all_twelve_keys()
    {
        var json = Serialize(PlatformDashboardAttentionUseCase.BuildAttentionItems(
            Now,
            [new OverdueInvoiceRow("inv-1", 1234.5, "USD", Now.AddDays(-3), "org-1", "Acme")],
            [], [], [], [])[0]);

        Assert.Equal(12, json.EnumerateObject().Count());
        Assert.Equal(1234.5, json.GetProperty("amount").GetDouble());
        Assert.Equal(-3, json.GetProperty("daysUntil").GetInt32());
    }

    [Fact]
    public void ExpiringTrial_omits_amount_and_currency_ENTIRELY()
    {
        var json = Serialize(PlatformDashboardAttentionUseCase.BuildAttentionItems(
            Now, [],
            [new ExpiringTrialRow("sub-1", Now.AddDays(3), "org-1", "Globex")],
            [], [], [])[0]);

        // The TS object literal for this branch has no `amount` key at all. Emitting `amount: null` would
        // diff against the TS payload just as surely as emitting a wrong number.
        Assert.False(json.TryGetProperty("amount", out _));
        Assert.False(json.TryGetProperty("currency", out _));
        Assert.True(json.TryGetProperty("daysUntil", out _));
        Assert.Equal(10, json.EnumerateObject().Count());
    }

    [Fact]
    public void FailedPayment_omits_daysUntil_ENTIRELY()
    {
        var json = Serialize(PlatformDashboardAttentionUseCase.BuildAttentionItems(
            Now, [], [],
            [new PastDueSubscriptionRow("sub-9", "starter", "org-3", "Initech")],
            [], [])[0]);

        Assert.False(json.TryGetProperty("daysUntil", out _));
        Assert.True(json.TryGetProperty("amount", out _));
        Assert.Equal(11, json.EnumerateObject().Count());
    }

    [Fact]
    public void PendingInvitation_withNoOrg_emits_orgId_and_orgName_as_explicit_NULLS()
    {
        var json = Serialize(PlatformDashboardAttentionUseCase.BuildAttentionItems(
            Now, [], [], [],
            [new StaleInvitationRow("i-2", "b@x.test", Now.AddDays(-6), null, null)],
            [])[0]);

        // NOT omitted. `orgId: inv.organization?.id` is a WRITTEN key whose value is undefined, and
        // superjson renders a written-undefined as null in the `json` payload the parity harness reads.
        // This is the one assertion that would fail under a [JsonIgnore(WhenWritingNull)] model.
        Assert.True(json.TryGetProperty("orgId", out var orgId));
        Assert.Equal(JsonValueKind.Null, orgId.ValueKind);
        Assert.Equal(JsonValueKind.Null, json.GetProperty("orgName").ValueKind);
        Assert.Equal(9, json.EnumerateObject().Count());
    }

    [Fact]
    public void SuspendedOrg_emits_nine_keys_with_no_money_and_no_days()
    {
        var json = Serialize(PlatformDashboardAttentionUseCase.BuildAttentionItems(
            Now, [], [], [], [],
            [new SuspendedOrgRow("org-7", "Wayne")])[0]);

        Assert.Equal(9, json.EnumerateObject().Count());
        Assert.False(json.TryGetProperty("amount", out _));
        Assert.False(json.TryGetProperty("daysUntil", out _));
        Assert.Equal("org-7", json.GetProperty("orgId").GetString());
    }
}
