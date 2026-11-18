using Tims.Domain.FitEngine;

namespace Tims.Application.FitEngine;

/// <summary>
/// FIT v2 port: where a candidate's assessment results for one vacancy come from. An adapter returns every
/// completed result it knows for the (organization, candidate, vacancy) triple, each tagged with its instrument
/// and its <see cref="ResultIntegrity"/>; the pure <see cref="FitV2Kernels.Evaluate"/> picks the latest per
/// instrument and ignores instruments the vacancy does not list.
///
/// <para>Contract for every adapter:</para>
/// <list type="bullet">
/// <item>Tenant-scoped: only rows of <paramref name="organizationId"/> (explicit filter + RLS).</item>
/// <item>Integrity is decided by the SOURCE, on the server: a voided, flagged or review-pending result is
/// <see cref="ResultIntegrity.NeedsReview"/>, never dropped and never down-scored.</item>
/// <item>Return the judged value only (normalized score / global percentile / CEFR / level) plus the content and
/// norm version; never answer keys, item data or interpretation text.</item>
/// <item>Read-only. Creates no tables and writes nothing.</item>
/// </list>
/// </summary>
public interface IAssessmentResultSource
{
    Task<IReadOnlyList<InstrumentResult>> GetResultsAsync(
        Guid organizationId, Guid candidateId, Guid vacancyId, CancellationToken cancellationToken);
}

/// <summary>Concatenates several sources, in order (the ATS tables first, then the provider).</summary>
public sealed class CompositeAssessmentResultSource(IReadOnlyList<IAssessmentResultSource> sources)
    : IAssessmentResultSource
{
    private readonly IReadOnlyList<IAssessmentResultSource> _sources = sources;

    public async Task<IReadOnlyList<InstrumentResult>> GetResultsAsync(
        Guid organizationId, Guid candidateId, Guid vacancyId, CancellationToken cancellationToken)
    {
        var all = new List<InstrumentResult>();
        foreach (var source in _sources)
        {
            // Sequential: the ATS adapter shares the request's DbContext, which is not thread-safe.
            all.AddRange(await source.GetResultsAsync(organizationId, candidateId, vacancyId, cancellationToken)
                .ConfigureAwait(false));
        }

        return all;
    }
}

/// <summary>A source with no results — what the v1-only constructor of the use case uses.</summary>
public sealed class NoAssessmentResults : IAssessmentResultSource
{
    public static readonly NoAssessmentResults Instance = new();

    private NoAssessmentResults()
    {
    }

    public Task<IReadOnlyList<InstrumentResult>> GetResultsAsync(
        Guid organizationId, Guid candidateId, Guid vacancyId, CancellationToken cancellationToken) =>
        Task.FromResult<IReadOnlyList<InstrumentResult>>([]);
}
