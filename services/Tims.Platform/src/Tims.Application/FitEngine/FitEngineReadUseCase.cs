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
    public async Task<IReadOnlyList<FitRankingRow>> GetRankingForVacancyAsync(
        Guid organizationId, Guid vacancyId, CancellationToken cancellationToken)
    {
        var rows = await _repository.GetFitScoresForVacancyAsync(organizationId, vacancyId, cancellationToken)
            .ConfigureAwait(false);
        return rows
            .Select(r => new FitRankingRow(
                r.Id.ToString(),
                r.CandidateId.ToString(),
                r.FirstName,
                r.LastName,
                r.OverallScore,
                JsonNode.Parse(r.Breakdown),
                r.IsPartial,
                r.CalculatedAt))
            .ToList();
    }

    /// <summary>
    /// <c>simulateWeights</c> — re-run the weighted-score kernel over each row's STORED breakdown with the
    /// hypothetical weights, then sort simulatedScore DESC. The sort is stable (OrderByDescending, matching JS
    /// Array.prototype.sort) over the overallScore-DESC fetch order, so ties keep the stored ranking's order.
    /// </summary>
    public async Task<IReadOnlyList<SimulatedRankingRow>> SimulateWeightsAsync(
        Guid organizationId, Guid vacancyId, IReadOnlyDictionary<string, double> hypotheticalWeights,
        CancellationToken cancellationToken)
    {
        var rows = await _repository.GetFitScoresForVacancyAsync(organizationId, vacancyId, cancellationToken)
            .ConfigureAwait(false);
        return rows
            .Select(r =>
            {
                var rawScores = FitEngineKernels.ParseBreakdownScores(JsonNode.Parse(r.Breakdown));
                var result = FitEngineKernels.ComputeWeightedScore(rawScores, hypotheticalWeights);
                return new SimulatedRankingRow(
                    r.CandidateId.ToString(), r.FirstName, r.LastName, result.OverallScore, result.IsPartial);
            })
            .OrderByDescending(r => r.SimulatedScore)
            .ToList();
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
