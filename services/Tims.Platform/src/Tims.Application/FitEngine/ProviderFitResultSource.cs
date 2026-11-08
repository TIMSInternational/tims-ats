using Tims.Application.Assessments.Providers;
using Tims.Domain.Assessments.Providers;
using Tims.Domain.FitEngine;

namespace Tims.Application.FitEngine;

/// <summary>
/// FIT v2 adapter over the TIMS Assessments provider connector (AS-5). It reads the results the connector stored for
/// one tenant, candidate and vacancy through <see cref="IProviderAssessmentResultSource"/>, which has already judged
/// them with <see cref="ProviderFitMapping"/>:
/// <list type="bullet">
/// <item>one current attempt per instrument (the most recently assigned one that was not cancelled);</item>
/// <item>only a <c>valid</c> <c>selection</c> result, not flagged for human review, on a <c>result_ready</c> attempt,
/// sat at exactly the time multiplier it was assigned with, is <see cref="ResultIntegrity.Valid"/>;</item>
/// <item>a voided or review result, a multiplier mismatch, or a voided attempt with no result is
/// <see cref="ResultIntegrity.NeedsReview"/> and carries no value;</item>
/// <item>a <c>development</c> result and an attempt still in flight are not reported.</item>
/// </list>
/// Each result is copied field for field into FIT's <see cref="InstrumentResult"/>.
///
/// <para>Defence in depth, so the FIT kernel can never score a provider value by accident:</para>
/// <list type="bullet">
/// <item>only the six provider instruments pass (<see cref="ProviderInstruments"/>). Anything else, including
/// <c>native_quiz</c>, is dropped: a provider result never stands in for an ATS quiz.</item>
/// <item>a needs-review result carries no judged value, and <c>NormalizedScore</c> (the ATS quiz's value) is always
/// null.</item>
/// <item>the source tag is always <c>provider</c>.</item>
/// </list>
///
/// <para>Consistency with the FIT v2 atomic write: the connector reads its own tables on its own connection, under
/// <c>TenantScope</c> with an explicit organization filter. It does not join FIT's write transaction, but it runs
/// inside it, while FIT holds the per-(organization, candidate, vacancy) advisory lock. A compute that takes the lock
/// after another compute's commit therefore reads every provider result committed before its read. A result stored
/// later is picked up by the next compute, as for every other FIT input.</para>
///
/// <para>Registered in FIT's composite source only when <c>Platform:AssessmentProvidersEnabled</c> is on. The
/// provider tables exist only once migration <c>20261107232524_assessment_providers</c> is applied; with the
/// connector off, FIT v2 reads the ATS tables alone and a provider instrument a vacancy lists shows as
/// <c>no_result</c>.</para>
/// </summary>
public sealed class ProviderFitResultSource(IProviderAssessmentResultSource provider) : IAssessmentResultSource
{
    /// <summary>The source tag on every result this adapter returns.</summary>
    public const string SourceName = ProviderFitMapping.SourceName;

    private readonly IProviderAssessmentResultSource _provider = provider;

    public async Task<IReadOnlyList<InstrumentResult>> GetResultsAsync(
        Guid organizationId, Guid candidateId, Guid vacancyId, CancellationToken cancellationToken)
    {
        var results = await _provider.GetResultsAsync(organizationId, candidateId, vacancyId, cancellationToken)
            .ConfigureAwait(false);
        return results
            .Where(r => ProviderInstruments.IsKnown(r.Instrument))
            .Select(ToInstrumentResult)
            .ToList();
    }

    /// <summary>The field-for-field copy, exposed for unit tests.</summary>
    public static InstrumentResult ToInstrumentResult(ProviderInstrumentResult result)
    {
        ArgumentNullException.ThrowIfNull(result);
        var valid = result.Integrity == ProviderResultIntegrity.Valid;
        return new InstrumentResult(
            result.Instrument,
            result.ResultId,
            SourceName,
            valid ? ResultIntegrity.Valid : ResultIntegrity.NeedsReview,
            result.CompletedAt,
            NormalizedScore: null,
            valid ? result.GlobalPercentile : null,
            valid ? result.Cefr : null,
            valid ? result.Level : null,
            result.ContentVersion,
            result.NormVersion);
    }
}
