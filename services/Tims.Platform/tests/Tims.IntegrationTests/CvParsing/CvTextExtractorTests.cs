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
