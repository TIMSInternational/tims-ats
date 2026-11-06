using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Tims.Application.InterviewTranscription;
using Tims.Infrastructure.InterviewJoin;

namespace Tims.Infrastructure.InterviewTranscription;

/// <summary><c>Daily:WebhookSecret</c> (env <c>Daily__WebhookSecret</c>): the base64 HMAC secret of the Daily webhook.</summary>
public sealed class DailyWebhookOptions
{
    public const string SectionName = "Daily";

    public string? WebhookSecret { get; init; }

    /// <summary>Usable: non-blank, not the terraform placeholder, valid base64 of at least 16 bytes.</summary>
    public bool HasUsableSecret
    {
        get
        {
            if (string.IsNullOrWhiteSpace(WebhookSecret) ||
                string.Equals(WebhookSecret.Trim(), DailyOptions.TerraformPlaceholder, StringComparison.Ordinal))
                return false;
            var buffer = new byte[WebhookSecret.Length];
            return Convert.TryFromBase64String(WebhookSecret.Trim(), buffer, out var written) && written >= 16;
        }
    }
}

public static class InterviewTranscriptionServiceCollectionExtensions
{
    public const long MaxTranscriptBytes = 2 * 1024 * 1024;

    public static IServiceCollection AddDailyTranscription(this IServiceCollection services,
        IConfiguration configuration)
    {
        services.AddOptions<DailyWebhookOptions>().Bind(configuration.GetSection(DailyWebhookOptions.SectionName));
        services.AddHttpClient<ITranscriptionProvider, DailyTranscriptionProvider>(client =>
            {
                client.Timeout = TimeSpan.FromSeconds(15);
                client.MaxResponseContentBufferSize = MaxTranscriptBytes;
            })
            .ConfigurePrimaryHttpMessageHandler(() => new HttpClientHandler { AllowAutoRedirect = false });
        return services;
    }
}

/// <summary>
/// Daily REST calls for the transcript (never a recording): enable transcript storage on ONE room, start real-time
/// transcription, fetch a stored WebVTT through its short-lived access link, delete a rejected transcript. The API key
/// is sent ONLY to the configured Daily API origin, never to the download link (a pre-signed storage URL).
/// </summary>
public sealed class DailyTranscriptionProvider(HttpClient client, IOptions<DailyOptions> options,
    ILogger<DailyTranscriptionProvider> logger) : ITranscriptionProvider
{
    private const int MaxRedirects = 2;
    private readonly DailyOptions _options = options.Value;

    public bool IsConfigured => _options.HasUsableApiKey;

    private HttpRequestMessage Api(HttpMethod method, string path, object? body = null)
    {
        var request = new HttpRequestMessage(method, new Uri(_options.ApiUrl.TrimEnd('/') + path));
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", _options.ApiKey!.Trim());
        if (body is not null) request.Content = JsonContent.Create(body);
        return request;
    }

    public async Task<TranscriptionStartResult> StartAsync(string roomName, string language, CancellationToken ct)
    {
        if (!IsConfigured) return TranscriptionStartResult.NotConfigured;
        var room = Uri.EscapeDataString(roomName);
        try
        {
            using (var enable = Api(HttpMethod.Post, "/rooms/" + room,
                       new { properties = new { enable_transcription_storage = true } }))
            using (var enabled = await client.SendAsync(enable, ct))
            {
                if (!enabled.IsSuccessStatusCode)
                {
                    logger.LogWarning("Daily transcript storage enable failed with {Status}", (int)enabled.StatusCode);
                    return TranscriptionStartResult.Failed;
                }
            }
            using var start = Api(HttpMethod.Post, "/rooms/" + room + "/transcription/start", new { language });
            using var started = await client.SendAsync(start, ct);
            if (started.IsSuccessStatusCode) return TranscriptionStartResult.Started;
            logger.LogWarning("Daily transcription start failed with {Status}", (int)started.StatusCode);
            return TranscriptionStartResult.Failed;
        }
        catch (Exception exception) when (exception is HttpRequestException or TaskCanceledException
                                              && !ct.IsCancellationRequested)
        {
            logger.LogWarning(exception, "Daily transcription start request failed");
            return TranscriptionStartResult.Failed;
        }
    }

    public async Task<string?> DownloadTranscriptAsync(Guid transcriptId, CancellationToken ct)
    {
        if (!IsConfigured) return null;
        try
        {
            Uri? link;
            using (var request = Api(HttpMethod.Get, "/transcript/" + transcriptId.ToString("D") + "/access-link"))
            using (var response = await client.SendAsync(request, ct))
            {
                if (!response.IsSuccessStatusCode)
                {
                    logger.LogWarning("Daily transcript access link failed with {Status}", (int)response.StatusCode);
                    return null;
                }
                link = ReadLink(await response.Content.ReadAsStringAsync(ct));
            }
            if (link is null) return null;
            for (var hop = 0; hop <= MaxRedirects; hop++)
            {
                // NO Authorization header: the link is pre-signed and may point at third-party storage.
                using var download = new HttpRequestMessage(HttpMethod.Get, link);
                using var file = await client.SendAsync(download, HttpCompletionOption.ResponseHeadersRead, ct);
                if (file.StatusCode is HttpStatusCode.Redirect or HttpStatusCode.Found or HttpStatusCode.SeeOther
                    or HttpStatusCode.TemporaryRedirect or HttpStatusCode.PermanentRedirect)
                {
                    link = SafeLink(file.Headers.Location is { } location
                        ? (location.IsAbsoluteUri ? location : new Uri(link, location))
                        : null);
                    if (link is null) return null;
                    continue;
                }
                if (!file.IsSuccessStatusCode)
                {
                    logger.LogWarning("Daily transcript download failed with {Status}", (int)file.StatusCode);
                    return null;
                }
                if (file.Content.Headers.ContentLength is > InterviewTranscriptionServiceCollectionExtensions.MaxTranscriptBytes)
                    return null;
                return await ReadBoundedAsync(file.Content, ct);
            }
            return null;
        }
        catch (Exception exception) when (exception is HttpRequestException or JsonException or TaskCanceledException
                                              && !ct.IsCancellationRequested)
        {
            logger.LogWarning(exception, "Daily transcript download request failed");
            return null;
        }
    }

    public async Task<bool> DeleteTranscriptAsync(Guid transcriptId, CancellationToken ct)
    {
        if (!IsConfigured) return false;
        try
        {
            using var request = Api(HttpMethod.Delete, "/transcript/" + transcriptId.ToString("D"));
            using var response = await client.SendAsync(request, ct);
            if (response.IsSuccessStatusCode || response.StatusCode == HttpStatusCode.NotFound) return true;
            logger.LogWarning("Daily transcript delete failed with {Status}", (int)response.StatusCode);
            return false;
        }
        catch (Exception exception) when (exception is HttpRequestException or TaskCanceledException
                                              && !ct.IsCancellationRequested)
        {
            logger.LogWarning(exception, "Daily transcript delete request failed");
            return false;
        }
    }

    /// <summary>Reads at most <see cref="InterviewTranscriptionServiceCollectionExtensions.MaxTranscriptBytes"/>; larger is null.</summary>
    private static async Task<string?> ReadBoundedAsync(HttpContent content, CancellationToken ct)
    {
        var max = InterviewTranscriptionServiceCollectionExtensions.MaxTranscriptBytes;
        await using var stream = await content.ReadAsStreamAsync(ct);
        using var buffer = new MemoryStream();
        var chunk = new byte[81_920];
        int read;
        while ((read = await stream.ReadAsync(chunk, ct)) > 0)
        {
            if (buffer.Length + read > max) return null;
            buffer.Write(chunk, 0, read);
        }
        return Encoding.UTF8.GetString(buffer.GetBuffer(), 0, (int)buffer.Length);
    }

    /// <summary>Daily's schema names the field <c>link</c>; its example uses <c>download_link</c>. Accept either.</summary>
    internal static Uri? ReadLink(string json)
    {
        using var document = JsonDocument.Parse(json, new JsonDocumentOptions { MaxDepth = 8 });
        var root = document.RootElement;
        if (root.ValueKind != JsonValueKind.Object) return null;
        foreach (var name in new[] { "link", "download_link" })
        {
            if (root.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String &&
                Uri.TryCreate(value.GetString(), UriKind.Absolute, out var uri))
                return SafeLink(uri);
        }
        return null;
    }

    /// <summary>https only, default port, no embedded credentials.</summary>
    internal static Uri? SafeLink(Uri? uri) =>
        uri is { Scheme: "https", UserInfo.Length: 0, IsDefaultPort: true } ? uri : null;
}
