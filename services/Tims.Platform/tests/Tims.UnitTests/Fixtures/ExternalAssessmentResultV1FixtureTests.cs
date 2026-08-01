using System.Text.Json;
using System.Text.Json.Nodes;
using Tims.Domain.ExternalVendor;
using Tims.Domain.Json;

namespace Tims.UnitTests.Fixtures;

/// <summary>
/// Pins the C# <see cref="ExternalAssessmentResultV1Mapper"/> to the shared golden fixture
/// (contracts/external-fixtures/assessment-result-v1.json), the SAME cases the TS vitest suite
/// (tests/external-vendor/assessment-result-v1-fixtures.test.ts) asserts against the REAL
/// <c>toExternalAssessmentResultV1</c>. Proves the row → v1 remap is byte-identical across stacks:
/// field rename, constant <c>schemaVersion 'v1'</c>, opaque JSON passthrough, and instant preservation.
///
/// FIX 4: the DATE fields are pinned by their SERIALIZED wire form, not merely their DateTimeOffset
/// value — the C# DTO is serialized through its <see cref="NodeIsoDateTimeOffsetConverter"/> and the
/// resulting string is asserted equal to the fixture's canonical ISO string, exactly as the TS suite
/// asserts <c>.toISOString()</c>. This closes the "STJ ≠ Node Z" gotcha (default STJ would emit
/// <c>+00:00</c>, not <c>…fffZ</c>) so the golden fixture gives REAL cross-stack byte-parity for dates.
/// </summary>
public sealed class ExternalAssessmentResultV1FixtureTests
{
    private static readonly V1Root Data = Fx.Load<V1Root>("external-fixtures", "assessment-result-v1.json");

    // The RAW fixture node (not the DateTimeOffset-deserialized model) — carries the exact ISO strings.
    private static readonly JsonNode RawCases = JsonNode.Parse(
        File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "external-fixtures", "assessment-result-v1.json")))!["cases"]!;

    // Serialize v1 through the DTO's own [JsonConverter] annotations; camelCase to match fixture keys.
    private static readonly JsonSerializerOptions WireOptions = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };

    private static readonly string[] DateFields =
        ["assignedAt", "startedAt", "completedAt", "expiresAt", "scoredAt"];

    public static IEnumerable<object[]> Cases() => Fx.Rows(Data.Cases.Select(c => c.Name).ToList());

    [Theory]
    [MemberData(nameof(Cases))]
    public void Matches_golden_fixture(int index, string name)
    {
        var c = Data.Cases[index];
        Assert.Equal(name, c.Name);

        var row = new ExternalResultRow(
            c.Input.Id,
            c.Input.AssignmentId,
            c.Input.RawScore,
            c.Input.NormalizedScore,
            c.Input.Percentile,
            c.Input.Band,
            c.Input.NormSampleSize,
            c.Input.Interpretation,
            c.Input.Breakdown,
            c.Input.ModelVersion,
            c.Input.ScoredAt,
            new ExternalAssignmentContext(
                c.Input.Assignment.CandidateId,
                c.Input.Assignment.VacancyId,
                c.Input.Assignment.Status,
                c.Input.Assignment.AssignedAt,
                c.Input.Assignment.StartedAt,
                c.Input.Assignment.CompletedAt,
                c.Input.Assignment.ExpiresAt,
                c.Input.Assignment.AssessmentType?.Name));

        var actual = ExternalAssessmentResultV1Mapper.Map(row);
        var expected = c.Expected;

        Assert.Equal(expected.SchemaVersion, actual.SchemaVersion);
        Assert.Equal(expected.AssignmentId, actual.AssignmentId);
        Assert.Equal(expected.CandidateId, actual.CandidateId);
        Assert.Equal(expected.VacancyId, actual.VacancyId);
        Assert.Equal(expected.AssessmentType, actual.AssessmentType);
        Assert.Equal(expected.Status, actual.Status);
        Assert.Equal(expected.AssignedAt, actual.AssignedAt);
        Assert.Equal(expected.StartedAt, actual.StartedAt);
        Assert.Equal(expected.CompletedAt, actual.CompletedAt);
        Assert.Equal(expected.ExpiresAt, actual.ExpiresAt);
        Assert.Equal(expected.ScoredAt, actual.ScoredAt);
        Assert.Equal(expected.RawScore, actual.RawScore);
        Assert.Equal(expected.NormalizedScore, actual.NormalizedScore);
        Assert.Equal(expected.Percentile, actual.Percentile);
        Assert.Equal(expected.Band, actual.Band);
        Assert.Equal(expected.NormSampleSize, actual.NormSampleSize);
        Assert.Equal(expected.ModelVersion, actual.ModelVersion);
        Assert.True(JsonNode.DeepEquals(expected.Interpretation, actual.Interpretation), "interpretation mismatch");
        Assert.True(JsonNode.DeepEquals(expected.Breakdown, actual.Breakdown), "breakdown mismatch");

        // FIX 4: pin the DATE WIRE FORMAT — serialize the DTO through its Node-ISO converter and assert
        // each date field's STRING form equals the fixture's canonical ISO string (…fffZ), byte-for-byte
        // with what TS `.toISOString()` emits. A default STJ writer (+00:00) would fail this.
        var wire = JsonSerializer.SerializeToNode(actual, WireOptions)!.AsObject();
        var expectedRaw = RawCases[index]!["expected"]!.AsObject();
        foreach (var field in DateFields)
        {
            var actualDate = wire[field];
            var expectedDate = expectedRaw[field];
            if (expectedDate is null)
            {
                Assert.Null(actualDate);
            }
            else
            {
                Assert.Equal(expectedDate.GetValue<string>(), actualDate!.GetValue<string>());
            }
        }
    }
}
