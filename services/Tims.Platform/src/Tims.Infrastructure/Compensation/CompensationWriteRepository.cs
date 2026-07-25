using Microsoft.EntityFrameworkCore;
using Tims.Application.Compensation;
using Tims.Domain.Compensation;

namespace Tims.Infrastructure.Compensation;

/// <summary>
/// EF implementation of <see cref="ICompensationWriteRepository"/> — a faithful port of the data steps of the TS
/// <c>createAdjustment</c> + <c>approveAdjustment</c> mutations. Every operation runs UNDER
/// <see cref="TenantScope"/> (SET LOCAL ROLE app_tenant + org GUC → RLS) with an EXPLICIT
/// <c>organizationId</c> filter (defense-in-depth). The approve is a single interactive transaction: the atomic
/// pending-only status transition (count 0 ⇒ CONFLICT — the TOCTOU guard) THEN, when approved, the compensation
/// propagation — both commit or roll back together (INV-1/INV-2).
/// </summary>
public sealed class CompensationWriteRepository(CompensationWriteDbContext db) : ICompensationWriteRepository
{
    private const string PendingStatus = "pending";

    private readonly CompensationWriteDbContext _db = db;

    public async Task<string?> GetSubjectCompensationCurrencyAsync(
        string organizationId, Guid subjectUserId, CancellationToken cancellationToken)
    {
        var orgId = Guid.Parse(organizationId);
        await using var scope = await TenantScope.BeginAsync(_db, orgId, cancellationToken).ConfigureAwait(false);

        // Prisma findFirst({ userId, organizationId }) select { currency }: null (no row) ⇒ USD fallback at caller.
        var currency = await _db.EmployeeCompensations
            .AsNoTracking()
            .Where(c => c.UserId == subjectUserId && c.OrganizationId == orgId)
            .Select(c => c.Currency)
            .FirstOrDefaultAsync(cancellationToken)
            .ConfigureAwait(false);

        await scope.CommitAsync(cancellationToken).ConfigureAwait(false);
        return currency;
    }

    public async Task<bool> SubjectExistsInOrgAsync(
        string organizationId, Guid subjectUserId, CancellationToken cancellationToken)
    {
        var orgId = Guid.Parse(organizationId);
        await using var scope = await TenantScope.BeginAsync(_db, orgId, cancellationToken).ConfigureAwait(false);

        // The H1 org-membership backstop — RLS-filtered to the caller's org under the active TenantScope,
        // with an explicit org filter (defense-in-depth). A cross-org userId ⇒ false ⇒ 403 (never INSERTed).
        var exists = await _db.Users
            .AsNoTracking()
            .AnyAsync(u => u.Id == subjectUserId && u.OrganizationId == orgId, cancellationToken)
            .ConfigureAwait(false);

        await scope.CommitAsync(cancellationToken).ConfigureAwait(false);
        return exists;
    }

    public async Task<string> InsertAdjustmentAsync(
        string organizationId,
        Guid callerId,
        CreateAdjustmentCommand command,
        string currency,
        DateTimeOffset now,
        CancellationToken cancellationToken)
    {
        var orgId = Guid.Parse(organizationId);
        var nowUnspecified = ToTimestamp(now);

        var entity = new SalaryAdjustmentWriteEntity
        {
            // Prisma @default(uuid()) is client-side generation — mint the id here (Prisma parity).
            Id = Guid.NewGuid(),
            OrganizationId = orgId,
            UserId = command.UserId,
            Type = command.Type,
            PreviousSalary = command.PreviousSalary,
            NewSalary = command.NewSalary,
            Currency = currency,
            Reason = command.Reason,
            Status = PendingStatus,
            ApprovedById = null,
            EffectiveDate = ToTimestamp(command.EffectiveDate),
            RequestedById = callerId,
            // Prisma @default(now()) / @updatedAt are client-side — set both explicitly (parity + NOT NULL safety).
            CreatedAt = nowUnspecified,
            UpdatedAt = nowUnspecified,
        };

        await using var scope = await TenantScope.BeginAsync(_db, orgId, cancellationToken).ConfigureAwait(false);
        _db.SalaryAdjustments.Add(entity);
        await _db.SaveChangesAsync(cancellationToken).ConfigureAwait(false);
        await scope.CommitAsync(cancellationToken).ConfigureAwait(false);

        return entity.Id.ToString();
    }

    public async Task<PendingAdjustmentRow?> LoadPendingAdjustmentAsync(
        string organizationId, Guid adjustmentId, CancellationToken cancellationToken)
    {
        var orgId = Guid.Parse(organizationId);
        await using var scope = await TenantScope.BeginAsync(_db, orgId, cancellationToken).ConfigureAwait(false);

        // Prisma findFirst({ id, org, status:'pending' }) select { userId, newSalary, currency }: null ⇒ NOT_FOUND.
        var row = await _db.SalaryAdjustments
            .AsNoTracking()
            .Where(a => a.Id == adjustmentId && a.OrganizationId == orgId && a.Status == PendingStatus)
            .Select(a => new PendingAdjustmentRow(a.UserId, a.NewSalary, a.Currency))
            .FirstOrDefaultAsync(cancellationToken)
            .ConfigureAwait(false);

        await scope.CommitAsync(cancellationToken).ConfigureAwait(false);
        return row;
    }

    public async Task<ApproveOutcome> ApproveAsync(
        string organizationId,
        Guid adjustmentId,
        Guid callerId,
        string newStatus,
        bool applyCompensation,
        Guid subjectUserId,
        double newSalary,
        string currency,
        DateTimeOffset now,
        CancellationToken cancellationToken)
    {
        var orgId = Guid.Parse(organizationId);
        var nowUnspecified = ToTimestamp(now);

        await using var scope = await TenantScope.BeginAsync(_db, orgId, cancellationToken).ConfigureAwait(false);

        // (a) Atomic TOCTOU guard: the status:'pending' predicate is the transition gate — count 0 ⇒ CONFLICT.
        var transitioned = await _db.SalaryAdjustments
            .Where(a => a.Id == adjustmentId && a.OrganizationId == orgId && a.Status == PendingStatus)
            .ExecuteUpdateAsync(
                setters => setters
                    .SetProperty(a => a.Status, newStatus)
                    .SetProperty(a => a.ApprovedById, (Guid?)callerId)
                    .SetProperty(a => a.UpdatedAt, nowUnspecified),
                cancellationToken)
            .ConfigureAwait(false);

        if (transitioned == 0)
        {
            // Already approved/rejected (or vanished) by a concurrent racer — abort the whole transaction
            // (dispose without commit → rollback) so NO compensation update is applied.
            return ApproveOutcome.Conflict;
        }

        // (b) Propagate the approved figure within the SAME transaction so the status transition and
        // currentSalary commit (or roll back) together. updateMany matches 0 rows harmlessly when the subject
        // has no comp row (TS parity). A failure here rolls the status transition back (INV-2 atomicity).
        if (applyCompensation)
        {
            await _db.EmployeeCompensations
                .Where(c => c.UserId == subjectUserId && c.OrganizationId == orgId)
                .ExecuteUpdateAsync(
                    setters => setters
                        .SetProperty(c => c.CurrentSalary, newSalary)
                        .SetProperty(c => c.Currency, currency)
                        .SetProperty(c => c.UpdatedAt, nowUnspecified),
                    cancellationToken)
                .ConfigureAwait(false);
        }

        await scope.CommitAsync(cancellationToken).ConfigureAwait(false);
        return ApproveOutcome.Applied;
    }

    // Prisma `timestamp(3) without time zone` stores UTC wall-clock; Npgsql rejects a Kind=Utc DateTime for it,
    // so bind the UTC wall-clock as Unspecified-kind. Truncate to whole MILLISECONDS first so the value C#
    // persists == what a JS `new Date()` (ms precision) persists (matches the external/staff writes).
    private static DateTime ToTimestamp(DateTimeOffset value)
    {
        var utc = value.UtcDateTime;
        return DateTime.SpecifyKind(utc.AddTicks(-(utc.Ticks % TimeSpan.TicksPerMillisecond)), DateTimeKind.Unspecified);
    }
}
