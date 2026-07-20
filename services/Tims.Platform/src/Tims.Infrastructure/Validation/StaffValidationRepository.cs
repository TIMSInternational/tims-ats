using Microsoft.EntityFrameworkCore;
using System.Text.Json.Nodes;
using Tims.Application.Validation;
using Tims.Domain.Validation;

namespace Tims.Infrastructure.Validation;

/// <summary>
/// EF implementation of <see cref="IStaffValidationRepository"/> — a faithful port of the TS staff
/// <c>updateValidation</c> data steps. Both operations run UNDER <see cref="TenantScope"/> (SET LOCAL ROLE
/// app_tenant + org GUC → RLS) with an EXPLICIT <c>organizationId</c> filter (defense-in-depth). The update
/// is a tracked read-modify-write: it sets only the columns the TS write sets (status / completer /
/// completedAt always; result / notes only when provided — Prisma <c>?? undefined</c> = skip), so a partial
/// update never clobbers an untouched column, and satisfies <c>single_completer_chk</c>
/// (<c>completed_by_id</c> set, <c>completed_by_api_key_id</c> null). No status precondition — last-write-wins.
/// </summary>
public sealed class StaffValidationRepository(StaffValidationDbContext db) : IStaffValidationRepository
{
    private readonly StaffValidationDbContext _db = db;

    public async Task<Guid?> FindOfferIdAsync(
        string organizationId, string validationId, CancellationToken cancellationToken)
    {
        var orgId = Guid.Parse(organizationId);
        var id = Guid.Parse(validationId);

        await using var scope = await TenantScope.BeginAsync(_db, orgId, cancellationToken).ConfigureAwait(false);

        // Prisma findFirst({ id, organizationId }) select { offerId }: null (no row) ⇒ NOT_FOUND at the caller.
        var offerId = await _db.Validations
            .AsNoTracking()
            .Where(v => v.Id == id && v.OrganizationId == orgId)
            .Select(v => (Guid?)v.OfferId)
            .FirstOrDefaultAsync(cancellationToken)
            .ConfigureAwait(false);

        await scope.CommitAsync(cancellationToken).ConfigureAwait(false);
        return offerId;
    }

    public async Task<StaffValidationRow?> UpdateAsync(
        string organizationId,
        string validationId,
        StaffValidationUpdateCommand command,
        Guid userId,
        DateTimeOffset now,
        CancellationToken cancellationToken)
    {
        var orgId = Guid.Parse(organizationId);
        var id = Guid.Parse(validationId);
        // Prisma `timestamp(3) without time zone` stores UTC wall-clock; Npgsql rejects a Kind=Utc DateTime for
        // it, so bind the UTC wall-clock as Unspecified-kind. Truncate to whole MILLISECONDS first so the value
        // C# persists == what a JS `new Date()` (ms precision) persists (else raw ticks round in timestamp(3)
        // and the returned tracked entity would disagree with a later read) — matching the external write.
        var utc = now.UtcDateTime;
        var nowUnspecified = DateTime.SpecifyKind(
            utc.AddTicks(-(utc.Ticks % TimeSpan.TicksPerMillisecond)), DateTimeKind.Unspecified);

        await using var scope = await TenantScope.BeginAsync(_db, orgId, cancellationToken).ConfigureAwait(false);

        var entity = await _db.Validations
            .Where(v => v.Id == id && v.OrganizationId == orgId)
            .FirstOrDefaultAsync(cancellationToken)
            .ConfigureAwait(false);
        if (entity is null)
        {
            await scope.CommitAsync(cancellationToken).ConfigureAwait(false);
            return null;
        }

        // Always set (TS: status, completedById, completedByApiKeyId, completedAt) — completer XOR satisfied.
        entity.Status = command.Status;
        entity.CompletedById = userId;
        entity.CompletedByApiKeyId = null;
        entity.CompletedAt = command.IsCompleting ? nowUnspecified : null;
        entity.UpdatedAt = nowUnspecified;

        // Partial (TS: `result ?? undefined`, `notes: input.notes`) — write only when the body carried them.
        if (command.ResultProvided)
        {
            entity.Result = command.ResultJson;
        }

        if (command.NotesProvided)
        {
            entity.Notes = command.Notes;
        }

        await _db.SaveChangesAsync(cancellationToken).ConfigureAwait(false);
        await scope.CommitAsync(cancellationToken).ConfigureAwait(false);

        return Map(entity);
    }

    private static StaffValidationRow Map(StaffValidationEntity e) => new(
        e.Id.ToString(),
        e.OrganizationId.ToString(),
        e.OfferId.ToString(),
        e.Type,
        e.Status,
        e.IsBlocking,
        e.Result is null ? null : JsonNode.Parse(e.Result),
        e.CompletedById?.ToString(),
        e.CompletedByApiKeyId?.ToString(),
        ToUtcNullable(e.CompletedAt),
        e.Notes,
        ToUtc(e.CreatedAt),
        ToUtc(e.UpdatedAt));

    private static DateTimeOffset ToUtc(DateTime value) =>
        new(DateTime.SpecifyKind(value, DateTimeKind.Utc));

    private static DateTimeOffset? ToUtcNullable(DateTime? value) =>
        value is null ? null : ToUtc(value.Value);
}
