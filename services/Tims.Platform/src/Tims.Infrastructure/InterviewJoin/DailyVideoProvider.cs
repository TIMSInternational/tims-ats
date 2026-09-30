using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Tims.Application.InterviewJoin;

namespace Tims.Infrastructure.InterviewJoin;

/// <summary>
/// <c>Daily:ApiKey</c> / <c>Daily:ApiUrl</c> (env <c>Daily__ApiKey</c>, <c>Daily__ApiUrl</c>). The URL is
/// validated at startup; a MISSING key does not fail startup (the TS video service treats it as optional
/// too) — the candidate join answers <c>unavailable</c> instead.
/// </summary>
public sealed class DailyOptions
{
    public const string SectionName = "Daily";
    public const string DefaultApiUrl = "https://api.daily.co/v1";

    /// <summary>The value terraform seeds into every secret until it is set out of band. It is NOT a key.</summary>
    public const string TerraformPlaceholder = "REPLACE_ME_OUT_OF_BAND";

    public string? ApiKey { get; init; }
    public string ApiUrl { get; init; } = DefaultApiUrl;

    /// <summary>A key is usable when it is non-blank and is not the terraform placeholder.</summary>
    public bool HasUsableApiKey => !string.IsNullOrWhiteSpace(ApiKey) &&
        !string.Equals(ApiKey.Trim(), TerraformPlaceholder, StringComparison.Ordinal);

    public bool IsValid() => Uri.TryCreate(ApiUrl, UriKind.Absolute, out var uri) && uri.Scheme == Uri.UriSchemeHttps &&
        uri.UserInfo.Length == 0 && uri.Query.Length == 0 && uri.Fragment.Length == 0;
}

public static class DailyVideoServiceCollectionExtensions
{
    public static IServiceCollection AddDailyVideo(this IServiceCollection services, IConfiguration configuration)
    {
        services.AddOptions<DailyOptions>().Bind(configuration.GetSection(DailyOptions.SectionName))
            .Validate(options => options.IsValid(), "Daily:ApiUrl must be an https URL without credentials, query or fragment")
            .ValidateOnStart();
        services.AddHttpClient<ICandidateVideoProvider, DailyVideoProvider>(client =>
            {
                client.Timeout = TimeSpan.FromSeconds(10);
                client.MaxResponseContentBufferSize = 65536;
            })
            .ConfigurePrimaryHttpMessageHandler(() => new HttpClientHandler { AllowAutoRedirect = false });
        return services;
    }
}

/// <summary>C# port of packages/api/src/services/video.service.ts, scoped to the candidate guest join.</summary>
public sealed class DailyVideoProvider(HttpClient client, IOptions<DailyOptions> options,
    ILogger<DailyVideoProvider> logger) : ICandidateVideoProvider
{
    private readonly DailyOptions _options = options.Value;

    public bool IsConfigured => _options.HasUsableApiKey;

    private Uri Endpoint(string path) => new(_options.ApiUrl.TrimEnd('/') + path);

    private HttpRequestMessage Request(HttpMethod method, string path, object? body = null)
    {
        var request = new HttpRequestMessage(method, Endpoint(path));
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", _options.ApiKey!.Trim());
        if (body is not null) request.Content = JsonContent.Create(body);
        return request;
    }

    public async Task<VideoRoom?> EnsureRoomAsync(string roomName, DateTimeOffset openUntil, CancellationToken ct)
    {
        if (!IsConfigured) return null;
        var exp = openUntil.ToUnixTimeSeconds();
        try
        {
            using (var create = Request(HttpMethod.Post, "/rooms/", new
            {
                name = roomName,
                privacy = "private",
                properties = new { exp, enable_chat = true, enable_knocking = false },
            }))
            using (var created = await client.SendAsync(create, ct))
            {
                if (created.IsSuccessStatusCode) return await ReadRoomAsync(created, ct);
                if (created.StatusCode != HttpStatusCode.BadRequest)
                {
                    logger.LogWarning("Daily room create failed with {Status}", (int)created.StatusCode);
                    return null;
                }
            }

            // 400 = the room already exists (TS parity): fetch it, and extend it if it closes too early.
            // Adopting it is safe only because every caller passes a name derived from the interview's own id
            // (CandidateInterviewJoin.IsOwnRoomName), and the caller re-checks the returned room (SameRoom).
            using var get = Request(HttpMethod.Get, "/rooms/" + Uri.EscapeDataString(roomName));
            using var existing = await client.SendAsync(get, ct);
            if (!existing.IsSuccessStatusCode)
            {
                logger.LogWarning("Daily room lookup failed with {Status}", (int)existing.StatusCode);
                return null;
            }
            using var document = JsonDocument.Parse(await existing.Content.ReadAsStringAsync(ct));
            var room = Room(document.RootElement);
            if (room is null) return null;
            if (document.RootElement.TryGetProperty("config", out var config) &&
                config.ValueKind == JsonValueKind.Object && config.TryGetProperty("exp", out var current) &&
                current.TryGetInt64(out var currentExp) && currentExp < exp)
            {
                using var extend = Request(HttpMethod.Post, "/rooms/" + Uri.EscapeDataString(roomName),
                    new { properties = new { exp } });
                using var extended = await client.SendAsync(extend, ct);
                if (!extended.IsSuccessStatusCode)
                {
                    logger.LogWarning("Daily room extend failed with {Status}", (int)extended.StatusCode);
                    return null;
                }
            }
            return room;
        }
        catch (Exception exception) when (exception is HttpRequestException or JsonException or TaskCanceledException
                                              && !ct.IsCancellationRequested)
        {
            logger.LogWarning(exception, "Daily room request failed");
            return null;
        }
    }

    public async Task<string?> CreateGuestTokenAsync(string roomName, string userName, DateTimeOffset notBefore,
        DateTimeOffset expiresAt, CancellationToken ct)
    {
        if (!IsConfigured) return null;
        try
        {
            using var request = Request(HttpMethod.Post, "/meeting-tokens", new
            {
                properties = new
                {
                    room_name = roomName,
                    user_name = userName,
                    is_owner = false,
                    nbf = notBefore.ToUnixTimeSeconds(),
                    exp = expiresAt.ToUnixTimeSeconds(),
                    eject_at_token_exp = true,
                },
            });
            using var response = await client.SendAsync(request, ct);
            if (!response.IsSuccessStatusCode)
            {
                logger.LogWarning("Daily meeting token failed with {Status}", (int)response.StatusCode);
                return null;
            }
            using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync(ct));
            return document.RootElement.ValueKind == JsonValueKind.Object &&
                   document.RootElement.TryGetProperty("token", out var token) &&
                   token.ValueKind == JsonValueKind.String && token.GetString() is { Length: > 0 and <= 4096 } value
                ? value
                : null;
        }
        catch (Exception exception) when (exception is HttpRequestException or JsonException or TaskCanceledException
                                              && !ct.IsCancellationRequested)
        {
            logger.LogWarning(exception, "Daily meeting token request failed");
            return null;
        }
    }

    private static async Task<VideoRoom?> ReadRoomAsync(HttpResponseMessage response, CancellationToken ct)
    {
        using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync(ct));
        return Room(document.RootElement);
    }

    private static VideoRoom? Room(JsonElement root) =>
        root.ValueKind == JsonValueKind.Object &&
        root.TryGetProperty("name", out var name) && name.ValueKind == JsonValueKind.String &&
        root.TryGetProperty("url", out var url) && url.ValueKind == JsonValueKind.String
            ? new VideoRoom(name.GetString()!, url.GetString()!)
            : null;
}
