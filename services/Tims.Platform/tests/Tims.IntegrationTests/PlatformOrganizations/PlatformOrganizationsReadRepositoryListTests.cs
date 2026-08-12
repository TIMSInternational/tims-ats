using Tims.Application.PlatformOrganizations;

namespace Tims.IntegrationTests.PlatformOrganizations;

/// <summary>
/// <see cref="PlatformOrganizationsReadRepository.ListAsync"/> projection guards — issue <b>#211</b>.
///
/// <para><b>These exist because two #211 changes shipped with no guard at all.</b> Verified by mutation
/// on 2026-08-11: replacing the <c>users</c> empty-array branch with <c>null</c>, and separately deleting
/// the pending-invoice <c>OrderBy</c>, each left the FULL 998-unit / 1241-integration suite green. Both
/// are decisions the repository takes while projecting, so
/// <c>PlatformOrganizationsReadModelsSerializationTests</c> structurally cannot reach them — it builds
/// the read models by hand and therefore supplies the exact values under test.</para>
///
/// <para><b>Why these two properties are worth a container.</b> The parity harness compares payloads
/// literally: <c>scripts/parity/normalize.ts</c> is deliberately NOT given <c>sortArraysBy</c> on this
/// surface (it applies at every array depth and would sort the top-level <c>organizations[]</c>, retiring
/// the pagination comparison), so invoice row order is compared as-is. And <c>dropNullish</c> DROPS a null
/// but KEEPS an empty array, so <c>users: null</c> where TS emits <c>[]</c> is a FAIL rather than a
/// harmless equivalent. Neither can be caught later by running <c>verify organization</c>, because both
/// platform-organizations flags are dark and the harness fails closed against a dark backend.</para>
/// </summary>
[Collection("PlatformOrganizationsReadList")]
public sealed class PlatformOrganizationsReadRepositoryListTests(PlatformOrganizationsReadListFixture fixture)
{
    private static readonly PlatformOrganizationListQuery AllOrgs =
        new(Cursor: null, Page: 0, Limit: 50, Search: null, Plan: null, Status: null, SortBy: null, SortDir: null);

    private async Task<PlatformOrganizationListItem> ItemAsync(Guid organizationId)
    {
        var result = await fixture.NewRepository().ListAsync(AllOrgs, CancellationToken.None);
        var item = result.Organizations.SingleOrDefault(o => o.Id == organizationId.ToString());

        // Non-vacuity: every assertion below is on `item`, so a query that silently returned nothing
        // must fail HERE with a clear message rather than as a null-reference somewhere downstream.
        Assert.NotNull(item);
        return item!;
    }

    // ── the users array (#211 divergence 3) ──────────────────────────────────────────────────────

    [Fact]
    public async Task An_org_whose_users_have_never_logged_in_projects_an_EMPTY_array_not_null()
    {
        var item = await ItemAsync(PlatformOrganizationsReadListFixture.OrgNoLogin);

        // TS emits `[]` here: `users: { where: { lastLoginAt: { not: null } }, take: 1 }` matches no row.
        // `dropNullish` would drop a null and keep an empty array, so null is a parity FAIL of its own.
        Assert.NotNull(item.Users);
        Assert.Empty(item.Users);
    }

    [Fact]
    public async Task An_org_with_logins_projects_a_ONE_element_array_holding_the_most_recent()
    {
        var item = await ItemAsync(PlatformOrganizationsReadListFixture.OrgWithLogin);

        // `take: 1` over `orderBy: { lastLoginAt: 'desc' }` — one element, and it must be the NEWER of
        // the two seeded logins. Asserting the count as well as the value is what distinguishes this
        // from a projection that returned both users.
        var login = Assert.Single(item.Users);
        Assert.Equal(PlatformOrganizationsReadListFixture.NewerLogin, login.LastLoginAt);
        Assert.NotEqual(PlatformOrganizationsReadListFixture.OlderLogin, login.LastLoginAt);
    }

    // ── the pending-invoice ordering (#211) ──────────────────────────────────────────────────────

    [Fact]
    public async Task Pending_invoices_come_back_in_ORDINAL_id_order_regardless_of_row_order()
    {
        var item = await ItemAsync(PlatformOrganizationsReadListFixture.OrgInvoices);

        // The seed inserts High, Mid, Low, so this assertion fails if the OrderBy is removed — which is
        // exactly the mutation that was green before this file existed.
        //
        // SCOPE, stated honestly: it does NOT distinguish the repository's ordinal-string OrderBy from
        // `OrderBy(Guid.Parse(...))`. Measured against net10.0, those two agree — on this triple, and on
        // 1,000,000 random pairs with ZERO disagreements (re-measured 2026-08-11 at 1M after an earlier
        // 200k run). The repository's source comment used to assert they "disagree"; that claim was
        // false and has been corrected in place, though the ordinal comparer it justified is still the
        // right choice, because ordinal order over the canonical lowercase hex IS Postgres's bytewise
        // `ORDER BY uuid`. No test can pin a distinction that does not exist, so this one pins the
        // property that does: ordered, not raw.
        Assert.Equal(
            [
                PlatformOrganizationsReadListFixture.InvoiceLow.ToString(),
                PlatformOrganizationsReadListFixture.InvoiceMid.ToString(),
                PlatformOrganizationsReadListFixture.InvoiceHigh.ToString(),
            ],
            item.PendingInvoices.Select(i => i.Id).ToArray());
    }

    [Fact]
    public async Task Only_PENDING_invoices_are_projected()
    {
        var item = await ItemAsync(PlatformOrganizationsReadListFixture.OrgInvoices);

        // Guards the premise of the ordering test: the fixture seeds a fourth, PAID invoice whose id
        // sorts second. If the status filter regressed, the ordering assertion above would fail for a
        // reason that has nothing to do with ordering, and this names the real cause.
        Assert.Equal(3, item.PendingInvoices.Count);
        Assert.DoesNotContain("0000000f-0000-4000-8000-00000000000f", item.PendingInvoices.Select(i => i.Id));
    }

    [Fact]
    public async Task An_org_with_no_pending_invoices_projects_an_EMPTY_array_not_null()
    {
        // Same dropNullish argument as the users array: TS's `invoices` include yields `[]`, never null.
        var item = await ItemAsync(PlatformOrganizationsReadListFixture.OrgNoLogin);

        Assert.NotNull(item.PendingInvoices);
        Assert.Empty(item.PendingInvoices);
    }

    // ── sortBy: 'plan' — the FIFTH divergence, unlisted by #211 ──────────────────────────────────

    /// <summary>
    /// <c>organizations.plan</c> is the NATIVE Postgres enum <c>"OrgPlan"</c>, and Postgres orders enum
    /// values by DECLARATION order — so the TS <c>orderBy: { plan: 'asc' }</c> yields
    /// trial, starter, professional, enterprise. This context maps the column to a C# <c>string</c>, and
    /// the sort was a bare <c>OrderBy(o =&gt; o.Plan)</c>, i.e. <c>Comparer&lt;string&gt;.Default</c>,
    /// which MEASURES as enterprise, professional, starter, trial — the exact reverse on the four-value
    /// set, a completely different page for the same request.
    ///
    /// <para>It is reachable from the production UI (<c>org-table.tsx</c> has a sortable Plan header and
    /// <c>page.tsx</c> forwards <c>sortBy</c>/<c>sortDir</c>) the moment the read flag flips, and no
    /// parity case could ever have caught it: the <c>list</c> surface is registered with
    /// <c>input: {}</c>, so <c>sortBy</c> is never sent.</para>
    /// </summary>
    [Fact]
    public async Task SortBy_plan_uses_the_enum_DECLARATION_order_not_lexicographic_string_order()
    {
        var query = new PlatformOrganizationListQuery(
            Cursor: null, Page: 0, Limit: 50, Search: null, Plan: null, Status: null, SortBy: "plan", SortDir: "asc");

        var result = await fixture.NewRepository().ListAsync(query, CancellationToken.None);
        var plans = result.Organizations.Select(o => o.Plan).ToArray();

        // The fixture seeds trial, starter, trial, professional. Declaration order groups the two trials
        // first; lexicographic order would put `professional` first and both `trial`s last, so this
        // assertion separates the two implementations rather than merely restating one.
        Assert.Equal(["trial", "trial", "starter", "professional"], plans);

        // Non-vacuity, stated as a fact rather than trusted: the lexicographic answer really is
        // different, so a green here cannot mean "both orderings happened to agree".
        Assert.NotEqual(plans, plans.OrderBy(p => p, StringComparer.CurrentCulture).ToArray());
    }

    [Fact]
    public async Task SortBy_plan_desc_reverses_the_declaration_order()
    {
        var query = new PlatformOrganizationListQuery(
            Cursor: null, Page: 0, Limit: 50, Search: null, Plan: null, Status: null, SortBy: "plan", SortDir: "desc");

        var result = await fixture.NewRepository().ListAsync(query, CancellationToken.None);

        // Guards the premise of the test above: a PlanRank applied only on the ascending branch would
        // leave `desc` on the string comparer, and the asc test alone could not tell.
        Assert.Equal(
            ["professional", "starter", "trial", "trial"],
            result.Organizations.Select(o => o.Plan).ToArray());
    }
}
