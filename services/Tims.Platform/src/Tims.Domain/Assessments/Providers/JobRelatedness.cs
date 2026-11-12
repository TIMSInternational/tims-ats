using System.Text.Json;
using System.Text.Json.Nodes;
using Tims.Domain.FitEngine;

namespace Tims.Domain.Assessments.Providers;

/// <summary>
/// Job-relatedness (assessment-platform design §6.3): a provider instrument may be assigned for a vacancy only when the
/// vacancy lists it in <c>job_profiles.fit_requirements.assessments[]</c> (the FIT v2 shape:
/// <c>{"instrument":"lia","use":"scored","reason":"..."}</c>), and every assignment carries a reason the contract
/// sends as <c>vacancy.job_relatedness_reason</c>.
///
/// <para>The reason is the vacancy's own when it declares one, so every candidate of a vacancy is assessed for the same
/// stated reason; the request's reason is used only when the vacancy entry has none. This reads just the
/// <c>instrument</c> and <c>reason</c> keys; the full requirement grammar (use, min, weight) is FIT v2's parser.</para>
/// </summary>
public static class JobRelatedness
{
    /// <summary>
    /// The vacancy's TIMS position code for PCA, exactly as FIT v2 reads its requirements (so what is sent with the
    /// assignment is what the PCA entry is judged against), or null: no PCA entry, none with a code, or a malformed
    /// <c>fit_requirements</c>.
    /// </summary>
    public static string? PcaJobCode(string? fitRequirementsJson)
    {
        if (string.IsNullOrWhiteSpace(fitRequirementsJson))
        {
            return null;
        }

        try
        {
            var node = JsonNode.Parse(fitRequirementsJson, documentOptions: new JsonDocumentOptions { MaxDepth = 16 });
            return FitV2Kernels.ParseAssessmentRequirements(node)
                ?.FirstOrDefault(r => r.Instrument == FitInstruments.Pca)?.JobCode;
        }
        catch (JsonException)
        {
            return null;
        }
    }

    /// <summary>Instrument → the vacancy's declared reason (null when the entry declares none). Unknown ids are dropped.</summary>
    public static IReadOnlyDictionary<string, string?> ParseListedInstruments(string? fitRequirementsJson)
    {
        var listed = new Dictionary<string, string?>(StringComparer.Ordinal);
        if (string.IsNullOrWhiteSpace(fitRequirementsJson))
        {
            return listed;
        }

        try
        {
            using var document = JsonDocument.Parse(fitRequirementsJson, new JsonDocumentOptions { MaxDepth = 16 });
            if (document.RootElement.ValueKind != JsonValueKind.Object
                || !document.RootElement.TryGetProperty("assessments", out var assessments)
                || assessments.ValueKind != JsonValueKind.Array)
            {
                return listed;
            }

            foreach (var entry in assessments.EnumerateArray())
            {
                if (entry.ValueKind != JsonValueKind.Object
                    || !entry.TryGetProperty("instrument", out var instrumentNode)
                    || instrumentNode.ValueKind != JsonValueKind.String
                    || instrumentNode.GetString() is not { } instrument
                    || !ProviderInstruments.IsKnown(instrument)
                    || listed.ContainsKey(instrument))
                {
                    continue;
                }

                string? reason = null;
                if (entry.TryGetProperty("reason", out var reasonNode) && reasonNode.ValueKind == JsonValueKind.String)
                {
                    var trimmed = reasonNode.GetString()?.Trim();
                    reason = ProviderFormats.IsReason(trimmed) ? trimmed : null;
                }

                listed[instrument] = reason;
            }
        }
        catch (JsonException)
        {
            // A malformed fit_requirements lists nothing, which fails closed: nothing can be assigned.
        }

        return listed;
    }

    /// <summary>The reason to send: the vacancy's, else the request's (when well-formed), else null (refuse).</summary>
    public static string? EffectiveReason(string? vacancyReason, string? requestReason)
    {
        if (vacancyReason is not null)
        {
            return vacancyReason;
        }

        var trimmed = requestReason?.Trim();
        return ProviderFormats.IsReason(trimmed) ? trimmed : null;
    }
}
