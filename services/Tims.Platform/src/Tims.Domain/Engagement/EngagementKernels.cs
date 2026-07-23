using System.Globalization;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.Json.Serialization;
using Tims.Domain.Access;
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
            var first = FirstValue(answers);
            double n;
            if (first is not null && first.GetValueKind() == JsonValueKind.Number)
            {
                n = first.GetValue<double>();
            }
            else if (first is not null && first.GetValueKind() == JsonValueKind.String)
            {
                n = JsParseInt(first.GetValue<string>());
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
            var key = StringKey(text);

            // answers = responses.map(r => r.answers?.[q.text]).filter(Boolean)
            var truthy = responseAnswers
                .Select(a => (JsonNode?)a[key])
                .Where(JsTruthy)
                .ToList();

            if (IsScale(type))
            {
                var nums = truthy.Select(JsNumber).Where(n => !double.IsNaN(n)).ToList();
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
            if (!JsTruthy(cat))
            {
                continue;
            }

            var catStr = StringKey(cat);
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
                    .Select(q => JsNumberOfKey(a, StringKey(q["text"])))
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
                : r.Answers.Select(kv => JsNumber(kv.Value)).Where(n => !double.IsNaN(n)).ToList();

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

    // Object.values(answers)[0] — the first property value (undefined ⇒ null when the object is empty).
    private static JsonNode? FirstValue(JsonObject answers)
    {
        foreach (var kv in answers)
        {
            return kv.Value;
        }

        return null;
    }

    // The string key a JS `answers[q.text]` lookup uses. Questions carry string text/category; a non-string
    // value is coerced via its JSON text (JS String() coercion), matching `q.text as string` at runtime.
    private static string StringKey(JsonNode? node) => node?.GetValueKind() == JsonValueKind.String
        ? node.GetValue<string>()
        : node?.ToJsonString() ?? "undefined";

    private static bool IsScale(JsonNode? type) =>
        type?.GetValueKind() == JsonValueKind.String && type.GetValue<string>() == ScaleType;

    // JS Boolean(x): null/undefined/false → false; "" → false; 0 → false; else true.
    private static bool JsTruthy(JsonNode? node)
    {
        if (node is null)
        {
            return false;
        }

        return node.GetValueKind() switch
        {
            JsonValueKind.Null => false,
            JsonValueKind.False => false,
            JsonValueKind.True => true,
            JsonValueKind.String => node.GetValue<string>().Length > 0,
            JsonValueKind.Number => node.GetValue<double>() != 0,
            _ => true, // object / array
        };
    }

    // JS Number(x) for a PRESENT value (a C#-null node = present JSON null → Number(null) = 0).
    private static double JsNumber(JsonNode? node)
    {
        if (node is null)
        {
            return 0; // Number(null) = 0
        }

        return node.GetValueKind() switch
        {
            JsonValueKind.Null => 0,
            JsonValueKind.True => 1,
            JsonValueKind.False => 0,
            JsonValueKind.Number => node.GetValue<double>(),
            JsonValueKind.String => JsStringToNumber(node.GetValue<string>()),
            _ => double.NaN, // object / array → NaN
        };
    }

    // JS Number(answers?.[key]): an ABSENT key is undefined → NaN; a present (incl. JSON-null) value → Number(v).
    private static double JsNumberOfKey(JsonObject answers, string key) =>
        answers.TryGetPropertyValue(key, out var node) ? JsNumber(node) : double.NaN;

    // JS Number(string) — FAITHFUL port (Codex Slice-11 M1): survey answers are decimal in practice, but a
    // numerically-aggregated field can carry any string, and JS Number() coerces the exotic grammars too — a
    // pasted "0x10" is 16 (a COUNTED k-anon contributor), not NaN. Reproduce the whole grammar so the
    // contributor counts / averages / suppression thresholds are byte-identical to the TS `.map(Number)` path:
    // trim; "" → 0; ±Infinity; 0x/0o/0b integer literals (NO sign permitted); else a decimal/scientific
    // StrDecimalLiteral → value, else NaN.
    private static double JsStringToNumber(string s)
    {
        var t = s.Trim();
        if (t.Length == 0)
        {
            return 0;
        }

        if (t is "Infinity" or "+Infinity")
        {
            return double.PositiveInfinity;
        }

        if (t == "-Infinity")
        {
            return double.NegativeInfinity;
        }

        // Radix-prefixed integer literals: JS Number() parses 0x/0o/0b WITHOUT a sign; empty digit run → NaN.
        if (t.Length > 2 && t[0] == '0')
        {
            var radix = char.ToLowerInvariant(t[1]) switch { 'x' => 16, 'o' => 8, 'b' => 2, _ => 0 };
            if (radix != 0)
            {
                return TryParseRadix(t.AsSpan(2), radix, out var rv) ? rv : double.NaN;
            }
        }

        return double.TryParse(t, NumberStyles.Float, CultureInfo.InvariantCulture, out var d) ? d : double.NaN;
    }

    // JS radix-integer parse for 0x/0o/0b (accumulated as double to match JS Number's IEEE-754 result on
    // large magnitudes). Any digit outside the radix (or an empty run) → NaN, matching Number().
    private static bool TryParseRadix(ReadOnlySpan<char> digits, int radix, out double value)
    {
        value = 0;
        if (digits.Length == 0)
        {
            return false;
        }

        double acc = 0;
        foreach (var c in digits)
        {
            var dv = c switch
            {
                >= '0' and <= '9' => c - '0',
                >= 'a' and <= 'f' => c - 'a' + 10,
                >= 'A' and <= 'F' => c - 'A' + 10,
                _ => -1,
            };
            if (dv < 0 || dv >= radix)
            {
                return false;
            }

            acc = (acc * radix) + dv;
        }

        value = acc;
        return true;
    }

    // JS parseInt(s, 10): skip leading whitespace, optional sign, read the leading decimal-digit run; no digits → NaN.
    private static double JsParseInt(string s)
    {
        var i = 0;
        var n = s.Length;
        while (i < n && char.IsWhiteSpace(s[i]))
        {
            i++;
        }

        var sign = 1;
        if (i < n && (s[i] == '+' || s[i] == '-'))
        {
            if (s[i] == '-')
            {
                sign = -1;
            }

            i++;
        }

        var start = i;
        while (i < n && s[i] >= '0' && s[i] <= '9')
        {
            i++;
        }

        if (i == start)
        {
            return double.NaN;
        }

        return sign * double.Parse(s[start..i], CultureInfo.InvariantCulture);
    }
}
