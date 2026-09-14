using Microsoft.EntityFrameworkCore;
using Tims.Application.PlatformDashboard;

namespace Tims.Infrastructure.PlatformDashboard;

/// <summary>
/// EF Core implementation of <c>getAiCostAnomalies</c>' two queries (Phase-5 slice 23, issue #81, the
/// final read).
///
/// <para><b>The config query joins in SQL what Prisma joins with nested selects</b> — <c>agent:
/// { select: … }</c> and <c>organization: { select: … }</c> are INNER joins here because both FKs are
/// NOT NULL (<c>agent_id</c> with ON DELETE CASCADE; <c>organization_id</c> likewise), so a config row
/// can never lack either parent and the join drops nothing Prisma would have returned.</para>
///
/// <para><b>The usage roll-up is the same <c>GROUP BY</c> Prisma emits.</b> <c>groupBy</c> is not a
/// JavaScript reduction — Prisma sends <c>SUM("cost_usd"), COUNT(*) … GROUP BY agent_id,
/// organization_id</c> to Postgres, so BOTH stacks receive database-computed sums over the same rows and
/// the floating-point accumulation order inside a group belongs to Postgres in both. Nothing here
/// re-adds costs in application code.</para>
/// </summary>
public sealed class PlatformDashboardAiRepository(PlatformDashboardReadDbContext db)
    : IPlatformDashboardAiRepository
{
    public async Task<IReadOnlyList<EnabledAgentConfigRow>> GetEnabledAgentConfigsAsync(CancellationToken cancellationToken)
    {
        var rows = await (
                from config in db.AiAgentOrgConfigs.AsNoTracking()
                where config.Enabled
                join agent in db.AiAgents.AsNoTracking() on config.AgentId equals agent.Id
                join organization in db.Organizations.AsNoTracking() on config.OrganizationId equals organization.Id
                select new
                {
                    config.AgentId,
                    config.OrganizationId,
                    config.MonthlyBudget,
                    AgentName = agent.Name,
                    AgentSlug = agent.Slug,
                    agent.CostPerCall,
                    agent.Status,
                    OrgName = organization.Name,
                })
            .ToListAsync(cancellationToken)
            .ConfigureAwait(false);

        return rows
            .Select(r => new EnabledAgentConfigRow(
                r.AgentId,
                r.OrganizationId,
                r.MonthlyBudget,
                r.AgentName,
                r.AgentSlug,
                r.CostPerCall,
                r.Status,
                r.OrgName))
            .ToList();
    }

    public async Task<IReadOnlyList<AgentUsageRow>> GetUsageSinceAsync(DateTime sinceUtc, CancellationToken cancellationToken)
    {
        var since = PlatformDashboardTimestamps.ToNaive(sinceUtc);

        var rows = await db.AiAgentUsageLogs
            .AsNoTracking()
            .Where(l => l.CreatedAt >= since)
            .GroupBy(l => new { l.AgentId, l.OrganizationId })
            .Select(g => new
            {
                g.Key.AgentId,
                g.Key.OrganizationId,
                // Nullable so EF translates to a bare SUM (`_sum.costUsd` is `number | null` to Prisma
                // too); the kernel owns the `?? 0`.
                Cost = g.Sum(l => (double?)l.CostUsd),
                Calls = g.Count(),
            })
            .ToListAsync(cancellationToken)
            .ConfigureAwait(false);

        return rows
            .Select(r => new AgentUsageRow(r.AgentId, r.OrganizationId, r.Cost, r.Calls))
            .ToList();
    }
}
