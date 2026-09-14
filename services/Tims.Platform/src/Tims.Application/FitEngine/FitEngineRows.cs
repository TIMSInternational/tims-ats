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
    string LastName);

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
