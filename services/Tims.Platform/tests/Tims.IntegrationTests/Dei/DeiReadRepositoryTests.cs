using Tims.Infrastructure.Dei;
using Xunit;

namespace Tims.IntegrationTests.Dei;

/// <summary>
/// Phase-5 Slice 11b direct-repository tests (real Postgres + real RLS): each call runs UNDER TenantScope (SET
/// LOCAL ROLE app_tenant + org GUC), proving the EF queries fetch the right rows, that RLS + the explicit org
/// filter isolate the tenant, and — the CRITICAL bites — that the THREE native Prisma enums GROUP BY into typed
/// LABELS (not int), that WITHOUT the MapEnum registration the same read 500s, and that an unmapped (plain)
/// context still string-materializes (the enum data source does not bleed). The suppression math is exhaustively
/// golden-tested in the unit suite; here we prove the enum + RLS + aggregate plumbing end-to-end on real rows.
/// </summary>
[Collection("DeiRead")]
public sealed class DeiReadRepositoryTests(DeiReadFixture fixture)
{
    private readonly DeiReadFixture _fixture = fixture;

    private DeiReadRepository EnumRepo() => new(_fixture.NewReadContext());

    private DeiReadRepository PlainRepo() => new(_fixture.NewPlainContext());

    private static string OrgA => DeiReadFixture.OrgA.ToString();
    private static string OrgB => DeiReadFixture.OrgB.ToString();

    // ── native-enum materialization: group-by returns typed LABELS, not int ─────────
    [Fact]
    public async Task GenderCounts_OrgA_materializesEnumLabels_notInts()
    {
        var counts = (await EnumRepo().GetGenderCountsAsync(OrgA, CancellationToken.None))
            .ToDictionary(c => c.Key, c => c.Count);

        Assert.Equal(5, counts["female"]);   // label, not "0"
        Assert.Equal(5, counts["male"]);
        Assert.Equal(5, counts["non_binary"]);
        Assert.Equal(3, counts.Count);
    }

    [Fact]
    public async Task EthnicityAndDisabilityCounts_OrgA_materializeEnumLabels()
    {
        var eth = (await EnumRepo().GetEthnicityCountsAsync(OrgA, CancellationToken.None))
            .ToDictionary(c => c.Key, c => c.Count);
        var dis = (await EnumRepo().GetDisabilityCountsAsync(OrgA, CancellationToken.None))
            .ToDictionary(c => c.Key, c => c.Count);

        Assert.Equal(5, eth["mestizo"]);
        Assert.Equal(5, eth["afrodescendiente"]);
        Assert.Equal(5, eth["blanco"]);
        Assert.Equal(5, dis["none"]);
        Assert.Equal(5, dis["has_disability"]);
        Assert.Equal(5, dis["undisclosed"]);
    }

    // THE MapEnum bite: WITHOUT the enum mapping the SAME group-by throws (int-materialization / 42883) — proving
    // MapEnum is load-bearing (neutralizing it turns the read from 200 into a 500).
    [Fact]
    public async Task GenderCounts_withoutMapEnum_throws_theEnumBite()
    {
        await Assert.ThrowsAnyAsync<Exception>(
            () => PlainRepo().GetGenderCountsAsync(OrgA, CancellationToken.None));
    }

    // No-bleed: the SAME unmapped (plain) context still STRING-materializes — reading nationality (String) +
    // candidates succeeds without any enum mapping, so the enum data source is confined to its own context.
    [Fact]
    public async Task PlainContext_stringColumns_stillMaterialize_noBleed()
    {
        var nat = await PlainRepo().GetNationalityDataAsync(OrgA, CancellationToken.None);
        var candidates = await PlainRepo().CountCandidatesAsync(OrgA, null, null, CancellationToken.None);

        Assert.Equal(3, nat.Counts.Count);
        Assert.Equal(5, nat.Counts.Single(c => c.Key == "CO").Count);
        Assert.Equal(7, candidates);
    }

    // ── dashboard aggregate bundle (real rows) ──────────────────────────────────────
    [Fact]
    public async Task DashboardData_OrgA_countsAndLeadersAndCoverageDenominator()
    {
        var data = await EnumRepo().GetDashboardDataAsync(OrgA, CancellationToken.None);

        Assert.Equal(18, data.TotalEmployees);        // 15 demographic + 3 auth users, all active
        Assert.Equal(15, data.WithDemographics);
        Assert.Equal(0, data.NullNationalityCount);
        Assert.Equal(0, data.NullDobCount);
        Assert.Equal(5, data.Genders.Single(g => g.Key == "female").Count);
        Assert.Equal(5, data.Ethnicities.Single(e => e.Key == "blanco").Count);
        Assert.Equal(3, data.Nationalities.Count);
        Assert.Equal(10, data.LeaderGenders.Count);   // 5 female + 5 male leaders
        Assert.Equal(5, data.LeaderGenders.Count(g => g == "female"));
    }

    // ── LEADERSHIP_SLUGS parity: only demographic users holding a leadership role are counted ───────
    [Fact]
    public async Task LeadershipGenders_OrgA_countsOnlyLeaders_5F5M()
    {
        var genders = await EnumRepo().GetLeadershipGendersAsync(OrgA, CancellationToken.None);

        Assert.Equal(10, genders.Count);
        Assert.Equal(5, genders.Count(g => g == "female"));
        Assert.Equal(5, genders.Count(g => g == "male"));
        Assert.DoesNotContain("non_binary", genders); // the non_binary group are non-leaders
    }

    // ── cross-org RLS isolation ─────────────────────────────────────────────────────
    [Fact]
    public async Task GenderCounts_OrgB_isolated_female3male8_neverOrgAsRows()
    {
        var counts = (await EnumRepo().GetGenderCountsAsync(OrgB, CancellationToken.None))
            .ToDictionary(c => c.Key, c => c.Count);

        Assert.Equal(3, counts["female"]);  // OrgB's sub-floor female group (RLS-isolated from OrgA's 5)
        Assert.Equal(8, counts["male"]);
        Assert.False(counts.ContainsKey("non_binary")); // OrgA-only
    }

    [Fact]
    public async Task NationalityData_OrgB_singleGroupCO11_noNull()
    {
        var data = await EnumRepo().GetNationalityDataAsync(OrgB, CancellationToken.None);
        Assert.Equal(11, data.Counts.Single(c => c.Key == "CO").Count);
        Assert.Single(data.Counts);
        Assert.Equal(0, data.NullCount);
    }

    // ── promotion counts (type filter + year window + cross-org) ─────────────────────
    [Fact]
    public async Task CountPromotions_OrgA_2026_countsOnlyPromotionType()
    {
        var start = new DateTimeOffset(2026, 1, 1, 0, 0, 0, TimeSpan.Zero);
        var end = new DateTimeOffset(2027, 1, 1, 0, 0, 0, TimeSpan.Zero);
        var count = await EnumRepo().CountPromotionsAsync(OrgA, start, end, CancellationToken.None);
        Assert.Equal(6, count); // 6 promotions; the 2 'merit' rows are excluded by the type filter
    }

    [Fact]
    public async Task CountPromotions_OrgA_2025_belowFloor()
    {
        var start = new DateTimeOffset(2025, 1, 1, 0, 0, 0, TimeSpan.Zero);
        var end = new DateTimeOffset(2026, 1, 1, 0, 0, 0, TimeSpan.Zero);
        var count = await EnumRepo().CountPromotionsAsync(OrgA, start, end, CancellationToken.None);
        Assert.Equal(3, count); // the use case floors this via KAnonymity
    }

    // ── hiring funnel window ────────────────────────────────────────────────────────
    [Fact]
    public async Task CountCandidates_OrgA_windowAndUnfiltered()
    {
        var all = await EnumRepo().CountCandidatesAsync(OrgA, null, null, CancellationToken.None);
        var windowed = await EnumRepo().CountCandidatesAsync(
            OrgA, new DateTimeOffset(2026, 5, 1, 0, 0, 0, TimeSpan.Zero), null, CancellationToken.None);

        Assert.Equal(7, all);       // OrgB's candidate is RLS-isolated
        Assert.Equal(4, windowed);  // only the 4 June candidates
    }

    // ── inclusion index data (answers-only) ─────────────────────────────────────────
    [Fact]
    public async Task ClimateInclusionData_OrgA_twoQuestions_sixResponses()
    {
        var data = await EnumRepo().GetClimateInclusionDataAsync(OrgA, null, CancellationToken.None);

        Assert.NotNull(data);
        Assert.Equal(2, data!.Questions.Count);
        Assert.Equal(6, data.ResponseAnswers.Count);
    }
}
