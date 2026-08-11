using System.Globalization;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.EntityFrameworkCore;
using Tims.Application.PlatformOrganizations;
using Tims.Infrastructure.Audit;

namespace Tims.Infrastructure.PlatformOrganizations;

/// <summary>
/// The platform-owner organizations WRITE repository (Phase-5 slice 20, issue #76) — the C# port of
/// <c>updateOrganization</c> (<c>organizations.ts:171-210</c>) and <c>suspendOrganization</c>
/// (<c>organizations.ts:212-241</c>).
///
/// <para><b>The org UPDATE and the audit INSERT are ONE transaction.</b> Both mutations open a
/// <see cref="TenantScope"/>, issue the UPDATE, add the <c>audit_logs</c> row, <c>SaveChanges</c> and only
/// then commit. If the audit write fails for any reason the scope disposes without committing, so the
/// organization row is left exactly as it was — that is the fail-CLOSED contract from #76, and it is what
/// distinguishes this port from the TS <c>.catch(() =&gt; {})</c> it replaces. It is proved by mutation:
/// <c>PlatformOrganizationsWriteRepositoryTests</c> points the context at a database with no
/// <c>audit_logs</c> table and asserts the organization is unchanged.</para>
/// </summary>
public sealed class PlatformOrganizationsWriteRepository(PlatformOrganizationsWriteDbContext db)
    : IPlatformOrganizationsWriteRepository
{
    private const string OrganizationEntity = "organization";
    private const string UpdatedAction = "org_updated";
    private const string SuspendedAction = "org_suspended";
    private const string ActivatedAction = "org_activated";

    private readonly PlatformOrganizationsWriteDbContext _db = db;

    public async Task<PlatformOrganizationRow?> UpdateAsync(
        Guid id,
        PlatformOrganizationUpdateInput input,
        string changesJson,
        Guid actorId,
        DateTime now,
        CancellationToken cancellationToken)
    {
        // Locals, not inline expressions: every one of these becomes a bound Npgsql parameter. `null` means
        // the field was ABSENT (Zod `.optional()` rejects an explicit null), which is exactly what the
        // COALESCE below reads it as — so there is no input that can null one of these columns, matching
        // the TS `if (rest.x !== undefined)` guards.
        var name = input.Name;
        var plan = input.Plan;
        var isActive = input.IsActive;
        var settings = PlatformOrganizationsWriteUseCase.BuildSettingsColumnJson(input.Settings);
        var updatedAt = ToTimestampText(now);

        await using var scope = await TenantScope.BeginAsync(_db, id, cancellationToken).ConfigureAwait(false);

        // Raw-but-fully-parameterized, for two reasons EF cannot cover: `plan` is a native Postgres enum
        // (`OrgPlan`) with no EF store mapping to write back through — the same {plan}::"OrgPlan" cast
        // BillingWebhookRepository already uses on this column — and COALESCE expresses "absent leaves the
        // stored value alone" in one statement instead of a load-then-mutate round trip that could act on a
        // stale row. Timestamps bind as text + ::timestamp: a raw command carries no column-type hint, so
        // Npgsql would default a DateTime to timestamptz and reject the Unspecified UTC wall-clock.
        var affected = await _db.Database.ExecuteSqlInterpolatedAsync(
            $"""
             UPDATE organizations SET
                 name = COALESCE({name}, name),
                 plan = COALESCE({plan}::"OrgPlan", plan),
                 is_active = COALESCE({isActive}, is_active),
                 settings = COALESCE({settings}::jsonb, settings),
                 updated_at = {updatedAt}::timestamp
             WHERE id = {id}
             """,
            cancellationToken).ConfigureAwait(false);

        if (affected == 0)
        {
            // No such organization: return without committing, so no audit row is written either.
            return null;
        }

        AddAuditRow(id, actorId, UpdatedAction, ToJsonStringScalar(changesJson));

        // ONE SaveChanges, INSIDE the scope's transaction: an audit failure here rolls the UPDATE back.
        await _db.SaveChangesAsync(cancellationToken).ConfigureAwait(false);

        var row = await ReadRowAsync(id, cancellationToken).ConfigureAwait(false);
        await scope.CommitAsync(cancellationToken).ConfigureAwait(false);
        return row;
    }

    public async Task<PlatformOrganizationRow?> SuspendAsync(
        Guid id,
        bool suspend,
        Guid actorId,
        DateTime now,
        CancellationToken cancellationToken)
    {
        // organizations.ts:217 — `isActive: !suspend`. Suspending deactivates; unsuspending reactivates.
        var isActive = !suspend;
        var updatedAt = ToTimestampText(now);

        await using var scope = await TenantScope.BeginAsync(_db, id, cancellationToken).ConfigureAwait(false);

        var affected = await _db.Database.ExecuteSqlInterpolatedAsync(
            $"""
             UPDATE organizations SET is_active = {isActive}, updated_at = {updatedAt}::timestamp
             WHERE id = {id}
             """,
            cancellationToken).ConfigureAwait(false);

        if (affected == 0)
        {
            return null;
        }

        // organizations.ts:233 — the action, not a `changes` payload, carries the direction. The TS write
        // sets no `changes` key at all for this audit, so neither does this one.
        AddAuditRow(id, actorId, suspend ? SuspendedAction : ActivatedAction, changes: null);

        await _db.SaveChangesAsync(cancellationToken).ConfigureAwait(false);

        var row = await ReadRowAsync(id, cancellationToken).ConfigureAwait(false);
        await scope.CommitAsync(cancellationToken).ConfigureAwait(false);
        return row;
    }

    // The body moved to PlatformOwnerNotifier in slice 21 (#76), when the create repository became a second
    // caller of the same fan-out. The per-owner copy and the empty-set early return are user-visible
    // behaviour; two hand-maintained copies would drift into notifications that differ depending on which
    // mutation produced them. Its own unit of work, outside the update transaction — a failed fan-out must
    // not undo a completed suspension, deliberately asymmetric with the audit write.
    public Task NotifyPlatformOwnersAsync(PlatformOwnerNotification notification, CancellationToken cancellationToken) =>
        PlatformOwnerNotifier.SendAsync(_db, _db.Users, _db.Notifications, notification, cancellationToken);

    private void AddAuditRow(Guid organizationId, Guid actorId, string action, string? changes) =>
        _db.AuditLogs.Add(new AuditLogEntity
        {
            Id = Guid.NewGuid(),
            OrganizationId = organizationId,
            ActorId = actorId,
            Action = action,
            Entity = OrganizationEntity,
            // Prisma `entityId String?` is TEXT, not uuid — the TS passes the same uuid string.
            EntityId = organizationId.ToString(),
            Changes = changes,
        });

    private async Task<PlatformOrganizationRow?> ReadRowAsync(Guid id, CancellationToken cancellationToken)
    {
        var entity = await _db.Organizations
            .AsNoTracking()
            .FirstOrDefaultAsync(o => o.Id == id, cancellationToken)
            .ConfigureAwait(false);

        return entity is null ? null : Map(entity);
    }

    /// <summary>
    /// Both TS mutations <c>return org</c> — the full row <c>db.organization.update()</c> resolves to.
    /// Field order follows the Prisma model declaration order so the JSON shape matches.
    /// </summary>
    private static PlatformOrganizationRow Map(PlatformOrganizationWriteEntity entity) =>
        new(
            entity.Id.ToString(),
            entity.Name,
            entity.Slug,
            entity.Domain,
            entity.Logo,
            entity.Plan,
            entity.Settings is null ? null : JsonNode.Parse(entity.Settings),
            entity.BillingEmail,
            entity.IsActive,
            entity.CreatedAt,
            entity.UpdatedAt,
            entity.DeletedAt);

    /// <summary>
    /// Wraps the changes text as a JSON string VALUE, so the jsonb column receives a string scalar rather
    /// than an object.
    ///
    /// <para>That is what Prisma stores. <c>audit_logs.changes</c> is a Prisma <c>Json?</c> field and the TS
    /// hands it <c>JSON.stringify(rest)</c> — a JS string — so the JSON value is a string, not the object it
    /// spells out. Measured against Postgres 16 through Prisma 6:
    /// <c>jsonb_typeof</c> is <c>'string'</c> and the stored text is
    /// <c>"{\"name\":\"N\",\"isActive\":true}"</c>. Writing an object here instead would be
    /// <c>jsonb_typeof = 'object'</c> with re-ordered, re-spaced keys — visibly different to any reader and
    /// to the parity harness.</para>
    ///
    /// <para>The escaping of the wrapper itself is irrelevant (Postgres decodes it before storing), which is
    /// why this can use the default encoder while
    /// <see cref="PlatformOrganizationsWriteUseCase.BuildUpdateChangesJson"/> must not: there, the escaping
    /// IS the stored content.</para>
    /// </summary>
    private static string ToJsonStringScalar(string changesJson) => JsonSerializer.Serialize(changesJson);

    // Prisma writes `timestamp(3) without time zone` holding a UTC wall-clock; bind the same text form.
    private static string ToTimestampText(DateTime value) =>
        value.ToString("yyyy-MM-dd HH:mm:ss.fff", CultureInfo.InvariantCulture);
}
