using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Tims.Application.Fx;
using Tims.Infrastructure.Fx;

namespace FxSeedOnce;

/// <summary>
/// One-off composition root for populating fx_rates outside the Tims.Workers host. Wires the exact
/// same DI pieces Tims.Workers/Program.cs registers for the FX plane (FxRateDbContext,
/// AddFxRateGateway, IFxRateWriteRepository, RefreshFxRatesUseCase), minus Quartz scheduling,
/// OpenTelemetry, health checks, and the unrelated HRIS wiring, then invokes
/// RefreshFxRatesUseCase.RunAsync exactly once. FxOptions is registered with no explicit binding —
/// its class-level defaults (ExchangeRate-API's open.er-api.com base URL + standard Polly resilience
/// knobs) are used as-is, identical to what Tims.Workers would use with an empty "Fx" config section.
/// </summary>
public static class FxSeedRunner
{
    public static async Task<int> RunAsync(string connectionString, CancellationToken cancellationToken)
    {
        var services = new ServiceCollection();
        services.AddLogging(builder => builder.AddConsole());
        services.AddOptions<FxOptions>();
        services.AddDbContext<FxRateDbContext>(options => options.UseNpgsql(connectionString));
        services.AddFxRateGateway();
        services.AddScoped<IFxRateWriteRepository, FxRateWriteRepository>();
        services.AddScoped<RefreshFxRatesUseCase>();

        await using var provider = services.BuildServiceProvider();
        var useCase = provider.GetRequiredService<RefreshFxRatesUseCase>();
        return await useCase.RunAsync(cancellationToken).ConfigureAwait(false);
    }
}
