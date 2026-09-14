namespace Tims.Application.PlatformDashboard;

/// <summary>
/// The two queries <c>getAiCostAnomalies</c> issues (Phase-5 slice 23, issue #81, final read): every
/// ENABLED agent+org configuration joined to its agent and organization, and a 30-day usage roll-up
/// grouped by (agent, organization). The join to a config-less usage pair is done by the KERNEL via a
/// dictionary — exactly as TS builds <c>usageMap</c> — not by SQL, so a usage row whose configuration is
/// absent or disabled is fetched and then ignored, faithfully.
/// </summary>
public interface IPlatformDashboardAiRepository
{
    Task<IReadOnlyList<EnabledAgentConfigRow>> GetEnabledAgentConfigsAsync(CancellationToken cancellationToken);

    /// <summary><c>createdAt &gt;= sinceUtc</c>, where the caller derives <c>sinceUtc</c> as
    /// <c>now − 30 days</c> from the request instant — the same millisecond arithmetic as TS's
    /// <c>new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)</c>.</summary>
    Task<IReadOnlyList<AgentUsageRow>> GetUsageSinceAsync(DateTime sinceUtc, CancellationToken cancellationToken);
}
