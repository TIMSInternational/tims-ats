using System.Globalization;
using Microsoft.EntityFrameworkCore;
using Tims.Application.PlatformOrganizations;

namespace Tims.Infrastructure.OrgProvisioning;

/// <summary>The organization, default hierarchy, entitlements, scoped roles and subscription.
/// Requires the caller's transaction; never commits. Shared by direct creation and invitations.</summary>
public static class OrganizationBundleWriter
{
    /// <param name="profile">The creation input's locale profile: written to <c>organizations.settings</c>
    /// (country/timezone/currency/locale) and to the default company. Null = empty settings (the column
    /// default) and a <see cref="OrgProvisioningWriter.DefaultCountry"/> company, as before profiles existed.</param>
    public static async Task CreateAsync(DbContext db, Guid organizationId, string name, string slug,
        string plan, string billingEmail, DateTime now, CancellationToken ct, OrgLocaleProfile? profile = null)
    {
        if (db.Database.CurrentTransaction is null)
            throw new InvalidOperationException("Organization provisioning requires a transaction");
        now = DateTime.SpecifyKind(now, DateTimeKind.Unspecified);
        var updatedAt = Timestamp(now);
        var settings = profile is null ? null : OrgLocaleProfileRules.SettingsJson(profile);
        await db.Database.ExecuteSqlInterpolatedAsync($"""
            INSERT INTO organizations (id, name, slug, plan, billing_email, settings, updated_at)
            VALUES ({organizationId}, {name}, {slug}, {plan}::"OrgPlan", {billingEmail},
                    COALESCE({settings}::jsonb, jsonb_build_object()), {updatedAt}::timestamp)
            """, ct);
        await OrgProvisioningWriter.ProvisionDefaultsAsync(db, organizationId, name, now, ct, profile);
        await OrgProvisioningWriter.ProvisionEntitlementsAsync(db, organizationId, now, ct);
        await RoleAccessProvisioner.ProvisionAsync(db, organizationId, now, ct);
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
