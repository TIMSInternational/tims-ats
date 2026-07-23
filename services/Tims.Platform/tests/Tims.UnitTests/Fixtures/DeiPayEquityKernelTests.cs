using System.Collections.Generic;
using Tims.Domain.Dei;

namespace Tims.UnitTests.Fixtures;

/// <summary>
/// Unit tests for the Slice-11c <see cref="DeiKernels.BuildPayEquity"/> pay-equity shaping kernel (the FX
/// conversion happens in the use case; this kernel takes ALREADY-CONVERTED salaries). Pins the min-5 k-anon
/// anti-differencing guard (cohort floor, population floor, skipped-salaried bucket, non-positive-salary
/// complement) + the female-vs-male median gap%. A drift turns CI red.
/// </summary>
public sealed class DeiPayEquityKernelTests
{
    private static PayEquityGenderInput Cohort(string gender, params double[] salaries) =>
        new(gender, salaries);

    private static Dictionary<string, int> Demographic(params (string Gender, int Count)[] counts) =>
        counts.ToDictionary(c => c.Gender, c => c.Count, StringComparer.Ordinal);

    [Fact]
    public void Both_cohorts_at_or_above_min5_publishes_avg_median_and_gap()
    {
        // female median 100000, male median 120000 → gap = (100000-120000)/120000*1000/10 = -16.7%.
        var byGender = new[]
        {
            Cohort("female", 90000, 95000, 100000, 105000, 110000),
            Cohort("male", 100000, 110000, 120000, 130000, 140000),
        };
        var demographic = Demographic(("female", 5), ("male", 5));

        var view = DeiKernels.BuildPayEquity(byGender, demographic, skippedSalaried: 0, "USD");

        Assert.False(view.Suppressed);
        Assert.Equal(2, view.Results.Count);
        var female = view.Results[0];
        Assert.Equal("female", female.Group);
        Assert.Equal(5, female.Count);
        Assert.Equal(100000, female.AverageSalary);
        Assert.Equal(100000, female.MedianSalary);
        Assert.Equal(120000, view.Results[1].MedianSalary);
        Assert.Equal(-16.7, view.GapPct);
        Assert.Equal("USD", view.Currency);
    }

    [Fact]
    public void A_sub_floor_cohort_suppresses_the_WHOLE_result_no_group_keys_survive()
    {
        // male cohort = 3 (1..4) → all-or-nothing: empty results, null gap, suppressed.
        var byGender = new[]
        {
            Cohort("female", 90000, 95000, 100000, 105000, 110000),
            Cohort("male", 100000, 110000, 120000),
        };
        var demographic = Demographic(("female", 5), ("male", 3));

        var view = DeiKernels.BuildPayEquity(byGender, demographic, skippedSalaried: 0, "USD");

        Assert.True(view.Suppressed);
        Assert.Empty(view.Results);
        Assert.Null(view.GapPct);
    }

    [Fact]
    public void A_sub_floor_skipped_salaried_bucket_suppresses_via_differencing_guard()
    {
        // Both cohorts clear the floor, but 2 undisclosed/no-demographics salaried people (1..4) would be
        // recoverable as N − Σ(visible) → the whole result suppresses.
        var byGender = new[]
        {
            Cohort("female", 90000, 95000, 100000, 105000, 110000),
            Cohort("male", 100000, 110000, 120000, 130000, 140000),
        };
        var demographic = Demographic(("female", 5), ("male", 5));

        var view = DeiKernels.BuildPayEquity(byGender, demographic, skippedSalaried: 2, "USD");

        Assert.True(view.Suppressed);
        Assert.Empty(view.Results);
    }

    [Fact]
    public void A_sub_floor_non_positive_salary_complement_suppresses()
    {
        // female: 5 salaried, but 8 demographic → complement 3 (1..4) is recoverable → suppress.
        var byGender = new[]
        {
            Cohort("female", 90000, 95000, 100000, 105000, 110000),
            Cohort("male", 100000, 110000, 120000, 130000, 140000),
        };
        var demographic = Demographic(("female", 8), ("male", 5));

        var view = DeiKernels.BuildPayEquity(byGender, demographic, skippedSalaried: 0, "USD");

        Assert.True(view.Suppressed);
    }
}
