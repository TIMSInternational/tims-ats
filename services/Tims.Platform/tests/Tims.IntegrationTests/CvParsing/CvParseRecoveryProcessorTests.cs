using Npgsql;
using Tims.Infrastructure.CvParsing;
using UglyToad.PdfPig.Content;
using UglyToad.PdfPig.Core;
using UglyToad.PdfPig.Fonts.Standard14Fonts;
using UglyToad.PdfPig.Writer;

namespace Tims.IntegrationTests.CvParsing;

[Collection(nameof(CvParseLeaseCollection))]
public sealed class CvParseRecoveryProcessorTests(CvParseLeaseFixture fixture)
{
    private const string ModelJson = """
        {"name":"Synthetic Candidate","email":null,"phone":null,"skills":["C#"],
         "experience":[],"education":[{"institution":"Test University","degree":"BSc","year":2020}],
         "languages":["English"],"summary":null}
        """;

    [Fact]
    public async Task Pdf_to_validated_parse_completes_one_existing_document_and_profile()
    {
        await fixture.ResetAsync();
        var now = DateTime.UtcNow;
        var org = Guid.NewGuid();
        var documentId = await fixture.SeedAsync(org, now.AddMinutes(-3));
        var leases = new CvParseLeaseRepository(fixture.Source);
        var lease = Assert.Single(await leases.ClaimDueAsync(2, now, CancellationToken.None));
        var pdf = new PdfDocumentBuilder();
        var page = pdf.AddPage(PageSize.A4);
        page.AddText("Synthetic Candidate CV", 12, new PdfPoint(25, 700),
            pdf.AddStandard14Font(Standard14Font.Helvetica));
        var parser = new ParserStub();
        var processor = new CvParseRecoveryProcessor(leases, new ObjectStub(pdf.Build()), parser);

        Assert.Equal(CvRecoveryOutcome.Completed, await processor.RunOneAsync(lease, CancellationToken.None));
        Assert.Equal(1, parser.Calls);
        Assert.Contains("Synthetic Candidate CV", parser.LastText);
        Assert.Equal(CvRecoveryOutcome.Ineligible, await processor.RunOneAsync(lease, CancellationToken.None));
        Assert.Equal(1, parser.Calls);

        await using var connection = await fixture.Source.OpenConnectionAsync();
        await using var document = new NpgsqlCommand("""
            SELECT parsed_data->>'name', parsed_data->>'parsed', cv_parse_lease_token IS NULL
            FROM candidate_documents WHERE id = @id
            """, connection);
        document.Parameters.AddWithValue("id", documentId);
        await using var reader = await document.ExecuteReaderAsync();
        Assert.True(await reader.ReadAsync());
        Assert.Equal("Synthetic Candidate", reader.GetString(0));
        Assert.Equal("true", reader.GetString(1));
        Assert.True(reader.GetBoolean(2));
    }

    [Fact]
    public async Task Withdrawn_consent_after_fetch_prevents_inference_and_profile_update()
    {
        await fixture.ResetAsync();
        var now = DateTime.UtcNow;
        var org = Guid.NewGuid();
        await fixture.SeedAsync(org, now.AddMinutes(-3));
        var leases = new CvParseLeaseRepository(fixture.Source);
        var lease = Assert.Single(await leases.ClaimDueAsync(2, now, CancellationToken.None));
        var pdf = new PdfDocumentBuilder();
        pdf.AddPage(PageSize.A4).AddText("Synthetic Candidate", 12, new PdfPoint(25, 700),
            pdf.AddStandard14Font(Standard14Font.Helvetica));
        var store = new ObjectStub(pdf.Build(), () => fixture.WithdrawAsync(lease.CandidateId));
        var parser = new ParserStub();
        var processor = new CvParseRecoveryProcessor(leases, store, parser);

        Assert.Equal(CvRecoveryOutcome.Ineligible, await processor.RunOneAsync(lease, CancellationToken.None));
        Assert.Equal(0, parser.Calls);
        await using var connection = await fixture.Source.OpenConnectionAsync();
        await using var command = new NpgsqlCommand(
            "SELECT parsed_data IS NULL FROM candidate_documents WHERE id=@id", connection);
        command.Parameters.AddWithValue("id", lease.DocumentId);
        Assert.True((bool)(await command.ExecuteScalarAsync())!);
    }

    [Fact]
    public async Task Configuration_denial_defers_hourly_without_consuming_an_attempt()
    {
        await fixture.ResetAsync();
        var now = DateTime.UtcNow;
        var documentId = await fixture.SeedAsync(Guid.NewGuid(), now.AddMinutes(-3));
        var leases = new CvParseLeaseRepository(fixture.Source);
        var lease = Assert.Single(await leases.ClaimDueAsync(2, now, CancellationToken.None));
        var processor = new CvParseRecoveryProcessor(leases, new ObjectStub(SyntheticPdf()),
            new ParserStub { Throw = new CvAiBudgetDeniedException(CvAiBudgetDenial.AgentUnavailable) });

        Assert.Equal(CvRecoveryOutcome.Deferred, await processor.RunOneAsync(lease, CancellationToken.None));

        var (attempts, code, nextAt, leased) = await ReadRetryStateAsync(documentId);
        Assert.Equal(0, attempts);
        Assert.Equal("budget_denied", code);
        Assert.False(leased);
        Assert.InRange(nextAt!.Value, now.AddMinutes(59), now.AddMinutes(61));
    }

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public async Task Missing_model_or_guardrail_configuration_defers_without_consuming_an_attempt(bool atAuthorize)
    {
        // Tier-1 review: a configuration error used to be an inference failure, so four runs
        // exhausted every affected CV and correcting the configuration could not recover them.
        await fixture.ResetAsync();
        var now = DateTime.UtcNow;
        var documentId = await fixture.SeedAsync(Guid.NewGuid(), now.AddMinutes(-3));
        var leases = new CvParseLeaseRepository(fixture.Source);
        var lease = Assert.Single(await leases.ClaimDueAsync(2, now, CancellationToken.None));
        var objects = new ObjectStub(SyntheticPdf());
        var parser = atAuthorize
            ? new ParserStub { AuthorizeThrow = new CvParserConfigurationException() }
            : new ParserStub { Throw = new CvParserConfigurationException() };
        var processor = new CvParseRecoveryProcessor(leases, objects, parser);

        Assert.Equal(CvRecoveryOutcome.Deferred, await processor.RunOneAsync(lease, CancellationToken.None));

        var (attempts, code, nextAt, leased) = await ReadRetryStateAsync(documentId);
        Assert.Equal(0, attempts);
        Assert.Equal("configuration_error", code);
        Assert.False(leased);
        Assert.InRange(nextAt!.Value, now.AddMinutes(59), now.AddMinutes(61));
        Assert.Equal(atAuthorize ? 0 : 1, objects.Fetches);
        Assert.Equal(1, (await leases.ReadStatsAsync(now, CancellationToken.None)).Deferred);
    }

    [Fact]
    public async Task Spent_budget_is_denied_before_any_fetch_or_decode_and_waits_for_next_month()
    {
        await fixture.ResetAsync();
        var now = DateTime.UtcNow;
        var documentId = await fixture.SeedAsync(Guid.NewGuid(), now.AddMinutes(-3));
        var leases = new CvParseLeaseRepository(fixture.Source);
        var lease = Assert.Single(await leases.ClaimDueAsync(2, now, CancellationToken.None));
        var store = new ObjectStub(SyntheticPdf());
        var extractor = new CountingExtractor();
        var parser = new ParserStub { DenyAuthorize = CvAiBudgetDenial.MonthlyBudgetSpent };
        var processor = new CvParseRecoveryProcessor(leases, store, parser, extractor);

        Assert.Equal(CvRecoveryOutcome.Deferred, await processor.RunOneAsync(lease, CancellationToken.None));

        Assert.Equal(0, store.Fetches);
        Assert.Equal(0, extractor.Calls);
        Assert.Equal(0, parser.Calls);
        var (attempts, code, nextAt, leased) = await ReadRetryStateAsync(documentId);
        Assert.Equal(0, attempts);
        Assert.Equal("budget_denied", code);
        Assert.False(leased);
        var nextMonth = new DateTime(now.Year, now.Month, 1, 0, 0, 0, DateTimeKind.Utc).AddMonths(1);
        Assert.InRange(nextAt!.Value, nextMonth.AddSeconds(-1), nextMonth.AddSeconds(1));
    }

    [Theory]
    [InlineData(CvAiBudgetDenial.MonthlyBudgetSpent, "2026-11-01T00:00:00Z")]
    [InlineData(CvAiBudgetDenial.DisabledByTenant, "2026-10-31T23:59:59Z")]
    [InlineData(CvAiBudgetDenial.AgentUnavailable, "2026-10-31T23:59:59Z")]
    public void Deferral_length_follows_the_denial_reason(CvAiBudgetDenial reason, string expected)
    {
        var now = new DateTime(2026, 10, 31, 22, 59, 59, DateTimeKind.Utc);
        Assert.Equal(DateTime.Parse(expected, null, System.Globalization.DateTimeStyles.AdjustToUniversal),
            CvParseRecoveryProcessor.BudgetDeferralUntil(reason, now));
        Assert.Equal(new DateTime(2027, 1, 1, 0, 0, 0, DateTimeKind.Utc),
            CvParseRecoveryProcessor.BudgetDeferralUntil(CvAiBudgetDenial.MonthlyBudgetSpent,
                new DateTime(2026, 12, 31, 23, 0, 0, DateTimeKind.Utc)));
    }

    [Fact]
    public async Task Hanging_pdf_extraction_times_out_as_a_retryable_failure()
    {
        await fixture.ResetAsync();
        var now = DateTime.UtcNow;
        var documentId = await fixture.SeedAsync(Guid.NewGuid(), now.AddMinutes(-3));
        var leases = new CvParseLeaseRepository(fixture.Source);
        var lease = Assert.Single(await leases.ClaimDueAsync(2, now, CancellationToken.None));
        using var release = new ManualResetEventSlim();
        var extractor = new BoundedCvTextExtractor(TimeSpan.FromMilliseconds(200), (_, _, _) =>
        {
            release.Wait(TimeSpan.FromSeconds(30)); // a decoder spinning inside one page ignores its token
            return "never used";
        });
        var parser = new ParserStub();
        var processor = new CvParseRecoveryProcessor(leases, new ObjectStub(SyntheticPdf()), parser, extractor);

        var outcome = await processor.RunOneAsync(lease, CancellationToken.None).WaitAsync(TimeSpan.FromSeconds(10));

        Assert.Equal(CvRecoveryOutcome.Failed, outcome);
        Assert.Equal(0, parser.Calls);
        var (attempts, code, nextAt, leased) = await ReadRetryStateAsync(documentId);
        Assert.Equal(1, attempts); // retryable: not forced to MaxAttempts
        Assert.Equal("extraction_error", code);
        Assert.NotNull(nextAt);
        Assert.False(leased);
        release.Set();
    }

    [Fact]
    public async Task Saturated_extractor_defers_the_next_document_without_spending_its_attempt()
    {
        await fixture.ResetAsync();
        var now = DateTime.UtcNow;
        var org = Guid.NewGuid();
        await fixture.SeedAsync(org, now.AddMinutes(-4));
        var second = await fixture.SeedAsync(org, now.AddMinutes(-3));
        var leases = new CvParseLeaseRepository(fixture.Source);
        var claims = await leases.ClaimDueAsync(2, now, CancellationToken.None);
        using var release = new ManualResetEventSlim();
        var extractor = new BoundedCvTextExtractor(TimeSpan.FromMilliseconds(100), (_, _, _) =>
        {
            release.Wait(TimeSpan.FromSeconds(30));
            return "never used";
        }, maxDecoders: 1);
        var processor = new CvParseRecoveryProcessor(leases, new ObjectStub(SyntheticPdf()), new ParserStub(), extractor);

        Assert.Equal(CvRecoveryOutcome.Failed, await processor.RunOneAsync(claims[0], CancellationToken.None));
        Assert.Equal(1, extractor.AbandonedExtractions);
        Assert.Equal(CvRecoveryOutcome.Deferred, await processor.RunOneAsync(claims[1], CancellationToken.None));
        var (attempts, code, _, _) = await ReadRetryStateAsync(second);
        Assert.Equal(0, attempts);
        Assert.Equal("extraction_error", code);

        release.Set();
        await WaitUntilAsync(() => extractor.AbandonedExtractions == 0);
    }

    private static byte[] SyntheticPdf()
    {
        var pdf = new PdfDocumentBuilder();
        pdf.AddPage(PageSize.A4).AddText("Synthetic Candidate", 12, new PdfPoint(25, 700),
            pdf.AddStandard14Font(Standard14Font.Helvetica));
        return pdf.Build();
    }

    private static async Task WaitUntilAsync(Func<bool> condition)
    {
        for (var i = 0; i < 100 && !condition(); i++) await Task.Delay(50);
        Assert.True(condition());
    }

    private async Task<(int Attempts, string? Code, DateTime? NextAt, bool Leased)> ReadRetryStateAsync(Guid id)
    {
        await using var connection = await fixture.Source.OpenConnectionAsync();
        await using var command = new NpgsqlCommand("""
            SELECT cv_parse_attempts, cv_parse_failure_code, cv_parse_next_at, cv_parse_lease_token IS NOT NULL
            FROM candidate_documents WHERE id = @id
            """, connection);
        command.Parameters.AddWithValue("id", id);
        await using var reader = await command.ExecuteReaderAsync();
        Assert.True(await reader.ReadAsync());
        return (reader.GetInt32(0), reader.IsDBNull(1) ? null : reader.GetString(1),
            reader.IsDBNull(2) ? null : DateTime.SpecifyKind(reader.GetDateTime(2), DateTimeKind.Utc),
            reader.GetBoolean(3));
    }

    private sealed class ObjectStub(byte[] bytes, Func<Task>? onFetch = null) : ICvObjectStore
    {
        public int Fetches { get; private set; }

        public async Task<byte[]> FetchAsync(Guid organizationId, string objectKey, CancellationToken ct)
        {
            Fetches++;
            Assert.StartsWith($"cv-uploads/{organizationId}/", objectKey);
            if (onFetch is not null) await onFetch();
            return bytes;
        }
    }

    private sealed class CountingExtractor : ICvTextExtractor
    {
        public int Calls { get; private set; }
        public int AbandonedExtractions => 0;

        public Task<string> ExtractAsync(ReadOnlyMemory<byte> bytes, string objectKey, CancellationToken ct)
        {
            Calls++;
            return Task.FromResult("Synthetic Candidate");
        }
    }

    private sealed class ParserStub : ICvParser
    {
        public int Calls { get; private set; }
        public string? LastText { get; private set; }
        public Exception? Throw { get; init; }
        public CvAiBudgetDenial? DenyAuthorize { get; init; }
        public Exception? AuthorizeThrow { get; init; }

        public Task AuthorizeAsync(Guid organizationId, CancellationToken ct) =>
            AuthorizeThrow is not null ? Task.FromException(AuthorizeThrow) :
            DenyAuthorize is { } reason
                ? Task.FromException(new CvAiBudgetDeniedException(reason))
                : Task.CompletedTask;

        public Task<CvParsedResult> ParseAsync(Guid organizationId, string cvText, CancellationToken ct)
        {
            if (Throw is not null) return Task.FromException<CvParsedResult>(Throw);
            Calls++;
            LastText = cvText;
            Assert.True(CvParsedResult.TryParse(ModelJson, out var result));
            return Task.FromResult(result!);
        }
    }
}
