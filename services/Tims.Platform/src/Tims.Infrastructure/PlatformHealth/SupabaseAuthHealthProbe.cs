using System.Diagnostics;
using Microsoft.Extensions.Configuration;
using Tims.Application.PlatformHealth;
using Tims.Infrastructure.CandidateConsent;

namespace Tims.Infrastructure.PlatformHealth;

/// <summary>
/// <c>GET {Invitations:SupabaseUrl}/auth/v1/health</c> with the same <c>apikey</c> the platform already uses for
/// <see cref="SupabaseAuthSettingsProbe"/> (no new secret). Read-only; no redirects; the response body is never
/// read or echoed. Unconfigured (or still the Terraform placeholder) ⇒ <c>not_configured</c>.
/// </summary>
public sealed class SupabaseAuthHealthProbe(IHttpClientFactory httpClientFactory, IConfiguration configuration) : IDependencyProbe
{
    public const string HttpClientName = "PlatformHealthAuth";

    public string Id => DependencyIds.Auth;

    public async Task<DependencyProbeResult> ProbeAsync(CancellationToken cancellationToken)
    {
        var url = configuration["Invitations:SupabaseUrl"];
        var key = configuration["Invitations:SupabaseServiceKey"];
        if (!SupabaseAuthSettingsProbe.IsConfigured(url, key) || !SupabaseAuthSettingsProbe.TryAuthOrigin(url, out var origin))
        {
            return DependencyProbeResult.Of(Id, DependencyStatus.NotConfigured, DependencyReason.MissingConfig);
        }

        var stopwatch = Stopwatch.StartNew();
        try
        {
            using var request = new HttpRequestMessage(HttpMethod.Get, new Uri(origin, "/auth/v1/health"));
            request.Headers.Add("apikey", key);
            var client = httpClientFactory.CreateClient(HttpClientName);
            using var response = await client
                .SendAsync(request, HttpCompletionOption.ResponseHeadersRead, cancellationToken)
                .ConfigureAwait(false);
            return DependencyHealthClassifier.ClassifyAuthHealth((int)response.StatusCode, stopwatch.ElapsedMilliseconds);
        }
        catch (HttpRequestException)
        {
            return DependencyProbeResult.Of(Id, DependencyStatus.Down, DependencyReason.Unreachable, stopwatch.ElapsedMilliseconds);
        }
    }
}
