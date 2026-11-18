using System.Text;
using Microsoft.AspNetCore.Http;
using Tims.Api.Assessments;
using Tims.Application.Assessments.Providers;

namespace Tims.IntegrationTests.Assessments;

/// <summary>
/// The webhook's 64 KiB cap is enforced in three independent places; each test below fails if exactly one of them is
/// removed (the endpoint test with both caps in place cannot tell them apart).
/// </summary>
public sealed class WebhookBodyCapTests
{
    private const int Max = ProviderWebhookUseCase.MaxBodyBytes;

    private static DefaultHttpContext Request(byte[] body, long? contentLength)
    {
        var context = new DefaultHttpContext();
        context.Request.Body = new MemoryStream(body);
        context.Request.ContentLength = contentLength;
        return context;
    }

    [Fact]
    public async Task A_declared_Content_Length_over_the_cap_is_refused_before_reading()
    {
        // The body itself is small: only the declared length can refuse it.
        var context = Request(Encoding.UTF8.GetBytes("{}"), Max + 1);

        Assert.Null(await ProviderCandidateEndpoints.ReadRawBodyAsync(context, Max, CancellationToken.None));
        Assert.Equal(0, context.Request.Body.Position);
    }

    [Fact]
    public async Task A_streamed_body_with_no_Content_Length_is_refused_once_it_passes_the_cap()
    {
        var oversized = await ProviderCandidateEndpoints.ReadRawBodyAsync(
            Request(new byte[Max + 1], null), Max, CancellationToken.None);
        var atCap = await ProviderCandidateEndpoints.ReadRawBodyAsync(Request(new byte[Max], null), Max, CancellationToken.None);

        Assert.Null(oversized);
        Assert.Equal(Max, atCap!.Length);
    }

    private static byte[] Envelope(int totalBytes)
    {
        var json = $$"""{"event_id":"{{Guid.NewGuid()}}","event_type":"subject.erased","event_version":1,"occurred_at":"2026-11-09T14:38:06Z","producer":"tims-assessments","tenant_id":"{{Guid.NewGuid()}}","data":{"subject_id":"{{Guid.NewGuid()}}" """ + "}}";
        return Encoding.UTF8.GetBytes(json + new string(' ', totalBytes - Encoding.UTF8.GetByteCount(json)));
    }

    [Fact]
    public void The_envelope_parser_refuses_a_valid_envelope_one_byte_over_the_cap()
    {
        // Valid JSON either way (trailing whitespace): only the parser's own length check can refuse the larger one.
        Assert.True(ProviderWebhookUseCase.TryParseEnvelope(Envelope(Max), out _, out _));
        Assert.False(ProviderWebhookUseCase.TryParseEnvelope(Envelope(Max + 1), out _, out var error));
        Assert.Equal("invalid_envelope", error);
    }
}
