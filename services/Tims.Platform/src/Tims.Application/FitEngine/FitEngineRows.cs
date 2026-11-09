using System.Text.Json.Nodes;
using Tims.Domain.FitEngine;

namespace Tims.Application.FitEngine;

/// <summary>
/// Repository-facing data rows for the FIT-engine slice. Jsonb columns travel as raw strings (parsed/passed
/// through at the use-case layer); timestamps are re-kinded UTC <see cref="DateTimeOffset"/> at the repository
/// boundary (the Node-ISO converter then emits <c>…fffZ</c> on the wire).
/// </summary>
/// <param name="Breakdown">The stored breakdown jsonb, unparsed.</param>
public sealed record FitScoreForVacancyData(
    Guid Id,
    double OverallScore,
    string Breakdown,
    bool IsPartial,
    DateTimeOffset CalculatedAt,
    Guid CandidateId,
    string FirstName,
    string LastName,
    string? Weights = null);

/// <summary>One of a candidate's fit_scores rows (the #312 hidden rows excluded), with its vacancy for the scope check.</summary>
public sealed record CandidateFitScoreData(
    Guid Id,
    Guid VacancyId,
    double OverallScore,
    string Breakdown,
    string? Weights,
    bool IsPartial,
    DateTimeOffset CalculatedAt);

/// <summary>The review state of one fit_scores row, as returned to a caller.</summary>
public sealed record FitReviewStateRow(string FitScoreId, bool ReviewPending);

/// <summary>One fit_scores row's FIT v2 review state, with its vacancy (for the caller's scope check).</summary>
public sealed record FitReviewStateData(Guid FitScoreId, Guid VacancyId, bool ReviewPending);

/// <summary>One <c>role_family_weight_profiles</c> row — <c>Weights</c> is the raw jsonb.</summary>
public sealed record WeightProfileData(Guid Id, string Name, string Weights);

/// <summary>The <c>getFitScoreForExplain</c> projection (names joined at the use case).</summary>
public sealed record ExplainFitRowData(
    double OverallScore,
    string Breakdown,
    string CandidateFirstName,
    string CandidateLastName,
    string VacancyTitle);

/// <summary>
/// The <c>getCandidateForFit</c> projection — <c>Education</c>/<c>Languages</c> are nullable jsonb strings
/// (TS selects the whole Json columns).
/// </summary>
public sealed record CandidateForFitData(int? YearsExperience, string? Education, string? Languages);

/// <summary>
/// The <c>getVacancyForFit</c> projection — <c>FitRequirements</c> is <c>jobProfile.fitRequirements</c> jsonb
/// (null when the vacancy has no job profile OR the profile has no fitRequirements — the TS optional chain).
/// </summary>
public sealed record VacancyForFitData(string? RoleFamily, string? FitRequirements);

/// <summary>The stored <c>fit_requirements</c> after a write, and what the writer dropped or changed.</summary>
public sealed record FitRequirementsSaved(JsonNode? FitRequirements, IReadOnlyList<FitRequirementIssue> Issues);

/// <summary>
/// What a FIT v2 compute writes for one candidate, built INSIDE the write transaction from an in-lock read of the
/// results (see <c>IFitEngineWriteRepository.UpsertFitScoreV2Async</c>).
/// </summary>
public sealed record FitScoreWrite(double OverallScore, string BreakdownJson, bool IsPartial);
