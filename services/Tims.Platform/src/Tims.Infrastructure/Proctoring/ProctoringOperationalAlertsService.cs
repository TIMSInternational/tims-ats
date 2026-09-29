using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Tims.Domain.Proctoring;

namespace Tims.Infrastructure.Proctoring;

/// <summary>
/// Runs once at startup and every 30 seconds thereafter. An absent heartbeat is
/// observable after 90 seconds, giving a 120-second target from the last heartbeat
/// to an HR inbox row under normal database availability. The inbox is not an
/// accusation; it links to the restricted human review screen.
/// </summary>
public sealed class ProctoringOperationalAlertsService(
    IServiceScopeFactory scopes, ILogger<ProctoringOperationalAlertsService> logger)
    : BackgroundService
{
    public static readonly TimeSpan PollInterval = TimeSpan.FromSeconds(30);
    public static readonly TimeSpan HeartbeatToInboxTarget =
        TimeSpan.FromSeconds(ProctoringSignalPolicy.HeartbeatGapSeconds) + PollInterval;

    private readonly IServiceScopeFactory _scopes = scopes;
    private readonly ILogger<ProctoringOperationalAlertsService> _logger = logger;

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(PollInterval);
        do
        {
            try { await SweepOnceAsync(stoppingToken); }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { break; }
            catch
            {
                // No signal, user, candidate, or object identifiers go to logs.
                _logger.LogError("Proctoring operational alert sweep failed");
            }
        } while (await timer.WaitForNextTickAsync(stoppingToken));
    }

    public async Task<ProctoringOperationalAlertResult> SweepOnceAsync(CancellationToken ct)
    {
        Guid[] organizations;
        await using (var bootstrap = _scopes.CreateAsyncScope())
        {
            organizations = await bootstrap.ServiceProvider
                .GetRequiredService<ProctoringOperationalAlertsRepository>()
                .ListActiveOrganizationIdsAsync(ct);
        }

        var gaps = 0;
        var notifications = 0;
        foreach (var organizationId in organizations)
        {
            ct.ThrowIfCancellationRequested();
            try
            {
                await using var tenant = _scopes.CreateAsyncScope();
                var result = await tenant.ServiceProvider
                    .GetRequiredService<ProctoringOperationalAlertsRepository>()
                    .RunOrganizationAsync(organizationId, ct);
                gaps += result.HeartbeatGaps;
                notifications += result.InboxNotifications;
            }
            catch (OperationCanceledException) when (ct.IsCancellationRequested) { throw; }
            catch
            {
                // A failed organization must not starve the others. The next sweep
                // replays it from append-only events and deterministic inbox IDs.
                _logger.LogError("Proctoring alert delivery failed for one organization");
            }
        }

        if (gaps != 0 || notifications != 0)
            _logger.LogInformation(
                "Proctoring operational alerts: {Gaps} heartbeat gaps, {Notifications} inbox entries",
                gaps, notifications);
        return new ProctoringOperationalAlertResult(gaps, notifications);
    }
}
