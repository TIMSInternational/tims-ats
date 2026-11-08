using System.Text.Json;
using System.Text.Json.Nodes;

namespace Tims.Domain.FitEngine;

/// <summary>Stable codes for why an <c>assessments[]</c> entry was dropped or changed by the writer.</summary>
public static class FitRequirementIssueCodes
{
    public const string NotAnObject = "not_an_object";
    public const string UnknownInstrument = "unknown_instrument";
    public const string InvalidUse = "invalid_use";
    public const string InvalidMinimum = "invalid_minimum";
    public const string DuplicateInstrument = "duplicate_instrument";
    public const string TooManyEntries = "too_many_entries";
    public const string UseCoercedToAdvisory = "use_coerced_to_advisory";
    public const string InvalidWeight = "invalid_weight";
    public const string WeightIgnored = "weight_ignored";
    public const string ReasonDropped = "reason_dropped";
}

/// <summary>One finding about an <c>assessments[]</c> entry: its index in the request, and whether it was kept.</summary>
public sealed record FitRequirementIssue(int Index, string? Instrument, string Code, bool Dropped);

/// <summary>The validated <c>fit_requirements</c> a writer stores, plus what it dropped or changed.</summary>
public sealed record FitRequirementsWrite(JsonObject FitRequirements, bool ReplacesAssessments, IReadOnlyList<FitRequirementIssue> Issues);

/// <summary>
/// The C#-owned <c>fit_requirements</c> writer's input rules. The three v1 keys keep the TS
/// <c>updateFitRequirements</c> contract (each optional; an absent key is not stored). <c>assessments</c>:
/// <list type="bullet">
/// <item>absent → the stored array is KEPT (the writer merges it; the TS card used to erase it);</item>
/// <item><c>null</c> → removed (the vacancy goes back to v1 scoring);</item>
/// <item>an array → replaced by its valid entries, normalized to <c>{instrument, use, min, weight?, reason?}</c> by
/// the same rules FIT v2 reads them with (<see cref="FitV2Kernels.ParseAssessmentRequirements"/>), so what is stored
/// is exactly what is scored. Every dropped or changed entry is reported. A non-empty array in which nothing
/// survives is refused (<see cref="Validate"/> returns null): FIT v2 would read it as v1, silently.</item>
/// </list>
/// </summary>
public static class FitRequirementsInput
{
    public const double MaxYearsExperience = 60;
    public const int MaxLanguages = 20;
    public const int MaxLanguageLength = 50;

    /// <summary>A request with more entries is refused outright (past 32 they are reported and dropped).</summary>
    public const int MaxAssessmentEntriesInRequest = 64;

    public static readonly IReadOnlyList<string> EducationLevels =
        ["high_school", "associate", "bachelor", "master", "phd"];

    /// <summary>
    /// Validates a request body. Returns null with <paramref name="error"/> set when the body is invalid (a v1 key
    /// out of bounds, <c>assessments</c> neither null nor an array, or a non-empty array with no valid entry).
    /// </summary>
    public static FitRequirementsWrite? Validate(JsonNode? body, out string? error, out IReadOnlyList<FitRequirementIssue> issues)
    {
        error = null;
        issues = [];
        if (body is not JsonObject input)
        {
            error = "invalid_input";
            return null;
        }

        var stored = new JsonObject();
        if (input.TryGetPropertyValue("minYearsExperience", out var years) && years is not null)
        {
            if (years is not JsonValue yv || yv.GetValueKind() != JsonValueKind.Number
                || yv.GetValue<double>() is not (>= 0 and <= MaxYearsExperience))
            {
                error = "invalid_min_years_experience";
                return null;
            }

            stored["minYearsExperience"] = yv.GetValue<double>();
        }

        if (input.TryGetPropertyValue("requiredEducationLevel", out var level) && level is not null)
        {
            if (level is not JsonValue lv || !lv.TryGetValue<string>(out var levelText)
                || !EducationLevels.Contains(levelText))
            {
                error = "invalid_education_level";
                return null;
            }

            stored["requiredEducationLevel"] = levelText;
        }

        if (input.TryGetPropertyValue("requiredLanguages", out var languages) && languages is not null)
        {
            if (languages is not JsonArray list || list.Count > MaxLanguages)
            {
                error = "invalid_required_languages";
                return null;
            }

            var copy = new JsonArray();
            foreach (var item in list)
            {
                if (item is not JsonValue v || !v.TryGetValue<string>(out var language)
                    || language.Length is < 1 or > MaxLanguageLength)
                {
                    error = "invalid_required_languages";
                    return null;
                }

                copy.Add(language);
            }

            stored["requiredLanguages"] = copy;
        }

        if (!input.TryGetPropertyValue("assessments", out var assessments))
        {
            return new FitRequirementsWrite(stored, ReplacesAssessments: false, []);
        }

        if (assessments is null)
        {
            return new FitRequirementsWrite(stored, ReplacesAssessments: true, []);
        }

        if (assessments is not JsonArray entries || entries.Count > MaxAssessmentEntriesInRequest)
        {
            error = "invalid_assessments";
            return null;
        }

        var (kept, found) = NormalizeAssessments(entries);
        issues = found;
        if (kept.Count == 0 && entries.Count > 0)
        {
            error = "no_valid_assessment";
            return null;
        }

        stored["assessments"] = kept;
        return new FitRequirementsWrite(stored, ReplacesAssessments: true, found);
    }

    /// <summary>The valid entries, normalized, and every finding (dropped entries and changed fields).</summary>
    public static (JsonArray Kept, IReadOnlyList<FitRequirementIssue> Issues) NormalizeAssessments(JsonArray entries)
    {
        var kept = new JsonArray();
        var issues = new List<FitRequirementIssue>();
        var seen = new HashSet<string>(StringComparer.Ordinal);
        for (var i = 0; i < entries.Count; i++)
        {
            var instrument = InstrumentOf(entries[i]);
            if (i >= FitV2Kernels.MaxRequirementEntries)
            {
                issues.Add(new FitRequirementIssue(i, instrument, FitRequirementIssueCodes.TooManyEntries, Dropped: true));
                continue;
            }

            var codes = new List<string>();
            var parsed = FitV2Kernels.TryParseRequirement(entries[i], codes);
            if (parsed is not null && !seen.Add(parsed.Instrument))
            {
                codes.Add(FitRequirementIssueCodes.DuplicateInstrument);
                parsed = null;
            }

            // Dropped: the entry is not stored at all. Otherwise the code names a field that was changed or ignored.
            foreach (var code in codes)
            {
                issues.Add(new FitRequirementIssue(i, parsed?.Instrument ?? instrument, code, Dropped: parsed is null));
            }

            if (parsed is not null)
            {
                kept.Add(ToStoredJson(parsed));
            }
        }

        return (kept, issues);
    }

    /// <summary>
    /// One requirement as the writer stores it. Reading it back with
    /// <see cref="FitV2Kernels.ParseAssessmentRequirements"/> gives the same requirement (English drops its weight:
    /// owner default D3).
    /// </summary>
    public static JsonObject ToStoredJson(AssessmentRequirement requirement)
    {
        var json = new JsonObject
        {
            ["instrument"] = requirement.Instrument,
            ["use"] = requirement.Use,
            ["min"] = FitV2Kernels.MinimumToJson(requirement.Min),
        };
        if (requirement.Weight is { } weight && requirement.Instrument != FitInstruments.English)
        {
            json["weight"] = weight;
        }

        if (requirement.Reason is { } reason)
        {
            json["reason"] = reason;
        }

        return json;
    }

    private static string? InstrumentOf(JsonNode? entry) =>
        entry is JsonObject e && e["instrument"] is JsonValue v && v.TryGetValue<string>(out var s)
            && FitInstruments.All.Contains(s.Trim().ToLowerInvariant())
            ? s.Trim().ToLowerInvariant()
            : null;
}
