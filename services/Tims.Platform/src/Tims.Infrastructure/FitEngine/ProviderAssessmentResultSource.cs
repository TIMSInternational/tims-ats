using Tims.Application.FitEngine;
using Tims.Domain.FitEngine;

namespace Tims.Infrastructure.FitEngine;

/// <summary>
/// FIT v2 stub for results held by the TIMS Assessments provider (the headless <c>/v1</c> API). It returns NO
/// results today, so every provider instrument a vacancy lists shows as <c>no_result</c> (gate unknown, no score).
/// It creates no tables and makes no network call.
///
/// <para>The connector (assessment-platform design §2.4, AS-5/AS-7) will implement it against the
/// <c>TIMSInternational/tims-interop</c> result schemas, which do not exist yet. The intended mapping:</para>
/// <list type="bullet">
/// <item><c>LiaResultV1</c> → <c>lia</c>: <c>global_percentile</c> → <see cref="InstrumentResult.GlobalPercentile"/>
/// (null on a partial battery, which FIT shows as <c>no_value</c>), bundle/content version and norm-table version
/// → <c>ContentVersion</c>/<c>NormVersion</c>.</item>
/// <item><c>EnglishResultV1</c> → <c>english</c>: <c>cefr_level</c> → <see cref="InstrumentResult.Cefr"/>.</item>
/// <item><c>ItciaResultV1</c> → <c>itcia</c>: <c>global_level</c> (1..5) → <see cref="InstrumentResult.Level"/>;
/// <c>requires_human_review</c> → <see cref="ResultIntegrity.NeedsReview"/>.</item>
/// <item><c>PersonalityResultV1</c>, <c>MiResultV1</c>, <c>PcaResultV1</c> → advisory instruments: status only,
/// no value is read.</item>
/// <item>Any session the provider voided or flagged → <see cref="ResultIntegrity.NeedsReview"/>. Only results of
/// the same tenant, for the same vacancy, count; a reused result within the tenant's validity window is the
/// connector's decision, never a cross-tenant one.</item>
/// </list>
/// </summary>
public sealed class ProviderAssessmentResultSource : IAssessmentResultSource
{
    /// <summary>The source tag the connector will put on provider results.</summary>
    public const string SourceName = "provider";

    public Task<IReadOnlyList<InstrumentResult>> GetResultsAsync(
        Guid organizationId, Guid candidateId, Guid vacancyId, CancellationToken cancellationToken) =>
        Task.FromResult<IReadOnlyList<InstrumentResult>>([]);
}
