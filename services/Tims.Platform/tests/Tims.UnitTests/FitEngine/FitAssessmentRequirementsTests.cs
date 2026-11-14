using System.Text.Json.Nodes;
using Tims.Application.FitEngine;
using Tims.Domain.FitEngine;

namespace Tims.UnitTests.FitEngine;

/// <summary>
/// The vacancy assessments editor (FIT v2 <c>assessments[]</c>): strict input (nothing silently dropped, a job-relatedness
/// reason on every entry, the version the editor read) and the conditional replace's outcomes.
/// </summary>
public sealed class FitAssessmentRequirementsTests
{
    private const string Version = "0123456789abcdef0123456789abcdef";
    private static readonly Guid Org = Guid.Parse("11111111-1111-1111-1111-111111111111");
    private static readonly Guid Vacancy = Guid.Parse("a0000000-0000-4000-8000-000000000001");
    private static readonly DateTimeOffset Now = new(2026, 11, 9, 13, 0, 0, TimeSpan.Zero);

    private static JsonNode Body(string assessments, string version = Version) =>
        JsonNode.Parse($$"""{"assessments":{{assessments}},"expectedVersion":"{{version}}"}""")!;

    private static FitAssessmentRequirementsWrite? Validate(JsonNode body, out string? error, out IReadOnlyList<FitRequirementIssue> issues) =>
        FitAssessmentRequirementsInput.Validate(body, liaScoredAllowed: false, out error, out issues);

    [Fact]
    public void A_complete_configuration_is_kept_normalized_with_its_notes()
    {
        var write = Validate(Body("""
            [{"instrument":"LIA","use":"scored","min":{"globalPercentile":40},"weight":2,"reason":"  Análisis de datos  "},
             {"instrument":"english","use":"gate","min":{"cefr":"b2"},"reason":"Clientes en inglés"},
             {"instrument":"personality","use":"advisory","reason":"Guía de entrevista"}]
            """), out var error, out var issues);

        Assert.NotNull(write);
        Assert.Null(error);
        Assert.Equal(Version, write!.ExpectedVersion);
        Assert.Equal(3, write.Assessments.Count);
        Assert.Equal("lia", write.Assessments[0]!["instrument"]!.GetValue<string>());
        Assert.Equal("Análisis de datos", write.Assessments[0]!["reason"]!.GetValue<string>());
        Assert.Equal("B2", write.Assessments[1]!["min"]!["cefr"]!.GetValue<string>());
        // D20: a scored LIA is stored as configured and reported as a threshold while the norms are unconfirmed.
        Assert.Contains(issues, i => i.Code == FitRequirementIssueCodes.LiaThresholdOnly && !i.Dropped);
    }

    [Theory]
    [InlineData("""[{"instrument":"lia","use":"scored","min":{"globalPercentile":40}}]""")]
    [InlineData("""[{"instrument":"lia","use":"scored","min":{"globalPercentile":40},"reason":"   "}]""")]
    [InlineData("""[{"instrument":"personality","use":"advisory"}]""")]
    // Codex atsux run 1 [P2]: what FIT keeps but the assignment refuses (ProviderFormats.IsReason) is refused here too,
    // or the vacancy saves a reason that makes every assignment fail.
    [InlineData("""[{"instrument":"lia","use":"scored","min":{"globalPercentile":40},"reason":"IA"}]""")]
    [InlineData("""[{"instrument":"lia","use":"scored","min":{"globalPercentile":40},"reason":"uso\u0007de datos"}]""")]
    [InlineData("""[{"instrument":"lia","use":"scored","min":{"globalPercentile":40},"reason":"dos\nlíneas"}]""")]
    public void Every_entry_needs_a_job_relatedness_reason(string assessments)
    {
        var write = Validate(Body(assessments), out var error, out var issues);

        Assert.Null(write);
        Assert.Equal("invalid_assessments", error);
        var issue = Assert.Single(issues);
        Assert.Equal(FitAssessmentRequirementsInput.ReasonRequired, issue.Code);
        Assert.Equal(0, issue.Index);
        Assert.True(issue.Dropped);
    }

    [Theory]
    [InlineData("""[{"instrument":"lia","use":"scored","reason":"r"}]""", FitRequirementIssueCodes.InvalidMinimum)]
    [InlineData("""[{"instrument":"lia","use":"scored","min":{"globalPercentile":140},"reason":"r"}]""", FitRequirementIssueCodes.InvalidMinimum)]
    [InlineData("""[{"instrument":"pcb","reason":"r"}]""", FitRequirementIssueCodes.UnknownInstrument)]
    [InlineData("""[{"instrument":"lia","use":"ranked","min":{"globalPercentile":40},"reason":"r"}]""", FitRequirementIssueCodes.InvalidUse)]
    [InlineData("""[{"instrument":"english","use":"gate","min":{"cefr":"B2"},"reason":"r"},{"instrument":"english","use":"gate","min":{"cefr":"C1"},"reason":"r"}]""", FitRequirementIssueCodes.DuplicateInstrument)]
    public void An_entry_fit_would_drop_refuses_the_whole_write(string assessments, string code)
    {
        var write = Validate(Body(assessments), out var error, out var issues);

        Assert.Null(write);
        Assert.Equal("invalid_assessments", error);
        Assert.Contains(issues, i => i.Code == code && i.Dropped);
    }

    [Theory]
    [InlineData("""{"assessments":[]}""")]
    [InlineData("""{"assessments":[],"expectedVersion":"not-a-version"}""")]
    [InlineData("""{"assessments":[],"expectedVersion":"0123456789ABCDEF0123456789ABCDEF"}""")]
    [InlineData("""{"assessments":[],"expectedVersion":"0123456789abcdef0123456789abcdef","minYearsExperience":3}""")]
    [InlineData("""[]""")]
    public void The_body_is_exactly_the_array_and_a_well_formed_version(string json)
    {
        Assert.Null(Validate(JsonNode.Parse(json)!, out var error, out _));
        Assert.Equal("invalid_input", error);
    }

    [Fact]
    public void An_empty_array_is_a_decision_and_is_kept()
    {
        var write = Validate(Body("[]"), out var error, out _);

        Assert.Null(error);
        Assert.Empty(write!.Assessments);
    }

    [Fact]
    public void Too_many_entries_are_refused() =>
        Assert.Null(Validate(Body("[" + string.Join(",", Enumerable.Repeat("""{"instrument":"lia"}""", 33)) + "]"), out _, out _));

    // ── the use case ──────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task A_save_from_the_stored_version_writes_and_returns_the_new_version()
    {
        var repository = new FakeRepository("[]", Version);
        var useCase = new FitAssessmentRequirementsUseCase(repository);

        var result = await useCase.ReplaceAsync(Org, Vacancy,
            Body("""[{"instrument":"english","use":"gate","min":{"cefr":"B2"},"reason":"Clientes"}]"""), false, Now,
            CancellationToken.None);

        Assert.Equal(AssessmentRequirementsOutcome.Saved, result.Outcome);
        Assert.Equal("english", Assert.Single(result.View!.Assessments).Instrument);
        Assert.NotEqual(Version, result.View.Version);
        Assert.Equal(Version, repository.LastExpected);
    }

    [Fact]
    public async Task A_save_from_a_stale_version_is_a_conflict_that_returns_what_is_stored_now()
    {
        var repository = new FakeRepository(
            """[{"instrument":"lia","use":"scored","min":{"globalPercentile":50},"reason":"Otra persona lo cambió"}]""",
            "ffffffffffffffffffffffffffffffff");
        var useCase = new FitAssessmentRequirementsUseCase(repository);

        var result = await useCase.ReplaceAsync(Org, Vacancy, Body("[]"), false, Now, CancellationToken.None);

        Assert.Equal(AssessmentRequirementsOutcome.Conflict, result.Outcome);
        Assert.Equal("requirements_changed", result.Error);
        Assert.Equal("lia", Assert.Single(result.View!.Assessments).Instrument);
        Assert.Equal("ffffffffffffffffffffffffffffffff", result.View.Version);
    }

    [Fact]
    public async Task An_invalid_body_never_reaches_the_repository()
    {
        var repository = new FakeRepository("[]", Version);

        var result = await new FitAssessmentRequirementsUseCase(repository).ReplaceAsync(
            Org, Vacancy, Body("""[{"instrument":"lia","use":"scored","min":{"globalPercentile":40}}]"""), false, Now,
            CancellationToken.None);

        Assert.Equal(AssessmentRequirementsOutcome.Invalid, result.Outcome);
        Assert.Null(repository.LastExpected);
    }

    [Fact]
    public async Task The_read_shows_entries_as_fit_parses_them_and_reports_the_ones_it_ignores()
    {
        var repository = new FakeRepository(
            """[{"instrument":"english","min":{"cefr":"b1"},"reason":"Clientes"},{"instrument":"native-quiz"}]""", Version);

        var view = await new FitAssessmentRequirementsUseCase(repository).GetAsync(Org, Vacancy, false, CancellationToken.None);

        var english = Assert.Single(view.Assessments);
        Assert.Equal(FitInstrumentUses.Gate, english.Use); // English defaults to a gate
        Assert.Equal("B1", english.Min!.Cefr);
        Assert.Contains(view.Issues, i => i.Index == 1 && i.Code == FitRequirementIssueCodes.UnknownInstrument && i.Dropped);
        Assert.Equal(Version, view.Version);
    }

    [Fact]
    public async Task An_absent_array_reads_as_empty()
    {
        var view = await new FitAssessmentRequirementsUseCase(new FakeRepository(null, Version))
            .GetAsync(Org, Vacancy, false, CancellationToken.None);

        Assert.Empty(view.Assessments);
        Assert.Empty(view.Issues);
    }

    private sealed class FakeRepository(string? stored, string version) : IFitAssessmentRequirementsRepository
    {
        private string? _stored = stored;
        private string _version = version;

        public string? LastExpected { get; private set; }

        public Task<StoredAssessmentRequirements> ReadAsync(Guid organizationId, Guid vacancyId, CancellationToken cancellationToken) =>
            Task.FromResult(new StoredAssessmentRequirements(_stored, _version));

        public Task<AssessmentRequirementsWriteResult> ReplaceAsync(
            Guid organizationId, Guid vacancyId, string assessmentsJson, string expectedVersion, DateTimeOffset now,
            CancellationToken cancellationToken)
        {
            LastExpected = expectedVersion;
            if (expectedVersion != _version)
            {
                return Task.FromResult(new AssessmentRequirementsWriteResult(false, _stored, _version));
            }

            _stored = assessmentsJson;
            _version = "abcdefabcdefabcdefabcdefabcdefab";
            return Task.FromResult(new AssessmentRequirementsWriteResult(true, _stored, _version));
        }
    }
}
