using System.Text.Json.Nodes;
using System.Text.Json.Serialization;

namespace Tims.Domain.ExternalVendor;

/// <summary>
/// The row the repository returns (result row + selected assignment context) — the input to the v1
/// mapper. A faithful port of the TS <c>ExternalResultRow</c> (packages/api/src/dto/external-assessment.ts):
/// it carries ONLY the classification-ceiling fields for <c>external</c> (the six scored fields) plus the
/// non-sensitive anchors, <c>scoredAt</c>, and the assignment context the v1 shape needs — never a
/// non-ceiling sensitive column.
///
/// Opaque psychometric JSON (<see cref="Interpretation"/>, <see cref="Breakdown"/>) is carried as a raw
/// <see cref="JsonNode"/> (the TS <c>unknown</c> analog) and passed through the mapper untouched — never
/// reshaped. Timestamps are instants (<see cref="DateTimeOffset"/>), matching the TS <c>Date</c>.
/// </summary>
public sealed record ExternalResultRow(
    string Id,
    string AssignmentId,
    double? RawScore,
    double? NormalizedScore,
    double? Percentile,
    JsonNode? Interpretation,
    JsonNode? Breakdown,
    string? ModelVersion,
    DateTimeOffset ScoredAt,
    ExternalAssignmentContext Assignment);

/// <summary>
/// The non-sensitive assignment context the v1 shape flattens in (lifecycle + identity). Assignment
/// rows are not classification-sensitive; these are plain anchors. <see cref="AssessmentTypeName"/> is
/// nullable to mirror the TS <c>assessmentType?.name ?? null</c> (the relation is required in Prisma, so
/// in practice it is always present).
/// </summary>
public sealed record ExternalAssignmentContext(
    string CandidateId,
    string VacancyId,
    string Status,
    DateTimeOffset AssignedAt,
    DateTimeOffset? StartedAt,
    DateTimeOffset? CompletedAt,
    DateTimeOffset? ExpiresAt,
    string? AssessmentTypeName);

/// <summary>
/// The STABLE, versioned external contract for assessment profiles — a faithful port of the TS
/// <c>ExternalAssessmentResultV1</c> DTO. Integrators depend on this shape, so it is mapped explicitly
/// (never a reshape of the internal row): bump <see cref="SchemaVersion"/> and add a v2 mapper for a
/// breaking change. The flat field set is assignment context + the six scored fields + <c>scoredAt</c>.
/// </summary>
public sealed record ExternalAssessmentResultV1(
    string SchemaVersion,
    string AssignmentId,
    string CandidateId,
    string VacancyId,
    string? AssessmentType,
    string Status,
    [property: JsonConverter(typeof(NodeIsoDateTimeOffsetConverter))]
    DateTimeOffset AssignedAt,
    [property: JsonConverter(typeof(NodeIsoNullableDateTimeOffsetConverter))]
    DateTimeOffset? StartedAt,
    [property: JsonConverter(typeof(NodeIsoNullableDateTimeOffsetConverter))]
    DateTimeOffset? CompletedAt,
    [property: JsonConverter(typeof(NodeIsoNullableDateTimeOffsetConverter))]
    DateTimeOffset? ExpiresAt,
    [property: JsonConverter(typeof(NodeIsoDateTimeOffsetConverter))]
    DateTimeOffset ScoredAt,
    double? RawScore,
    double? NormalizedScore,
    double? Percentile,
    JsonNode? Interpretation,
    JsonNode? Breakdown,
    string? ModelVersion);

/// <summary>
/// The pure row → v1 mapper (port of <c>toExternalAssessmentResultV1</c>). A structural remap only:
/// it renames fields (e.g. <c>assignment.candidateId</c> → <c>candidateId</c>), stamps the constant
/// <c>schemaVersion: "v1"</c>, and passes every value through unchanged. Golden-fixtured against the
/// real TS mapper.
/// </summary>
public static class ExternalAssessmentResultV1Mapper
{
    public const string SchemaVersion = "v1";

    public static ExternalAssessmentResultV1 Map(ExternalResultRow row) => new(
        SchemaVersion: SchemaVersion,
        AssignmentId: row.AssignmentId,
        CandidateId: row.Assignment.CandidateId,
        VacancyId: row.Assignment.VacancyId,
        AssessmentType: row.Assignment.AssessmentTypeName,
        Status: row.Assignment.Status,
        AssignedAt: row.Assignment.AssignedAt,
        StartedAt: row.Assignment.StartedAt,
        CompletedAt: row.Assignment.CompletedAt,
        ExpiresAt: row.Assignment.ExpiresAt,
        ScoredAt: row.ScoredAt,
        RawScore: row.RawScore,
        NormalizedScore: row.NormalizedScore,
        Percentile: row.Percentile,
        Interpretation: row.Interpretation,
        Breakdown: row.Breakdown,
        ModelVersion: row.ModelVersion);
}
