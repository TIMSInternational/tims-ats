using Microsoft.EntityFrameworkCore;

namespace Tims.Infrastructure.AlertMetrics;

/// <summary>
/// READ-ONLY, PRIVILEGED, CROSS-ORG context for the alert-evaluation cron's two soon-to-flip metrics
/// (<c>surveys</c> → flip #64, <c>salary_adjustments</c> → flip #66).
///
/// <b>Why this is deliberately NOT wrapped in <see cref="TenantScope"/>.</b> The alert-evaluation cron has
/// no tenant session: it iterates EVERY organization's rules in one run
/// (packages/api/src/repositories/alert-evaluation.repository.ts:1-7, driven by
/// alert-evaluation.service.ts). <see cref="TenantScope"/> issues <c>SET LOCAL ROLE app_tenant</c>
/// (TenantScope.cs:46), which is precisely the scoping this caller must not be subject to — under it the
/// cron would see one org per transaction and, with no org GUC set, ZERO rows. Both of these tables carry
/// <c>ENABLE</c> + <c>FORCE ROW LEVEL SECURITY</c> and a fail-closed <c>tenant_isolation</c> policy in prod
/// (packages/db/baseline/prod-public-schema.sql:2620, :2474, :7931, :7889), so FORCE means even the table
/// owner is filtered — this context reads across orgs only because the base login role is BYPASSRLS
/// (docs/architecture/csharp-migration/PROD-DEPLOY-PREP-2026-07-27.md:139). Same pattern, same rationale, as
/// <see cref="Tims.Infrastructure.Audit.AuditReadDbContext"/> and
/// <see cref="Tims.Infrastructure.AccessReview.AccessReviewDbContext"/>.
///
/// <b>What therefore keeps this from being a tenant-isolation hole.</b> NOTHING at the database layer — by
/// construction. The entire boundary is at the API edge, and it is three independent locks:
/// <list type="number">
///   <item>the endpoint is not even MAPPED unless <c>Platform:AlertMetricsCronReadEnabled</c> is true
///     (default false → 404);</item>
///   <item>it is reachable ONLY by presenting <c>Platform:AlertMetricsCronSecret</c>, a machine credential
///     no tenant can hold or mint. No Supabase JWT and no <c>tims_</c> API key authorizes it — there is no
///     code path from a user identity to this context (see <c>CronCallerGate</c>);</item>
///   <item>every query takes an EXPLICIT <c>organization_id</c> and returns a scalar COUNT only — no rows,
///     no columns, no PII — and the sensitive metric is min-5 floored before it leaves the process.</item>
/// </list>
///
/// Only the columns the two COUNTs need are mapped (id / organization_id / status). Nothing else on these
/// tables is reachable through this context even if a future query is added carelessly.
/// <c>SaveChanges</c> is never called; every query is <c>.AsNoTracking()</c>.
/// </summary>
public sealed class AlertMetricsDbContext(DbContextOptions<AlertMetricsDbContext> options) : DbContext(options)
{
    public DbSet<AlertMetricsSurveyEntity> Surveys => Set<AlertMetricsSurveyEntity>();

    public DbSet<AlertMetricsSalaryAdjustmentEntity> SalaryAdjustments => Set<AlertMetricsSalaryAdjustmentEntity>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<AlertMetricsSurveyEntity>(entity =>
        {
            entity.ToTable("surveys");
            entity.HasKey(s => s.Id);
            entity.Property(s => s.Id).HasColumnName("id");
            entity.Property(s => s.OrganizationId).HasColumnName("organization_id");
            entity.Property(s => s.Status).HasColumnName("status");
        });

        modelBuilder.Entity<AlertMetricsSalaryAdjustmentEntity>(entity =>
        {
            entity.ToTable("salary_adjustments");
            entity.HasKey(a => a.Id);
            entity.Property(a => a.Id).HasColumnName("id");
            entity.Property(a => a.OrganizationId).HasColumnName("organization_id");
            entity.Property(a => a.Status).HasColumnName("status");
        });
    }
}

public sealed class AlertMetricsSurveyEntity
{
    public Guid Id { get; set; }

    public Guid OrganizationId { get; set; }

    public string Status { get; set; } = string.Empty;
}

public sealed class AlertMetricsSalaryAdjustmentEntity
{
    public Guid Id { get; set; }

    public Guid OrganizationId { get; set; }

    public string Status { get; set; } = string.Empty;
}
