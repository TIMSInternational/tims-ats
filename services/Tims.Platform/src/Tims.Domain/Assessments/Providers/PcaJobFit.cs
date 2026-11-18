using System.Text.Json;
using System.Text.Json.Nodes;
using Tims.Domain.FitEngine;

namespace Tims.Domain.Assessments.Providers;

/// <summary>A DISC profile on scale <c>pca.disc_0_100</c>: here, the position's (its completed JCA).</summary>
public sealed record DiscFactors(int D, int I, int S, int C);

/// <summary>
/// The provider's fit of a PCA to a vacancy's TIMS position code: the contract's <c>PcaResultV1.scores.job_fit</c>
/// (TIMS, 2026-11-12: the PCA-vs-JCA fit is TIMS's own formula, computed by its platform, never by the ATS).
/// <c>Fit</c> and <c>JobProfile</c> are set only when <c>Status</c> is <see cref="PcaJobFits.Computed"/>.
/// </summary>
public sealed record PcaJobFit(string JobCode, string Status, double? Fit, DiscFactors? JobProfile);

/// <summary>Reads <c>scores.job_fit</c> from a stored PCA result. Never throws; anything off contract reads as absent.</summary>
public static class PcaJobFits
{
    public const string Computed = "computed";
    public const string JobNotFound = "job_not_found";
    public const string Unavailable = "unavailable";

    /// <summary>The job fit of a stored <c>scores</c> JSON, or null (no job fit, or one that is not the contract shape).</summary>
    public static PcaJobFit? FromScoresJson(string? scoresJson)
    {
        if (string.IsNullOrWhiteSpace(scoresJson))
        {
            return null;
        }

        try
        {
            return JsonNode.Parse(scoresJson, documentOptions: new JsonDocumentOptions { MaxDepth = 16 }) is JsonObject scores
                ? FromScores(scores)
                : null;
        }
        catch (JsonException)
        {
            return null;
        }
    }

    /// <summary>The job fit of a parsed <c>scores</c> object, or null.</summary>
    public static PcaJobFit? FromScores(JsonObject scores)
    {
        ArgumentNullException.ThrowIfNull(scores);
        if (scores["job_fit"] is not JsonObject fit
            || Text(fit["job_code"]) is not { } code || !FitV2Kernels.IsJobCode(code)
            || Text(fit["analysis"]) != "fit")
        {
            return null;
        }

        switch (Text(fit["status"]))
        {
            case Computed:
                return Number(fit["fit"]) is { } value && value is >= 0 and <= 100
                    && fit["job_profile"] is JsonObject profile
                    && Factor(profile["d"]) is { } d && Factor(profile["i"]) is { } i
                    && Factor(profile["s"]) is { } s && Factor(profile["c"]) is { } c
                        ? new PcaJobFit(code, Computed, value, new DiscFactors(d, i, s, c))
                        : null;
            case JobNotFound:
                return new PcaJobFit(code, JobNotFound, null, null);
            case Unavailable:
                return new PcaJobFit(code, Unavailable, null, null);
            default:
                return null;
        }
    }

    private static string? Text(JsonNode? node) =>
        node is JsonValue v && v.TryGetValue<string>(out var s) ? s : null;

    private static double? Number(JsonNode? node) =>
        node is JsonValue v && v.GetValueKind() == JsonValueKind.Number && v.TryGetValue<double>(out var n) && double.IsFinite(n)
            ? n
            : null;

    private static int? Factor(JsonNode? node) =>
        Number(node) is { } n && n is >= 0 and <= 100 ? (int)Math.Round(n, MidpointRounding.AwayFromZero) : null;
}
