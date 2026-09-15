using System.Globalization;
using Microsoft.EntityFrameworkCore;
using Tims.Application.PlatformOrganizations;

namespace Tims.Infrastructure.OrgProvisioning;

/// <summary>The organization, default hierarchy, entitlements, admin role and subscription.
/// Requires the caller's transaction; never commits. Shared by direct creation and invitations.</summary>
public static class OrganizationBundleWriter
{
    public static async Task CreateAsync(DbContext db, Guid organizationId, string name, string slug,
        string plan, string billingEmail, DateTime now, CancellationToken ct)
    {
        if (db.Database.CurrentTransaction is null)
            throw new InvalidOperationException("Organization provisioning requires a transaction");
        now = DateTime.SpecifyKind(now, DateTimeKind.Unspecified);
        var updatedAt = Timestamp(now);
        await db.Database.ExecuteSqlInterpolatedAsync($"""
            INSERT INTO organizations (id, name, slug, plan, billing_email, updated_at)
            VALUES ({organizationId}, {name}, {slug}, {plan}::"OrgPlan", {billingEmail}, {updatedAt}::timestamp)
            """, ct);
        await OrgProvisioningWriter.ProvisionDefaultsAsync(db, organizationId, name, now, ct);
        await OrgProvisioningWriter.ProvisionEntitlementsAsync(db, organizationId, now, ct);
        db.Set<RoleWriteEntity>().Add(new RoleWriteEntity
        {
            Id = Guid.NewGuid(),
            OrganizationId = organizationId,
            Name = "Super Administrador",
            Slug = "super_admin",
            IsSystem = true,
            UpdatedAt = now,
        });
        await db.SaveChangesAsync(ct);
        var status = PlatformOrganizationsCreateUseCase.ResolveSubscriptionStatus(plan);
        var trial = PlatformOrganizationsCreateUseCase.ResolveTrialEndsAt(plan, now);
        var trialText = trial is null ? null : Timestamp(trial.Value);
        var subscriptionId = Guid.NewGuid();
        await db.Database.ExecuteSqlInterpolatedAsync($"""
            INSERT INTO subscriptions (id, organization_id, plan, status, trial_ends_at, updated_at)
            VALUES ({subscriptionId}, {organizationId}, {plan}::"OrgPlan", {status}::"SubscriptionStatus",
                    {trialText}::timestamp, {updatedAt}::timestamp)
            """, ct);
    }

    private static string Timestamp(DateTime value) => value.ToString("yyyy-MM-dd HH:mm:ss.fff", CultureInfo.InvariantCulture);
}
