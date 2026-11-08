using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace Tims.Infrastructure.Assessments.Providers;

/// <summary>
/// OAuth 2.0 client-credentials access tokens for the TIMS Assessments API, cached in memory per process.
/// <list type="bullet">
/// <item>Single-flight: concurrent callers share one token request.</item>
/// <item>Refreshed <see cref="RefreshSkew"/> before <c>expires_in</c> (the contract's tokens live at most 15 minutes),
/// and dropped on a 401 (<see cref="Invalidate"/>) so a rotated client secret takes effect on the next call.</item>
/// <item>Client authentication is HTTP Basic (<c>client_secret_basic</c>, RFC 6749 §2.3.1). The secret and the token
/// are never logged; a failure logs only the HTTP status.</item>
/// </list>
/// </summary>
public sealed class ClientCredentialsTokenCache(
    IHttpClientFactory httpClientFactory,
    IOptions<AssessmentProviderOptions> options,
    TimeProvider timeProvider,
    ILogger<ClientCredentialsTokenCache> logger) : IDisposable
{
    public const string HttpClientName = "tims-assessments-token";
    public static readonly TimeSpan RefreshSkew = TimeSpan.FromSeconds(60);
    private const int MaxTokenLength = 8192;

    private readonly SemaphoreSlim _gate = new(1, 1);

    // One immutable snapshot, swapped atomically: readers outside the lock never see a token with another's expiry.
    private CachedToken? _cached;

    /// <summary>A valid access token, or null when the token endpoint is unconfigured, unreachable or refused us.</summary>
    public async Task<string?> GetTokenAsync(CancellationToken cancellationToken)
    {
        if (TryCached(out var cached))
        {
            return cached;
        }

        await _gate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            if (TryCached(out cached))
            {
                return cached;
            }

            var fetched = await FetchAsync(cancellationToken).ConfigureAwait(false);
            if (fetched is { } token)
            {
                var lifetime = TimeSpan.FromSeconds(token.ExpiresInSeconds) - RefreshSkew;
                var refreshAt = timeProvider.GetUtcNow() + (lifetime > TimeSpan.Zero ? lifetime : TimeSpan.Zero);
                Volatile.Write(ref _cached, new CachedToken(token.AccessToken, refreshAt));
                return token.AccessToken;
            }

            return null;
        }
        finally
        {
            _gate.Release();
        }
    }

    /// <summary>Drops the cached token (after a 401), so the next call fetches a new one.</summary>
    public void Invalidate() => Volatile.Write(ref _cached, null);

    public void Dispose() => _gate.Dispose();

    private bool TryCached(out string? token)
    {
        var cached = Volatile.Read(ref _cached);
        token = cached?.Value;
        return cached is not null && timeProvider.GetUtcNow() < cached.RefreshAt;
    }

    private sealed class CachedToken(string value, DateTimeOffset refreshAt)
    {
        public string Value { get; } = value;

        public DateTimeOffset RefreshAt { get; } = refreshAt;

        public override string ToString() => "CachedToken { [redacted] }";
    }

    private async Task<(string AccessToken, int ExpiresInSeconds)?> FetchAsync(CancellationToken cancellationToken)
    {
        var settings = options.Value;
        if (!settings.IsConfigured)
        {
            return null;
        }

        var client = httpClientFactory.CreateClient(HttpClientName);
        using var request = new HttpRequestMessage(HttpMethod.Post, settings.TokenUrl);
        var basic = Convert.ToBase64String(Encoding.UTF8.GetBytes(
            Uri.EscapeDataString(settings.ClientId!.Trim()) + ":" + Uri.EscapeDataString(settings.ClientSecret!.Trim())));
        request.Headers.Authorization = new AuthenticationHeaderValue("Basic", basic);
        request.Content = new FormUrlEncodedContent(new Dictionary<string, string>
        {
            ["grant_type"] = "client_credentials",
            ["scope"] = settings.Scopes,
        });

        try
        {
            using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            timeout.CancelAfter(TimeSpan.FromSeconds(settings.RequestTimeoutSeconds));
            using var response = await client.SendAsync(request, timeout.Token).ConfigureAwait(false);
            if (!response.IsSuccessStatusCode)
            {
                logger.LogWarning("TIMS Assessments token request failed with {Status}", (int)response.StatusCode);
                return null;
            }

            await using var stream = await response.Content.ReadAsStreamAsync(timeout.Token).ConfigureAwait(false);
            using var document = await JsonDocument.ParseAsync(stream, cancellationToken: timeout.Token).ConfigureAwait(false);
            var root = document.RootElement;
            if (root.ValueKind != JsonValueKind.Object
                || !root.TryGetProperty("access_token", out var accessToken) || accessToken.ValueKind != JsonValueKind.String
                || accessToken.GetString() is not { Length: > 0 and <= MaxTokenLength } value
                || !root.TryGetProperty("token_type", out var tokenType) || tokenType.ValueKind != JsonValueKind.String
                || !string.Equals(tokenType.GetString(), "Bearer", StringComparison.OrdinalIgnoreCase)
                || !root.TryGetProperty("expires_in", out var expiresIn) || !expiresIn.TryGetInt32(out var seconds)
                || seconds <= 0)
            {
                logger.LogWarning("TIMS Assessments token response was not a bearer token response");
                return null;
            }

            return (value, Math.Min(seconds, 3600));
        }
        catch (HttpRequestException)
        {
            logger.LogWarning("TIMS Assessments token endpoint unreachable");
            return null;
        }
        catch (TaskCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            logger.LogWarning("TIMS Assessments token request timed out");
            return null;
        }
        catch (JsonException)
        {
            logger.LogWarning("TIMS Assessments token response was not JSON");
            return null;
        }
    }
}
