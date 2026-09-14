using Tims.Application.PlatformOrganizations;

namespace Tims.IntegrationTests.PlatformOrganizations;

/// <summary>
/// <see cref="PlatformOrganizationsReadRepository.GetByIdAsync"/> projection guards — issue <b>#211</b>.
///
/// <para><b>Why this file exists.</b> The <c>getOrganization</c> payload was the single biggest part of
/// the #211 change — 27 guaranteed-non-null scalars restored across six nested records, plus roughly
/// thirty new <c>HasColumnName</c> mappings — and it shipped with ZERO executable coverage. No test in
/// either project called <c>GetByIdAsync</c>, and there was no integration test for
/// <c>GET /platform/organizations/{id}</c>. <c>PlatformOrganizationsReadModelsSerializationTests</c>
/// structurally cannot reach it: its <c>BuildDetail()</c> hand-constructs the record, so it supplies the
/// very values under test, and its own docblock says it pins the C# side only.</para>
///
/// <para><b>The two failure modes that were invisible.</b> (1) A POSITIONAL ARGUMENT SWAP in a
/// projection — the records take same-typed arguments in long positional lists, so swapping
/// <c>b.OrganizationId</c> with <c>b.CompanyId</c>, or <c>c.Timezone</c> with <c>c.Language</c>, or
/// <c>billingProfile.City</c> with <c>billingProfile.State</c>, compiles and ships a wrong wire payload.
/// (2) A TYPO'D <c>HasColumnName</c>, which throws at runtime on first use in production and cannot fail
/// any unit test, because the fault only exists against a real Postgres. That is the same defect class
/// slice 20 found in slice 19 (see <see cref="PlatformOrganizationsReadDbContextTests"/>).</para>
///
/// <para><b>Neither can be caught later.</b> Both platform-organizations flags are dark, so
/// <c>verify organization</c> fails closed and the parity harness cannot backstop any of it.</para>
///
/// <para><b>How the assertions are built to catch a swap.</b> The fixture gives every same-typed
/// neighbour a DISTINCT value — different uuids for <c>organization_id</c> / <c>company_id</c> /
/// <c>business_unit_id</c>, different strings for currency / timezone / language, different dates for
/// each of the subscription's five nullable timestamps. An assertion is only as strong as the fixture's
/// ability to tell two fields apart, which is why the seed carries no repeated values and no incidental
/// nulls.</para>
/// </summary>
[Collection("PlatformOrganizationsReadList")]
public sealed class PlatformOrganizationsReadRepositoryDetailTests(PlatformOrganizationsReadListFixture fixture)
{
    private async Task<PlatformOrganizationDetail> DetailAsync()
    {
        var detail = await fixture.NewRepository()
            .GetByIdAsync(PlatformOrganizationsReadListFixture.OrgDetail, CancellationToken.None);

        // Non-vacuity: every assertion below dereferences this, so a query that silently returned
        // nothing must fail HERE with a clear message rather than as a null-reference downstream.
        Assert.NotNull(detail);
        return detail!;
    }

    // ── the query runs at all against real Postgres ──────────────────────────────────────────────

    [Fact]
    public async Task An_unknown_id_returns_null_rather_than_throwing()
    {
        var detail = await fixture.NewRepository()
            .GetByIdAsync(PlatformOrganizationsReadListFixture.OrgAbsent, CancellationToken.None);

        // The endpoint turns this into a 404, matching the TS `throw new TRPCError({ code: 'NOT_FOUND' })`.
        // Pinned because the early return is also what stops the eleven follow-up queries from running
        // against an id that has no rows.
        Assert.Null(detail);
    }

    // ── the organization's own scalars ───────────────────────────────────────────────────────────

    [Fact]
    public async Task The_organization_row_carries_every_Prisma_scalar_including_settings_and_deletedAt()
    {
        var detail = await DetailAsync();

        Assert.Equal(PlatformOrganizationsReadListFixture.OrgDetail.ToString(), detail.Id);
        Assert.Equal("Detail Org", detail.Name);
        Assert.Equal("detail", detail.Slug);
        Assert.Equal("detail.example", detail.Domain);
        Assert.Equal("https://cdn.example/logo.png", detail.Logo);
        Assert.Equal("professional", detail.Plan);
        Assert.Equal("billing@detail.example", detail.BillingEmail);
        Assert.True(detail.IsActive);
        Assert.Equal(new DateTime(2026, 8, 4, 0, 0, 0, DateTimeKind.Unspecified), detail.CreatedAt);
        Assert.Equal(new DateTime(2026, 8, 5, 1, 2, 3, 456, DateTimeKind.Unspecified), detail.UpdatedAt);
        Assert.Null(detail.DeletedAt);

        // `settings` is a jsonb OBJECT on the wire, not a JSON string containing JSON — the distinction
        // ParseJson exists for. Reading a member proves it parsed rather than round-tripped as text.
        Assert.NotNull(detail.Settings);
        Assert.Equal("es", detail.Settings!["locale"]!.GetValue<string>());
    }

    // ── companies → businessUnits → teams ────────────────────────────────────────────────────────

    [Fact]
    public async Task The_company_carries_its_full_scalar_set_with_no_positional_swap()
    {
        var company = Assert.Single((await DetailAsync()).Companies);

        Assert.Equal(PlatformOrganizationsReadListFixture.DetailCompany.ToString(), company.Id);
        // THE SWAP GUARD: these two are both uuid-shaped strings in adjacent positions.
        Assert.Equal(PlatformOrganizationsReadListFixture.OrgDetail.ToString(), company.OrganizationId);
        Assert.NotEqual(company.Id, company.OrganizationId);

        Assert.Equal("Detail Co", company.Name);
        // country / currency / timezone / language are four adjacent non-null strings — the fixture gives
        // each a value no other could be confused with.
        Assert.Equal("CO", company.Country);
        Assert.Equal("COP", company.Currency);
        Assert.Equal("America/Lima", company.Timezone);
        Assert.Equal("en", company.Language);
        Assert.Equal("Detail Co S.A.S.", company.LegalName);
        Assert.Equal("TAX-900", company.TaxId);
        Assert.Equal(1, company.Settings!["co"]!.GetValue<int>());
        Assert.True(company.IsActive);
        Assert.Equal(new DateTime(2026, 8, 4, 10, 0, 0, DateTimeKind.Unspecified), company.CreatedAt);
        Assert.Equal(new DateTime(2026, 8, 4, 11, 0, 0, DateTimeKind.Unspecified), company.UpdatedAt);
    }

    [Fact]
    public async Task The_business_unit_distinguishes_organizationId_from_companyId()
    {
        var unit = Assert.Single(Assert.Single((await DetailAsync()).Companies).BusinessUnits);

        Assert.Equal(PlatformOrganizationsReadListFixture.DetailUnit.ToString(), unit.Id);
        // THE named swap from the review: `b.OrganizationId` / `b.CompanyId` are adjacent, same-typed
        // and both uuid-shaped. Swapping them compiles and every other test stays green.
        Assert.Equal(PlatformOrganizationsReadListFixture.OrgDetail.ToString(), unit.OrganizationId);
        Assert.Equal(PlatformOrganizationsReadListFixture.DetailCompany.ToString(), unit.CompanyId);
        Assert.NotEqual(unit.OrganizationId, unit.CompanyId);

        Assert.Equal("General", unit.Name);
        Assert.Equal("BU-1", unit.Code);
        Assert.Null(unit.ParentId);
        Assert.Equal(1, unit.Settings!["bu"]!.GetValue<int>());
        Assert.True(unit.IsActive);
        Assert.Equal(new DateTime(2026, 8, 4, 12, 0, 0, DateTimeKind.Unspecified), unit.CreatedAt);
        Assert.Equal(new DateTime(2026, 8, 4, 13, 0, 0, DateTimeKind.Unspecified), unit.UpdatedAt);
    }

    [Fact]
    public async Task The_team_distinguishes_organizationId_from_businessUnitId_and_carries_its_leader()
    {
        var team = Assert.Single(Assert.Single(Assert.Single((await DetailAsync()).Companies).BusinessUnits).Teams);

        Assert.Equal(PlatformOrganizationsReadListFixture.DetailTeam.ToString(), team.Id);
        Assert.Equal(PlatformOrganizationsReadListFixture.OrgDetail.ToString(), team.OrganizationId);
        Assert.Equal(PlatformOrganizationsReadListFixture.DetailUnit.ToString(), team.BusinessUnitId);
        Assert.NotEqual(team.OrganizationId, team.BusinessUnitId);

        Assert.Equal("Equipo General", team.Name);
        Assert.Equal(PlatformOrganizationsReadListFixture.DetailTeamLeader.ToString(), team.LeaderId);
        Assert.Equal(1, team.Settings!["team"]!.GetValue<int>());
        Assert.True(team.IsActive);
        Assert.Equal(new DateTime(2026, 8, 4, 14, 0, 0, DateTimeKind.Unspecified), team.CreatedAt);
        Assert.Equal(new DateTime(2026, 8, 4, 15, 0, 0, DateTimeKind.Unspecified), team.UpdatedAt);
    }

    // ── users ────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Users_come_back_newest_first_with_their_eight_selected_fields()
    {
        var users = (await DetailAsync()).Users;

        // TS orders this relation `createdAt: 'desc'`. The fixture's two users are seeded oldest-first,
        // so an unordered projection yields the opposite sequence.
        Assert.Equal(
            [
                PlatformOrganizationsReadListFixture.DetailOtherUser.ToString(),
                PlatformOrganizationsReadListFixture.DetailTeamLeader.ToString(),
            ],
            users.Select(u => u.Id).ToArray());

        var leader = users[1];
        Assert.Equal("Leader", leader.FirstName);
        Assert.Equal("One", leader.LastName);
        Assert.Equal("leader@detail.example", leader.Email);
        Assert.Equal("Head of People", leader.JobTitle);
        // The two booleans differ per user, so swapping IsActive with IsPlatformOwner fails on both rows.
        Assert.True(leader.IsActive);
        Assert.False(leader.IsPlatformOwner);
        Assert.Equal(new DateTime(2026, 8, 9, 8, 0, 0, DateTimeKind.Unspecified), leader.LastLoginAt);

        var second = users[0];
        Assert.Null(second.JobTitle);
        Assert.False(second.IsActive);
        Assert.True(second.IsPlatformOwner);
        Assert.Null(second.LastLoginAt);
    }

    // ── subscription / featureFlags / billingProfile ─────────────────────────────────────────────

    [Fact]
    public async Task The_subscription_carries_all_thirteen_columns_with_each_date_on_its_own_member()
    {
        var subscription = (await DetailAsync()).Subscription;
        Assert.NotNull(subscription);

        Assert.Equal(PlatformOrganizationsReadListFixture.DetailSubscription.ToString(), subscription!.Id);
        Assert.Equal(PlatformOrganizationsReadListFixture.OrgDetail.ToString(), subscription.OrganizationId);
        Assert.Equal("cus_detail", subscription.StripeCustomerId);
        Assert.Equal("sub_detail", subscription.StripeSubscriptionId);
        // Both are native Postgres enums read into strings — the slice-19 InvalidCastException class.
        Assert.Equal("professional", subscription.Plan);
        Assert.Equal("active", subscription.Status);
        // FIVE adjacent nullable DateTimes. Each fixture value is a different month, so any permutation
        // among them fails rather than passing on coincidentally-equal instants.
        Assert.Equal(new DateTime(2026, 7, 1, 0, 0, 0, DateTimeKind.Unspecified), subscription.CurrentPeriodStart);
        Assert.Equal(new DateTime(2026, 8, 1, 0, 0, 0, DateTimeKind.Unspecified), subscription.CurrentPeriodEnd);
        Assert.Equal(new DateTime(2026, 6, 1, 0, 0, 0, DateTimeKind.Unspecified), subscription.TrialEndsAt);
        Assert.Equal(new DateTime(2026, 5, 1, 0, 0, 0, DateTimeKind.Unspecified), subscription.CancelledAt);
        Assert.Equal(new DateTime(2026, 4, 1, 0, 0, 0, DateTimeKind.Unspecified), subscription.LastStripeEventAt);
        Assert.Equal(new DateTime(2026, 3, 1, 0, 0, 0, DateTimeKind.Unspecified), subscription.CreatedAt);
        Assert.Equal(new DateTime(2026, 2, 1, 0, 0, 0, DateTimeKind.Unspecified), subscription.UpdatedAt);
    }

    [Fact]
    public async Task The_feature_flag_carries_its_organizationId_payload_and_timestamps()
    {
        var flag = Assert.Single((await DetailAsync()).FeatureFlags);

        Assert.Equal(PlatformOrganizationsReadListFixture.DetailFeatureFlag.ToString(), flag.Id);
        Assert.Equal(PlatformOrganizationsReadListFixture.OrgDetail.ToString(), flag.OrganizationId);
        Assert.Equal("detail_flag", flag.Key);
        Assert.True(flag.Enabled);
        // `payload` is the one nullable jsonb in this payload, i.e. the only column that exercises
        // ParseJson's null branch in production. Seeded non-null so the PARSE path is proved here.
        Assert.Equal("b", flag.Payload!["variant"]!.GetValue<string>());
        Assert.Equal(new DateTime(2026, 8, 4, 16, 0, 0, DateTimeKind.Unspecified), flag.CreatedAt);
        Assert.Equal(new DateTime(2026, 8, 4, 17, 0, 0, DateTimeKind.Unspecified), flag.UpdatedAt);
    }

    [Fact]
    public async Task The_billing_profile_keeps_city_state_country_and_zip_in_their_own_members()
    {
        var profile = (await DetailAsync()).BillingProfile;
        Assert.NotNull(profile);

        Assert.Equal(PlatformOrganizationsReadListFixture.DetailBillingProfile.ToString(), profile!.Id);
        Assert.Equal(PlatformOrganizationsReadListFixture.OrgDetail.ToString(), profile.OrganizationId);
        Assert.Equal("Detail Billing Co", profile.CompanyName);
        Assert.Equal("BTAX-1", profile.TaxId);
        // address/city/state/country/zipCode are five adjacent nullable strings — the third named swap
        // from the review (City ↔ State) lives here.
        Assert.Equal("1 Detail Way", profile.Address);
        Assert.Equal("Bogota", profile.City);
        Assert.Equal("Cundinamarca", profile.State);
        Assert.Equal("CO", profile.Country);
        Assert.Equal("110111", profile.ZipCode);
        Assert.Equal("ap@detail.example", profile.BillingEmail);
        Assert.Equal("+57-1-555-0100", profile.BillingPhone);
        Assert.Equal(new DateTime(2026, 8, 4, 18, 0, 0, DateTimeKind.Unspecified), profile.CreatedAt);
        Assert.Equal(new DateTime(2026, 8, 4, 19, 0, 0, DateTimeKind.Unspecified), profile.UpdatedAt);
    }

    // ── _count ───────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task The_counts_are_distinct_per_relation_and_invitations_counts_only_pending_plus_sent()
    {
        var counts = (await DetailAsync()).Counts;

        // Deliberately four DIFFERENT numbers: a projection that passed the same count into all four
        // positions, or swapped two of them, cannot survive this.
        Assert.Equal(2, counts.Users);
        Assert.Equal(3, counts.Vacancies);
        // Four invoices, ALL of them `draft`. The detail's invoice count is unfiltered by status, unlike
        // the list's pending-only array — seeding zero pending rows is what proves that difference.
        Assert.Equal(4, counts.Invoices);
        // Seven invitations exist; only `pending` and `sent` are open (organizations.ts). The `accepted`
        // and `revoked` rows are what make this assertion mean something.
        Assert.Equal(5, counts.Invitations);
    }
}
