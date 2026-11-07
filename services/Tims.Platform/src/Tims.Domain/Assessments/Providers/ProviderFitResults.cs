namespace Tims.Domain.Assessments.Providers;

/// <summary>Whether a provider result may count toward FIT. Mirrors FIT v2's <c>ResultIntegrity</c>.</summary>
public enum ProviderResultIntegrity
{
    /// <summary>Server-timed, server-scored, <c>valid</c>, for selection, not awaiting review.</summary>
    Valid,

    /// <summary>Voided, flagged or awaiting human review: shown as needs review, never as a low score.</summary>
    NeedsReview,
}

/// <summary>
/// One provider result as the FIT v2 result source reports it. Field-for-field the shape of FIT v2's
/// <c>Tims.Domain.FitEngine.InstrumentResult</c> (branch <c>feat/fit-v2-per-instrument</c>, not merged when this was
/// written), so the adapter that plugs this into <c>IAssessmentResultSource</c> is a one-to-one copy.
/// <c>NormalizedScore</c> is always null: it is the ATS native quiz's value, not a provider instrument's.
/// </summary>
public sealed record ProviderInstrumentResult(
    string Instrument,
    string ResultId,
    string Source,
    ProviderResultIntegrity Integrity,
    DateTimeOffset? CompletedAt,
    double? NormalizedScore,
    double? GlobalPercentile,
    string? Cefr,
    int? Level,
    string? ContentVersion,
    string? NormVersion);

/// <summary>The stored attempt + latest result an integrity decision is made from.</summary>
public sealed record ProviderFitRow(
    Guid AttemptId,
    string Instrument,
    string AttemptState,
    Guid? ProviderResultId,
    string? Purpose,
    string? ValidityStatus,
    bool RequiresHumanReview,
    DateTimeOffset? CompletedAt,
    double? GlobalPercentile,
    string? Cefr,
    int? Level,
    string? ContentVersion,
    string? NormVersion);

/// <summary>
/// Maps stored provider attempts and results to FIT v2 results. The rules (assessment-platform design §6.3):
/// <list type="bullet">
/// <item>Only a <c>valid</c> result of a <c>selection</c> assignment, not flagged for human review, on an attempt that
/// is still <c>result_ready</c>, is <see cref="ProviderResultIntegrity.Valid"/>.</item>
/// <item>A voided or review-pending result, or a voided attempt with no result yet, is
/// <see cref="ProviderResultIntegrity.NeedsReview"/>: present, never dropped, never down-scored.</item>
/// <item>A <c>development</c> result never feeds a hiring score: it is not reported at all.</item>
/// <item>An attempt still in flight (no result, not voided) is not reported: FIT shows <c>no_result</c>.</item>
/// </list>
/// </summary>
public static class ProviderFitMapping
{
    public const string SourceName = "provider";

    public static IReadOnlyList<ProviderInstrumentResult> Map(IEnumerable<ProviderFitRow> rows)
    {
        ArgumentNullException.ThrowIfNull(rows);
        var results = new List<ProviderInstrumentResult>();
        foreach (var row in rows)
        {
            if (row.ProviderResultId is not { } resultId)
            {
                if (row.AttemptState == ProviderAttemptStates.Voided)
                {
                    results.Add(new ProviderInstrumentResult(
                        row.Instrument, row.AttemptId.ToString(), SourceName, ProviderResultIntegrity.NeedsReview,
                        row.CompletedAt, null, null, null, null, null, null));
                }

                continue;
            }

            if (row.Purpose != "selection")
            {
                continue;
            }

            var valid = row.ValidityStatus == ProviderValidity.Valid
                && !row.RequiresHumanReview
                && row.AttemptState == ProviderAttemptStates.ResultReady;

            results.Add(new ProviderInstrumentResult(
                row.Instrument,
                resultId.ToString(),
                SourceName,
                valid ? ProviderResultIntegrity.Valid : ProviderResultIntegrity.NeedsReview,
                row.CompletedAt,
                NormalizedScore: null,
                // A needs-review result carries no judged value: FIT must not be able to score it by accident.
                valid ? row.GlobalPercentile : null,
                valid ? row.Cefr : null,
                valid ? row.Level : null,
                row.ContentVersion,
                row.NormVersion));
        }

        return results;
    }
}
