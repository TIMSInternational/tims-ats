using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Tims.Application.PlatformHealth;

namespace Tims.Infrastructure.PlatformHealth;

public static class PlatformHealthServiceCollectionExtensions
{
    /// <summary>
    /// Registers the dependency probes (auth, storage, jobs, AI, email, realtime) and the cached use case. The
    /// API's own readiness probe is registered by the host (it needs ASP.NET's HealthCheckService). Requires
    /// <c>AddPlatformEmail</c> first (the SES probe reuses its client).
    /// </summary>
    public static IServiceCollection AddPlatformHealthProbes(
        this IServiceCollection services, IConfiguration configuration, string? databaseConnectionString)
    {
        services.AddOptions<PlatformHealthOptions>()
            .Bind(configuration.GetSection(PlatformHealthOptions.SectionName))
            .Validate(options => options.IsValid(),
                "PlatformHealth requires valid bucket/region/guardrail identifiers, a 250–5000ms probe timeout and a 30–60s cache")
            .ValidateOnStart();

        services.AddHttpClient(SupabaseAuthHealthProbe.HttpClientName, client =>
            {
                client.Timeout = TimeSpan.FromSeconds(5); // outer bound; the use case enforces the ~2s deadline
                client.MaxResponseContentBufferSize = 4096;
            })
            .ConfigurePrimaryHttpMessageHandler(() => new HttpClientHandler { AllowAutoRedirect = false });

        services.TryAddSingleton(TimeProvider.System);
        services.TryAddSingleton<IAwsHealthClientFactory, AwsHealthClientFactory>();
        services.TryAddSingleton<IPlatformHealthTelemetry, LoggingPlatformHealthTelemetry>();

        services.AddSingleton<IDependencyProbe, SupabaseAuthHealthProbe>();
        services.AddSingleton<IDependencyProbe, CvBucketProbe>();
        services.AddSingleton<IDependencyProbe>(provider =>
            new WorkerHeartbeatProbe(databaseConnectionString ?? string.Empty, provider.GetRequiredService<TimeProvider>()));
        services.AddSingleton<IDependencyProbe, BedrockGuardrailProbe>();
        services.AddSingleton<IDependencyProbe, SesAccountProbe>();
        // The web app has no Supabase Realtime subscription (no `.channel(` / postgres_changes anywhere in apps/web
        // or packages), so realtime is reported as not used rather than probed.
        services.AddSingleton<IDependencyProbe>(new NotUsedDependencyProbe(DependencyIds.Realtime));

        services.AddSingleton(provider =>
        {
            var options = provider.GetRequiredService<IOptions<PlatformHealthOptions>>().Value;
            return new DependencyHealthSettings(
                TimeSpan.FromMilliseconds(options.ProbeTimeoutMilliseconds),
                TimeSpan.FromSeconds(options.CacheSeconds));
        });
        services.AddSingleton<DependencyHealthUseCase>();
        return services;
    }
}

/// <summary>Logs probe faults by exception TYPE only — never a message, which can carry hostnames or ARNs.</summary>
public sealed class LoggingPlatformHealthTelemetry(ILogger<LoggingPlatformHealthTelemetry> logger) : IPlatformHealthTelemetry
{
    public void ProbeFaulted(string probeId, string exceptionType) =>
        logger.LogWarning("Platform health probe {ProbeId} faulted ({ExceptionType})", probeId, exceptionType);

    public void ProbeTimedOut(string probeId) =>
        logger.LogWarning("Platform health probe {ProbeId} exceeded its deadline", probeId);
}
