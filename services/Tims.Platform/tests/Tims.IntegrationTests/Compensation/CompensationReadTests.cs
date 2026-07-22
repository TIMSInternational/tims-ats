using Tims.Application.Compensation;
using Tims.Domain.Access;
using Tims.Domain.Compensation;
using Tims.Infrastructure.Compensation;

namespace Tims.IntegrationTests.Compensation;

/// <summary>
/// Phase-5 Slice 9 direct-repository tests (real Postgres + real RLS): each call runs UNDER TenantScope (SET
/// LOCAL ROLE app_tenant + org GUC), so these prove the EF/raw queries fetch the right rows AND that RLS + the
/// explicit org filter isolate the tenant (OrgB seeds distinct rows). The pure kernels are exhaustively
/// golden-tested in the unit suite; here we verify the DB wiring, the field-authed dynamic-column SELECTs
/// (never select-then-null), the scopeWhereFor('salaryAdjustment') row drop, and cross-org isolation.
/// </summary>
[Collection("CompensationRead")]
public sealed class CompensationReadTests(CompensationReadFixture fixture)
{
    // selectFor field sets (the endpoint passes these; here we construct them directly, as the repo tests do).
    private static readonly IReadOnlyList<string> HrAdjFields =
        FieldClassification.SelectFor(new[] { "hr_admin" }, "salaryAdjustment");
    private static readonly IReadOnlyList<string> LeaderAdjFields =
        FieldClassification.SelectFor(new[] { "leader" }, "salaryAdjustment");
    private static readonly IReadOnlyList<string> HrCompFields =
        FieldClassification.SelectFor(new[] { "hr_admin" }, "employeeCompensation");
    private static readonly IReadOnlyList<string> LeaderCompFields =
        FieldClassification.SelectFor(new[] { "leader" }, "employeeCompensation");

    private readonly CompensationReadFixture _fixture = fixture;

    private CompensationReadRepository NewRepo() => new(_fixture.NewReadContext());

    private static ScopePredicate TeamAdjScope() =>
        new ScopePredicate.FieldIn("userId", CompensationReadFixture.TeamMemberIds);

    // ── Read 1/2: salary bands + market comparison (isolation) ──────────────────
    [Fact]
    public async Task GetSalaryBands_orgA_returnsOnlyOrgABand()
    {
        var rows = await NewRepo().GetSalaryBandsAsync(CompensationReadFixture.OrgA.ToString(), CancellationToken.None);
        var band = Assert.Single(rows);
        Assert.Equal("L5", band.Level);
        Assert.Equal(100000, band.MidSalary);
    }

    [Fact]
    public async Task GetSalaryBands_crossOrg_isolatedUnderRls()
    {
        var rows = await NewRepo().GetSalaryBandsAsync(CompensationReadFixture.OrgB.ToString(), CancellationToken.None);
        var band = Assert.Single(rows);
        Assert.Equal("LB", band.Level); // OrgA's L5 never bleeds in
    }

    [Fact]
    public async Task GetMarketComparison_levelFilter_projectsBand()
    {
        var rows = await NewRepo().GetMarketComparisonAsync(CompensationReadFixture.OrgA.ToString(), "L5", CancellationToken.None);
        var row = Assert.Single(rows);
        Assert.Equal(80000, row.InternalMin);
        Assert.Equal(100000, row.InternalMid);
        Assert.Equal(120000, row.InternalMax);
    }

    // ── Read 3/4: benefits + compa-ratio wiring feeds the kernel ────────────────
    [Fact]
    public async Task BenefitsUtilization_orgA_countsEnrollmentAndActiveUsers()
    {
        var data = await NewRepo().GetBenefitsUtilizationDataAsync(CompensationReadFixture.OrgA.ToString(), CancellationToken.None);
        var plan = Assert.Single(data.Plans);
        Assert.Equal("Health", plan.Name);
        Assert.Equal("medical", plan.Category);
        Assert.Equal(1, plan.Enrolled);       // one enrollment (M1)
        Assert.True(data.TotalUsers >= 1);     // active OrgA users
    }

    [Fact]
    public async Task CompaRatio_orgA_fivePositive_nonSuppressed()
    {
        var rows = await NewRepo().GetCompaRatioRowsAsync(CompensationReadFixture.OrgA.ToString(), CancellationToken.None);
        var view = CompensationKernels.BuildCompaRatioDistribution(rows);

        Assert.False(view.Suppressed);
        Assert.Equal(5, view.TotalEmployees);
        Assert.Equal(5, view.Distribution["0.90-1.00"].Count); // all five ratios in [0.9,1.0)
    }

    [Fact]
    public async Task CompaRatio_orgB_threePositive_suppressed_underRls()
    {
        var rows = await NewRepo().GetCompaRatioRowsAsync(CompensationReadFixture.OrgB.ToString(), CancellationToken.None);
        var view = CompensationKernels.BuildCompaRatioDistribution(rows);

        Assert.True(view.Suppressed);          // positiveCount 3 → min-5 suppressed
        Assert.Empty(view.Distribution);       // all-or-nothing empty distribution
        Assert.Null(view.TotalEmployees);
    }

    // ── Read 5: listPendingAdjustments field-auth + scopeWhereFor row drop ──────
    [Fact]
    public async Task PendingAdjustments_hrOrgScope_bothPending_withRestrictedFields()
    {
        var result = await NewRepo().ListPendingAdjustmentsAsync(
            CompensationReadFixture.OrgA.ToString(), HrAdjFields, ScopePredicate.MatchAll, CancellationToken.None);

        Assert.Equal(2, result.Rows.Count); // ADJ1 + ADJ2 (ADJ3 is approved → excluded)
        Assert.Equal(2, result.RecordIds.Count);
        // hr_admin is entitled to the restricted salary fields — they are SELECTED.
        Assert.All(result.Rows, r => Assert.True(r.ContainsKey("previousSalary")));
        Assert.All(result.Rows, r => Assert.True(r.ContainsKey("newSalary")));
        Assert.All(result.Rows, r => Assert.True(r.ContainsKey("reason")));
    }

    [Fact]
    public async Task PendingAdjustments_leaderTeamScope_onlyInScope_statusOnly_noRestrictedFields()
    {
        // scopeWhereFor('salaryAdjustment') team scope {TeamLead, M1, M2} → ADJ1 (M1) survives; ADJ2 (Emp) is
        // dropped at the DB (row filter, not post-hoc). selectFor(leader) → status ONLY (no restricted fields).
        var result = await NewRepo().ListPendingAdjustmentsAsync(
            CompensationReadFixture.OrgA.ToString(), LeaderAdjFields, TeamAdjScope(), CancellationToken.None);

        var row = Assert.Single(result.Rows);
        Assert.True(row.ContainsKey("status"));
        // Field-auth bite: a leader NEVER receives the restricted salary fields (never selected-then-nulled).
        Assert.False(row.ContainsKey("previousSalary"));
        Assert.False(row.ContainsKey("newSalary"));
        Assert.False(row.ContainsKey("reason"));
        Assert.False(row.ContainsKey("type"));
    }

    // ── Read 6/7: getEmployeeComp field-auth + missing → null ───────────────────
    [Fact]
    public async Task GetEmployeeComp_hr_readsFullFinanceFields()
    {
        var result = await NewRepo().GetEmployeeCompAsync(
            CompensationReadFixture.OrgA.ToString(), CompensationReadFixture.M1Id, HrCompFields, CancellationToken.None);

        Assert.NotNull(result);
        Assert.True(result!.Dto.ContainsKey("currentSalary"));
        Assert.True(result.Dto.ContainsKey("compaRatio")); // hr entitled
        Assert.True(result.Dto.ContainsKey("variablePay"));
        Assert.True(result.Dto.ContainsKey("band"));       // band present (M1 has band L5)
    }

    [Fact]
    public async Task GetEmployeeComp_leader_omitsFinanceFields()
    {
        var result = await NewRepo().GetEmployeeCompAsync(
            CompensationReadFixture.OrgA.ToString(), CompensationReadFixture.M1Id, LeaderCompFields, CancellationToken.None);

        Assert.NotNull(result);
        Assert.True(result!.Dto.ContainsKey("currentSalary")); // leader entitled to salary/currency
        Assert.True(result.Dto.ContainsKey("currency"));
        // Field-auth bite: leader NOT entitled to the finance fields → never selected.
        Assert.False(result.Dto.ContainsKey("compaRatio"));
        Assert.False(result.Dto.ContainsKey("variablePay"));
        Assert.False(result.Dto.ContainsKey("band"));
    }

    [Fact]
    public async Task GetEmployeeComp_noRow_returnsNull()
    {
        // CompanyRec (recruiter) has NO comp row → null (the endpoint decides 404 vs graceful null).
        var result = await NewRepo().GetEmployeeCompAsync(
            CompensationReadFixture.OrgA.ToString(), CompensationReadFixture.CompanyRecId, HrCompFields, CancellationToken.None);
        Assert.Null(result);
    }

    [Fact]
    public async Task CompaRatio_crossOrg_neverBleeds()
    {
        // OrgA sees exactly its five comps; OrgB's three never bleed in (RLS + explicit org filter).
        var rows = await NewRepo().GetCompaRatioRowsAsync(CompensationReadFixture.OrgA.ToString(), CancellationToken.None);
        Assert.Equal(5, rows.Count);
    }
}
