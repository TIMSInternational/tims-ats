using Microsoft.EntityFrameworkCore;
using Npgsql;
using Tims.Application.Hris;
using Tims.Domain.Hris;

namespace Tims.Infrastructure.Hris;

/// <summary>
/// The TENANT-SCOPED persistence of a sync run over the four <c>hris_</c> tables. EVERY method runs
/// UNDER <see cref="TenantScope.BeginAsync(Microsoft.EntityFrameworkCore.DbContext, System.Guid?, System.Threading.CancellationToken)"/>
/// (SET LOCAL ROLE app_tenant + org GUC) so the RLS <c>WITH CHECK</c> passes for the connector's org —
/// the sync has no ambient JWT, so the org is threaded explicitly and set on the GUC per call.
///
/// PII discipline: the one employee READ (<see cref="LoadExistingRecordStatesAsync"/>) projects to
/// external_id + source_hash + is_deleted_in_source ONLY; writes use targeted <c>ExecuteUpdate</c>
/// (existing rows) or an explicit column list (inserts) — no <c>SELECT *</c> of employee rows, ever.
/// Upserts are idempotent on the unique key (organization_id, connector_id, external_id): source wins,
/// and a soft-deleted row that reappears is un-flagged.
/// </summary>
public sealed class HrisSyncRepository(HrisDbContext db) : IHrisSyncRepository
{
    public async Task<HrisSyncRunSnapshot?> FindRunByIdempotencyKeyAsync(
        Guid organizationId,
        Guid connectorId,
        string idempotencyKey,
        CancellationToken cancellationToken)
    {
        await using var scope = await TenantScope.BeginAsync(db, organizationId, cancellationToken);
        var snapshot = await db.SyncRuns
            .Where(r => r.OrganizationId == organizationId
                && r.ConnectorId == connectorId
                && r.IdempotencyKey == idempotencyKey)
            .Select(r => new HrisSyncRunSnapshot(r.Id, r.OrganizationId, r.ConnectorId, r.IdempotencyKey, r.Status))
            .SingleOrDefaultAsync(cancellationToken);
        await scope.CommitAsync(cancellationToken);
        return snapshot;
    }

    public async Task<HrisSyncRunSnapshot> CreatePendingRunAsync(NewHrisSyncRun run, CancellationToken cancellationToken)
    {
        await using var scope = await TenantScope.BeginAsync(db, run.OrganizationId, cancellationToken);

        var entity = new HrisSyncRunEntity
        {
            Id = Guid.NewGuid(),
            OrganizationId = run.OrganizationId,
            ConnectorId = run.ConnectorId,
            Status = SyncRunStatus.Pending,
            Trigger = run.Trigger,
            IdempotencyKey = run.IdempotencyKey,
            CursorBefore = run.CursorBefore,
            RecordsSeen = 0,
            RecordsUpserted = 0,
            RecordsFailed = 0,
        };
        db.SyncRuns.Add(entity);
        try
        {
            await db.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateException ex) when (ex.InnerException is PostgresException { SqlState: PostgresErrorCodes.UniqueViolation })
        {
            // A concurrent invocation already inserted the run for this (org, connector, idempotency_key).
            // Surface an Infrastructure-neutral conflict so the use case re-finds it and short-circuits
            // (get-or-create) rather than racing a competing run. The scope disposes → rolls back.
            throw new HrisSyncRunConflictException(
                "A concurrent HRIS sync run already exists for this (organization, connector, idempotency key).", ex);
        }

        await scope.CommitAsync(cancellationToken);

        return new HrisSyncRunSnapshot(
            entity.Id, entity.OrganizationId, entity.ConnectorId, entity.IdempotencyKey, entity.Status);
    }

    public async Task MarkRunningAsync(Guid organizationId, Guid runId, DateTime startedAt, CancellationToken cancellationToken)
    {
        await using var scope = await TenantScope.BeginAsync(db, organizationId, cancellationToken);
        await db.SyncRuns
            .Where(r => r.Id == runId)
            .ExecuteUpdateAsync(
                s => s
                    .SetProperty(r => r.Status, SyncRunStatus.Running)
                    .SetProperty(r => r.StartedAt, startedAt),
                cancellationToken);
        await scope.CommitAsync(cancellationToken);
    }

    public async Task<IReadOnlyDictionary<string, HrisExistingRecordState>> LoadExistingRecordStatesAsync(
        Guid organizationId,
        Guid connectorId,
        CancellationToken cancellationToken)
    {
        await using var scope = await TenantScope.BeginAsync(db, organizationId, cancellationToken);
        var rows = await db.ExternalEmployees
            .Where(e => e.OrganizationId == organizationId && e.ConnectorId == connectorId)
            // PII-FREE projection: identity + hash + soft-delete flag only.
            .Select(e => new { e.ExternalId, e.SourceHash, e.IsDeletedInSource })
            .ToListAsync(cancellationToken);
        await scope.CommitAsync(cancellationToken);

        return rows.ToDictionary(
            r => r.ExternalId,
            r => new HrisExistingRecordState(r.SourceHash, r.IsDeletedInSource),
            StringComparer.Ordinal);
    }

    public async Task PersistRecordsAsync(
        Guid organizationId,
        Guid connectorId,
        Guid syncRunId,
        HrisSyncPersistencePlan plan,
        DateTime syncedAt,
        CancellationToken cancellationToken)
    {
        await using var scope = await TenantScope.BeginAsync(db, organizationId, cancellationToken);

        // DEFERRED (Phase 4, see docs/architecture/csharp-migration/phase-3-scaffold-followups.md #1):
        // this is a read-then-insert upsert, safe today because a connector is swept by exactly one
        // in-flight run (idempotency short-circuit + run-creation unique-violation guard) and the
        // (organization_id, connector_id, external_id) unique index is the hard net. Convert to
        // INSERT … ON CONFLICT DO UPDATE (or a per-connector advisory lock) once concurrent triggers land.

        // Which upsert targets already exist (PII-free id projection) → update; the rest → insert.
        var upsertIds = plan.Upserts.Select(u => u.Employee.ExternalId).ToList();
        var existingIds = new HashSet<string>(
            await db.ExternalEmployees
                .Where(e => e.OrganizationId == organizationId
                    && e.ConnectorId == connectorId
                    && upsertIds.Contains(e.ExternalId))
                .Select(e => e.ExternalId)
                .ToListAsync(cancellationToken),
            StringComparer.Ordinal);

        foreach (var upsert in plan.Upserts)
        {
            var employee = upsert.Employee;
            if (existingIds.Contains(employee.ExternalId))
            {
                // Update in place — source wins; clears any prior soft-delete flag (resurrect).
                await db.ExternalEmployees
                    .Where(e => e.OrganizationId == organizationId
                        && e.ConnectorId == connectorId
                        && e.ExternalId == employee.ExternalId)
                    .ExecuteUpdateAsync(
                        s => s
                            .SetProperty(e => e.FirstName, employee.FirstName)
                            .SetProperty(e => e.LastName, employee.LastName)
                            .SetProperty(e => e.WorkEmail, employee.WorkEmail)
                            .SetProperty(e => e.JobTitle, employee.JobTitle)
                            .SetProperty(e => e.Department, employee.Department)
                            .SetProperty(e => e.Division, employee.Division)
                            .SetProperty(e => e.HireDate, employee.HireDate)
                            .SetProperty(e => e.EmploymentStatus, employee.EmploymentStatus)
                            .SetProperty(e => e.SupervisorExternalId, employee.SupervisorExternalId)
                            .SetProperty(e => e.RawPayload, upsert.RawPayloadJson)
                            .SetProperty(e => e.SourceHash, upsert.SourceHash)
                            .SetProperty(e => e.IsDeletedInSource, false)
                            .SetProperty(e => e.LastSyncedAt, syncedAt)
                            .SetProperty(e => e.LastSyncRunId, syncRunId)
                            .SetProperty(e => e.UpdatedAt, syncedAt),
                        cancellationToken);
            }
            else
            {
                db.ExternalEmployees.Add(new HrisExternalEmployeeEntity
                {
                    Id = Guid.NewGuid(),
                    OrganizationId = organizationId,
                    ConnectorId = connectorId,
                    ExternalId = employee.ExternalId,
                    FirstName = employee.FirstName,
                    LastName = employee.LastName,
                    WorkEmail = employee.WorkEmail,
                    JobTitle = employee.JobTitle,
                    Department = employee.Department,
                    Division = employee.Division,
                    HireDate = employee.HireDate,
                    EmploymentStatus = employee.EmploymentStatus,
                    SupervisorExternalId = employee.SupervisorExternalId,
                    RawPayload = upsert.RawPayloadJson,
                    SourceHash = upsert.SourceHash,
                    IsDeletedInSource = false,
                    LastSyncRunId = syncRunId,
                });
            }
        }

        // Soft-delete (never hard-delete) everything absent from the source snapshot.
        if (plan.SoftDeletedExternalIds.Count > 0)
        {
            await db.ExternalEmployees
                .Where(e => e.OrganizationId == organizationId
                    && e.ConnectorId == connectorId
                    && plan.SoftDeletedExternalIds.Contains(e.ExternalId))
                .ExecuteUpdateAsync(
                    s => s
                        .SetProperty(e => e.IsDeletedInSource, true)
                        .SetProperty(e => e.LastSyncRunId, syncRunId)
                        .SetProperty(e => e.UpdatedAt, syncedAt),
                    cancellationToken);
        }

        foreach (var error in plan.RecordErrors)
        {
            db.SyncRecordErrors.Add(new HrisSyncRecordErrorEntity
            {
                Id = Guid.NewGuid(),
                OrganizationId = organizationId,
                SyncRunId = syncRunId,
                ConnectorId = connectorId,
                ExternalId = error.ExternalId,
                ErrorType = error.ErrorType,
                Message = error.Message,
            });
        }

        await db.SaveChangesAsync(cancellationToken);
        await scope.CommitAsync(cancellationToken);
    }

    public async Task FinalizeRunAsync(HrisSyncRunFinalization finalization, CancellationToken cancellationToken)
    {
        await using var scope = await TenantScope.BeginAsync(db, finalization.OrganizationId, cancellationToken);
        // CONDITIONAL on the run still holding its expected status (running): a stale/late finalizer can
        // never rewrite a run that already reached a terminal state — the update matches 0 rows and no-ops.
        await db.SyncRuns
            .Where(r => r.Id == finalization.RunId && r.Status == finalization.ExpectedCurrentStatus)
            .ExecuteUpdateAsync(
                s => s
                    .SetProperty(r => r.Status, finalization.Status)
                    .SetProperty(r => r.RecordsSeen, finalization.RecordsSeen)
                    .SetProperty(r => r.RecordsUpserted, finalization.RecordsUpserted)
                    .SetProperty(r => r.RecordsFailed, finalization.RecordsFailed)
                    .SetProperty(r => r.CursorAfter, finalization.CursorAfter)
                    .SetProperty(r => r.ErrorSummary, finalization.ErrorSummary)
                    .SetProperty(r => r.FinishedAt, finalization.FinishedAt),
                cancellationToken);
        await scope.CommitAsync(cancellationToken);
    }

    public async Task UpdateConnectorWatermarkAsync(
        Guid organizationId,
        Guid connectorId,
        Guid lastSyncRunId,
        DateTime lastSyncedAt,
        string? syncCursor,
        CancellationToken cancellationToken)
    {
        await using var scope = await TenantScope.BeginAsync(db, organizationId, cancellationToken);
        await db.Connectors
            .Where(c => c.Id == connectorId)
            .ExecuteUpdateAsync(
                s => s
                    .SetProperty(c => c.LastSyncRunId, lastSyncRunId)
                    .SetProperty(c => c.LastSyncedAt, lastSyncedAt)
                    .SetProperty(c => c.SyncCursor, syncCursor)
                    .SetProperty(c => c.UpdatedAt, lastSyncedAt),
                cancellationToken);
        await scope.CommitAsync(cancellationToken);
    }
}
