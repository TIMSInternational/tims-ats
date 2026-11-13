using Tims.Application.Assessments.Providers;

namespace Tims.UnitTests.Assessments.Providers;

/// <summary>
/// HR report downloads (contract getResultReport): never wider than the result the ATS shows, a link-out instrument's
/// report is a provider variant at <c>full</c>, the provider's refusal is "no report" while an outage or a missing grant
/// is never hidden as one, and every download is audited.
/// </summary>
public sealed class ProviderReportUseCaseTests
{
    private static readonly Guid Org = Guid.Parse("0a0a0a0a-0000-4000-8000-000000000001");
    private static readonly Guid Actor = Guid.Parse("0a0a0a0a-0000-4000-8000-000000000002");
    private static readonly Guid Attempt = Guid.Parse("0a0a0a0a-0000-4000-8000-000000000003");
    private static readonly Guid Result = Guid.Parse("0a0a0a0a-0000-4000-8000-000000000004");

    private readonly FakeProvider _provider = new();
    private readonly Repository _repository = new();

    private ProviderReportUseCase UseCase => new(_repository, _provider);

    private static ProviderReportTarget Target(
        string instrument = "lia", string? validity = "valid", string? level = "full", Guid? result = null,
        bool stopped = false, bool withdrawn = false) =>
        new(Guid.NewGuid(), Guid.NewGuid(), instrument, "es", result ?? Result, validity, level, stopped, withdrawn);

    private Task<ProviderReportListResult> List(bool inScope = true) =>
        UseCase.ListAsync(Org, Attempt, _ => Task.FromResult(inScope), CancellationToken.None);

    private Task<ProviderReportDownloadResult> Download(string? variant = null, string? locale = null, bool inScope = true) =>
        UseCase.DownloadAsync(Org, Actor, Attempt, variant, locale, _ => Task.FromResult(inScope), CancellationToken.None);

    [Fact]
    public async Task A_native_result_offers_its_report_and_the_download_is_the_providers_pdf_audited_once()
    {
        _repository.Target = Target();

        var list = await List();
        Assert.Equal(ProviderReportOutcome.Ok, list.Outcome);
        Assert.Equal([new ProviderReportOption(null, null)], list.Reports);

        var got = await Download();
        Assert.Equal(ProviderReportOutcome.Ok, got.Outcome);
        Assert.StartsWith("%PDF-", System.Text.Encoding.ASCII.GetString(got.File!.Content));
        Assert.Equal(["list_reports", "report:native:es"], _provider.Calls); // the attempt's locale by default
        Assert.Equal([(Attempt, "lia", (string?)null)], _repository.Audits);
    }

    [Fact]
    public async Task A_pca_at_full_offers_only_the_variants_and_a_download_without_one_is_refused_before_the_provider()
    {
        _repository.Target = Target("pca");
        _provider.OnListReports = _ => ProviderCall<IReadOnlyList<ProviderReportOption>>.Success(
            [new ProviderReportOption("pca", "Informe PCA"), new ProviderReportOption("gd", "Guía de desarrollo")]);

        var list = await List();
        Assert.Equal(["pca", "gd"], list.Reports.Select(r => r.Variant));

        Assert.Equal(ProviderReportOutcome.NoReport, (await Download()).Outcome);
        Assert.DoesNotContain(_provider.Calls, c => c.StartsWith("report:", StringComparison.Ordinal));

        var got = await Download("gd", "en");
        Assert.Equal((ProviderReportOutcome.Ok, "pca"), (got.Outcome, got.Instrument));
        Assert.Contains("report:gd:en", _provider.Calls);
        Assert.Equal([(Attempt, "pca", (string?)"gd")], _repository.Audits);
    }

    [Fact]
    public async Task Below_full_a_variant_is_never_offered_or_fetched()
    {
        _repository.Target = Target("lia", level: "summary");
        _provider.OnListReports = _ => ProviderCall<IReadOnlyList<ProviderReportOption>>.Success([new ProviderReportOption("x", "X")]);

        Assert.Equal([new ProviderReportOption(null, null)], (await List()).Reports);
        Assert.Equal(ProviderReportOutcome.NoReport, (await Download("x")).Outcome);

        _repository.Target = Target("pca", level: "summary");
        Assert.Equal(ProviderReportOutcome.NoReport, (await List()).Outcome);
        Assert.DoesNotContain(_provider.Calls, c => c.StartsWith("report:", StringComparison.Ordinal));
        Assert.Empty(_repository.Audits);
    }

    [Theory]
    [InlineData("voided")]
    [InlineData("no_result")]
    [InlineData("status_only")]
    [InlineData("none")]
    [InlineData("results_stopped")]
    [InlineData("consent_withdrawn")]
    public async Task A_result_with_no_report_to_give_never_reaches_the_provider(string why)
    {
        _repository.Target = why switch
        {
            "voided" => Target(validity: "voided"),
            "no_result" => Target(validity: null, level: null) with { ProviderResultId = null },
            "status_only" or "none" => Target(level: why),
            "results_stopped" => Target(stopped: true),
            _ => Target(withdrawn: true),
        };

        Assert.Equal(ProviderReportOutcome.NoReport, (await List()).Outcome);
        Assert.Equal(ProviderReportOutcome.NoReport, (await Download()).Outcome);
        Assert.Empty(_provider.Calls);
        Assert.Empty(_repository.Audits);
    }

    [Fact]
    public async Task A_result_under_review_has_its_report()
    {
        _repository.Target = Target(validity: "needs_review");

        Assert.Equal(ProviderReportOutcome.Ok, (await Download()).Outcome);
    }

    [Fact]
    public async Task An_unknown_attempt_or_one_outside_the_callers_scope_is_not_found()
    {
        Assert.Equal(ProviderReportOutcome.NotFound, (await List()).Outcome);
        _repository.Target = Target();
        Assert.Equal(ProviderReportOutcome.NotFound, (await Download(inScope: false)).Outcome);
        Assert.Equal(ProviderReportOutcome.NotFound, (await List(inScope: false)).Outcome);
        Assert.Empty(_provider.Calls);
    }

    [Theory]
    [InlineData("Informe", null)]
    [InlineData("a/b", null)]
    [InlineData(null, "es-CR-x")]
    [InlineData(null, "../")]
    public async Task An_off_pattern_variant_or_locale_is_invalid_input_and_nothing_is_read(string? variant, string? locale)
    {
        _repository.Target = Target();

        Assert.Equal(ProviderReportOutcome.InvalidInput, (await Download(variant, locale)).Outcome);
        Assert.Empty(_provider.Calls);
        Assert.Equal(0, _repository.Reads);
    }

    [Theory]
    [InlineData(410, "result_voided", ProviderReportOutcome.NoReport)]
    [InlineData(403, "result_not_visible", ProviderReportOutcome.NoReport)]
    [InlineData(422, "validation_failed", ProviderReportOutcome.NoReport)]
    [InlineData(404, "not_found", ProviderReportOutcome.NoReport)]
    [InlineData(403, "insufficient_scope", ProviderReportOutcome.ProviderUnavailable)] // a missing reports:read grant
    [InlineData(null, ProviderFailure.TokenUnavailable, ProviderReportOutcome.ProviderUnavailable)]
    [InlineData(503, "service_unavailable", ProviderReportOutcome.ProviderUnavailable)]
    [InlineData(null, ProviderFailure.ContractViolation, ProviderReportOutcome.ProviderUnavailable)]
    public async Task The_providers_refusal_is_no_report_and_anything_else_is_unavailable(
        int? status, string code, ProviderReportOutcome expected)
    {
        _repository.Target = Target();
        var failure = new ProviderFailure(status, code, false, []);
        _provider.OnReportPdf = (_, _, _) => ProviderCall<ProviderReportFile>.Fail(failure);
        _provider.OnListReports = _ => ProviderCall<IReadOnlyList<ProviderReportOption>>.Fail(failure);

        Assert.Equal(expected, (await Download()).Outcome);
        Assert.Equal(expected, (await List()).Outcome);
        Assert.Empty(_repository.Audits); // only a delivered report is audited
    }

    [Fact]
    public async Task An_unconfigured_provider_is_reported_as_such_and_never_called()
    {
        _repository.Target = Target();
        _provider.IsConfigured = false;

        Assert.Equal(ProviderReportOutcome.ProviderUnconfigured, (await Download()).Outcome);
        Assert.Equal(ProviderReportOutcome.ProviderUnconfigured, (await List()).Outcome);
        Assert.Empty(_provider.Calls);
    }

    private sealed class Repository : IProviderReportRepository
    {
        public ProviderReportTarget? Target { get; set; }

        public int Reads { get; private set; }

        public List<(Guid Attempt, string Instrument, string? Variant)> Audits { get; } = [];

        public Task<ProviderReportTarget?> GetReportTargetAsync(
            Guid organizationId, Guid attemptId, CancellationToken cancellationToken)
        {
            Reads++;
            return Task.FromResult(attemptId == Attempt && organizationId == Org ? Target : null);
        }

        public Task AuditReportDownloadAsync(
            Guid organizationId, Guid actorId, Guid attemptId, Guid candidateId, string instrument, string? variant,
            CancellationToken cancellationToken)
        {
            Assert.Equal((Org, Actor), (organizationId, actorId));
            Audits.Add((attemptId, instrument, variant));
            return Task.CompletedTask;
        }
    }
}
