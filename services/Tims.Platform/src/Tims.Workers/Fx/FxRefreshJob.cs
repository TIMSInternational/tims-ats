using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Tims.Application.Fx;

namespace Tims.Workers.Fx;

/// <summary>
/// The thin, invokable entry point for the daily FX-rate refresh (Slice 11c) — the "2nd recurring job" the
/// Phase-4 Quartz scheduler anticipated. It drives <see cref="RefreshFxRatesUseCase.RunAsync"/> under a FRESH DI
/// scope (its own <c>FxRateDbContext</c> / typed HttpClient), so nothing is captured from the root provider. The
/// use case is idempotent (upsert ON CONFLICT base/quote/as_of), so a ResilientJobRunner retry of the same fire
/// re-pins the same as_of in place — never a duplicate.
///
/// It is NOT a hosted timer: scheduling/cadence is owned by the Quartz layer. Cooperative cancellation aborts the
/// run and is never reclassified as a failure (the runner rethrows it).
/// </summary>
public sealed class FxRefreshJob(IServiceScopeFactory scopeFactory, ILogger<FxRefreshJob> logger)
{
    private readonly IServiceScopeFactory _scopeFactory = scopeFactory;
    private readonly ILogger<FxRefreshJob> _logger = logger;

    public async Task RunAsync(CancellationToken cancellationToken)
    {
        await using var scope = _scopeFactory.CreateAsyncScope();
        var useCase = scope.ServiceProvider.GetRequiredService<RefreshFxRatesUseCase>();
        var written = await useCase.RunAsync(cancellationToken).ConfigureAwait(false);
        _logger.LogInformation("fx refresh: pinned {Count} rate(s)", written);
    }
}
