using Microsoft.EntityFrameworkCore;
using Tims.Application.ExternalVendor;
using Tims.Domain.ExternalVendor;

namespace Tims.Infrastructure.ExternalVendor;

/// <summary>
/// EF implementation of <see cref="IExternalValidationRepository"/> — a faithful port of the TS
/// <c>external-validation.repository.ts</c>. Both operations run UNDER <see cref="TenantScope"/> (SET LOCAL
/// ROLE app_tenant + org GUC) so RLS engages, with an EXPLICIT <c>organizationId</c> filter
/// (defense-in-depth, INV-7). The submit is an ATOMIC pending-only <c>ExecuteUpdateAsync</c> (INV-4) —
/// never a read-then-write on the status — that sets vendor provenance (INV-5).
/// </summary>
public sealed class ExternalValidationRepository(ExternalValidationDbContext db) : IExternalValidationRepository
{
    private const string PendingStatus = "pending";

    private readonly ExternalValidationDbContext _db = db;

    public async Task<string?> GetStatusForSubmitAsync(
        string organizationId, string validationId, CancellationToken cancellationToken)
    {
        var orgId = Guid.Parse(organizationId);
        var id = Guid.Parse(validationId);

        await using var scope = await TenantScope.BeginAsync(_db, orgId, cancellationToken).ConfigureAwait(false);

        // Prisma findFirst({ id, organizationId }) select { id, status }: only nullness + status matter.
        var status = await _db.Validations
            .AsNoTracking()
            .Where(v => v.Id == id && v.OrganizationId == orgId)
            .Select(v => v.Status)
            .FirstOrDefaultAsync(cancellationToken)
            .ConfigureAwait(false);

        await scope.CommitAsync(cancellationToken).ConfigureAwait(false);
        return status;
    }

    public async Task<int> SubmitResultAsync(
        string organizationId,
        string validationId,
        string apiKeyId,
        ExternalValidationSubmitCommand command,
        DateTimeOffset now,
        CancellationToken cancellationToken)
    {
        var orgId = Guid.Parse(organizationId);
        var id = Guid.Parse(validationId);
        var apiKeyGuid = Guid.Parse(apiKeyId);
        var resultJson = command.SerializeResult();
        var status = command.Status;
        var notes = command.Notes;
        // The Prisma columns are `timestamp(3) without time zone`. Npgsql maps a Kind=Utc DateTime to
        // timestamptz and REJECTS it for a `timestamp` column, so write the UTC wall-clock as an
        // Unspecified-kind DateTime — exactly how Prisma stores it (UTC wall-clock, no offset).
        var completedAt = DateTime.SpecifyKind(now.UtcDateTime, DateTimeKind.Unspecified);

        await using var scope = await TenantScope.BeginAsync(_db, orgId, cancellationToken).ConfigureAwait(false);

        // Atomic TOCTOU guard: the status:'pending' predicate is the transition gate — count 0 ⇒ CONFLICT.
        var pending = _db.Validations.Where(v =>
            v.Id == id && v.OrganizationId == orgId && v.Status == PendingStatus);

        // Faithful to the TS `notes: data.notes ?? undefined` (Prisma omits an undefined field): when the
        // vendor sends no notes, the column is left untouched rather than overwritten to NULL.
        int affected;
        if (notes is not null)
        {
            affected = await pending
                .ExecuteUpdateAsync(
                    setters => setters
                        .SetProperty(v => v.Status, status)
                        .SetProperty(v => v.Result, resultJson)
                        .SetProperty(v => v.Notes, notes)
                        .SetProperty(v => v.CompletedByApiKeyId, (Guid?)apiKeyGuid)
                        .SetProperty(v => v.CompletedById, (Guid?)null)
                        .SetProperty(v => v.CompletedAt, (DateTime?)completedAt)
                        .SetProperty(v => v.UpdatedAt, completedAt),
                    cancellationToken)
                .ConfigureAwait(false);
        }
        else
        {
            affected = await pending
                .ExecuteUpdateAsync(
                    setters => setters
                        .SetProperty(v => v.Status, status)
                        .SetProperty(v => v.Result, resultJson)
                        .SetProperty(v => v.CompletedByApiKeyId, (Guid?)apiKeyGuid)
                        .SetProperty(v => v.CompletedById, (Guid?)null)
                        .SetProperty(v => v.CompletedAt, (DateTime?)completedAt)
                        .SetProperty(v => v.UpdatedAt, completedAt),
                    cancellationToken)
                .ConfigureAwait(false);
        }

        await scope.CommitAsync(cancellationToken).ConfigureAwait(false);
        return affected;
    }
}
