using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.Json.Serialization;
using Tims.Domain.Access;
using Tims.Domain.Json;
using Tims.Domain.Reporting;

namespace Tims.Domain.Engagement;

// Pure engagement shaping kernels — a faithful port of the pure exports in @tims/shared `engagement.ts`
// (Phase-5 engagement strangler, Slice 11). No DB, no I/O, no clock. Golden-fixtured against the SAME
// contracts/engagement-fixtures/*.json the REAL @tims/shared exports assert (Tims.UnitTests). All rounding uses
// JS half-UP via ReportingMath.JsRound (Math.Floor(x + 0.5)), NOT .NET banker's rounding. min-5 k-anonymity
// reuses the ALREADY-ported Tims.Domain.Access.KAnonymity (byte-identical to the TS suppressBelowMin5) — no
// re-port. The kernels consume the raw jsonb `answers` values and replicate JS Boolean()/Number()/parseInt
// coercion (JsTruthy/JsNumber/JsParseInt) so the coercion is golden-fixtured alongside the suppression logic.
//
// INTERNAL reads = raw kernel shape, NO schemaVersion. Records serialize camelCase to match the tRPC wire.

// ── computeEnps (read #5) ───────────────────────────────────────────────────────

/// <summary>The eNPS result — score + promoter/passive/detractor split (all nulled when suppressed).</summary>
public sealed record EnpsResult(
    int? Enps,
    int? Promoters,
    int? Passives,
    int? Detractors,
    int? TotalResponses,
    bool Suppressed,
    string Period);

// ── summarizeSurveyResults (read #2) ────────────────────────────────────────────

/// <summary>One per-question summary. <see cref="Average"/> is OMITTED when null (non-scale questions carry no
/// average — matching the TS optional <c>average?</c>); scale questions always carry it.</summary>
public sealed record QuestionSummary(
    JsonNode? Question,
    JsonNode? Type,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] double? Average,
    int? Count,
    bool Suppressed);

/// <summary>getSurveyResults shape (raw kernel core; the router adds surveyId/title). <see cref="QuestionSummaries"/>
/// is EMPTY whenever <see cref="Suppressed"/> is true (survey/question all-or-nothing).</summary>
public sealed record SurveyResultsSummary(int? TotalResponses, bool Suppressed, IReadOnlyList<QuestionSummary> QuestionSummaries);

// ── buildClimateHeatmap (read #6) ───────────────────────────────────────────────

/// <summary>One climate category cell (score null when suppressed).</summary>
public sealed record HeatCell(string Category, double? Score);

/// <summary>getClimateHeatmap shape (raw kernel core; the router adds surveyId/title).</summary>
public sealed record ClimateHeatmap(bool Suppressed, IReadOnlyList<HeatCell> Data);

// ── buildResultsByArea (read #7) ────────────────────────────────────────────────

/// <summary>One per-response input: the area key (company|businessUnit per groupBy, resolved by the repo from
/// the response's user; null/empty ⇒ the implicit unassigned/skipped bucket) + the raw answers object.</summary>
public sealed record AreaResultRow(string? AreaKey, JsonObject? Answers);

/// <summary>One per-area output row (average/responses null only via the all-or-nothing empty collapse).</summary>
public sealed record AreaResult(string GroupId, double? Average, int? Responses, bool Suppressed);

/// <summary>getResultsByArea shape (raw kernel core; the router adds surveyId/groupBy). <see cref="Results"/> is
/// EMPTY whenever <see cref="Suppressed"/> is true (present-key cardinality + N−Σ differencing guard).</summary>
public sealed record ResultsByArea(IReadOnlyList<AreaResult> Results, bool Suppressed);

// ── buildEngagementKpis (read #13) ──────────────────────────────────────────────

/// <summary>getDashboardKpis shape.</summary>
public sealed record EngagementKpis(
    int ActiveSurveys,
    int? TotalResponses,
    bool TotalResponsesSuppressed,
    int ActionPlansOpen,
    int HighRiskCount);

/// <summary>The pure engagement kernels (faithful ports of @tims/shared/engagement.ts).</summary>
public static class EngagementKernels
{
    private const string ScaleType = "scale";

    private static bool Suppress(int count) => KAnonymity.SuppressBelowMin5(count).Suppressed;

    // ── computeEnps ─────────────────────────────────────────────────────────────
    public static EnpsResult ComputeEnps(IReadOnlyList<JsonObject> responseAnswers, string period)
    {
        // scores = responses.map(first value → number as-is else parseInt(base10)).filter(!isNaN)
        var scores = new List<double>();
        foreach (var answers in responseAnswers)
        {
            var first = JsValue.FirstValue(answers);
            double n;
            if (first is not null && first.GetValueKind() == JsonValueKind.Number)
            {
                n = first.GetValue<double>();
            }
            else if (first is not null && first.GetValueKind() == JsonValueKind.String)
            {
                n = JsValue.ParseInt(first.GetValue<string>());
            }
            else
            {
                n = double.NaN; // number-typed → used; otherwise parseInt(String(x)) of a non-numeric → NaN
            }

            if (!double.IsNaN(n))
            {
                scores.Add(n);
            }
        }

        // Response floor + skip-bucket floor.
        var skipped = responseAnswers.Count - scores.Count;
        if (Suppress(scores.Count) || Suppress(skipped))
        {
            return SuppressedEnps(period);
        }

        var total = scores.Count == 0 ? 1 : scores.Count; // scores.length || 1
        var promoters = scores.Count(s => s >= 9);
        var detractors = scores.Count(s => s <= 6);
        var passives = total - promoters - detractors;
        var enps = (int)ReportingMath.JsRound((double)(promoters - detractors) / total * 100);

        // Per-split floor (guarded on scores.length > 0 so the `|| 1` sentinel never falsely suppresses).
        var splitSuppressed = scores.Count > 0
            && (Suppress(promoters) || Suppress(passives) || Suppress(detractors));
        if (splitSuppressed)
        {
            return SuppressedEnps(period);
        }

        return new EnpsResult(enps, promoters, passives, detractors, scores.Count, false, period);
    }

    private static EnpsResult SuppressedEnps(string period) =>
        new(null, null, null, null, null, true, period);

    // ── summarizeSurveyResults ────────────────────────────────────────────────────
    public static SurveyResultsSummary SummarizeSurveyResults(
        IReadOnlyList<JsonObject> questions,
        IReadOnlyList<JsonObject> responseAnswers)
    {
        var totalResponses = responseAnswers.Count;
        if (Suppress(totalResponses))
        {
            return new SurveyResultsSummary(null, true, Array.Empty<QuestionSummary>());
        }

        var rawSummaries = new List<QuestionSummary>(questions.Count);
        foreach (var q in questions)
        {
            var text = q["text"];
            var type = q["type"];
            var key = JsValue.StringKey(text);

            // answers = responses.map(r => r.answers?.[q.text]).filter(Boolean)
            var truthy = responseAnswers
                .Select(a => (JsonNode?)a[key])
                .Where(JsValue.Truthy)
                .ToList();

            if (IsScale(type))
            {
                var nums = truthy.Select(JsValue.Number).Where(n => !double.IsNaN(n)).ToList();
                var skipped = totalResponses - nums.Count;
                if (Suppress(nums.Count) || Suppress(skipped))
                {
                    rawSummaries.Add(new QuestionSummary(Clone(text), Clone(type), null, null, true));
                    continue;
                }

                var avg = nums.Count > 0 ? nums.Sum() / nums.Count : 0d;
                rawSummaries.Add(new QuestionSummary(Clone(text), Clone(type), Round2(avg), nums.Count, false));
            }
            else
            {
                var skipped = totalResponses - truthy.Count;
                if (Suppress(truthy.Count) || Suppress(skipped))
                {
                    rawSummaries.Add(new QuestionSummary(Clone(text), Clone(type), null, null, true));
                    continue;
                }

                rawSummaries.Add(new QuestionSummary(Clone(text), Clone(type), null, truthy.Count, false));
            }
        }

        if (rawSummaries.Any(s => s.Suppressed))
        {
            return new SurveyResultsSummary(totalResponses, true, Array.Empty<QuestionSummary>());
        }

        return new SurveyResultsSummary(totalResponses, false, rawSummaries);
    }

    // ── buildClimateHeatmap ───────────────────────────────────────────────────────
    public static ClimateHeatmap BuildClimateHeatmap(
        IReadOnlyList<JsonObject> questions,
        IReadOnlyList<JsonObject> responseAnswers)
    {
        if (Suppress(responseAnswers.Count))
        {
            return new ClimateHeatmap(true, Array.Empty<HeatCell>());
        }

        // categories = [...new Set(questions.map(q => q.category).filter(Boolean))] — first-seen order, deduped.
        var categories = new List<string>();
        var seen = new HashSet<string>(StringComparer.Ordinal);
        foreach (var q in questions)
        {
            var cat = q["category"];
            if (!JsValue.Truthy(cat))
            {
                continue;
            }

            var catStr = JsValue.StringKey(cat);
            if (seen.Add(catStr))
            {
                categories.Add(catStr);
            }
        }

        var perCategory = categories.Select(cat =>
        {
            // catQuestions = questions.filter(q => q.category === cat) — strict string equality.
            var catQuestions = questions
                .Where(q => q["category"] is { } c && c.GetValueKind() == JsonValueKind.String && c.GetValue<string>() == cat)
                .ToList();

            var contributors = 0;
            var scores = new List<double>();
            foreach (var a in responseAnswers)
            {
                var rowScores = catQuestions
                    .Select(q => JsValue.NumberOfKey(a, JsValue.StringKey(q["text"])))
                    .Where(n => !double.IsNaN(n))
                    .ToList();
                if (rowScores.Count > 0)
                {
                    contributors += 1;
                }

                scores.AddRange(rowScores);
            }

            return (Cat: cat, Scores: scores, Contributors: contributors);
        }).ToList();

        var anyCategorySuppressed = perCategory.Any(c =>
            Suppress(c.Contributors) || Suppress(responseAnswers.Count - c.Contributors));
        if (anyCategorySuppressed)
        {
            return new ClimateHeatmap(true, perCategory.Select(c => new HeatCell(c.Cat, null)).ToList());
        }

        var data = perCategory.Select(c =>
        {
            var avg = c.Scores.Count > 0 ? c.Scores.Sum() / c.Scores.Count : 0d;
            return new HeatCell(c.Cat, Round2(avg));
        }).ToList();
        return new ClimateHeatmap(false, data);
    }

    // ── buildResultsByArea ────────────────────────────────────────────────────────
    public static ResultsByArea BuildResultsByArea(IReadOnlyList<AreaResultRow> rows)
    {
        var order = new List<string>();
        var groups = new Dictionary<string, (List<double> Scores, int Respondents, int NumericContributors)>(StringComparer.Ordinal);
        var skippedCount = 0;

        foreach (var r in rows)
        {
            if (string.IsNullOrEmpty(r.AreaKey))
            {
                skippedCount += 1;
                continue;
            }

            if (!groups.TryGetValue(r.AreaKey, out var g))
            {
                g = (new List<double>(), 0, 0);
                order.Add(r.AreaKey);
            }

            // vals = Object.values(answers ?? {}).map(Number).filter(!isNaN)
            var vals = r.Answers is null
                ? new List<double>()
                : r.Answers.Select(kv => JsValue.Number(kv.Value)).Where(n => !double.IsNaN(n)).ToList();

            g.Respondents += 1;
            if (vals.Count > 0)
            {
                g.NumericContributors += 1;
            }

            g.Scores.AddRange(vals);
            groups[r.AreaKey] = g;
        }

        var anyAreaSuppressed = groups.Values.Any(a =>
            Suppress(a.Respondents)
            || Suppress(a.NumericContributors)
            || Suppress(a.Respondents - a.NumericContributors))
            || Suppress(skippedCount);

        if (Suppress(rows.Count) || anyAreaSuppressed)
        {
            return new ResultsByArea(Array.Empty<AreaResult>(), true);
        }

        var results = order.Select(id =>
        {
            var g = groups[id];
            var average = g.Scores.Count > 0 ? Round2(g.Scores.Sum() / g.Scores.Count) : 0d;
            return new AreaResult(id, average, g.Respondents, false);
        }).ToList();
        return new ResultsByArea(results, false);
    }

    // ── buildEngagementKpis ───────────────────────────────────────────────────────
    public static EngagementKpis BuildEngagementKpis(
        int activeSurveys,
        int totalResponses,
        IReadOnlyList<int> perSurveyCounts,
        int actionPlansOpen)
    {
        var anySurveySubFloor = perSurveyCounts.Any(Suppress);
        var totalResponsesSuppressed = Suppress(totalResponses) || anySurveySubFloor;
        return new EngagementKpis(
            activeSurveys,
            totalResponsesSuppressed ? null : totalResponses,
            totalResponsesSuppressed,
            actionPlansOpen,
            0);
    }

    // ── JS-coercion + rounding helpers ────────────────────────────────────────────

    // Math.round(avg * 100) / 100 — JS half-up (NOT banker's), 2-decimal.
    private static double Round2(double avg) => ReportingMath.JsRound(avg * 100) / 100d;

    private static JsonNode? Clone(JsonNode? node) => node?.DeepClone();

    private static bool IsScale(JsonNode? type) =>
        type?.GetValueKind() == JsonValueKind.String && type.GetValue<string>() == ScaleType;
}
