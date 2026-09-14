using Microsoft.EntityFrameworkCore;

namespace Tims.Infrastructure.OrgProvisioning;

/// <summary>
/// The ONE EF mapping of the six Prisma-OWNED tables a brand-new organization is provisioned with
/// (Phase-5 slice 21, issue #76).
///
/// <para>Modelled on <see cref="Tims.Infrastructure.Audit.AuditLogModelConfiguration.ConfigureAuditLogs"/>
/// and for the same stated reason: issue #75 (<c>platform/invitations.ts</c>) calls the identical helper
/// pair inside its OWN org-creation transaction, so a second context will map these tables. Two contexts
/// hand-maintaining the same column map is a drift hazard with a nasty failure mode — the mismatch would
/// not be a build error or a test failure, it would be provisioned rows that DIFFER depending on which
/// writer produced them.</para>
///
/// <para><b>Every table here is <c>.ToTable()</c>-mapped through EF on purpose, not written with raw
/// SQL.</b> <c>scripts/table-ownership.mjs</c> greps table names out of <c>ToTable</c> calls and nothing else, so a raw-SQL
/// writer is INVISIBLE to the governance check (issue #199 — the same blind spot that lets
/// <c>BillingWebhookRepository</c> UPDATE <c>organizations.plan</c> unnoticed). Mapping these through EF is
/// what makes the ledger entries for <c>org_entitlements</c> and <c>plan_modules</c> actually enforced
/// rather than merely documented. Raw SQL is reserved for the two tables where a native Postgres enum
/// column leaves no choice (<c>organizations.plan</c>, <c>subscriptions.plan</c>/<c>status</c>).</para>
/// </summary>
public static class OrgProvisioningModelConfiguration
{
    public static ModelBuilder ConfigureOrgProvisioning(this ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<CompanyWriteEntity>(entity =>
        {
            entity.ToTable("companies");
            entity.HasKey(c => c.Id);
            entity.Property(c => c.Id).HasColumnName("id");
            entity.Property(c => c.OrganizationId).HasColumnName("organization_id");
            entity.Property(c => c.Name).HasColumnName("name");
            entity.Property(c => c.Country).HasColumnName("country");
            // Prisma writes `timestamp(3) without time zone` with NO DB default (@updatedAt is client-side),
            // so this column MUST be sent or the INSERT fails 23502.
            entity.Property(c => c.UpdatedAt).HasColumnName("updated_at").HasColumnType("timestamp");
        });

        modelBuilder.Entity<BusinessUnitWriteEntity>(entity =>
        {
            entity.ToTable("business_units");
            entity.HasKey(b => b.Id);
            entity.Property(b => b.Id).HasColumnName("id");
            entity.Property(b => b.OrganizationId).HasColumnName("organization_id");
            entity.Property(b => b.CompanyId).HasColumnName("company_id");
            entity.Property(b => b.Name).HasColumnName("name");
            entity.Property(b => b.UpdatedAt).HasColumnName("updated_at").HasColumnType("timestamp");
        });

        modelBuilder.Entity<TeamWriteEntity>(entity =>
        {
            entity.ToTable("teams");
            entity.HasKey(t => t.Id);
            entity.Property(t => t.Id).HasColumnName("id");
            entity.Property(t => t.OrganizationId).HasColumnName("organization_id");
            entity.Property(t => t.BusinessUnitId).HasColumnName("business_unit_id");
            entity.Property(t => t.Name).HasColumnName("name");
            entity.Property(t => t.UpdatedAt).HasColumnName("updated_at").HasColumnType("timestamp");
        });

        modelBuilder.Entity<RoleWriteEntity>(entity =>
        {
            entity.ToTable("roles");
            entity.HasKey(r => r.Id);
            entity.Property(r => r.Id).HasColumnName("id");
            entity.Property(r => r.OrganizationId).HasColumnName("organization_id");
            entity.Property(r => r.Name).HasColumnName("name");
            entity.Property(r => r.Slug).HasColumnName("slug");
            entity.Property(r => r.IsSystem).HasColumnName("is_system");
            entity.Property(r => r.UpdatedAt).HasColumnName("updated_at").HasColumnType("timestamp");
            // `description` and `is_active` are never sent by the TS create — left to NULL / the DB default.
        });

        modelBuilder.Entity<OrgEntitlementWriteEntity>(entity =>
        {
            entity.ToTable("org_entitlements");
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Id).HasColumnName("id");
            entity.Property(e => e.OrganizationId).HasColumnName("organization_id");
            entity.Property(e => e.ModuleCode).HasColumnName("module_code");
            entity.Property(e => e.Enabled).HasColumnName("enabled");
            entity.Property(e => e.Source).HasColumnName("source");
            entity.Property(e => e.Limit).HasColumnName("limit");
            entity.Property(e => e.UpdatedAt).HasColumnName("updated_at").HasColumnType("timestamp");
            // `unit_price` deliberately unmapped (the TS never copies Module.defaultUnitPrice);
            // `activated_at` is left to its DB default.
        });

        modelBuilder.Entity<PlanModuleReadEntity>(entity =>
        {
            entity.ToTable("plan_modules");
            entity.HasKey(p => p.Id);
            entity.Property(p => p.Id).HasColumnName("id");
            entity.Property(p => p.PlanCode).HasColumnName("plan_code");
            entity.Property(p => p.ModuleCode).HasColumnName("module_code");
            entity.Property(p => p.Limit).HasColumnName("limit");
        });

        return modelBuilder;
    }
}
