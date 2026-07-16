using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Options;
using Tims.Application.Audit;
using Tims.Application.Hris;
using Tims.Infrastructure.Hris;

namespace Tims.Workers.Hris;

/// <summary>
/// Wires the HRIS background-sync plane (WP3.3): the two repositories, the sync use case, and the
/// invokable <see cref="HrisSyncJob"/>. Additive — the HOST supplies the shared infrastructure the
/// repositories/use case depend on (<c>HrisDbContext</c>, <c>IDataAccessAuditor</c> via the audit
/// context, and the connector plane via <c>AddHrisConnectors()</c>); this method never touches the
/// existing Program.cs registrations. Scheduling the job (a hosted timer bound to <c>sync_cadence</c>) is
/// Phase 4 — for now the job is just a DI-resolvable, directly-invokable method.
/// </summary>
public static class HrisWorkerServiceCollectionExtensions
{
    public static IServiceCollection AddHrisSyncWorker(this IServiceCollection services)
    {
        ArgumentNullException.ThrowIfNull(services);

        services.TryAddSingleton(TimeProvider.System);

        services.AddScoped<IHrisConnectorReadRepository, HrisConnectorReadRepository>();
        services.AddScoped<IHrisSyncRepository, HrisSyncRepository>();

        // The use case takes the page cap from HrisOptions (bound + validated by the host); a factory
        // registration threads it in while keeping the Application type free of any Infrastructure ref.
        services.AddScoped(serviceProvider => new RunHrisSyncUseCase(
            serviceProvider.GetRequiredService<IHrisConnectorReadRepository>(),
            serviceProvider.GetRequiredService<IHrisSyncRepository>(),
            serviceProvider.GetRequiredService<IHrisConnectorFactory>(),
            serviceProvider.GetRequiredService<IDataAccessAuditor>(),
            serviceProvider.GetRequiredService<TimeProvider>(),
            serviceProvider.GetRequiredService<IOptions<HrisOptions>>().Value.MaxSyncPages));

        services.AddScoped<HrisSyncJob>();

        return services;
    }
}
