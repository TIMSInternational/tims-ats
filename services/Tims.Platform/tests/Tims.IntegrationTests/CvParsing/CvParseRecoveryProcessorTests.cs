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

    private sealed class ObjectStub(byte[] bytes, Func<Task>? onFetch = null) : ICvObjectStore
    {
        public async Task<byte[]> FetchAsync(Guid organizationId, string objectKey, CancellationToken ct)
        {
            Assert.StartsWith($"cv-uploads/{organizationId}/", objectKey);
            if (onFetch is not null) await onFetch();
            return bytes;
        }
    }

    private sealed class ParserStub : ICvParser
    {
        public int Calls { get; private set; }
        public string? LastText { get; private set; }
        public Task<CvParsedResult> ParseAsync(Guid organizationId, string cvText, CancellationToken ct)
        {
            Calls++;
            LastText = cvText;
            Assert.True(CvParsedResult.TryParse(ModelJson, out var result));
            return Task.FromResult(result!);
        }
    }
}
