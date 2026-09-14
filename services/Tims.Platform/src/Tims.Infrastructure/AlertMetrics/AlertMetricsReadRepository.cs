using Microsoft.EntityFrameworkCore;
using Tims.Application.AlertMetrics;
using Tims.Infrastructure.Monitoring;

namespace Tims.Infrastructure.AlertMetrics;

/// <summary>
/// The two COUNT queries behind the cross-org alert-metric surface (§8 Q0b slice 2, issue #172), ported
/// 1:1 from packages/api/src/repositories/alert-evaluation.repository.ts:217,223 (they were :115,:120 on main —
/// this branch added ~100 lines above them) — the SAME status
/// literals, the SAME org filter. Scalar counts only: nothing this repository can return identifies a row.
///
/// <para><b>Why this runs UNDER <see cref="TenantScope"/>, and why that is the whole point.</b> The
/// obvious way to serve a "privileged cross-org read" is to let the query run unscoped and rely on the
/// deployed login role being BYPASSRLS. That was the previous attempt (PR #141) and it carries a bad
/// failure mode: the BYPASSRLS property is asserted nowhere, and if the deployed role does NOT have it,
/// <c>surveys</c> and <c>salary_adjustments</c> both carry <c>FORCE ROW LEVEL SECURITY</c> plus a
/// fail-closed <c>tenant_isolation</c> policy, so with no org GUC set every query returns 0 rows. The
/// cron would then read 0 for every metric in every org, forever, and a metric pinned at 0 looks exactly
/// like "no breach" — a silent, total failure of the alerting path.</para>
///
/// <para>So this repository does not bypass RLS at all. The caller supplies an EXPLICIT organization id;
/// that id is fed to <see cref="TenantScope"/> (<c>SET LOCAL ROLE app_tenant</c> + org GUC), and the
/// count runs RLS-scoped to exactly that one org, with a redundant explicit <c>organization_id</c>
/// predicate for defense in depth. The privilege the cron holds is the right to NAME any org — enforced
/// at the API edge by the cron secret — not the right to see across orgs in a single query. Consequences
/// that matter:
/// <list type="bullet">
///   <item>there is no BYPASSRLS dependency to assert, because there is none to depend on;</item>
///   <item>a misconfigured GUC fails CLOSED per-org and surfaces as a wrong count for that org, not as a
///     platform-wide silent zero;</item>
///   <item>the RLS proof in the integration tests is a real proof — it runs as a non-superuser role and
///     RLS is genuinely the thing being exercised, rather than demonstrating a Postgres axiom about
///     superusers.</item>
/// </list></para>
///
/// <para><b>Why <see cref="MonitoringReadDbContext"/> and not a new context.</b> Both tables are already
/// mapped there (id / organization_id / status), and the identical two counts already ship inside
/// <c>MonitoringReadRepository.GetExecutiveKpiCountsAsync</c> from Q0b slice 1 (issue #100) — same
/// literals, same TenantScope discipline. A second context over the same two tables would be a copy that
/// can drift, with a second RLS story to keep true. <c>app_tenant</c> holds SELECT on both tables in the
/// prod baseline (packages/db/baseline/prod-public-schema.sql:8666, :8708), which is what makes the
/// scoped path work at all.</para>
///
/// Every query is <c>AsNoTracking()</c>; <c>SaveChanges</c> is never called.
/// </summary>
public sealed class AlertMetricsReadRepository(MonitoringReadDbContext db) : IAlertMetricsReadRepository
{
    private const string ActiveStatus = "active";
    private const string PendingStatus = "pending";

    private readonly MonitoringReadDbContext _db = db;

    public async Task<int> CountActiveSurveysAsync(Guid organizationId, CancellationToken cancellationToken)
    {
        await using var scope = await TenantScope.BeginAsync(_db, organizationId, cancellationToken)
            .ConfigureAwait(false);

        var count = await _db.Surveys.AsNoTracking()
            .CountAsync(s => s.OrganizationId == organizationId && s.Status == ActiveStatus, cancellationToken)
            .ConfigureAwait(false);

        await scope.CommitAsync(cancellationToken).ConfigureAwait(false);
        return count;
    }

    public async Task<int> CountPendingSalaryAdjustmentsAsync(Guid organizationId, CancellationToken cancellationToken)
    {
        await using var scope = await TenantScope.BeginAsync(_db, organizationId, cancellationToken)
            .ConfigureAwait(false);

        var count = await _db.SalaryAdjustments.AsNoTracking()
            .CountAsync(s => s.OrganizationId == organizationId && s.Status == PendingStatus, cancellationToken)
            .ConfigureAwait(false);

        await scope.CommitAsync(cancellationToken).ConfigureAwait(false);
        return count;
    }
}
