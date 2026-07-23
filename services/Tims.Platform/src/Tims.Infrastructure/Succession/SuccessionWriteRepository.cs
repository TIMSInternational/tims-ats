using Microsoft.EntityFrameworkCore;
using Npgsql;
using Tims.Application.Succession;
using Tims.Domain.Succession;

namespace Tims.Infrastructure.Succession;

/// <summary>
/// EF implementation of <see cref="ISuccessionWriteRepository"/> — a faithful port of the data steps of the 5 TS
/// <c>succession</c> mutations (inline <c>prisma.*</c> in the router). Every operation runs UNDER
/// <see cref="TenantScope"/> (SET LOCAL ROLE app_tenant + org GUC → RLS) with an EXPLICIT <c>organizationId</c>
/// filter/value (defense-in-depth). Client-set id (<c>Guid.NewGuid()</c>) + createdAt/updatedAt (both explicit) —
/// Prisma <c>@default(uuid())</c> / <c>@default(now())</c> / <c>@updatedAt</c> are client-side. addSuccessor stamps
/// <c>addedById = caller</c> server-side and maps the <c>@@unique([criticalRoleId, userId])</c> violation (23505) →
/// <see cref="AddSuccessorOutcome.Conflict"/> atomically (the documented 409 improvement over the TS 500). The
/// delete/update paths load the tracked row {id, org} — null ⇒ null (TOCTOU → 404 at the caller).
/// </summary>
public sealed class SuccessionWriteRepository(SuccessionWriteDbContext db) : ISuccessionWriteRepository
{
    private readonly SuccessionWriteDbContext _db = db;

    public async Task<CriticalRoleRow?> AddCriticalRoleAsync(
        string organizationId, AddCriticalRoleInput input, DateTimeOffset now, CancellationToken cancellationToken)
    {
        var orgId = Guid.Parse(organizationId);
        var nowTs = ToTimestamp(now);

        var entity = new CriticalRoleWriteEntity
        {
            // Prisma @default(uuid()) is client-side generation — mint the id here (Prisma parity).
            Id = Guid.NewGuid(),
            OrganizationId = orgId,
            Title = input.Title,
            PositionId = input.PositionId,
            CurrentHolderId = input.CurrentHolderId,
            CompanyId = input.CompanyId,
            UnitId = input.UnitId,
            Criticality = input.Criticality,
            FlightRisk = input.FlightRisk,
            // targetBandLevel has no create input (Prisma leaves it NULL until updateCriticalRoleBand).
            TargetBandLevel = null,
            // Prisma @default(now()) / @updatedAt are client-side — set both explicitly (parity + NOT NULL safety).
            CreatedAt = nowTs,
            UpdatedAt = nowTs,
        };

        await using var scope = await TenantScope.BeginAsync(_db, orgId, cancellationToken).ConfigureAwait(false);

        // Codex H2: the TS router persists arbitrary currentHolderId/companyId/unitId (only UUID-syntax checked), so
        // an org-scoped creator could anchor a role to another tenant's employee / foreign org structure (the FK
        // check bypasses RLS). Validate each PROVIDED optional reference exists in the caller's org BEFORE the INSERT,
        // in the SAME TenantScope txn (the lookups are RLS-filtered to the org). A provided-but-not-in-org id ⇒ null
        // (→ 400 at the endpoint). Fixed in BOTH stacks (succession.ts) to keep parity + ship the prod hardening.
        if (input.CurrentHolderId is { } holderId
            && !await _db.Users.AsNoTracking()
                .AnyAsync(u => u.Id == holderId && u.OrganizationId == orgId, cancellationToken).ConfigureAwait(false))
        {
            return null;
        }

        if (input.CompanyId is { } companyId
            && !await _db.Companies.AsNoTracking()
                .AnyAsync(c => c.Id == companyId && c.OrganizationId == orgId, cancellationToken).ConfigureAwait(false))
        {
            return null;
        }

        if (input.UnitId is { } unitId
            && !await _db.BusinessUnits.AsNoTracking()
                .AnyAsync(b => b.Id == unitId && b.OrganizationId == orgId, cancellationToken).ConfigureAwait(false))
        {
            return null;
        }

        _db.CriticalRoles.Add(entity);
        await _db.SaveChangesAsync(cancellationToken).ConfigureAwait(false);
        await scope.CommitAsync(cancellationToken).ConfigureAwait(false);

        return ToCriticalRoleRow(entity);
    }

    public async Task<AddSuccessorResult> AddSuccessorAsync(
        string organizationId, Guid callerId, AddSuccessorInput input, DateTimeOffset now,
        CancellationToken cancellationToken)
    {
        var orgId = Guid.Parse(organizationId);
        var nowTs = ToTimestamp(now);

        var entity = new SuccessorWriteEntity
        {
            Id = Guid.NewGuid(),
            OrganizationId = orgId,
            CriticalRoleId = input.CriticalRoleId,
            UserId = input.UserId,
            Readiness = input.Readiness,
            Type = input.Type,
            DevelopmentPlan = input.DevelopmentPlan,
            // Provenance/anti-forgery: addedById is ALWAYS the resolved caller, NEVER from input (succession.ts:173).
            AddedById = callerId,
            CreatedAt = nowTs,
            UpdatedAt = nowTs,
        };

        await using var scope = await TenantScope.BeginAsync(_db, orgId, cancellationToken).ConfigureAwait(false);

        // Codex H1: assertSubjectInScope no-ops for organization/company scope (it enforces SCOPE, not org
        // membership), so an org-scoped caller could otherwise persist a cross-tenant userId. Prove the target user
        // is a member of the caller's org AUTHORITATIVELY here — this same-txn lookup is RLS-filtered to the org, so a
        // cross-org userId returns null ⇒ SubjectNotInOrg (→ 403). The projection doubles as the TS `include: { user:
        // { select: { id, firstName, lastName, avatar } } }`, so there is no separate post-insert query (and no
        // `user!` null-assertion). Fixed in BOTH stacks (succession.ts) to keep parity + ship the prod hardening.
        var user = await _db.Users
            .AsNoTracking()
            .Where(u => u.Id == input.UserId && u.OrganizationId == orgId)
            .Select(u => new SuccessorUserRow(u.Id.ToString(), u.FirstName, u.LastName, u.Avatar))
            .FirstOrDefaultAsync(cancellationToken)
            .ConfigureAwait(false);
        if (user is null)
        {
            return new AddSuccessorResult(AddSuccessorOutcome.SubjectNotInOrg, null);
        }

        _db.Successors.Add(entity);

        try
        {
            await _db.SaveChangesAsync(cancellationToken).ConfigureAwait(false);
        }
        catch (DbUpdateException ex) when (IsUniqueViolation(ex))
        {
            // Documented port improvement (architecturally-correct-not-safe): the @@unique([criticalRoleId, userId])
            // violation → 409 CONFLICT (the TS leaks the Prisma P2002 as a 500). Atomic: the scope disposes WITHOUT
            // commit → the INSERT rolls back, so NO duplicate row is created.
            return new AddSuccessorResult(AddSuccessorOutcome.Conflict, null);
        }

        await scope.CommitAsync(cancellationToken).ConfigureAwait(false);

        return new AddSuccessorResult(AddSuccessorOutcome.Created, ToSuccessorRow(entity, user));
    }

    public async Task<SuccessorScalarRow?> RemoveSuccessorAsync(
        string organizationId, Guid successorId, CancellationToken cancellationToken)
    {
        var orgId = Guid.Parse(organizationId);

        await using var scope = await TenantScope.BeginAsync(_db, orgId, cancellationToken).ConfigureAwait(false);

        // Load the tracked row {id, org} so the TS `delete` return shape (the deleted row) can be reconstructed.
        // Null ⇒ the row vanished between the assertScoped probe and the delete (TOCTOU) → 404 at the caller.
        var entity = await _db.Successors
            .FirstOrDefaultAsync(s => s.Id == successorId && s.OrganizationId == orgId, cancellationToken)
            .ConfigureAwait(false);
        if (entity is null)
        {
            await scope.CommitAsync(cancellationToken).ConfigureAwait(false);
            return null;
        }

        var deleted = ToSuccessorScalarRow(entity);
        _db.Successors.Remove(entity);
        try
        {
            await _db.SaveChangesAsync(cancellationToken).ConfigureAwait(false);
        }
        catch (DbUpdateConcurrencyException)
        {
            // Codex M1: the row was concurrently deleted between the tracked load and SaveChanges (a real TOCTOU that
            // the pre-load null-check can't catch). Surface it as the SAME 404 as "absent at load", never a 500.
            return null;
        }

        await scope.CommitAsync(cancellationToken).ConfigureAwait(false);

        return deleted;
    }

    public async Task<SuccessorScalarRow?> UpdateSuccessorReadinessAsync(
        string organizationId, Guid successorId, UpdateSuccessorReadinessInput input, DateTimeOffset now,
        CancellationToken cancellationToken)
    {
        var orgId = Guid.Parse(organizationId);
        var nowTs = ToTimestamp(now);

        await using var scope = await TenantScope.BeginAsync(_db, orgId, cancellationToken).ConfigureAwait(false);

        var entity = await _db.Successors
            .FirstOrDefaultAsync(s => s.Id == successorId && s.OrganizationId == orgId, cancellationToken)
            .ConfigureAwait(false);
        if (entity is null)
        {
            await scope.CommitAsync(cancellationToken).ConfigureAwait(false);
            return null;
        }

        // TS `data: { readiness, developmentPlan }` — readiness ALWAYS set; developmentPlan applied ONLY when the
        // optional key was present (an absent optional is skipped by Prisma, never nulled).
        entity.Readiness = input.Readiness;
        if (input.HasDevelopmentPlan)
        {
            entity.DevelopmentPlan = input.DevelopmentPlan;
        }

        entity.UpdatedAt = nowTs;
        try
        {
            await _db.SaveChangesAsync(cancellationToken).ConfigureAwait(false);
        }
        catch (DbUpdateConcurrencyException)
        {
            // Codex M1: concurrently deleted between load and SaveChanges → 404, never a 500.
            return null;
        }

        await scope.CommitAsync(cancellationToken).ConfigureAwait(false);

        return ToSuccessorScalarRow(entity);
    }

    public async Task<CriticalRoleBandResult?> UpdateCriticalRoleBandAsync(
        string organizationId, Guid criticalRoleId, UpdateCriticalRoleBandInput input, DateTimeOffset now,
        CancellationToken cancellationToken)
    {
        var orgId = Guid.Parse(organizationId);
        var nowTs = ToTimestamp(now);

        await using var scope = await TenantScope.BeginAsync(_db, orgId, cancellationToken).ConfigureAwait(false);

        var entity = await _db.CriticalRoles
            .FirstOrDefaultAsync(r => r.Id == criticalRoleId && r.OrganizationId == orgId, cancellationToken)
            .ConfigureAwait(false);
        if (entity is null)
        {
            await scope.CommitAsync(cancellationToken).ConfigureAwait(false);
            return null;
        }

        // TS select { id, targetBandLevel } — settable to null (Zod .nullable()).
        entity.TargetBandLevel = input.TargetBandLevel;
        entity.UpdatedAt = nowTs;
        try
        {
            await _db.SaveChangesAsync(cancellationToken).ConfigureAwait(false);
        }
        catch (DbUpdateConcurrencyException)
        {
            // Codex M1: concurrently deleted between load and SaveChanges → 404, never a 500.
            return null;
        }

        await scope.CommitAsync(cancellationToken).ConfigureAwait(false);

        return new CriticalRoleBandResult(entity.Id.ToString(), entity.TargetBandLevel);
    }

    // Codex M2: match ONLY the successors (criticalRoleId, userId) unique constraint — a future/unexpected unique
    // index or a PK collision must NOT be mislabeled as the documented duplicate-successor 409 (it must propagate).
    private static bool IsUniqueViolation(DbUpdateException ex) =>
        ex.InnerException is PostgresException
        {
            SqlState: PostgresErrorCodes.UniqueViolation,
            ConstraintName: "successors_critical_role_id_user_id_key",
        };

    private static CriticalRoleRow ToCriticalRoleRow(CriticalRoleWriteEntity e) => new(
        e.Id.ToString(),
        e.OrganizationId.ToString(),
        e.Title,
        e.PositionId,
        e.CurrentHolderId?.ToString(),
        e.CompanyId?.ToString(),
        e.UnitId?.ToString(),
        e.Criticality,
        e.FlightRisk,
        e.TargetBandLevel,
        ToUtc(e.CreatedAt),
        ToUtc(e.UpdatedAt));

    private static SuccessorRow ToSuccessorRow(SuccessorWriteEntity e, SuccessorUserRow user) => new(
        e.Id.ToString(),
        e.OrganizationId.ToString(),
        e.CriticalRoleId.ToString(),
        e.UserId.ToString(),
        e.Readiness,
        e.Type,
        e.DevelopmentPlan,
        e.AddedById?.ToString(),
        ToUtc(e.CreatedAt),
        ToUtc(e.UpdatedAt),
        user);

    private static SuccessorScalarRow ToSuccessorScalarRow(SuccessorWriteEntity e) => new(
        e.Id.ToString(),
        e.OrganizationId.ToString(),
        e.CriticalRoleId.ToString(),
        e.UserId.ToString(),
        e.Readiness,
        e.Type,
        e.DevelopmentPlan,
        e.AddedById?.ToString(),
        ToUtc(e.CreatedAt),
        ToUtc(e.UpdatedAt));

    // Prisma `timestamp(3) without time zone` stores UTC wall-clock; Npgsql rejects a Kind=Utc DateTime for it, so
    // bind the UTC wall-clock as Unspecified-kind. Truncate to whole MILLISECONDS first so the value C# persists ==
    // what a JS `new Date()` (ms precision) persists (matches the compensation/evaluation360 staff writes).
    private static DateTime ToTimestamp(DateTimeOffset value)
    {
        var utc = value.UtcDateTime;
        return DateTime.SpecifyKind(utc.AddTicks(-(utc.Ticks % TimeSpan.TicksPerMillisecond)), DateTimeKind.Unspecified);
    }

    // Re-kind a persisted Unspecified wall-clock UTC value to UTC so the shared Node-ISO converter emits `…fffZ`.
    private static DateTimeOffset ToUtc(DateTime value) => new(DateTime.SpecifyKind(value, DateTimeKind.Utc));
}
