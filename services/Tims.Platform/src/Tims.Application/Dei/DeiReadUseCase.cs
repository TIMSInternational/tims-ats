using Tims.Application.Fx;
using Tims.Domain.Access;
using Tims.Domain.Compensation;
using Tims.Domain.Dei;

namespace Tims.Application.Dei;

/// <summary>
/// The DEI READ use case — infra-free orchestration, a faithful port of the 10 ported reads of the TS
/// <c>dei</c> router/service (getPayEquity + the generateReport mutation are NOT ported). It threads the
/// repository aggregates into the pure <see cref="DeiKernels"/> (golden-parity with @tims/shared): the five
/// demographic distributions run <see cref="DeiKernels.BuildDistribution"/> (then rename the generic key to each
/// endpoint's field); getDashboardKpis runs <see cref="DeiKernels.DeiDashboardKpis"/>; getLeadershipDiversity runs
/// <see cref="DeiKernels.LeadershipDiversity"/>; getInclusionIndex runs <see cref="DeiKernels.InclusionIndex"/>;
/// getPromotionEquity floors the raw count via <see cref="KAnonymity"/>; getHiringFunnel is a bare count (no
/// suppression). No clock here — getAgeDistribution/getPromotionEquity take the request clock from the endpoint.
/// </summary>
public sealed class DeiReadUseCase(IDeiReadRepository repository, FxMoneyConverter fxConverter)
{
    private const string DisplayCurrencyFallback = CurrencyCodes.DefaultCurrency; // 'USD'
    private const string UndisclosedGender = "undisclosed";

    private readonly IDeiReadRepository _repository = repository;
    private readonly FxMoneyConverter _fxConverter = fxConverter;

    // #12 getPayEquity (Slice 11c): per-gender avg/median + female-vs-male gap%, salaries converted to the org
    // display currency via the DB-pinned FX (FxMoneyConverter), min-5 k-anon shaped by the pure kernel. A faithful
    // port of dei.service.getPayEquity: rows with missing/'undisclosed' gender are the skipped-salaried implicit
    // bucket; a zero salary is dropped; the FULL demographic gender counts feed the non-positive-salary complement
    // guard. FAIL-SOFT: a cold-start missing pin (any cross-rate unavailable) → the whole result SUPPRESSES
    // (empty results + null gap + suppressed:true), never a 500.
    public async Task<PayEquityView> GetPayEquityAsync(string organizationId, CancellationToken cancellationToken)
    {
        var data = await _repository.GetPayEquityDataAsync(organizationId, cancellationToken).ConfigureAwait(false);
        var displayCurrency = CurrencyCodes.NormalizeCurrencyCode(data.DisplayCurrency, DisplayCurrencyFallback);

        // Build the gender cohorts in FIRST-SEEN order (matching the TS Map iteration → results order).
        var order = new List<string>();
        var byGender = new Dictionary<string, List<double>>(StringComparer.Ordinal);
        var skippedSalaried = 0;
        foreach (var row in data.Rows)
        {
            var gender = row.Gender;
            var salary = row.Salary;
            if (string.IsNullOrEmpty(gender) || string.Equals(gender, UndisclosedGender, StringComparison.Ordinal))
            {
                if (salary != 0)
                {
                    skippedSalaried++;
                }

                continue;
            }

            if (salary == 0)
            {
                continue;
            }

            // Convert this salary to the display currency via the DB-pinned rate. FAIL-SOFT: a missing pin →
            // suppress the whole read (empty results + suppressed), never a 500.
            var converted = await _fxConverter
                .ConvertAmountAsync(salary, row.Currency, displayCurrency, cancellationToken).ConfigureAwait(false);
            if (converted is not { } amount)
            {
                return new PayEquityView(Array.Empty<PayEquityGroup>(), null, true, displayCurrency);
            }

            if (!byGender.TryGetValue(gender, out var salaries))
            {
                salaries = new List<double>();
                byGender[gender] = salaries;
                order.Add(gender);
            }

            salaries.Add(amount);
        }

        var cohorts = order
            .Select(g => new PayEquityGenderInput(g, byGender[g]))
            .ToList();
        var demographicCounts = data.GenderCounts.ToDictionary(g => g.Key, g => g.Count, StringComparer.Ordinal);

        return DeiKernels.BuildPayEquity(cohorts, demographicCounts, skippedSalaried, displayCurrency);
    }

    // #1 getDashboardKpis.
    public async Task<DashboardKpis> GetDashboardKpisAsync(string organizationId, CancellationToken cancellationToken)
    {
        var data = await _repository.GetDashboardDataAsync(organizationId, cancellationToken).ConfigureAwait(false);
        return DeiKernels.DeiDashboardKpis(new DashboardKpisInput(
            data.TotalEmployees,
            data.WithDemographics,
            data.Genders.Select(ToDistInput).ToList(),
            data.Nationalities.Select(ToDistInput).ToList(),
            data.NullNationalityCount,
            data.NullDobCount,
            data.Ethnicities.Select(ToDistInput).ToList(),
            data.LeaderGenders));
    }

    // #2 getGenderRepresentation.
    public async Task<GenderRepresentationView> GetGenderRepresentationAsync(
        string organizationId, CancellationToken cancellationToken)
    {
        var counts = await _repository.GetGenderCountsAsync(organizationId, cancellationToken).ConfigureAwait(false);
        var dist = DeiKernels.BuildDistribution(counts.Select(ToDistInput).ToList(), Total(counts));
        return new GenderRepresentationView(
            dist.Groups.Select(g => new GenderGroup(g.Key, g.Count, g.Percentage, g.Suppressed)).ToList(),
            dist.Suppressed);
    }

    // #3 getAgeDistribution (clock from the endpoint): raw DOBs → fixed AGE_BANDS buckets + the null-DOB implicit
    // group folded into the suppression trigger.
    public async Task<AgeDistributionView> GetAgeDistributionAsync(
        string organizationId, DateTime now, CancellationToken cancellationToken)
    {
        var data = await _repository.GetAgeDataAsync(organizationId, cancellationToken).ConfigureAwait(false);
        var buckets = DeiKernels.AgeBands.ToDictionary(b => b, _ => 0, StringComparer.Ordinal);
        foreach (var dob in data.BirthDates)
        {
            buckets[DeiKernels.AgeBand(dob, now)]++;
        }

        var total = data.BirthDates.Count;
        var dist = DeiKernels.BuildDistribution(
            DeiKernels.AgeBands.Select(range => new DistInput(range, buckets[range])).ToList(),
            total,
            new[] { data.NullDobCount });
        return new AgeDistributionView(
            dist.Groups.Select(g => new AgeGroup(g.Key, g.Count, g.Percentage, g.Suppressed)).ToList(),
            dist.Suppressed);
    }

    // #4 getNationalityDiversity: count-desc ranking + the null-nationality implicit group.
    public async Task<NationalityDiversityView> GetNationalityDiversityAsync(
        string organizationId, CancellationToken cancellationToken)
    {
        var data = await _repository.GetNationalityDataAsync(organizationId, cancellationToken).ConfigureAwait(false);
        var total = Total(data.Counts);
        var sorted = data.Counts.OrderByDescending(c => c.Count).Select(ToDistInput).ToList();
        var dist = DeiKernels.BuildDistribution(sorted, total, new[] { data.NullCount });
        if (dist.Suppressed)
        {
            return new NationalityDiversityView(null, Array.Empty<NationalityGroup>(), true);
        }

        var distribution = dist.Groups
            .Select(g => new NationalityGroup(g.Key, g.Count, g.Percentage, g.Suppressed))
            .ToList();
        return new NationalityDiversityView(distribution.Count, distribution, false);
    }

    // #5 getEthnicityDistribution: count-desc ranking.
    public async Task<EthnicityDistributionView> GetEthnicityDistributionAsync(
        string organizationId, CancellationToken cancellationToken)
    {
        var counts = await _repository.GetEthnicityCountsAsync(organizationId, cancellationToken).ConfigureAwait(false);
        var sorted = counts.OrderByDescending(c => c.Count).Select(ToDistInput).ToList();
        var dist = DeiKernels.BuildDistribution(sorted, Total(counts));
        return new EthnicityDistributionView(
            dist.Groups.Select(g => new EthnicityGroup(g.Key, g.Count, g.Percentage, g.Suppressed)).ToList(),
            dist.Suppressed);
    }

    // #6 getDisabilityDistribution.
    public async Task<DisabilityDistributionView> GetDisabilityDistributionAsync(
        string organizationId, CancellationToken cancellationToken)
    {
        var counts = await _repository.GetDisabilityCountsAsync(organizationId, cancellationToken).ConfigureAwait(false);
        var dist = DeiKernels.BuildDistribution(counts.Select(ToDistInput).ToList(), Total(counts));
        return new DisabilityDistributionView(
            dist.Groups.Select(g => new DisabilityGroup(g.Key, g.Count, g.Percentage, g.Suppressed)).ToList(),
            dist.Suppressed);
    }

    // #8 getLeadershipDiversity.
    public async Task<LeadershipDiversityResult> GetLeadershipDiversityAsync(
        string organizationId, CancellationToken cancellationToken)
    {
        var leaderGenders = await _repository.GetLeadershipGendersAsync(organizationId, cancellationToken).ConfigureAwait(false);
        return DeiKernels.LeadershipDiversity(leaderGenders);
    }

    // #9 getHiringFunnel (no suppression — candidates have no demographics).
    public async Task<HiringFunnelView> GetHiringFunnelAsync(
        string organizationId, DateTimeOffset? dateFrom, DateTimeOffset? dateTo, CancellationToken cancellationToken)
    {
        var total = await _repository.CountCandidatesAsync(organizationId, dateFrom, dateTo, cancellationToken).ConfigureAwait(false);
        return new HiringFunnelView(total);
    }

    // #10 getPromotionEquity (year resolved by the endpoint): [year-01-01, (year+1)-01-01) window, min-5 floored.
    public async Task<PromotionEquityView> GetPromotionEquityAsync(
        string organizationId, int year, CancellationToken cancellationToken)
    {
        var start = new DateTimeOffset(year, 1, 1, 0, 0, 0, TimeSpan.Zero);
        var end = new DateTimeOffset(year + 1, 1, 1, 0, 0, 0, TimeSpan.Zero);
        var total = await _repository.CountPromotionsAsync(organizationId, start, end, cancellationToken).ConfigureAwait(false);
        var floored = KAnonymity.SuppressBelowMin5(total);
        return new PromotionEquityView(year, floored.Count, floored.Suppressed);
    }

    // #11 getInclusionIndex: no climate survey → {index:null, totalResponses:null, suppressed:false}; else the
    // multi-tier inclusionIndex kernel.
    public async Task<InclusionIndexResult> GetInclusionIndexAsync(
        string organizationId, Guid? surveyId, CancellationToken cancellationToken)
    {
        var data = await _repository.GetClimateInclusionDataAsync(organizationId, surveyId, cancellationToken).ConfigureAwait(false);
        return data is null
            ? new InclusionIndexResult(null, null, false, null)
            : DeiKernels.InclusionIndex(data.Questions, data.ResponseAnswers);
    }

    private static DistInput ToDistInput(DeiGroupCount c) => new(c.Key, c.Count);

    private static int Total(IReadOnlyList<DeiGroupCount> counts) => counts.Sum(c => c.Count);
}
