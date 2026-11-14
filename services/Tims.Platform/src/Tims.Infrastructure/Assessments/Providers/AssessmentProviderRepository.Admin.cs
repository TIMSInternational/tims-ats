using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Tims.Application.Assessments.Providers;
using Tims.Domain.Assessments.Providers;
using Tims.Infrastructure.Audit;

namespace Tims.Infrastructure.Assessments.Providers;

/// <summary>
/// Platform-owner administration of a binding (round 12): its state with the open work an unbind would strand, the
/// unbind itself, the inactive-binding read DSAR uses, and the erasure run's audit row.
/// </summary>
public sealed partial class AssessmentProviderRepository
{
    /// <summary>The advisory lock that serializes an unbind (exclusive) with every assignment's reserve (shared).</summary>
    internal static string BindingLockKey(Guid organizationId) => "assessment-provider-binding:" + organizationId.ToString();

    public async Task<ProviderBindingState> GetBindingStateAsync(Guid organizationId, CancellationToken cancellationToken)
    {
        await using var scope = await TenantScope.BeginAsync(_db, organizationId, cancellationToken).ConfigureAwait(false);
        var binding = await _db.Bindings.AsNoTracking()
            .Where(b => b.OrganizationId == organizationId && b.Provider == ProviderNames.TimsAssessments)
            .FirstOrDefaultAsync(cancellationToken).ConfigureAwait(false);
        var work = await OpenWorkAsync(organizationId, cancellationToken).ConfigureAwait(false);
        await scope.CommitAsync(cancellationToken).ConfigureAwait(false);
        return binding is null
            ? new ProviderBindingState(false, false, null, [], null, null, work)
            : new ProviderBindingState(true, binding.IsActive, binding.ProviderTenantId, binding.EnabledInstruments,
                binding.DefaultLocale, ToOffset(binding.UpdatedAt), work);
    }

    public async Task<ProviderBindingRow?> GetBindingAsync(Guid organizationId, CancellationToken cancellationToken)
    {
        await using var scope = await TenantScope.BeginAsync(_db, organizationId, cancellationToken).ConfigureAwait(false);
        var binding = await _db.Bindings.AsNoTracking()
            .Where(b => b.OrganizationId == organizationId && b.Provider == ProviderNames.TimsAssessments)
            .FirstOrDefaultAsync(cancellationToken).ConfigureAwait(false);
        await scope.CommitAsync(cancellationToken).ConfigureAwait(false);
        return binding is null ? null : ToRow(binding);
    }

    public async Task<IReadOnlyList<AttemptRow>> ListCancellableAttemptsAsync(
        Guid organizationId, CancellationToken cancellationToken)
    {
        await using var scope = await TenantScope.BeginAsync(_db, organizationId, cancellationToken).ConfigureAwait(false);
        string[] cancellable =
        [
            ProviderAttemptStates.PendingCreate, ProviderAttemptStates.Created, ProviderAttemptStates.Launched,
            ProviderAttemptStates.InProgress,
        ];
        var rows = await _db.Attempts.AsNoTracking()
            .Where(a => a.OrganizationId == organizationId && cancellable.Contains(a.State))
            .OrderBy(a => a.CreatedAt).ThenBy(a => a.Id)
            .ToListAsync(cancellationToken).ConfigureAwait(false);
        await scope.CommitAsync(cancellationToken).ConfigureAwait(false);
        return rows.Select(a => ToRow(a, isNew: false)).ToList();
    }

    public async Task<ProviderOpenWork?> DeactivateBindingAsync(
        Guid organizationId, Guid actorId, DateTimeOffset now, CancellationToken cancellationToken)
    {
        // PRIVILEGED (no TenantScope), like UpsertBindingAsync: app_tenant may not write bindings. The binding lock is
        // taken EXCLUSIVELY: a reserve (which holds it shared while it re-checks the binding and inserts) either committed
        // before (its attempt is counted below) or waits and then sees the binding inactive. One transaction: the check
        // and the deactivation cannot be separated by any assignment.
        await using var transaction = await _db.Database.BeginTransactionAsync(cancellationToken).ConfigureAwait(false);
        var key = BindingLockKey(organizationId);
        await _db.Database.ExecuteSqlInterpolatedAsync(
            $"SELECT pg_advisory_xact_lock(hashtextextended({key}, 0))", cancellationToken).ConfigureAwait(false);
        _db.ChangeTracker.Clear();
        var binding = await _db.Bindings
            .FirstOrDefaultAsync(b => b.OrganizationId == organizationId && b.Provider == ProviderNames.TimsAssessments
                && b.IsActive, cancellationToken)
            .ConfigureAwait(false);
        if (binding is null)
        {
            await transaction.CommitAsync(cancellationToken).ConfigureAwait(false);
            return null;
        }

        var work = await OpenWorkAsync(organizationId, cancellationToken).ConfigureAwait(false);
        if (work.Any)
        {
            await transaction.CommitAsync(cancellationToken).ConfigureAwait(false);
            return work;
        }

        binding.IsActive = false;
        binding.UpdatedAt = now.UtcDateTime;
        _db.AuditLogs.Add(new AuditLogEntity
        {
            Id = Guid.NewGuid(),
            OrganizationId = organizationId,
            UserId = actorId,
            ActorId = actorId,
            Action = "assessment_provider_binding_unset",
            Entity = "assessment_provider_binding",
            EntityId = binding.Id.ToString(),
            Metadata = JsonSerializer.Serialize(new Dictionary<string, object?>
            {
                ["providerTenantId"] = binding.ProviderTenantId,
                ["enabledInstruments"] = binding.EnabledInstruments,
            }),
        });
        await _db.SaveChangesAsync(cancellationToken).ConfigureAwait(false);
        await transaction.CommitAsync(cancellationToken).ConfigureAwait(false);
        return ProviderOpenWork.None;
    }

    public async Task AuditErasureRunAsync(
        Guid organizationId, Guid candidateId, Guid actorId, string outcome, int subjects, int requested,
        CancellationToken cancellationToken)
    {
        await using var scope = await TenantScope.BeginAsync(_db, organizationId, cancellationToken).ConfigureAwait(false);
        AddAudit(organizationId, actorId, "assessment_provider_erasure_run", candidateId, new Dictionary<string, object?>
        {
            ["outcome"] = outcome,
            ["subjects"] = subjects,
            ["requested"] = requested,
        });
        await _db.SaveChangesAsync(cancellationToken).ConfigureAwait(false);
        await scope.CommitAsync(cancellationToken).ConfigureAwait(false);
    }

    // The binding's reserve-side guard, inside the reserve's transaction: the shared binding lock, then the binding's
    // enabled instruments as committed now, or null when an unbind committed first. An unbind and a change of the enabled
    // instruments take the same lock exclusively, so neither can commit between this read and the reserve's insert.
    private async Task<IReadOnlyList<string>?> LockActiveBindingAsync(
        Guid organizationId, Guid bindingId, CancellationToken cancellationToken)
    {
        var key = BindingLockKey(organizationId);
        await _db.Database.ExecuteSqlInterpolatedAsync(
            $"SELECT pg_advisory_xact_lock_shared(hashtextextended({key}, 0))", cancellationToken).ConfigureAwait(false);
        var enabled = await _db.Bindings.AsNoTracking()
            .Where(b => b.Id == bindingId && b.OrganizationId == organizationId && b.IsActive)
            .Select(b => b.EnabledInstruments)
            .FirstOrDefaultAsync(cancellationToken)
            .ConfigureAwait(false);
        return enabled;
    }

    private async Task<ProviderOpenWork> OpenWorkAsync(Guid organizationId, CancellationToken cancellationToken)
    {
        var staleSeconds = ProviderCreateFence.StaleAfter.TotalSeconds;
        var row = await _db.Database.SqlQuery<OpenWorkRow>(
                $"""
                 SELECT count(*) FILTER (WHERE state IN ('pending_create', 'created', 'launched', 'in_progress'))::int AS "Cancellable",
                        count(*) FILTER (WHERE state = 'completed')::int AS "AwaitingResult",
                        count(*) FILTER (WHERE withdrawal_state = 'pending')::int AS "PendingWithdrawals",
                        count(*) FILTER (WHERE state = 'cancelled'
                                           AND last_error_code = 'provider_cancel_pending')::int AS "CancelPending",
                        count(*) FILTER (WHERE EXISTS (
                            SELECT 1 FROM unnest(create_fences) AS f
                             WHERE f >= clock_timestamp() - make_interval(secs => {staleSeconds})))::int AS "CreatesInFlight"
                   FROM assessment_provider_attempts
                  WHERE organization_id = {organizationId}
                 """)
            .SingleAsync(cancellationToken).ConfigureAwait(false);
        return new ProviderOpenWork(row.Cancellable, row.AwaitingResult, row.PendingWithdrawals, row.CancelPending, row.CreatesInFlight);
    }

    private sealed class OpenWorkRow
    {
        public int Cancellable { get; init; }

        public int AwaitingResult { get; init; }

        public int PendingWithdrawals { get; init; }

        public int CancelPending { get; init; }

        public int CreatesInFlight { get; init; }
    }
}
