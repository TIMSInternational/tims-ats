using System.Net;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Tims.Application.InterviewTranscription;
using Tims.Infrastructure.InterviewJoin;
using Tims.Infrastructure.InterviewTranscription;

namespace Tims.IntegrationTests.InterviewTranscription;

public sealed class DailyTranscriptionProviderTests
{
    private sealed class Handler(params HttpResponseMessage[] responses) : HttpMessageHandler
    {
        private readonly Queue<HttpResponseMessage> _responses = new(responses);
        public List<(HttpMethod Method, string Url, string? Auth, string Body)> Requests { get; } = [];

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            Requests.Add((request.Method, request.RequestUri!.ToString(), request.Headers.Authorization?.ToString(),
                request.Content is null ? "" : await request.Content.ReadAsStringAsync(ct)));
            return _responses.Dequeue();
        }
    }

    private static HttpResponseMessage Json(HttpStatusCode status, string body) =>
        new(status) { Content = new StringContent(body, Encoding.UTF8, "application/json") };

    private static DailyTranscriptionProvider Provider(Handler handler, string? key = "daily-test-key") =>
        new(new HttpClient(handler), Options.Create(new DailyOptions { ApiKey = key }),
            NullLogger<DailyTranscriptionProvider>.Instance);

    private static readonly Guid Transcript = Guid.Parse("68f65d4c-a4dc-4179-bbb1-c12432afb924");

    [Fact]
    public async Task Start_enables_storage_on_that_room_then_starts_a_transcript_never_a_recording()
    {
        var handler = new Handler(Json(HttpStatusCode.OK, "{}"), Json(HttpStatusCode.OK, "{}"));
        Assert.Equal(TranscriptionStartResult.Started, await Provider(handler).StartAsync("tims-abc", "es", default));
        Assert.Equal(2, handler.Requests.Count);
        Assert.Equal((HttpMethod.Post, "https://api.daily.co/v1/rooms/tims-abc", "Bearer daily-test-key"),
            (handler.Requests[0].Method, handler.Requests[0].Url, handler.Requests[0].Auth));
        using var enable = JsonDocument.Parse(handler.Requests[0].Body);
        Assert.True(enable.RootElement.GetProperty("properties").GetProperty("enable_transcription_storage").GetBoolean());
        Assert.Equal("https://api.daily.co/v1/rooms/tims-abc/transcription/start", handler.Requests[1].Url);
        Assert.Equal("es", JsonDocument.Parse(handler.Requests[1].Body).RootElement.GetProperty("language").GetString());
        Assert.DoesNotContain(handler.Requests, r => r.Url.Contains("recording", StringComparison.Ordinal) ||
                                                     r.Body.Contains("recording", StringComparison.Ordinal));
    }

    [Fact]
    public async Task A_failed_storage_enable_never_starts_the_transcript()
    {
        var handler = new Handler(Json(HttpStatusCode.BadRequest, "{}"));
        Assert.Equal(TranscriptionStartResult.Failed, await Provider(handler).StartAsync("tims-abc", "es", default));
        Assert.Single(handler.Requests);
        Assert.Equal(TranscriptionStartResult.NotConfigured,
            await Provider(new Handler(), key: "REPLACE_ME_OUT_OF_BAND").StartAsync("tims-abc", "es", default));
    }

    [Fact]
    public async Task Download_sends_the_key_to_the_API_only_never_to_the_presigned_link()
    {
        var handler = new Handler(
            Json(HttpStatusCode.OK, $$"""{"transcriptId":"{{Transcript}}","link":"https://b.daily.co/transcripts/x.vtt?Expires=1"}"""),
            new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent("WEBVTT\n\n") });
        Assert.Equal("WEBVTT\n\n", await Provider(handler).DownloadTranscriptAsync(Transcript, default));
        Assert.Equal(($"https://api.daily.co/v1/transcript/{Transcript}/access-link", "Bearer daily-test-key"),
            (handler.Requests[0].Url, handler.Requests[0].Auth));
        Assert.Equal(("https://b.daily.co/transcripts/x.vtt?Expires=1", (string?)null),
            (handler.Requests[1].Url, handler.Requests[1].Auth));
    }

    [Fact]
    public async Task Download_follows_an_https_redirect_without_credentials_and_refuses_http()
    {
        var redirect = new HttpResponseMessage(HttpStatusCode.Found);
        redirect.Headers.Location = new Uri("https://storage.example/x.vtt?sig=1");
        var handler = new Handler(Json(HttpStatusCode.OK, """{"download_link":"https://b.daily.co/t"}"""), redirect,
            new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent("WEBVTT") });
        Assert.Equal("WEBVTT", await Provider(handler).DownloadTranscriptAsync(Transcript, default));
        Assert.Null(handler.Requests[2].Auth);

        var insecure = new HttpResponseMessage(HttpStatusCode.Found);
        insecure.Headers.Location = new Uri("http://storage.example/x.vtt");
        var refused = new Handler(Json(HttpStatusCode.OK, """{"link":"https://b.daily.co/t"}"""), insecure);
        Assert.Null(await Provider(refused).DownloadTranscriptAsync(Transcript, default));
        Assert.Equal(2, refused.Requests.Count);

        var plainLink = new Handler(Json(HttpStatusCode.OK, """{"link":"http://b.daily.co/t"}"""));
        Assert.Null(await Provider(plainLink).DownloadTranscriptAsync(Transcript, default));
        Assert.Single(plainLink.Requests);
    }

    [Fact]
    public async Task An_oversized_transcript_is_refused()
    {
        var big = new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new ByteArrayContent(new byte[InterviewTranscriptionServiceCollectionExtensions.MaxTranscriptBytes + 1]),
        };
        var handler = new Handler(Json(HttpStatusCode.OK, """{"link":"https://b.daily.co/t"}"""), big);
        Assert.Null(await Provider(handler).DownloadTranscriptAsync(Transcript, default));
    }

    [Fact]
    public async Task Delete_treats_an_already_missing_transcript_as_deleted()
    {
        var handler = new Handler(Json(HttpStatusCode.NotFound, "{}"), Json(HttpStatusCode.InternalServerError, "{}"));
        var provider = Provider(handler);
        Assert.True(await provider.DeleteTranscriptAsync(Transcript, default));
        Assert.False(await provider.DeleteTranscriptAsync(Transcript, default));
        Assert.Equal((HttpMethod.Delete, $"https://api.daily.co/v1/transcript/{Transcript}"),
            (handler.Requests[0].Method, handler.Requests[0].Url));
    }

    [Theory]
    [InlineData("", false)]
    [InlineData("REPLACE_ME_OUT_OF_BAND", false)]
    [InlineData("c2hvcnQ=", false)] // "short"
    [InlineData("not base64!!", false)]
    [InlineData("aW50ZWdyYXRpb24taG1hYy1zZWNyZXQtMDEyMzQ1Njc4OQ==", true)]
    public void Webhook_secret_usability(string secret, bool usable) =>
        Assert.Equal(usable, new DailyWebhookOptions { WebhookSecret = secret }.HasUsableSecret);
}
