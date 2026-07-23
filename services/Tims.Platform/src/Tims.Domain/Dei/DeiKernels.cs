using System.Text.Json.Nodes;
using System.Text.Json.Serialization;
using Tims.Domain.Access;
using Tims.Domain.Json;
using Tims.Domain.Reporting;

namespace Tims.Domain.Dei;

// Pure DEI shaping kernels — a faithful port of the pure exports in @tims/shared `dei.ts` (Phase-5
// people-dashboards strangler, Slice 11b — GROUP 2). No DB, no I/O, no clock (ageBand takes the clock as a
// parameter). Golden-fixtured against the SAME contracts/dei-fixtures/*.json the REAL @tims/shared exports assert
// (Tims.UnitTests.DeiKernelsFixtureTests). All half-up rounding uses ReportingMath.JsRound (Math.Floor(x+0.5)),
// NOT .NET banker's rounding. min-5 k-anonymity reuses the ALREADY-ported Tims.Domain.Access.KAnonymity
// (byte-identical to the TS suppressBelowMin5) — no re-port. inclusionIndex consumes the raw jsonb `answers`
// values and replicates JS Number() coercion via the shared Tims.Domain.Json.JsValue.
//
// INTERNAL reads = raw kernel shape, NO schemaVersion. Records serialize camelCase to match the tRPC wire.

// ── buildDistribution (reads #2/#3/#4/#5/#6) ─────────────────────────────────────

/// <summary>One caller-ordered {key,count} distribution bucket fed into <see cref="DeiKernels.BuildDistribution"/>.</summary>
public sealed record DistInput(string Key, int Count);

/// <summary>One published distribution group (count/percentage null only via the all-or-nothing empty collapse —
/// present groups always carry a value; suppressed collapses the WHOLE list to empty).</summary>
public sealed record DistGroup(string Key, int? Count, double? Percentage, bool Suppressed);

/// <summary>The generic distribution kernel result. <see cref="Groups"/> is EMPTY (no keys) whenever
/// <see cref="Suppressed"/> is true (present-key cardinality + N−Σ differencing guard).</summary>
public sealed record Distribution(IReadOnlyList<DistGroup> Groups, bool Suppressed);

// ── leadershipDiversity (read #8) ────────────────────────────────────────────────

/// <summary>One leadership-diversity gender group.</summary>
public sealed record LeaderGroup(string Gender, int? Count, double? Percentage, bool Suppressed);

/// <summary>getLeadershipDiversity wire (kernel shape). byGender EMPTY + null totalLeaders when suppressed.</summary>
public sealed record LeadershipDiversityResult(int? TotalLeaders, IReadOnlyList<LeaderGroup> ByGender, bool Suppressed);

// ── deiDashboardKpis (read #1) ───────────────────────────────────────────────────

/// <summary>getDashboardKpis kernel input: the raw repository aggregates (grouped counts + implicit null-bucket
/// counts + the leader-gender list) before the ratios/suppression shaper runs.</summary>
public sealed record DashboardKpisInput(
    int TotalEmployees,
    int WithDemographics,
    IReadOnlyList<DistInput> Genders,
    IReadOnlyList<DistInput> Nationalities,
    int NullNationalityCount,
    int NullDobCount,
    IReadOnlyList<DistInput> Ethnicities,
    IReadOnlyList<string> LeaderGenders);

/// <summary>getDashboardKpis wire: the headline ratios (each nulled per the cross-endpoint differencing guard).</summary>
public sealed record DashboardKpis(
    int TotalEmployees,
    double? DemographicsCoverage,
    double? GenderParityIndex,
    double? WomenPct,
    double? LeadershipWomenPct,
    int? TotalNationalities);

// ── inclusionIndex (read #11) ────────────────────────────────────────────────────

/// <summary>getInclusionIndex wire. <see cref="QuestionsEvaluated"/> is OMITTED unless the index was computed
/// (matches the TS optional <c>questionsEvaluated?</c> — present only in the success return).</summary>
public sealed record InclusionIndexResult(
    double? Index,
    int? TotalResponses,
    bool Suppressed,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] int? QuestionsEvaluated);

/// <summary>The pure DEI kernels (faithful ports of @tims/shared/dei.ts).</summary>
public static class DeiKernels
{
    private const string InclusionCategory = "inclusion";

    public static readonly IReadOnlyList<string> AgeBands = new[] { "<25", "25-34", "35-44", "45-54", "55+" };

    private static bool Suppress(int count) => KAnonymity.SuppressBelowMin5(count).Suppressed;

    // ── pct / median / ageBand ────────────────────────────────────────────────────

    /// <summary>Half-up percentage to one decimal (Math.round(count/total*1000)/10); 0 total → 0.</summary>
    public static double Pct(int count, int total) =>
        total > 0 ? ReportingMath.JsRound((double)count / total * 1000) / 10d : 0d;

    /// <summary>Median of a numeric list (0 when empty). Even length → half-up round of the two-middle mean —
    /// matches the live getPayEquity path; kept fixture-exercised, ready for Slice 11c.</summary>
    public static double Median(IReadOnlyList<double> values)
    {
        if (values.Count == 0)
        {
            return 0d;
        }

        var sorted = values.OrderBy(v => v).ToList();
        var mid = sorted.Count / 2;
        return sorted.Count % 2 != 0
            ? sorted[mid]
            : ReportingMath.JsRound((sorted[mid - 1] + sorted[mid]) / 2d);
    }

    /// <summary>Server-side age-band bucketing (the raw DOB never leaves the server). Age = full years at
    /// <paramref name="now"/> — the JS getFullYear/getMonth/getDate month/day decrement.</summary>
    public static string AgeBand(DateTime dob, DateTime now)
    {
        var age = now.Year - dob.Year;
        var m = now.Month - dob.Month;
        if (m < 0 || (m == 0 && now.Day < dob.Day))
        {
            age--;
        }

        if (age < 25)
        {
            return "<25";
        }

        if (age < 35)
        {
            return "25-34";
        }

        if (age < 45)
        {
            return "35-44";
        }

        if (age < 55)
        {
            return "45-54";
        }

        return "55+";
    }

    // ── buildDistribution ─────────────────────────────────────────────────────────

    public static Distribution BuildDistribution(
        IReadOnlyList<DistInput> groups, int total, IReadOnlyList<int>? extraBuckets = null)
    {
        var extras = extraBuckets ?? Array.Empty<int>();
        var suppressed =
            Suppress(total) ||
            extras.Any(Suppress) ||
            groups.Any(g => Suppress(g.Count));
        if (suppressed)
        {
            return new Distribution(Array.Empty<DistGroup>(), true);
        }

        return new Distribution(
            groups.Select(g => new DistGroup(g.Key, g.Count, Pct(g.Count, total), false)).ToList(),
            false);
    }

    // ── leadershipDiversity ───────────────────────────────────────────────────────

    public static LeadershipDiversityResult LeadershipDiversity(IReadOnlyList<string> leaderGenders)
    {
        var total = leaderGenders.Count;
        var order = new List<string>();
        var counts = new Dictionary<string, int>(StringComparer.Ordinal);
        foreach (var g in leaderGenders)
        {
            if (counts.TryGetValue(g, out var c))
            {
                counts[g] = c + 1;
            }
            else
            {
                counts[g] = 1;
                order.Add(g);
            }
        }

        var suppressed = Suppress(total) || counts.Values.Any(Suppress);
        if (suppressed)
        {
            return new LeadershipDiversityResult(null, Array.Empty<LeaderGroup>(), true);
        }

        return new LeadershipDiversityResult(
            total,
            order.Select(gender => new LeaderGroup(gender, counts[gender], Pct(counts[gender], total), false)).ToList(),
            false);
    }

    // ── deiDashboardKpis ──────────────────────────────────────────────────────────

    public static DashboardKpis DeiDashboardKpis(DashboardKpisInput input)
    {
        var byGender = new Dictionary<string, int>(StringComparer.Ordinal);
        foreach (var g in input.Genders)
        {
            byGender[g.Key] = g.Count;
        }

        var female = byGender.GetValueOrDefault("female", 0);
        var male = byGender.GetValueOrDefault("male", 0);
        var genderKnown = input.Genders
            .Where(g => !string.Equals(g.Key, "undisclosed", StringComparison.Ordinal))
            .Sum(g => g.Count);
        var maxGender = Math.Max(female, male);
        var genderParityIndex = maxGender > 0
            ? ReportingMath.JsRound((double)Math.Min(female, male) / maxGender * 100) / 100d
            : 0d;

        var leaderOrder = new List<string>();
        var leaderCounts = new Dictionary<string, int>(StringComparer.Ordinal);
        foreach (var g in input.LeaderGenders)
        {
            if (leaderCounts.TryGetValue(g, out var c))
            {
                leaderCounts[g] = c + 1;
            }
            else
            {
                leaderCounts[g] = 1;
                leaderOrder.Add(g);
            }
        }

        var leaderFemale = leaderCounts.GetValueOrDefault("female", 0);

        var anyGenderSuppressed = input.Genders.Any(g => Suppress(g.Count));
        var anyLeaderGenderSuppressed = leaderCounts.Values.Any(Suppress);

        var nationalityPopulation = input.Nationalities.Sum(n => n.Count);
        var anyNationalitySuppressed = input.Nationalities.Any(n => Suppress(n.Count));
        var nationalitySuppressed =
            Suppress(nationalityPopulation) ||
            Suppress(input.NullNationalityCount) ||
            anyNationalitySuppressed;

        var ethnicityPopulation = input.Ethnicities.Sum(e => e.Count);
        var ethnicitySuppressed =
            Suppress(ethnicityPopulation) ||
            input.Ethnicities.Any(e => Suppress(e.Count));
        var nullDobSuppressed = Suppress(input.NullDobCount);
        var anyDemographicSuppressed =
            anyGenderSuppressed || nationalitySuppressed || ethnicitySuppressed || nullDobSuppressed;

        return new DashboardKpis(
            input.TotalEmployees,
            anyDemographicSuppressed ? null : Pct(input.WithDemographics, input.TotalEmployees),
            anyGenderSuppressed ? null : genderParityIndex,
            anyGenderSuppressed ? null : Pct(female, genderKnown),
            anyLeaderGenderSuppressed ? null : Pct(leaderFemale, input.LeaderGenders.Count),
            nationalitySuppressed ? null : input.Nationalities.Count);
    }

    // ── inclusionIndex ────────────────────────────────────────────────────────────

    public static InclusionIndexResult InclusionIndex(
        IReadOnlyList<JsonObject> questions, IReadOnlyList<JsonObject> responseAnswers)
    {
        var total = responseAnswers.Count;
        if (Suppress(total))
        {
            return new InclusionIndexResult(null, null, true, null);
        }

        // inclusionQuestions = questions.filter(q => q.category === 'inclusion') — strict string equality.
        var inclusionQuestions = questions
            .Where(q => q["category"] is { } c
                && c.GetValueKind() == System.Text.Json.JsonValueKind.String
                && c.GetValue<string>() == InclusionCategory)
            .ToList();
        if (inclusionQuestions.Count == 0)
        {
            return new InclusionIndexResult(null, total, false, null);
        }

        var contributingRespondents = 0;
        var scores = new List<double>();
        foreach (var answers in responseAnswers)
        {
            // rowScores = inclusionQuestions.map(q => Number(answers?.[q.text])).filter(!isNaN)
            var rowScores = inclusionQuestions
                .Select(q => JsValue.NumberOfKey(answers, JsValue.StringKey(q["text"])))
                .Where(n => !double.IsNaN(n))
                .ToList();
            if (rowScores.Count > 0)
            {
                contributingRespondents += 1;
            }

            scores.AddRange(rowScores);
        }

        var inclusionSkipped = total - contributingRespondents;
        if (Suppress(contributingRespondents) || Suppress(inclusionSkipped))
        {
            return new InclusionIndexResult(null, total, true, null);
        }

        var avg = scores.Count > 0 ? scores.Sum() / scores.Count : 0d;
        return new InclusionIndexResult(
            ReportingMath.JsRound(avg * 100) / 100d,
            total,
            false,
            inclusionQuestions.Count);
    }
}
