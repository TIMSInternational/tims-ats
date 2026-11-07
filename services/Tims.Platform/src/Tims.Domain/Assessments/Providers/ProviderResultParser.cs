using System.Globalization;
using System.Text.Json;

namespace Tims.Domain.Assessments.Providers;

/// <summary>
/// One typed provider result (<c>AssessmentResult</c>: <c>LiaResultV1</c> … <c>PcaResultV1</c>) reduced to what the
/// ATS stores: the <c>ResultBase</c> fields, the validity, the versions an audit needs to reproduce a FIT entry, and the
/// one value FIT v2 judges each instrument on. <see cref="ScoresJson"/> is the provider's own <c>scores</c> object for
/// the HR view (AS-7); it never contains keys, items or norm tables (the contract forbids them).
/// </summary>
public sealed record ParsedProviderResult(
    Guid ResultId,
    string ResultSchema,
    string Instrument,
    string InstrumentVersion,
    Guid TenantId,
    Guid SubjectId,
    Guid AssignmentId,
    string Purpose,
    string? ExternalVacancyRef,
    DateTimeOffset CompletedAt,
    DateTimeOffset ScoredAt,
    int ResultRevision,
    string ValidityStatus,
    IReadOnlyList<string> ValidityReasons,
    string ContentVersion,
    string ContentSha256,
    string? NormVersion,
    string ScoringVersion,
    string ScoringMethod,
    decimal TimeMultiplierApplied,
    string RenderedFor,
    string RenderedLevel,
    string Completion,
    double? GlobalPercentile,
    string? Cefr,
    int? Level,
    bool RequiresHumanReview,
    string? ScoresJson);

/// <summary>
/// Parses and validates a provider result. The provider is another system: every field the ATS persists or decides on
/// is checked here (types, ranges, enum membership, the instrument ↔ <c>result_schema</c> pairing), and anything off
/// contract is rejected with a stable reason code instead of being stored.
/// </summary>
public static class ProviderResultParser
{
    /// <summary>Upper bound on the stored <c>scores</c> JSON (the largest contract example is under 4 KiB).</summary>
    public const int MaxScoresJsonLength = 65_536;

    private static readonly string[] Cefr = ["A1", "A2", "B1", "B2", "C1", "C2"];
    private static readonly string[] ScoringMethods = ["deterministic", "ai_assisted", "provider"];
    private static readonly string[] Audiences = ["subject", "tenant_hr", "platform"];

    public static bool TryParse(JsonElement root, out ParsedProviderResult? result, out string? error)
    {
        result = null;
        error = null;
        try
        {
            result = Parse(root);
            return true;
        }
        catch (ProviderResultFormatException ex)
        {
            error = ex.Code;
            return false;
        }
    }

    private static ParsedProviderResult Parse(JsonElement root)
    {
        if (root.ValueKind != JsonValueKind.Object)
        {
            throw new ProviderResultFormatException("result_not_object");
        }

        var instrument = RequireString(root, "instrument");
        if (!ProviderInstruments.IsKnown(instrument))
        {
            throw new ProviderResultFormatException("unknown_instrument");
        }

        var schema = RequireString(root, "result_schema");
        if (!string.Equals(ProviderInstruments.ResultSchemaFor(instrument), schema, StringComparison.Ordinal))
        {
            throw new ProviderResultFormatException("result_schema_mismatch");
        }

        var instrumentVersion = RequireString(root, "instrument_version");
        if (!ProviderFormats.IsInstrumentVersion(instrumentVersion))
        {
            throw new ProviderResultFormatException("invalid_instrument_version");
        }

        var purpose = RequireString(root, "purpose");
        if (purpose is not ("selection" or "development"))
        {
            throw new ProviderResultFormatException("invalid_purpose");
        }

        string? vacancyRef = null;
        if (root.TryGetProperty("vacancy", out var vacancy) && vacancy.ValueKind == JsonValueKind.Object)
        {
            vacancyRef = RequireString(vacancy, "external_vacancy_ref");
        }
        else if (purpose == "selection")
        {
            throw new ProviderResultFormatException("selection_without_vacancy");
        }

        var revision = RequireInt(root, "result_revision");
        if (revision < 1)
        {
            throw new ProviderResultFormatException("invalid_result_revision");
        }

        var validity = RequireObject(root, "validity");
        var validityStatus = RequireString(validity, "status");
        if (!ProviderValidity.IsKnown(validityStatus))
        {
            throw new ProviderResultFormatException("invalid_validity_status");
        }

        var reasons = RequireStringArray(validity, "reasons", maxItems: 10, maxLength: 64);
        if (validityStatus == ProviderValidity.Valid ? reasons.Count != 0 : reasons.Count == 0)
        {
            throw new ProviderResultFormatException("invalid_validity_reasons");
        }

        var contentVersion = RequireString(root, "content_version");
        var scoringVersion = RequireString(root, "scoring_version");
        if (!ProviderFormats.IsContentVersion(contentVersion) || !ProviderFormats.IsContentVersion(scoringVersion))
        {
            throw new ProviderResultFormatException("invalid_content_version");
        }

        var sha = RequireString(root, "content_sha256");
        if (!ProviderFormats.IsSha256(sha))
        {
            throw new ProviderResultFormatException("invalid_content_sha256");
        }

        string? normVersion = null;
        if (root.TryGetProperty("norm_version", out var norm) && norm.ValueKind != JsonValueKind.Null)
        {
            normVersion = norm.ValueKind == JsonValueKind.String ? norm.GetString() : null;
            if (!ProviderFormats.IsContentVersion(normVersion))
            {
                throw new ProviderResultFormatException("invalid_norm_version");
            }
        }

        var scoringMethod = RequireString(root, "scoring_method");
        if (!ScoringMethods.Contains(scoringMethod, StringComparer.Ordinal))
        {
            throw new ProviderResultFormatException("invalid_scoring_method");
        }

        var accommodations = RequireObject(root, "accommodations_applied");
        var multiplier = RequireDecimal(accommodations, "time_multiplier");
        if (multiplier < AccommodationAids.MinTimeMultiplier || multiplier > AccommodationAids.MaxTimeMultiplier)
        {
            throw new ProviderResultFormatException("invalid_time_multiplier");
        }

        var visibility = RequireObject(root, "visibility");
        var renderedFor = RequireString(visibility, "rendered_for");
        var renderedLevel = RequireString(visibility, "rendered_level");
        if (!Audiences.Contains(renderedFor, StringComparer.Ordinal) || renderedLevel is not ("summary" or "full"))
        {
            throw new ProviderResultFormatException("invalid_visibility");
        }

        var summary = RequireObject(root, "summary");
        var completion = RequireString(summary, "completion");
        if (completion is not ("complete" or "partial"))
        {
            throw new ProviderResultFormatException("invalid_completion");
        }

        JsonElement? scores = root.TryGetProperty("scores", out var s) && s.ValueKind == JsonValueKind.Object ? s : null;
        string? scoresJson = null;
        if (scores is { } present)
        {
            if (renderedLevel != "full")
            {
                // ScoresByVisibility: a summary projection never carries scores.
                throw new ProviderResultFormatException("scores_above_rendered_level");
            }

            scoresJson = present.GetRawText();
            if (scoresJson.Length > MaxScoresJsonLength)
            {
                throw new ProviderResultFormatException("scores_too_large");
            }
        }

        var (percentile, cefr, level, humanReview) = ExtractFitValue(instrument, summary, scores);

        return new ParsedProviderResult(
            RequireGuid(root, "result_id"),
            schema,
            instrument,
            instrumentVersion,
            RequireGuid(root, "tenant_id"),
            RequireGuid(root, "subject_id"),
            RequireGuid(root, "assignment_id"),
            purpose,
            vacancyRef,
            RequireTimestamp(root, "completed_at"),
            RequireTimestamp(root, "scored_at"),
            revision,
            validityStatus,
            reasons,
            contentVersion,
            sha,
            normVersion,
            scoringVersion,
            scoringMethod,
            multiplier,
            renderedFor,
            renderedLevel,
            completion,
            percentile,
            cefr,
            level,
            humanReview,
            scoresJson);
    }

    /// <summary>
    /// The value FIT v2 judges each instrument on, from the full <c>scores</c> when present, else from the generic
    /// <c>summary</c> headline (the contract guarantees the scale id, so a mismatched scale is ignored, not guessed):
    /// LIA's global percentile (null on a partial battery), English's overall CEFR, ITC-IA's global level (1..5).
    /// Personality, MI and PCA are advisory: no value is read.
    /// </summary>
    private static (double? Percentile, string? Cefr, int? Level, bool HumanReview) ExtractFitValue(
        string instrument, JsonElement summary, JsonElement? scores)
    {
        switch (instrument)
        {
            case ProviderInstruments.Lia:
                {
                    if (scores is { } liaScores)
                    {
                        var battery = OptionalString(liaScores, "battery");
                        if (battery != "full")
                        {
                            return (null, null, null, false);
                        }

                        return liaScores.TryGetProperty("global", out var global) && global.ValueKind == JsonValueKind.Object
                            ? (OptionalPercentile(global, "percentile"), null, null, false)
                            : (null, null, null, false);
                    }

                    if (OptionalString(summary, "completion") != "complete")
                    {
                        return (null, null, null, false);
                    }

                    return summary.TryGetProperty("headline_percentile", out var headline)
                        && headline.ValueKind == JsonValueKind.Object
                        && OptionalString(headline, "scale_id") == "lia.percentile"
                            ? (OptionalPercentile(headline, "value"), null, null, false)
                            : (null, null, null, false);
                }

            case ProviderInstruments.English:
                {
                    JsonElement? level = null;
                    if (scores is { } englishScores
                        && englishScores.TryGetProperty("overall", out var overall) && overall.ValueKind == JsonValueKind.Object
                        && overall.TryGetProperty("cefr", out var cefrNode) && cefrNode.ValueKind == JsonValueKind.Object)
                    {
                        level = cefrNode;
                    }
                    else if (summary.TryGetProperty("headline_level", out var headline) && headline.ValueKind == JsonValueKind.Object)
                    {
                        level = headline;
                    }

                    if (level is { } l && OptionalString(l, "scale_id") == "english.cefr")
                    {
                        var code = OptionalString(l, "code");
                        return (null, code is not null && Cefr.Contains(code, StringComparer.Ordinal) ? code : null, null, false);
                    }

                    return (null, null, null, false);
                }

            case ProviderInstruments.Itcia:
                {
                    var humanReview = false;
                    JsonElement? level = null;
                    if (scores is { } itciaScores)
                    {
                        humanReview = itciaScores.TryGetProperty("requires_human_review", out var hr)
                            && hr.ValueKind == JsonValueKind.True;
                        if (itciaScores.TryGetProperty("global_level", out var gl) && gl.ValueKind == JsonValueKind.Object)
                        {
                            level = gl;
                        }
                    }
                    else if (summary.TryGetProperty("headline_level", out var headline) && headline.ValueKind == JsonValueKind.Object)
                    {
                        level = headline;
                    }

                    if (level is { } l && OptionalString(l, "scale_id") == "itcia.level"
                        && l.TryGetProperty("ordinal", out var ordinal) && ordinal.TryGetInt32(out var value)
                        && value is >= 1 and <= 5)
                    {
                        return (null, null, value, humanReview);
                    }

                    return (null, null, null, humanReview);
                }

            default:
                return (null, null, null, false);
        }
    }

    private static double? OptionalPercentile(JsonElement obj, string name)
    {
        if (!obj.TryGetProperty(name, out var node) || node.ValueKind != JsonValueKind.Number
            || !node.TryGetDouble(out var value) || double.IsNaN(value) || value < 0 || value > 100)
        {
            return null;
        }

        return value;
    }

    private static string? OptionalString(JsonElement obj, string name) =>
        obj.TryGetProperty(name, out var node) && node.ValueKind == JsonValueKind.String ? node.GetString() : null;

    private static JsonElement RequireObject(JsonElement obj, string name) =>
        obj.TryGetProperty(name, out var node) && node.ValueKind == JsonValueKind.Object
            ? node
            : throw new ProviderResultFormatException($"missing_{name}");

    private static string RequireString(JsonElement obj, string name)
    {
        if (!obj.TryGetProperty(name, out var node) || node.ValueKind != JsonValueKind.String
            || node.GetString() is not { Length: > 0 and <= 256 } value)
        {
            throw new ProviderResultFormatException($"missing_{name}");
        }

        return value;
    }

    private static int RequireInt(JsonElement obj, string name) =>
        obj.TryGetProperty(name, out var node) && node.ValueKind == JsonValueKind.Number && node.TryGetInt32(out var value)
            ? value
            : throw new ProviderResultFormatException($"missing_{name}");

    private static decimal RequireDecimal(JsonElement obj, string name) =>
        obj.TryGetProperty(name, out var node) && node.ValueKind == JsonValueKind.Number && node.TryGetDecimal(out var value)
            ? value
            : throw new ProviderResultFormatException($"missing_{name}");

    private static Guid RequireGuid(JsonElement obj, string name) =>
        Guid.TryParseExact(RequireString(obj, name), "D", out var value)
            ? value
            : throw new ProviderResultFormatException($"invalid_{name}");

    private static DateTimeOffset RequireTimestamp(JsonElement obj, string name) =>
        DateTimeOffset.TryParse(RequireString(obj, name), CultureInfo.InvariantCulture,
            DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal, out var value)
            ? value
            : throw new ProviderResultFormatException($"invalid_{name}");

    private static List<string> RequireStringArray(JsonElement obj, string name, int maxItems, int maxLength)
    {
        if (!obj.TryGetProperty(name, out var node) || node.ValueKind != JsonValueKind.Array
            || node.GetArrayLength() > maxItems)
        {
            throw new ProviderResultFormatException($"invalid_{name}");
        }

        var values = new List<string>();
        foreach (var item in node.EnumerateArray())
        {
            if (item.ValueKind != JsonValueKind.String || item.GetString() is not { Length: > 0 } value
                || value.Length > maxLength)
            {
                throw new ProviderResultFormatException($"invalid_{name}");
            }

            values.Add(value);
        }

        return values;
    }

    private sealed class ProviderResultFormatException(string code) : Exception(code)
    {
        public string Code { get; } = code;
    }
}
