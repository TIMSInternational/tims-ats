using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Tims.Application.Assessments.Providers;
using Tims.Domain.Assessments.Providers;
using Tims.Infrastructure.Audit;

namespace Tims.Infrastructure.Assessments.Providers;

/// <summary>The organization's assessment security settings (<c>assessment_provider_settings</c>, one row per org).</summary>
public sealed partial class AssessmentProviderRepository
{
    private const string SettingsAuditEntity = "assessment_provider_settings";

    public async Task<ProctoringSettingsRow?> GetProctoringSettingsAsync(Guid organizationId, CancellationToken cancellationToken)
    {
        await using var scope = await TenantScope.BeginAsync(_db, organizationId, cancellationToken).ConfigureAwait(false);
        var row = await _db.Settings.AsNoTracking()
            .Where(s => s.OrganizationId == organizationId)
            .FirstOrDefaultAsync(cancellationToken).ConfigureAwait(false);
        await scope.CommitAsync(cancellationToken).ConfigureAwait(false);
        return row is null ? null : ToSettingsRow(row);
    }

    public async Task<ProctoringSettingsRow> SaveProctoringSettingsAsync(
        Guid organizationId, Guid actorId, AssessmentProctoring settings, DateTimeOffset now,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(settings);
        var timestamp = now.UtcDateTime;
        await using var scope = await TenantScope.BeginAsync(_db, organizationId, cancellationToken).ConfigureAwait(false);
        _db.ChangeTracker.Clear();

        // Race-safe upsert: the org's row is created (all off) if missing, then locked, so two concurrent saves serialize
        // and each audit row records the value it actually replaced.
        await _db.Database.ExecuteSqlInterpolatedAsync(
            $"""
            INSERT INTO assessment_provider_settings (id, organization_id, updated_by_id, created_at, updated_at)
            VALUES ({Guid.NewGuid()}, {organizationId}, {actorId}, {timestamp}, {timestamp})
            ON CONFLICT (organization_id) DO NOTHING
            """, cancellationToken).ConfigureAwait(false);
        var row = await _db.Settings
            .FromSqlInterpolated($"SELECT * FROM assessment_provider_settings WHERE organization_id = {organizationId} FOR UPDATE")
            .FirstAsync(cancellationToken).ConfigureAwait(false);

        var before = ToSettingsRow(row).Settings;
        row.ProctoringLockdown = settings.Lockdown;
        row.AntiCheatThreshold = settings.AntiCheat?.Threshold;
        row.AntiCheatConsequence = settings.AntiCheat?.Consequence;
        row.IdentityCheck = settings.IdentityCheck;
        row.UpdatedById = actorId;
        row.UpdatedAt = timestamp;
        _db.AuditLogs.Add(new AuditLogEntity
        {
            Id = Guid.NewGuid(),
            OrganizationId = organizationId,
            UserId = actorId,
            ActorId = actorId,
            Action = "assessment_provider_settings_updated",
            Entity = SettingsAuditEntity,
            EntityId = row.Id.ToString(),
            Changes = JsonSerializer.Serialize(new Dictionary<string, object?>
            {
                ["proctoring"] = new { before = AuditShape(before), after = AuditShape(settings) },
            }),
        });
        await _db.SaveChangesAsync(cancellationToken).ConfigureAwait(false);
        await scope.CommitAsync(cancellationToken).ConfigureAwait(false);
        return ToSettingsRow(row);
    }

    private static object AuditShape(AssessmentProctoring settings) => new
    {
        lockdown = settings.Lockdown,
        antiCheatThreshold = settings.AntiCheat?.Threshold,
        antiCheatConsequence = settings.AntiCheat?.Consequence,
        identityCheck = settings.IdentityCheck,
    };

    private static ProctoringSettingsRow ToSettingsRow(ProviderSettingsEntity row) =>
        new(
            new AssessmentProctoring(
                row.ProctoringLockdown,
                row is { AntiCheatThreshold: { } threshold, AntiCheatConsequence: { } consequence }
                    ? new AntiCheatPolicy(threshold, consequence)
                    : null,
                row.IdentityCheck),
            new DateTimeOffset(DateTime.SpecifyKind(row.UpdatedAt, DateTimeKind.Utc)),
            row.UpdatedById);

    /// <summary>The attempt's stored proctoring snapshot, or null when none was sent.</summary>
    private static AssessmentProctoring? ProctoringOf(ProviderAttemptEntity a) =>
        a is { ProctoringLockdown: { } lockdown, ProctoringIdentityCheck: { } identityCheck }
            ? new AssessmentProctoring(
                lockdown,
                a is { ProctoringAntiCheatThreshold: { } threshold, ProctoringAntiCheatConsequence: { } consequence }
                    ? new AntiCheatPolicy(threshold, consequence)
                    : null,
                identityCheck)
            : null;

    private static void SetProctoring(ProviderAttemptEntity a, AssessmentProctoring? proctoring)
    {
        a.ProctoringLockdown = proctoring?.Lockdown;
        a.ProctoringAntiCheatThreshold = proctoring?.AntiCheat?.Threshold;
        a.ProctoringAntiCheatConsequence = proctoring?.AntiCheat?.Consequence;
        a.ProctoringIdentityCheck = proctoring?.IdentityCheck;
    }
}
