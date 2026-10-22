using System.IO.Compression;
using System.Text;
using Tims.Infrastructure.CvParsing;
using UglyToad.PdfPig.Content;
using UglyToad.PdfPig.Core;
using UglyToad.PdfPig.Fonts.Standard14Fonts;
using UglyToad.PdfPig.Writer;

namespace Tims.IntegrationTests.CvParsing;

public sealed class CvTextExtractorTests
{
    [Fact]
    public void Extracts_text_from_a_synthetic_pdf()
    {
        var builder = new PdfDocumentBuilder();
        var page = builder.AddPage(PageSize.A4);
        var font = builder.AddStandard14Font(Standard14Font.Helvetica);
        page.AddText("Synthetic Candidate CV", 12, new PdfPoint(25, 700), font);

        var text = CvTextExtractor.Extract(builder.Build(), "cv-uploads/org/resume.pdf");
        Assert.Contains("Synthetic Candidate CV", text);
    }

    [Fact]
    public void Extracts_paragraphs_and_limits_text_from_a_docx()
    {
        var longText = new string('A', 10_000);
        var bytes = MakeDocx($"""
            <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
              <w:body><w:p><w:r><w:t>Synthetic Candidate</w:t></w:r></w:p>
              <w:p><w:r><w:t>{longText}</w:t></w:r></w:p></w:body>
            </w:document>
            """);

        var text = CvTextExtractor.Extract(bytes, "cv-uploads/org/resume.docx");
        Assert.StartsWith("Synthetic Candidate\n", text);
        Assert.Equal(CvTextExtractor.MaxTextCharacters, text.Length);
    }

    [Fact]
    public void Rejects_xml_entities_without_leaking_the_document()
    {
        var bytes = MakeDocx("""
            <!DOCTYPE w:document [<!ENTITY private "ana@example.com">]>
            <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
              <w:body><w:p><w:r><w:t>&private;</w:t></w:r></w:p></w:body>
            </w:document>
            """);

        var error = Assert.Throws<CvDocumentException>(() =>
            CvTextExtractor.Extract(bytes, "cv-uploads/org/resume.docx"));
        Assert.DoesNotContain("ana@example.com", error.ToString());
    }

    [Theory]
    [InlineData("cv-uploads/org/resume.txt")]
    [InlineData("cv-uploads/org/resume.pdf")]
    public void Rejects_unsupported_or_corrupt_content(string key)
    {
        Assert.Throws<CvDocumentException>(() => CvTextExtractor.Extract(Encoding.UTF8.GetBytes("not a CV"), key));
    }

    [Fact]
    public void Rejects_oversized_docx_xml_before_decompression()
    {
        var bytes = MakeDocx("<document>" + new string('A', 2 * 1024 * 1024) + "</document>");
        Assert.Throws<CvDocumentException>(() => CvTextExtractor.Extract(bytes, "cv-uploads/org/resume.docx"));
    }

    private static byte[] MakeDocx(string xml)
    {
        using var stream = new MemoryStream();
        using (var archive = new ZipArchive(stream, ZipArchiveMode.Create, leaveOpen: true))
        {
            var entry = archive.CreateEntry("word/document.xml");
            using var writer = new StreamWriter(entry.Open(), Encoding.UTF8);
            writer.Write(xml);
        }
        return stream.ToArray();
    }
}

public sealed class BoundedCvTextExtractorTests
{
    [Fact]
    public async Task Overrunning_decoder_is_abandoned_at_the_deadline_and_counted_until_it_ends()
    {
        using var release = new ManualResetEventSlim();
        var extractor = new BoundedCvTextExtractor(TimeSpan.FromMilliseconds(150), (_, _, _) =>
        {
            release.Wait(TimeSpan.FromSeconds(30));
            return "late";
        });
        var started = DateTime.UtcNow;
        await Assert.ThrowsAsync<CvExtractionTimeoutException>(() =>
            extractor.ExtractAsync(new byte[] { 1 }, "x.pdf", CancellationToken.None));
        Assert.True(DateTime.UtcNow - started < TimeSpan.FromSeconds(5));
        Assert.Equal(1, extractor.AbandonedExtractions);
        release.Set();
        for (var i = 0; i < 100 && extractor.AbandonedExtractions != 0; i++) await Task.Delay(50);
        Assert.Equal(0, extractor.AbandonedExtractions);
    }

    [Fact]
    public async Task Decoder_observes_its_deadline_token_between_units_of_work()
    {
        var extractor = new BoundedCvTextExtractor(TimeSpan.FromMilliseconds(150), (_, _, token) =>
        {
            while (true)
            {
                token.ThrowIfCancellationRequested();
                Thread.Sleep(10);
            }
        });
        await Assert.ThrowsAsync<CvExtractionTimeoutException>(() =>
            extractor.ExtractAsync(new byte[] { 1 }, "x.pdf", CancellationToken.None));
        for (var i = 0; i < 100 && extractor.AbandonedExtractions != 0; i++) await Task.Delay(50);
        Assert.Equal(0, extractor.AbandonedExtractions);
    }

    [Fact]
    public async Task Fast_decoder_returns_its_text_and_document_errors_pass_through()
    {
        var ok = new BoundedCvTextExtractor(TimeSpan.FromSeconds(5), (_, _, _) => "Synthetic text");
        Assert.Equal("Synthetic text", await ok.ExtractAsync(new byte[] { 1 }, "x.pdf", CancellationToken.None));
        var bad = new BoundedCvTextExtractor(TimeSpan.FromSeconds(5), (_, _, _) => throw new CvDocumentException());
        await Assert.ThrowsAsync<CvDocumentException>(() =>
            bad.ExtractAsync(new byte[] { 1 }, "x.pdf", CancellationToken.None));
        Assert.Equal(0, bad.AbandonedExtractions);
    }

    [Fact]
    public async Task Concurrent_callers_cannot_exceed_the_decoder_limit_before_any_timeout()
    {
        // Tier-1 review: admission counted only decoders that had ALREADY timed out, so two callers
        // arriving together were both admitted next to an overrunning decoder.
        using var release = new ManualResetEventSlim();
        var extractor = new BoundedCvTextExtractor(TimeSpan.FromSeconds(10), (_, _, _) =>
        {
            release.Wait(TimeSpan.FromSeconds(30));
            return "late";
        }, maxDecoders: 2);
        var first = extractor.ExtractAsync(new byte[] { 1 }, "a.pdf", CancellationToken.None);
        var second = extractor.ExtractAsync(new byte[] { 1 }, "b.pdf", CancellationToken.None);
        Assert.Equal(2, extractor.LiveDecoders);
        await Assert.ThrowsAsync<CvExtractorSaturatedException>(() =>
            extractor.ExtractAsync(new byte[] { 1 }, "c.pdf", CancellationToken.None));
        release.Set();
        Assert.Equal("late", await first);
        Assert.Equal("late", await second);
        for (var i = 0; i < 100 && extractor.LiveDecoders != 0; i++) await Task.Delay(20);
        Assert.Equal(0, extractor.LiveDecoders);
    }

    [Fact]
    public async Task A_cancelled_caller_keeps_its_decoder_counted_until_the_decoder_ends()
    {
        using var release = new ManualResetEventSlim();
        var extractor = new BoundedCvTextExtractor(TimeSpan.FromSeconds(10), (_, _, _) =>
        {
            release.Wait(TimeSpan.FromSeconds(30));
            return "late";
        }, maxDecoders: 1);
        using var cancel = new CancellationTokenSource();
        var call = extractor.ExtractAsync(new byte[] { 1 }, "a.pdf", cancel.Token);
        cancel.Cancel();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => call);
        Assert.Equal(1, extractor.AbandonedExtractions);
        await Assert.ThrowsAsync<CvExtractorSaturatedException>(() =>
            extractor.ExtractAsync(new byte[] { 1 }, "b.pdf", CancellationToken.None));
        release.Set();
        for (var i = 0; i < 100 && extractor.LiveDecoders != 0; i++) await Task.Delay(20);
        Assert.Equal(0, extractor.LiveDecoders);
        Assert.Equal(0, extractor.AbandonedExtractions);
        // The slot came back: the same extractor admits the next document.
        Assert.Equal("late", await extractor.ExtractAsync(new byte[] { 1 }, "c.pdf", CancellationToken.None));
    }
}
