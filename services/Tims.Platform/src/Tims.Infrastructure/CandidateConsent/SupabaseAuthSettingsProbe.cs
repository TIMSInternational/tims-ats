using System.Text.Json;
using Microsoft.Extensions.Configuration;
using Tims.Application.CandidateConsent;

namespace Tims.Infrastructure.CandidateConsent;

/// <summary>
/// Reads <c>{Invitations:SupabaseUrl}/auth/v1/settings</c> (header <c>apikey</c> = <c>Invitations:SupabaseServiceKey</c>)
/// and reports whether email confirmation is REQUIRED (<c>mailer_autoconfirm</c> is the JSON boolean <c>false</c>).
///
/// <para>Singleton. A successful read (either answer) is cached for <see cref="SuccessTtl"/>; a failure (unconfigured,
/// non-2xx, timeout, unparseable, field missing or not a boolean) answers false — fail closed — and is cached only
/// for <see cref="FailureTtl"/> so an outage does not stampede the auth service. One refresh at a time.</para>
/// </summary>
public sealed class SupabaseAuthSettingsProbe(
    IHttpClientFactory httpClientFactory, IConfiguration configuration, TimeProvider clock) : IAuthSettingsProbe
{
    public const string HttpClientName = "SupabaseAuthSettings";
    public static readonly TimeSpan SuccessTtl = TimeSpan.FromMinutes(5);
    public static readonly TimeSpan FailureTtl = TimeSpan.FromSeconds(10);

    private readonly SemaphoreSlim _refresh = new(1, 1);
    private volatile CachedAnswer? _cached;

    public async Task<bool> RequiresEmailConfirmationAsync(CancellationToken cancellationToken)
    {
        var cached = _cached;
        if (cached is not null && clock.GetUtcNow() < cached.ExpiresAt)
        {
            return cached.RequiresConfirmation;
        }

        await _refresh.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            cached = _cached;
            if (cached is not null && clock.GetUtcNow() < cached.ExpiresAt)
            {
                return cached.RequiresConfirmation;
            }

            var answer = await FetchAsync(cancellationToken).ConfigureAwait(false);
            var ttl = answer is null ? FailureTtl : SuccessTtl;
            var requires = answer == false; // autoconfirm false ⇒ confirmation required
            _cached = new CachedAnswer(requires, clock.GetUtcNow() + ttl);
            return requires;
        }
        finally
        {
            _refresh.Release();
        }
    }

    /// <summary>
    /// Parses the settings body: the value of <c>mailer_autoconfirm</c> when it is a JSON boolean, else null.
    /// </summary>
    public static bool? ParseAutoconfirm(string json)
    {
        try
        {
            using var document = JsonDocument.Parse(json);
            if (document.RootElement.ValueKind != JsonValueKind.Object
                || !document.RootElement.TryGetProperty("mailer_autoconfirm", out var value))
            {
                return null;
            }

            return value.ValueKind switch
            {
                JsonValueKind.True => true,
                JsonValueKind.False => false,
                _ => null,
            };
        }
        catch (JsonException)
        {
            return null;
        }
    }

    /// <summary>True when a URL + key are set and the key is not the terraform placeholder.</summary>
    public static bool IsConfigured(string? supabaseUrl, string? serviceKey) =>
        TryAuthOrigin(supabaseUrl, out _) && !string.IsNullOrWhiteSpace(serviceKey)
        && !string.Equals(serviceKey.Trim(), PlaceholderValue, StringComparison.Ordinal);

    public const string PlaceholderValue = "REPLACE_ME_OUT_OF_BAND";

    /// <summary>The autoconfirm flag, or null on any failure. Never throws except on cancellation of the caller.</summary>
    private async Task<bool?> FetchAsync(CancellationToken cancellationToken)
    {
        var url = configuration["Invitations:SupabaseUrl"];
        var key = configuration["Invitations:SupabaseServiceKey"];
        if (!IsConfigured(url, key) || !TryAuthOrigin(url, out var origin))
        {
            return null;
        }

        try
        {
            using var request = new HttpRequestMessage(HttpMethod.Get, new Uri(origin, "/auth/v1/settings"));
            request.Headers.Add("apikey", key);
            var client = httpClientFactory.CreateClient(HttpClientName);
            using var response = await client.SendAsync(request, cancellationToken).ConfigureAwait(false);
            if (!response.IsSuccessStatusCode)
            {
                return null;
            }

            return ParseAutoconfirm(await response.Content.ReadAsStringAsync(cancellationToken).ConfigureAwait(false));
        }
        catch (HttpRequestException)
        {
            return null;
        }
        catch (TaskCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            return null; // HttpClient timeout
        }
        catch (InvalidOperationException)
        {
            return null; // e.g. response exceeded MaxResponseContentBufferSize
        }
    }

    private static bool TryAuthOrigin(string? value, out Uri origin)
    {
        origin = null!;
        if (!Uri.TryCreate(value, UriKind.Absolute, out var uri) || uri.Scheme != "https" || uri.UserInfo.Length != 0
            || uri.AbsolutePath != "/" || uri.Query.Length != 0 || uri.Fragment.Length != 0)
        {
            return false;
        }

        origin = uri;
        return true;
    }

    private sealed record CachedAnswer(bool RequiresConfirmation, DateTimeOffset ExpiresAt);
}
