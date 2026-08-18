using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace Tims.Domain.FitEngine;

/// <summary>
/// The pure FIT-engine scoring kernels — a faithful port of the exported pure functions of
/// packages/api/src/services/fit-engine.service.ts (<c>computeWeightedScore</c>, <c>deriveExperienceScore</c>,
/// <c>deriveEducationScore</c>, <c>deriveLanguageScore</c>, <c>classifyEducationLevel</c> +
/// <c>parseRequirements</c>/<c>normalizeLanguage</c>). Golden-fixtured cross-stack against
/// contracts/fit-engine-fixtures/*.json (the SAME cases tests/fit-engine/kernels-fixtures.test.ts asserts
/// through the REAL TS exports).
///
/// Numeric parity: <see cref="JsRound"/> reproduces JS <c>Math.round</c> exactly (half toward +∞, so
/// −12.5 → −12, and the 0.49999999999999994 edge stays 0 — neither <c>MidpointRounding.AwayFromZero</c> nor
/// <c>Math.Floor(x + 0.5)</c> gets both right). Double additions run in the SAME dimension order as the TS
/// loops (float addition is order-dependent).
///
/// Malformed-jsonb divergence (documented in the slice doc, pinned by unit tests): where the TS cast-then-use
/// would THROW on garbage shapes (a non-array <c>education</c>/<c>languages</c>, a non-string language entry —
/// each an unhandled TypeError → 500), this port treats the malformed value as ABSENT (score null). Real rows
/// are CV-parser output and never hit either path; a clean null beats reproducing a crash.
/// </summary>
public static partial class FitEngineKernels
{
    /// <summary>The five FIT dimensions, in the TS <c>FIT_DIMENSIONS</c> iteration order (load-bearing for float math).</summary>
    public static readonly IReadOnlyList<string> FitDimensions =
        ["assessment", "interview", "experience", "education", "languages"];

    /// <summary>The education ladder, lowest → highest — index IS the ordinal (TS <c>EDUCATION_LEVELS</c>).</summary>
    public static readonly IReadOnlyList<string> EducationLevels =
        ["high_school", "associate", "bachelor", "master", "phd"];

    private static readonly IReadOnlyDictionary<string, string[]> EducationKeywords = new Dictionary<string, string[]>
    {
        ["high_school"] = ["high school", "bachiller", "secundaria"],
        ["associate"] = ["associate", "tecnico", "técnico", "technical degree"],
        ["bachelor"] = ["bachelor", "licenciatura", "ingenieria", "ingeniería", "bsc", "ba ", "b.s.", "b.a."],
        ["master"] = ["master", "maestria", "maestría", "msc", "mba", "m.s.", "m.a."],
        ["phd"] = ["phd", "doctorate", "doctorado", "ph.d"],
    };

    /// <summary>
    /// JS <c>Math.round</c>: nearest integer, exact halves toward +∞ (2.5 → 3, −2.5 → −2), NaN/±∞ pass through.
    /// The fractional comparison is against the true floor, so 0.49999999999999994 → 0 (where
    /// <c>Math.Floor(x + 0.5)</c> would give 1 — the + 0.5 rounds up in double arithmetic first).
    /// </summary>
    public static double JsRound(double value)
    {
        var floor = Math.Floor(value);
        return value - floor >= 0.5 ? floor + 1 : floor;
    }

    /// <summary>
    /// TS <c>computeWeightedScore</c>: renormalize over only the available (non-null) dimensions; a dimension
    /// missing from <paramref name="weights"/> weighs 0 (<c>weights[dim] ?? 0</c>). All five dims present under
    /// all-zero weights is availableWeight 0 → <c>{ 0, isPartial: true }</c> even though nothing was missing —
    /// a TS quirk this port reproduces (fixtured).
    /// </summary>
    public static WeightedScore ComputeWeightedScore(
        IReadOnlyDictionary<string, double?> rawScores,
        IReadOnlyDictionary<string, double> weights)
    {
        var weightedSum = 0d;
        var availableWeight = 0d;
        var missingAny = false;

        foreach (var dim in FitDimensions)
        {
            var raw = rawScores.TryGetValue(dim, out var value) ? value : null;
            var w = weights.TryGetValue(dim, out var weight) ? weight : 0d;
            if (raw is not { } present)
            {
                missingAny = true;
                continue;
            }

            weightedSum += present * w;
            availableWeight += w;
        }

        if (availableWeight == 0)
        {
            return new WeightedScore(0, true);
        }

        return new WeightedScore(JsRound(weightedSum / availableWeight), missingAny);
    }

    /// <summary>TS <c>deriveExperienceScore</c>: years vs. minYearsExperience, capped at 100; null if either side is unavailable.</summary>
    public static double? DeriveExperienceScore(double? yearsExperience, FitRequirements requirements)
    {
        if (requirements.MinYearsExperience is not { } minYears)
        {
            return null;
        }

        if (yearsExperience is not { } years)
        {
            return null;
        }

        if (minYears <= 0)
        {
            return 100;
        }

        return Math.Min(100, JsRound(years / minYears * 100));
    }

    /// <summary>
    /// TS <c>classifyEducationLevel</c>: keyword match on the lowercased degree label, checked from highest to
    /// lowest so "Master" isn't misclassified by a coincidental "bachelor" substring in a combined-degree label.
    /// Returns the level string or null. (TS <c>toLowerCase()</c> and <c>ToLowerInvariant()</c> agree on the
    /// ASCII/Latin-accent range these keywords live in.)
    /// </summary>
    public static string? ClassifyEducationLevel(string degree)
    {
        var lower = degree.ToLowerInvariant();
        for (var i = EducationLevels.Count - 1; i >= 0; i--)
        {
            var level = EducationLevels[i];
            if (EducationKeywords[level].Any(kw => lower.Contains(kw, StringComparison.Ordinal)))
            {
                return level;
            }
        }

        return null;
    }

    /// <summary>
    /// TS <c>deriveEducationScore</c>: the candidate's highest classified degree vs. the required ordinal.
    /// At/above → 100; below → proportional distance up the FULL 5-level ladder (<c>(h+1)/5*100</c>, not vs.
    /// the required ordinal). Null when the requirement, the education jsonb, or every classification is absent.
    /// Entries that are not objects, or whose <c>degree</c> is not a string, are skipped (TS <c>entry?.degree</c>
    /// typeof-guard). A NON-ARRAY education jsonb → null (TS would throw; see class doc).
    /// </summary>
    public static double? DeriveEducationScore(JsonNode? education, FitRequirements requirements)
    {
        if (requirements.RequiredEducationLevel is not { } requiredLevel)
        {
            return null;
        }

        if (education is not JsonArray entries || entries.Count == 0)
        {
            return null;
        }

        var highestOrdinal = -1;
        foreach (var entry in entries)
        {
            if (entry is not JsonObject obj
                || !obj.TryGetPropertyValue("degree", out var degreeNode)
                || degreeNode is not JsonValue degreeValue
                || !degreeValue.TryGetValue<string>(out var degree))
            {
                continue;
            }

            if (ClassifyEducationLevel(degree) is { } level)
            {
                highestOrdinal = Math.Max(highestOrdinal, IndexOf(EducationLevels, level));
            }
        }

        if (highestOrdinal == -1)
        {
            return null;
        }

        var requiredOrdinal = IndexOf(EducationLevels, requiredLevel);
        if (highestOrdinal >= requiredOrdinal)
        {
            return 100;
        }

        return JsRound((highestOrdinal + 1) / (double)EducationLevels.Count * 100);
    }

    /// <summary>
    /// TS <c>deriveLanguageScore</c>: proportion of requiredLanguages the candidate covers, case-insensitive,
    /// after stripping a trailing parenthetical proficiency (<c>"English (B2)"</c> → <c>"English"</c>) from BOTH
    /// sides. Null when either side is absent/empty. A duplicate required language counts every time it appears
    /// (TS <c>filter().length</c>). A non-array languages jsonb or a non-string entry is treated as absent
    /// (TS would throw; see class doc).
    /// </summary>
    public static double? DeriveLanguageScore(JsonNode? languages, FitRequirements requirements)
    {
        if (requirements.RequiredLanguages is not { Count: > 0 } required)
        {
            return null;
        }

        if (languages is not JsonArray spoken || spoken.Count == 0)
        {
            return null;
        }

        var candidateSet = new HashSet<string>(StringComparer.Ordinal);
        foreach (var entry in spoken)
        {
            if (entry is JsonValue value && value.TryGetValue<string>(out var language))
            {
                candidateSet.Add(NormalizeLanguage(language).ToLowerInvariant());
            }
        }

        var matched = required.Count(l => candidateSet.Contains(NormalizeLanguage(l).ToLowerInvariant()));
        return JsRound(matched / (double)required.Count * 100);
    }

    /// <summary>
    /// TS <c>parseRequirements</c>: lenient jsonb parse — non-object → empty; each field kept only when its JSON
    /// type matches (number / known-level string / all-string array — an EMPTY array is valid and kept).
    /// </summary>
    public static FitRequirements ParseRequirements(JsonNode? raw)
    {
        if (raw is not JsonObject obj)
        {
            return FitRequirements.Empty;
        }

        double? minYears = null;
        if (obj.TryGetPropertyValue("minYearsExperience", out var yearsNode)
            && yearsNode is JsonValue yearsValue
            && TryGetJsonNumber(yearsValue, out var years))
        {
            minYears = years;
        }

        string? requiredLevel = null;
        if (obj.TryGetPropertyValue("requiredEducationLevel", out var levelNode)
            && levelNode is JsonValue levelValue
            && levelValue.TryGetValue<string>(out var level)
            && EducationLevels.Contains(level))
        {
            requiredLevel = level;
        }

        IReadOnlyList<string>? requiredLanguages = null;
        if (obj.TryGetPropertyValue("requiredLanguages", out var langsNode) && langsNode is JsonArray langs)
        {
            var parsed = new List<string>(langs.Count);
            var allStrings = true;
            foreach (var entry in langs)
            {
                if (entry is JsonValue value && value.TryGetValue<string>(out var lang))
                {
                    parsed.Add(lang);
                }
                else
                {
                    allStrings = false;
                    break;
                }
            }

            if (allStrings)
            {
                requiredLanguages = parsed;
            }
        }

        return new FitRequirements(minYears, requiredLevel, requiredLanguages);
    }

    /// <summary>
    /// TS <c>normalizeLanguage</c>: strip a single trailing parenthetical qualifier + surrounding whitespace,
    /// then trim — <c>"English (B2)"</c> → <c>"English"</c>.
    /// </summary>
    public static string NormalizeLanguage(string language) =>
        TrailingParenthetical().Replace(language, string.Empty).Trim();

    /// <summary>
    /// Weights jsonb → the dictionary <see cref="ComputeWeightedScore"/> consumes: JSON-number values kept,
    /// anything else dropped (→ weighs 0 via the <c>?? 0</c> default). Router-written weights are Zod-validated
    /// numbers, so real rows never hit the drop path.
    /// </summary>
    public static IReadOnlyDictionary<string, double> ParseWeights(JsonNode? weights)
    {
        var parsed = new Dictionary<string, double>(StringComparer.Ordinal);
        if (weights is not JsonObject obj)
        {
            return parsed;
        }

        foreach (var (key, node) in obj)
        {
            if (node is JsonValue value && TryGetJsonNumber(value, out var number))
            {
                parsed[key] = number;
            }
        }

        return parsed;
    }

    /// <summary>
    /// A stored breakdown jsonb → the five raw dimension scores (<c>simulateWeights</c> reads them back from
    /// the row). A missing key, JSON null, or non-number value all read as null (missing).
    /// </summary>
    public static IReadOnlyDictionary<string, double?> ParseBreakdownScores(JsonNode? breakdown)
    {
        var scores = new Dictionary<string, double?>(StringComparer.Ordinal);
        foreach (var dim in FitDimensions)
        {
            double? score = null;
            if (breakdown is JsonObject obj
                && obj.TryGetPropertyValue(dim, out var node)
                && node is JsonValue value
                && TryGetJsonNumber(value, out var number))
            {
                score = number;
            }

            scores[dim] = score;
        }

        return scores;
    }

    // typeof x === 'number' — accept only a JSON-number-kind value (a string "5" or a bool must NOT parse).
    private static bool TryGetJsonNumber(JsonValue value, out double number)
    {
        if (value.GetValueKind() == JsonValueKind.Number)
        {
            number = value.GetValue<double>();
            return true;
        }

        number = 0;
        return false;
    }

    private static int IndexOf(IReadOnlyList<string> list, string value)
    {
        for (var i = 0; i < list.Count; i++)
        {
            if (string.Equals(list[i], value, StringComparison.Ordinal))
            {
                return i;
            }
        }

        return -1;
    }

    [GeneratedRegex(@"\s*\([^)]*\)\s*$")]
    private static partial Regex TrailingParenthetical();
}
