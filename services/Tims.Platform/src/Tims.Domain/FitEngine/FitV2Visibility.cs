using System.Text.Json.Nodes;
using Tims.Domain.Access;

namespace Tims.Domain.FitEngine;

/// <summary>
/// Owner default D6 (2026-11-08): a narrow-scoped reader (a team leader) sees only "below minimum" for an instrument
/// the candidate did not meet, never the exact level nor a derived fit that reveals it. HR and admins (company or
/// organization scope) see the stored row unchanged.
///
/// <para>Why the derived fit must go too: below the minimum the per-instrument fit is invertible (the English and
/// ITC-IA ladders are one-to-one there, and the LIA curve inverts as <c>p = score × min / 100</c>). The
/// <c>assessment</c> dimension is a known-weight mean of those fits, and the overall score is a known-weight mean of
/// the dimensions, so both invert too. A redacted row therefore drops the entry's <c>score</c> (and sets
/// <c>belowMinimum: true</c>), drops the <c>assessment</c> dimension when the entry feeds it, and the caller
/// recomputes the overall from the dimensions that remain.</para>
///
/// <para>English (owner default D3) feeds only <c>languages</c>, where it is covered or not: that is exactly
/// "below minimum", so the languages dimension stays. A gate already shows only met / not met. A native quiz with
/// no minimum has no "below minimum" and is left as is. A v1 row (no <c>fitVersion: 2</c>) is never touched.</para>
/// </summary>
public static class FitV2Visibility
{
    /// <summary>True for a reader below company scope (own, team, unit): the D6 redaction applies.</summary>
    public static bool HidesBelowMinimum(AccessScope scope) => scope < AccessScope.Company;

    /// <summary>
    /// The breakdown a narrow-scoped reader may see. Returns the input itself when nothing is below the minimum,
    /// else a redacted copy, and reports whether anything was hidden.
    /// </summary>
    public static JsonNode? RedactBelowMinimum(JsonNode? breakdown, out bool redacted)
    {
        redacted = false;
        if (breakdown is not JsonObject row
            || row["fitVersion"] is not JsonValue version
            || !version.TryGetValue<int>(out var v) || v != FitV2Kernels.FitVersion
            || row["assessments"] is not JsonArray entries)
        {
            return breakdown;
        }

        var hideAssessment = false;
        var belowIndexes = new List<int>();
        for (var i = 0; i < entries.Count; i++)
        {
            if (entries[i] is JsonObject entry && IsScoredBelowMinimum(entry))
            {
                belowIndexes.Add(i);
                hideAssessment |= !string.Equals(
                    entry["instrument"]?.GetValue<string>(), FitInstruments.English, StringComparison.Ordinal);
            }
        }

        if (belowIndexes.Count == 0)
        {
            return breakdown;
        }

        redacted = true;
        var copy = row.DeepClone().AsObject();
        var copiedEntries = copy["assessments"]!.AsArray();
        foreach (var i in belowIndexes)
        {
            var entry = copiedEntries[i]!.AsObject();
            entry["score"] = null;
            entry["belowMinimum"] = true;
        }

        if (hideAssessment)
        {
            copy["assessment"] = null;
        }

        return copy;
    }

    // A scored entry with a minimum whose fit is under 100 (every v2 curve is 100 at or above the minimum).
    private static bool IsScoredBelowMinimum(JsonObject entry) =>
        string.Equals(entry["use"]?.GetValue<string>(), FitInstrumentUses.Scored, StringComparison.Ordinal)
        && entry["min"] is JsonObject
        && entry["score"] is JsonValue score
        && score.TryGetValue<double>(out var value)
        && value < 100;
}
