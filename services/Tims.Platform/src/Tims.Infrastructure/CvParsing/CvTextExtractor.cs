using System.IO.Compression;
using System.Text;
using System.Xml;
using System.Xml.Linq;
using UglyToad.PdfPig;
using UglyToad.PdfPig.DocumentLayoutAnalysis.TextExtractor;

namespace Tims.Infrastructure.CvParsing;

public sealed class CvDocumentException : Exception
{
    public CvDocumentException() : base("CV document could not be extracted") { }
}

/// <summary>
/// Local, bounded extraction of the public portal's PDF/DOCX uploads. The
/// filename/key is used only to choose a decoder; raw bytes are never logged.
/// Scanned image-only PDFs produce no text and need a separate OCR decision.
/// </summary>
public static class CvTextExtractor
{
    public const int MaxFileBytes = 5 * 1024 * 1024;
    public const int MaxTextCharacters = 8_000; // same prompt bound as the TS CV agent
    private const int MaxPdfPages = 30;
    private const long MaxDocxXmlBytes = 2 * 1024 * 1024;
    private static readonly string WordNamespace = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

    public static string Extract(ReadOnlyMemory<byte> bytes, string objectKey, CancellationToken ct = default)
    {
        if (bytes.Length is < 1 or > MaxFileBytes) throw new CvDocumentException();
        try
        {
            var text = objectKey.EndsWith(".pdf", StringComparison.OrdinalIgnoreCase)
                ? ExtractPdf(bytes, ct)
                : objectKey.EndsWith(".docx", StringComparison.OrdinalIgnoreCase)
                    ? ExtractDocx(bytes, ct)
                    : throw new CvDocumentException();
            if (string.IsNullOrWhiteSpace(text)) throw new CvDocumentException();
            return text.Trim();
        }
        catch (CvDocumentException) { throw; }
        catch (OperationCanceledException) { throw; }
        catch (Exception exception) when (exception is not OutOfMemoryException)
        {
            // Parser/zip exceptions can echo filenames or document text. Do not
            // retain the inner exception or return it to the worker's logger.
            throw new CvDocumentException();
        }
    }

    private static string ExtractPdf(ReadOnlyMemory<byte> bytes, CancellationToken ct)
    {
        using var stream = new MemoryStream(bytes.ToArray(), writable: false);
        using var document = PdfDocument.Open(stream);
        if (document.NumberOfPages is < 1 or > MaxPdfPages) throw new CvDocumentException();
        var text = new StringBuilder(Math.Min(MaxTextCharacters, 1024));
        foreach (var page in document.GetPages())
        {
            ct.ThrowIfCancellationRequested();
            var pageText = ContentOrderTextExtractor.GetText(page);
            AppendBounded(text, pageText);
            if (text.Length >= MaxTextCharacters) break;
            AppendBounded(text, "\n");
        }
        return text.ToString();
    }

    private static string ExtractDocx(ReadOnlyMemory<byte> bytes, CancellationToken ct)
    {
        using var stream = new MemoryStream(bytes.ToArray(), writable: false);
        using var archive = new ZipArchive(stream, ZipArchiveMode.Read);
        var document = archive.GetEntry("word/document.xml") ?? throw new CvDocumentException();
        if (document.Length is < 1 or > MaxDocxXmlBytes) throw new CvDocumentException();
        using var xmlStream = document.Open();
        using var reader = XmlReader.Create(xmlStream, new XmlReaderSettings
        {
            DtdProcessing = DtdProcessing.Prohibit,
            XmlResolver = null,
            MaxCharactersInDocument = MaxDocxXmlBytes,
            IgnoreComments = true
        });
        var xml = XDocument.Load(reader);
        var word = XNamespace.Get(WordNamespace);
        var text = new StringBuilder(Math.Min(MaxTextCharacters, 1024));
        foreach (var paragraph in xml.Descendants(word + "p"))
        {
            ct.ThrowIfCancellationRequested();
            foreach (var element in paragraph.Descendants())
            {
                if (element.Name == word + "t") AppendBounded(text, element.Value);
                else if (element.Name == word + "tab") AppendBounded(text, "\t");
                if (text.Length >= MaxTextCharacters) break;
            }
            if (text.Length >= MaxTextCharacters) break;
            AppendBounded(text, "\n");
        }
        return text.ToString();
    }

    private static void AppendBounded(StringBuilder target, string value)
    {
        var remaining = MaxTextCharacters - target.Length;
        if (remaining > 0) target.Append(value.AsSpan(0, Math.Min(value.Length, remaining)));
    }
}

public sealed class CvExtractionTimeoutException : Exception
{
    public CvExtractionTimeoutException() : base("CV text extraction exceeded its time budget") { }
}

/// <summary>
/// Too many earlier extractions overran their deadline and are still running.
/// Not the current document's fault: the processor defers it without spending
/// an attempt, and the host raises the recovery alert.
/// </summary>
public sealed class CvExtractorSaturatedException : Exception
{
    public CvExtractorSaturatedException() : base("CV text extraction capacity is saturated") { }
}

/// <summary>Text extraction seam for the recovery processor.</summary>
public interface ICvTextExtractor
{
    /// <summary>Overrun extractions still running (0 when healthy).</summary>
    int AbandonedExtractions { get; }

    Task<string> ExtractAsync(ReadOnlyMemory<byte> bytes, string objectKey, CancellationToken ct);
}

/// <summary>
/// Runs the synchronous PDF/DOCX decoders off the hosted loop with a HARD
/// wall-clock budget. A malformed or hostile PDF can make PdfPig spin; the
/// caller stops waiting at the deadline and gets a RETRYABLE
/// <see cref="CvExtractionTimeoutException"/>. Cancellation is also checked
/// between pages/paragraphs, but a decoder stuck inside one page cannot be
/// interrupted in-process.
///
/// The resource bound is on decoder THREADS, not on how many have already timed
/// out: a slot is reserved atomically BEFORE a decoder starts and released only
/// when that decoder actually ends, whether it finished, timed out, or its caller
/// was cancelled. So at most <c>maxDecoders</c> decoders (and therefore at most
/// that many overrunning ones) burn CPU in the API process at once; a call beyond
/// that is refused with <see cref="CvExtractorSaturatedException"/> (deferred by
/// the processor without spending an attempt). The earlier check counted only
/// decoders that had ALREADY timed out, so concurrent callers could all be
/// admitted and leave more overrunning threads than the stated limit (tier-1 review).
/// </summary>
public sealed class BoundedCvTextExtractor(
    TimeSpan timeout,
    Func<ReadOnlyMemory<byte>, string, CancellationToken, string>? decode = null,
    int maxDecoders = 2) : ICvTextExtractor
{
    public static readonly TimeSpan DefaultTimeout = TimeSpan.FromSeconds(15);
    private readonly Func<ReadOnlyMemory<byte>, string, CancellationToken, string> _decode =
        decode ?? CvTextExtractor.Extract;
    private int _live;
    private int _abandoned;

    /// <summary>Decoders whose caller stopped waiting (deadline or cancellation) but which still run.</summary>
    public int AbandonedExtractions => Volatile.Read(ref _abandoned);

    /// <summary>Decoder threads alive right now (normal and abandoned).</summary>
    public int LiveDecoders => Volatile.Read(ref _live);

    public async Task<string> ExtractAsync(ReadOnlyMemory<byte> bytes, string objectKey, CancellationToken ct)
    {
        if (timeout <= TimeSpan.Zero) throw new ArgumentOutOfRangeException(nameof(timeout));
        if (maxDecoders < 1) throw new ArgumentOutOfRangeException(nameof(maxDecoders));
        if (Interlocked.Increment(ref _live) > maxDecoders)
        {
            Interlocked.Decrement(ref _live);
            throw new CvExtractorSaturatedException();
        }
        var deadline = CancellationTokenSource.CreateLinkedTokenSource(ct);
        var token = deadline.Token;
        Task<string> work;
        try
        {
            work = Task.Factory.StartNew(() => _decode(bytes, objectKey, token), CancellationToken.None,
                TaskCreationOptions.LongRunning | TaskCreationOptions.DenyChildAttach, TaskScheduler.Default);
        }
        catch
        {
            Interlocked.Decrement(ref _live);
            deadline.Dispose();
            throw;
        }
        // The slot (and the token source the decoder reads) is released only when the decoder ends.
        _ = work.ContinueWith(static (_, state) =>
        {
            var (self, source) = ((BoundedCvTextExtractor, CancellationTokenSource))state!;
            Interlocked.Decrement(ref self._live);
            source.Dispose();
        }, (this, deadline), CancellationToken.None, TaskContinuationOptions.ExecuteSynchronously, TaskScheduler.Default);
        try
        {
            return await work.WaitAsync(timeout, ct).ConfigureAwait(false);
        }
        catch (TimeoutException)
        {
            Abandon(work, deadline);
            throw new CvExtractionTimeoutException();
        }
        catch (OperationCanceledException) when (!ct.IsCancellationRequested)
        {
            throw new CvExtractionTimeoutException();
        }
        catch (OperationCanceledException)
        {
            // The caller was cancelled; the decoder may keep running. Count it until it ends.
            Abandon(work, deadline);
            throw;
        }
    }

    private void Abandon(Task work, CancellationTokenSource deadline)
    {
        try { deadline.Cancel(); } catch (ObjectDisposedException) { /* the decoder already ended */ }
        if (work.IsCompleted) return;
        Interlocked.Increment(ref _abandoned);
        _ = work.ContinueWith(static (_, state) =>
            Interlocked.Decrement(ref ((BoundedCvTextExtractor)state!)._abandoned), this,
            CancellationToken.None, TaskContinuationOptions.ExecuteSynchronously, TaskScheduler.Default);
    }
}
