using System.Text.Json.Nodes;
using System.Text.Json.Serialization;
using Tims.Domain.Json;

namespace Tims.Domain.FitEngine;

/// <summary>
/// The parsed <c>jobProfile.fitRequirements</c> jsonb (fit-engine.service.ts <c>parseRequirements</c>) — every
/// field individually optional, lenient: a wrong-typed field is DROPPED, never an error. <c>MinYearsExperience</c>
/// is <c>double?</c> (TS <c>typeof === 'number'</c> accepts floats and negatives; the &lt;= 0 branch handles them).
/// </summary>
public sealed record FitRequirements(
    double? MinYearsExperience,
    string? RequiredEducationLevel,
    IReadOnlyList<string>? RequiredLanguages)
{
    public static readonly FitRequirements Empty = new(null, null, null);
}

/// <summary>Result of <see cref="FitEngineKernels.ComputeWeightedScore"/> — mirrors the TS tuple exactly.</summary>
public sealed record WeightedScore(double OverallScore, bool IsPartial);

/// <summary>
/// One row of <c>getRankingForVacancy</c> — the TS mapping of <c>getFitScoresForVacancy</c> rows
/// (fit-engine.service.ts:207-216). <c>Breakdown</c> is the stored jsonb passed through UNPARSED (the TS
/// <c>breakdown as unknown as FitBreakdown</c> is a cast, not a transform). <c>CalculatedAt</c> wears the
/// Node-ISO converter (TRAP 6): superjson emits <c>Date.toISOString()</c> — always 3-digit ms, always Z.
/// </summary>
public sealed record FitRankingRow(
    string FitScoreId,
    string CandidateId,
    string FirstName,
    string LastName,
    double OverallScore,
    JsonNode? Breakdown,
    bool IsPartial,
    [property: JsonConverter(typeof(NodeIsoDateTimeOffsetConverter))] DateTimeOffset CalculatedAt);

/// <summary>One row of <c>simulateWeights</c> (fit-engine.service.ts:229-232), sorted simulatedScore DESC.</summary>
public sealed record SimulatedRankingRow(
    string CandidateId,
    string FirstName,
    string LastName,
    double SimulatedScore,
    bool IsPartial);

/// <summary>
/// One weight profile — the <c>{ id, name, weights }</c> select shared by <c>listRoleFamilyWeightProfiles</c> and
/// <c>upsertRoleFamilyWeightProfile</c>. <c>Weights</c> is the stored jsonb passed through unparsed.
/// </summary>
public sealed record WeightProfileRow(string Id, string Name, JsonNode? Weights);

/// <summary>The <c>computeForVacancy</c> response — <c>{ computed: n }</c>, the per-candidate results discarded.</summary>
public sealed record ComputeForVacancyResult(int Computed);

/// <summary>
/// The <c>getFitScoreForExplain</c> projection (fit-engine.service.ts:250-255). Fetched by the C# explain-fit
/// endpoint ONLY to reproduce the TS null → NOT_FOUND observable; the LLM half answers 501 (no Bedrock plane
/// in C#), so this row is never serialized to the wire.
/// </summary>
public sealed record ExplainFitData(
    double OverallScore,
    JsonNode? Breakdown,
    string CandidateName,
    string VacancyTitle);
