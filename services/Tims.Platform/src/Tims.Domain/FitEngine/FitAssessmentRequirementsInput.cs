using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Tims.Domain.Assessments.Providers;

namespace Tims.Domain.FitEngine;

/// <summary>The validated <c>assessments[]</c> a vacancy editor replaces, the version it was edited from, and notes.</summary>
public sealed record FitAssessmentRequirementsWrite(
    JsonArray Assessments, string ExpectedVersion, IReadOnlyList<FitRequirementIssue> Issues);

/// <summary>
/// The STRICT input rules of the vacancy assessments editor (<c>PUT /fit-engine/vacancies/{id}/requirements/assessments</c>).
/// Unlike the lenient requirements writer (<see cref="FitRequirementsInput"/>, which drops and reports), nothing here is
/// silently dropped: an editor submits exactly what HR configured, so any entry the FIT v2 parser would drop refuses the
/// whole write, and so does an entry without a job-relatedness reason (assessment-platform design §6.3: a test may be
/// assigned only if the vacancy lists it, WITH a reason; every candidate of the vacancy is then assessed for that
/// reason). Field changes the parser makes without dropping (an advisory-only instrument's use, an ignored weight, the
/// LIA threshold policy of owner default D20) are kept and reported, as the lenient writer does.
/// <para>The body is <c>{ "assessments": [...], "expectedVersion": "&lt;32 hex&gt;" }</c>, nothing else: the version is the
/// one the editor read, and the write is conditional on it (optimistic concurrency, enforced in the database).</para>
/// </summary>
public static partial class FitAssessmentRequirementsInput
{
    /// <summary>
    /// A kept entry with no usable reason: absent, blank, or one the assignment would refuse
    /// (<see cref="ProviderFormats.IsReason"/>: 3 to 500 characters, no control characters). The vacancy's reason is what
    /// every assignment sends, so an editor must never store one that makes assigning fail.
    /// </summary>
    public const string ReasonRequired = "reason_required";

    [GeneratedRegex("^[0-9a-f]{32}$", RegexOptions.CultureInvariant)]
    private static partial Regex VersionPattern();

    /// <summary>True for a version token as the database computes it (an md5 hex digest).</summary>
    public static bool IsVersion(string? value) => value is not null && VersionPattern().IsMatch(value);

    /// <summary>
    /// Validates an editor body. Returns null with <paramref name="error"/> set (and the offending entries in
    /// <paramref name="issues"/>) when nothing may be written: <c>invalid_input</c> (not the two-key object, or a bad
    /// version), <c>invalid_assessments</c> (not an array, too many entries, or an entry the parser would drop or that
    /// lacks a reason).
    /// </summary>
    public static FitAssessmentRequirementsWrite? Validate(
        JsonNode? body, bool liaScoredAllowed, out string? error, out IReadOnlyList<FitRequirementIssue> issues)
    {
        error = null;
        issues = [];
        if (body is not JsonObject input
            || input.Any(p => p.Key is not ("assessments" or "expectedVersion"))
            || input["expectedVersion"] is not JsonValue versionNode
            || !versionNode.TryGetValue<string>(out var version)
            || !IsVersion(version))
        {
            error = "invalid_input";
            return null;
        }

        if (input["assessments"] is not JsonArray entries || entries.Count > FitV2Kernels.MaxRequirementEntries)
        {
            error = "invalid_assessments";
            return null;
        }

        var (kept, found) = FitRequirementsInput.NormalizeAssessments(entries, liaScoredAllowed);
        var refused = found.Where(i => i.Dropped).ToList();

        // With no entry dropped, kept[i] is entries[i]: the reason check can name the request index.
        if (refused.Count == 0)
        {
            for (var i = 0; i < kept.Count; i++)
            {
                if (kept[i] is JsonObject entry
                    && (entry["reason"] is not JsonValue reason || !ProviderFormats.IsReason(reason.GetValue<string>())))
                {
                    refused.Add(new FitRequirementIssue(i, entry["instrument"]?.GetValue<string>(), ReasonRequired, Dropped: true));
                }
            }
        }

        if (refused.Count > 0)
        {
            error = "invalid_assessments";
            issues = refused;
            return null;
        }

        issues = found;
        return new FitAssessmentRequirementsWrite(kept, version, found);
    }
}
