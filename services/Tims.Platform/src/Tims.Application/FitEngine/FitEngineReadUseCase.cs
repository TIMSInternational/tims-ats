using System.Text.Json.Nodes;
using Tims.Domain.FitEngine;

namespace Tims.Application.FitEngine;

/// <summary>
/// The FIT-engine READ flows — thin orchestration over <see cref="IFitEngineReadRepository"/> plus the pure
/// <see cref="FitEngineKernels"/> (fit-engine.service.ts <c>getRankingForVacancy</c> / <c>simulateWeights</c> /
/// <c>listWeightProfiles</c> / <c>getFitScoreForExplain</c>).
/// </summary>
public sealed class FitEngineReadUseCase(IFitEngineReadRepository repository)
{
    private readonly IFitEngineReadRepository _repository = repository;

    /// <summary><c>getRankingForVacancy</c> — stored rows, overallScore DESC, breakdown jsonb passed through.</summary>
    public Task<IReadOnlyList<FitRankingRow>> GetRankingForVacancyAsync(
        Guid organizationId, Guid vacancyId, CancellationToken cancellationToken) =>
        GetRankingForVacancyAsync(organizationId, vacancyId, hideBelowMinimum: false, cancellationToken);

    /// <summary>
    /// <c>getRankingForVacancy</c> for a reader of a given reach. <paramref name="hideBelowMinimum"/> (owner default
    /// D6, a narrow-scoped reader): a FIT v2 row with an instrument below its minimum is returned through
    /// <see cref="FitV2Visibility.RedactBelowMinimum"/>, its overall recomputed from the dimensions that remain
    /// (so it cannot be inverted back to the hidden level) and marked partial, and the list is re-sorted on the
    /// numbers this reader sees. Every other row, and every row for a wide-scoped reader, is passed through.
    /// </summary>
    public async Task<IReadOnlyList<FitRankingRow>> GetRankingForVacancyAsync(
        Guid organizationId, Guid vacancyId, bool hideBelowMinimum, CancellationToken cancellationToken)
    {
        var rows = await _repository.GetFitScoresForVacancyAsync(organizationId, vacancyId, cancellationToken)
            .ConfigureAwait(false);
        var ranking = rows.Select(r => ToRankingRow(r, hideBelowMinimum)).ToList();
        return hideBelowMinimum ? ranking.OrderByDescending(r => r.OverallScore).ToList() : ranking;
    }

    private static FitRankingRow ToRankingRow(FitScoreForVacancyData r, bool hideBelowMinimum)
    {
        var breakdown = JsonNode.Parse(r.Breakdown);
        var overall = r.OverallScore;
        var isPartial = r.IsPartial;
        if (hideBelowMinimum)
        {
            breakdown = FitV2Visibility.RedactBelowMinimum(breakdown, out var redacted);
            if (redacted)
            {
                var weights = FitEngineKernels.ParseWeights(r.Weights is null ? null : JsonNode.Parse(r.Weights));
                var shown = FitEngineKernels.ComputeWeightedScore(
                    FitEngineKernels.ParseBreakdownScores(breakdown), weights);
                overall = shown.OverallScore;
                isPartial = true;
            }
        }

        return new FitRankingRow(
            r.Id.ToString(), r.CandidateId.ToString(), r.FirstName, r.LastName, overall, breakdown, isPartial,
            r.CalculatedAt);
    }

    /// <summary>
    /// <c>simulateWeights</c> — re-run the weighted-score kernel over each row's STORED breakdown with the
    /// hypothetical weights, then sort simulatedScore DESC. The sort is stable (OrderByDescending, matching JS
    /// Array.prototype.sort) over the overallScore-DESC fetch order, so ties keep the stored ranking's order.
    /// </summary>
    public Task<IReadOnlyList<SimulatedRankingRow>> SimulateWeightsAsync(
        Guid organizationId, Guid vacancyId, IReadOnlyDictionary<string, double> hypotheticalWeights,
        CancellationToken cancellationToken) =>
        SimulateWeightsAsync(organizationId, vacancyId, hypotheticalWeights, hideBelowMinimum: false, cancellationToken);

    /// <summary>
    /// <c>simulateWeights</c> for a reader of a given reach. With <paramref name="hideBelowMinimum"/> (owner default
    /// D6) the kernel runs over the breakdown that reader may see, so a weight of 1 on <c>assessment</c> cannot
    /// read a hidden dimension back.
    /// </summary>
    public async Task<IReadOnlyList<SimulatedRankingRow>> SimulateWeightsAsync(
        Guid organizationId, Guid vacancyId, IReadOnlyDictionary<string, double> hypotheticalWeights,
        bool hideBelowMinimum, CancellationToken cancellationToken)
    {
        var rows = await _repository.GetFitScoresForVacancyAsync(organizationId, vacancyId, cancellationToken)
            .ConfigureAwait(false);
        return rows
            .Select(r =>
            {
                var breakdown = JsonNode.Parse(r.Breakdown);
                if (hideBelowMinimum)
                {
                    breakdown = FitV2Visibility.RedactBelowMinimum(breakdown, out _);
                }

                var rawScores = FitEngineKernels.ParseBreakdownScores(breakdown);
                var result = FitEngineKernels.ComputeWeightedScore(rawScores, hypotheticalWeights);
                return new SimulatedRankingRow(
                    r.CandidateId.ToString(), r.FirstName, r.LastName, result.OverallScore, result.IsPartial);
            })
            .OrderByDescending(r => r.SimulatedScore)
            .ToList();
    }

    /// <summary>
    /// FIT v2 review state for fit_scores ids a list view already holds (the candidate and talent-pool tables), so a
    /// provisional score can be marked there. Only rows whose vacancy passes <paramref name="vacancyInScope"/> (the
    /// caller's scope probe, run once per distinct vacancy) are returned; ids out of scope or unknown are omitted.
    /// </summary>
    public async Task<IReadOnlyList<FitReviewStateRow>> GetReviewStatesAsync(
        Guid organizationId, IReadOnlyCollection<Guid> fitScoreIds, Func<Guid, Task<bool>> vacancyInScope,
        CancellationToken cancellationToken)
    {
        var rows = await _repository.GetReviewStatesAsync(organizationId, fitScoreIds, cancellationToken)
            .ConfigureAwait(false);
        var allowed = new Dictionary<Guid, bool>();
        var result = new List<FitReviewStateRow>(rows.Count);
        foreach (var row in rows)
        {
            if (!allowed.TryGetValue(row.VacancyId, out var inScope))
            {
                inScope = await vacancyInScope(row.VacancyId).ConfigureAwait(false);
                allowed[row.VacancyId] = inScope;
            }

            if (inScope)
            {
                result.Add(new FitReviewStateRow(row.FitScoreId.ToString(), row.ReviewPending));
            }
        }

        return result;
    }

    /// <summary><c>listRoleFamilyWeightProfiles</c> — org profiles, name ASC, weights jsonb passed through.</summary>
    public async Task<IReadOnlyList<WeightProfileRow>> ListWeightProfilesAsync(
        Guid organizationId, CancellationToken cancellationToken)
    {
        var rows = await _repository.ListWeightProfilesAsync(organizationId, cancellationToken).ConfigureAwait(false);
        return rows
            .Select(r => new WeightProfileRow(r.Id.ToString(), r.Name, JsonNode.Parse(r.Weights)))
            .ToList();
    }

    /// <summary><c>getFitScoreForExplain</c> — null ⇒ the endpoint's 404; candidateName is "first last" (TS template).</summary>
    public async Task<ExplainFitData?> GetExplainDataAsync(
        Guid organizationId, Guid candidateId, Guid vacancyId, CancellationToken cancellationToken)
    {
        var row = await _repository.GetFitScoreForExplainAsync(organizationId, candidateId, vacancyId, cancellationToken)
            .ConfigureAwait(false);
        if (row is null)
        {
            return null;
        }

        return new ExplainFitData(
            row.OverallScore,
            JsonNode.Parse(row.Breakdown),
            $"{row.CandidateFirstName} {row.CandidateLastName}",
            row.VacancyTitle);
    }
}
