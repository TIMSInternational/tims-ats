using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using Tims.Application.AssessmentTypes;
using Tims.Infrastructure.Audit;

namespace Tims.Infrastructure.AssessmentTypes;

/// <summary>
/// F13 tenant authoring repository for <c>assessment_types</c>.
///
/// <para><b>Tenancy, twice.</b> Every method opens a <see cref="TenantScope"/> for the caller's org (so the
/// <c>tenant_isolation</c> RLS policy's USING + WITH CHECK engage as <c>app_tenant</c>) AND filters
/// <c>organization_id</c> explicitly — a type id from another org is simply not found (→ 404), never updated.
/// <c>assessment_types.organization_id</c> is NOT NULL, so there are no global/system types for a tenant to edit.</para>
///
/// <para><b>Audit is fail-closed.</b> The type write and its <c>audit_logs</c> row are ONE <c>SaveChanges</c> inside
/// the scope's transaction; if either fails the scope disposes uncommitted and nothing persists.</para>
///
/// <para><b>Uniqueness.</b> A case-insensitive name clash within the org is a 409. The derived <c>code</c> must also
/// be unique per org (<c>assessment_types_organization_id_code_key</c>); a code clash WITHOUT a name clash (e.g. a
/// type was renamed but kept its code) gets a numeric suffix instead of a spurious 409. A concurrent insert that
/// still trips the unique index surfaces as 23505 → 409.</para>
/// </summary>
public sealed class AssessmentTypeWriteRepository(AssessmentTypeWriteDbContext db) : IAssessmentTypeWriteRepository
{
    private const string AuditEntity = "assessment_type";
    private const string CreatedAction = "assessment_type_created";
    private const string UpdatedAction = "assessment_type_updated";
    private const string DeactivatedAction = "assessment_type_deactivated";

    private readonly AssessmentTypeWriteDbContext _db = db;

    public async Task<AssessmentTypeWriteResult> CreateAsync(
        Guid organizationId, Guid actorId, AssessmentTypeCreateInput input, DateTime now, CancellationToken cancellationToken)
    {
        var timestamp = ToStoreTimestamp(now);
        await using var scope = await TenantScope.BeginAsync(_db, organizationId, cancellationToken).ConfigureAwait(false);

        if (await NameTakenAsync(organizationId, input.Name, excludeId: null, cancellationToken).ConfigureAwait(false))
        {
            return AssessmentTypeWriteResult.Conflict;
        }

        var existingCodes = await _db.AssessmentTypes
            .AsNoTracking()
            .Where(t => t.OrganizationId == organizationId)
            .Select(t => t.Code)
            .ToListAsync(cancellationToken)
            .ConfigureAwait(false);
        if (AssessmentTypeWriteUseCase.PickFreeCode(input.Code, existingCodes) is not { } code)
        {
            return AssessmentTypeWriteResult.Conflict;
        }

        var entity = new AssessmentTypeWriteEntity
        {
            Id = Guid.NewGuid(),
            OrganizationId = organizationId,
            Name = input.Name,
            Code = code,
            Description = input.Description,
            Duration = input.Duration,
            IsActive = true,
            CreatedAt = timestamp,
            UpdatedAt = timestamp,
        };
        _db.AssessmentTypes.Add(entity);
        AddAudit(organizationId, actorId, CreatedAction, entity.Id, new Dictionary<string, object?>
        {
            ["name"] = entity.Name,
            ["code"] = entity.Code,
            ["description"] = entity.Description,
            ["duration"] = entity.Duration,
        });

        if (!await TrySaveAsync(cancellationToken).ConfigureAwait(false))
        {
            return AssessmentTypeWriteResult.Conflict;
        }

        await scope.CommitAsync(cancellationToken).ConfigureAwait(false);
        return AssessmentTypeWriteResult.Ok(Map(entity));
    }

    public async Task<AssessmentTypeWriteResult> UpdateAsync(
        Guid organizationId, Guid actorId, Guid id, AssessmentTypeUpdateInput input, DateTime now,
        CancellationToken cancellationToken)
    {
        await using var scope = await TenantScope.BeginAsync(_db, organizationId, cancellationToken).ConfigureAwait(false);

        var entity = await FindAsync(organizationId, id, cancellationToken).ConfigureAwait(false);
        if (entity is null)
        {
            return AssessmentTypeWriteResult.NotFound;
        }

        var changes = new Dictionary<string, object?>();
        if (input.Name is { } name && !string.Equals(name, entity.Name, StringComparison.Ordinal))
        {
            if (await NameTakenAsync(organizationId, name, excludeId: id, cancellationToken).ConfigureAwait(false))
            {
                return AssessmentTypeWriteResult.Conflict;
            }

            changes["name"] = new { from = entity.Name, to = name };
            entity.Name = name;
        }

        if (input.HasDescription && !string.Equals(input.Description, entity.Description, StringComparison.Ordinal))
        {
            changes["description"] = new { from = entity.Description, to = input.Description };
            entity.Description = input.Description;
        }

        if (input.HasDuration && input.Duration != entity.Duration)
        {
            changes["duration"] = new { from = entity.Duration, to = input.Duration };
            entity.Duration = input.Duration;
        }

        if (changes.Count == 0)
        {
            // Nothing changed: no write, no audit row. Dispose rolls back the (read-only) transaction.
            return AssessmentTypeWriteResult.Ok(Map(entity));
        }

        entity.UpdatedAt = ToStoreTimestamp(now);
        AddAudit(organizationId, actorId, UpdatedAction, entity.Id, changes);

        if (!await TrySaveAsync(cancellationToken).ConfigureAwait(false))
        {
            return AssessmentTypeWriteResult.Conflict;
        }

        await scope.CommitAsync(cancellationToken).ConfigureAwait(false);
        return AssessmentTypeWriteResult.Ok(Map(entity));
    }

    public async Task<AssessmentTypeWriteResult> DeactivateAsync(
        Guid organizationId, Guid actorId, Guid id, DateTime now, CancellationToken cancellationToken)
    {
        await using var scope = await TenantScope.BeginAsync(_db, organizationId, cancellationToken).ConfigureAwait(false);

        var entity = await FindAsync(organizationId, id, cancellationToken).ConfigureAwait(false);
        if (entity is null)
        {
            return AssessmentTypeWriteResult.NotFound;
        }

        if (!entity.IsActive)
        {
            // Already inactive — idempotent, nothing written.
            return AssessmentTypeWriteResult.Ok(Map(entity));
        }

        // Soft deactivation only: assignments/results/questions keep referencing the row.
        entity.IsActive = false;
        entity.UpdatedAt = ToStoreTimestamp(now);
        AddAudit(organizationId, actorId, DeactivatedAction, entity.Id, new Dictionary<string, object?>
        {
            ["isActive"] = new { from = true, to = false },
        });

        await _db.SaveChangesAsync(cancellationToken).ConfigureAwait(false);
        await scope.CommitAsync(cancellationToken).ConfigureAwait(false);
        return AssessmentTypeWriteResult.Ok(Map(entity));
    }

    private Task<AssessmentTypeWriteEntity?> FindAsync(Guid organizationId, Guid id, CancellationToken cancellationToken) =>
        _db.AssessmentTypes.FirstOrDefaultAsync(t => t.Id == id && t.OrganizationId == organizationId, cancellationToken);

    private Task<bool> NameTakenAsync(Guid organizationId, string name, Guid? excludeId, CancellationToken cancellationToken)
    {
        var lowered = name.ToLowerInvariant();
        return _db.AssessmentTypes.AnyAsync(
            t => t.OrganizationId == organizationId && t.Name.ToLower() == lowered && (excludeId == null || t.Id != excludeId),
            cancellationToken);
    }

    private async Task<bool> TrySaveAsync(CancellationToken cancellationToken)
    {
        try
        {
            await _db.SaveChangesAsync(cancellationToken).ConfigureAwait(false);
            return true;
        }
        catch (DbUpdateException ex) when (ex.InnerException is PostgresException { SqlState: PostgresErrorCodes.UniqueViolation })
        {
            // A concurrent writer won the (organization_id, code) unique index. The scope disposes uncommitted.
            return false;
        }
    }

    private void AddAudit(Guid organizationId, Guid actorId, string action, Guid entityId, Dictionary<string, object?> metadata) =>
        _db.AuditLogs.Add(new AuditLogEntity
        {
            Id = Guid.NewGuid(),
            OrganizationId = organizationId,
            UserId = actorId,
            ActorId = actorId,
            Action = action,
            Entity = AuditEntity,
            // Prisma `entityId String?` is TEXT, not uuid.
            EntityId = entityId.ToString(),
            Metadata = JsonSerializer.Serialize(metadata),
        });

    private static AssessmentTypeRow Map(AssessmentTypeWriteEntity entity) =>
        new(
            entity.Id.ToString(),
            entity.OrganizationId.ToString(),
            entity.Name,
            entity.Code,
            entity.Description,
            entity.Duration,
            entity.IsActive,
            AssessmentTypeWriteUseCase.FormatTimestamp(entity.CreatedAt),
            AssessmentTypeWriteUseCase.FormatTimestamp(entity.UpdatedAt));

    // TRAP 11: Npgsql rejects Kind=Utc against a mapped `timestamp` column — store the UTC wall-clock as Unspecified.
    private static DateTime ToStoreTimestamp(DateTime utcNow) =>
        DateTime.SpecifyKind(utcNow, DateTimeKind.Unspecified);
}
