using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Npgsql;
using NpgsqlTypes;
using Tims.Application.Notification;

namespace Tims.Infrastructure.Notification;

/// <summary>
/// EF implementation of <see cref="INotificationWriteRepository"/> — the eight mutations of notification.ts
/// (:57-190) plus the lazy preference create that <c>getPreferences</c> performs.
///
/// <para>Shape by operation, chosen to match what Prisma emits: the four <c>updateMany</c>s and the one
/// <c>deleteMany</c> become <c>ExecuteUpdateAsync</c>/<c>ExecuteDeleteAsync</c> (a single statement whose
/// affected-row count IS the returned <c>{ count }</c>), while every INSERT is raw SQL so the column LIST can
/// name exactly what the caller supplied — see the NotificationDbContext remarks for why an EF <c>Add</c> is
/// wrong here. Every operation runs UNDER <see cref="TenantScope"/> and carries the caller's <c>user_id</c>
/// predicate, except <c>create</c>/<c>bulkCreate</c>, which address a TARGET user by design.</para>
///
/// <para>Timestamps bind as ms-truncated Unspecified-kind values (TRAP 6/10/11): the columns are
/// <c>timestamp(3) without time zone</c>, Npgsql REJECTS a <see cref="DateTimeKind.Utc"/> value against them
/// outright, and a JS <c>Date</c> carries whole milliseconds — while <c>DateTime.UtcNow</c> carries 100ns
/// ticks that Postgres would ROUND (JS truncates), so truncating here removes a class of one-millisecond
/// diff before it exists.</para>
/// </summary>
public sealed class NotificationWriteRepository(NotificationDbContext db) : INotificationWriteRepository
{
    private readonly NotificationDbContext _db = db;

    public async Task<int> MarkAsReadAsync(
        Guid? organizationId, Guid userId, Guid notificationId, DateTime readAt, CancellationToken cancellationToken)
    {
        await using var scope = await TenantScope.BeginAsync(_db, organizationId, cancellationToken)
            .ConfigureAwait(false);

        var readAtDb = ToDbTimestamp(readAt);
        var affected = await _db.Notifications
            .Where(n => n.Id == notificationId && n.UserId == userId)
            .ExecuteUpdateAsync(
                s => s.SetProperty(n => n.Read, true).SetProperty(n => n.ReadAt, readAtDb),
                cancellationToken)
            .ConfigureAwait(false);

        await scope.CommitAsync(cancellationToken).ConfigureAwait(false);
        return affected;
    }

    public async Task<int> MarkAllAsReadAsync(
        Guid? organizationId, Guid userId, DateTime readAt, CancellationToken cancellationToken)
    {
        await using var scope = await TenantScope.BeginAsync(_db, organizationId, cancellationToken)
            .ConfigureAwait(false);

        var readAtDb = ToDbTimestamp(readAt);

        // where: { userId, read: false } — NO archived filter. An archived-but-unread row IS marked read here
        // while `list` and `unreadCount` both exclude archived rows, so this can report a count larger than the
        // unread badge the caller could see. Faithful to the TS; noted so it is not read as an omission.
        var affected = await _db.Notifications
            .Where(n => n.UserId == userId && !n.Read)
            .ExecuteUpdateAsync(
                s => s.SetProperty(n => n.Read, true).SetProperty(n => n.ReadAt, readAtDb),
                cancellationToken)
            .ConfigureAwait(false);

        await scope.CommitAsync(cancellationToken).ConfigureAwait(false);
        return affected;
    }

    public async Task<int> ArchiveAsync(
        Guid? organizationId, Guid userId, Guid notificationId, CancellationToken cancellationToken)
    {
        await using var scope = await TenantScope.BeginAsync(_db, organizationId, cancellationToken)
            .ConfigureAwait(false);

        var affected = await _db.Notifications
            .Where(n => n.Id == notificationId && n.UserId == userId)
            .ExecuteUpdateAsync(s => s.SetProperty(n => n.Archived, true), cancellationToken)
            .ConfigureAwait(false);

        await scope.CommitAsync(cancellationToken).ConfigureAwait(false);
        return affected;
    }

    public async Task<int> ArchiveAllReadAsync(
        Guid? organizationId, Guid userId, CancellationToken cancellationToken)
    {
        await using var scope = await TenantScope.BeginAsync(_db, organizationId, cancellationToken)
            .ConfigureAwait(false);

        var affected = await _db.Notifications
            .Where(n => n.UserId == userId && n.Read && !n.Archived)
            .ExecuteUpdateAsync(s => s.SetProperty(n => n.Archived, true), cancellationToken)
            .ConfigureAwait(false);

        await scope.CommitAsync(cancellationToken).ConfigureAwait(false);
        return affected;
    }

    public async Task<int> DeleteAsync(
        Guid? organizationId, Guid userId, Guid notificationId, CancellationToken cancellationToken)
    {
        await using var scope = await TenantScope.BeginAsync(_db, organizationId, cancellationToken)
            .ConfigureAwait(false);

        // deleteMany — a HARD delete; notifications has no soft-delete column.
        var affected = await _db.Notifications
            .Where(n => n.Id == notificationId && n.UserId == userId)
            .ExecuteDeleteAsync(cancellationToken)
            .ConfigureAwait(false);

        await scope.CommitAsync(cancellationToken).ConfigureAwait(false);
        return affected;
    }

    public async Task<NotificationPreferencesRow> CreateDefaultPreferencesAsync(
        Guid? organizationId, Guid userId, DateTime now, CancellationToken cancellationToken)
    {
        await using var scope = await TenantScope.BeginAsync(_db, organizationId, cancellationToken)
            .ConfigureAwait(false);

        // create({ data: { userId } }) — every other column takes its database default, EXCEPT updated_at,
        // which is NOT NULL with no default because Prisma's @updatedAt is client-side.
        var rows = await _db.Database
            .SqlQuery<PreferencesProjection>(
                $"""
                 INSERT INTO notification_preferences (id, user_id, updated_at)
                 VALUES ({Guid.NewGuid()}, {userId}, {TimestampParam("updated_at", now)})
                 RETURNING email_enabled AS "EmailEnabled", push_enabled AS "PushEnabled",
                           categories::text AS "Categories", modules::text AS "Modules",
                           quiet_hours_start AS "QuietHoursStart", quiet_hours_end AS "QuietHoursEnd"
                 """)
            .ToListAsync(cancellationToken)
            .ConfigureAwait(false);

        await scope.CommitAsync(cancellationToken).ConfigureAwait(false);
        return NotificationReadRepository.MapPreferences(rows[0]);
    }

    public async Task<UpdatePreferencesResult> UpsertPreferencesAsync(
        Guid? organizationId,
        Guid userId,
        NotificationPreferencesUpdate update,
        DateTime now,
        CancellationToken cancellationToken)
    {
        await using var scope = await TenantScope.BeginAsync(_db, organizationId, cancellationToken)
            .ConfigureAwait(false);

        // The TS builds its `data` object key-by-key from `!== undefined` checks and passes the SAME object to
        // both `create` and `update`. So an unsent key is absent from both halves: it takes the column default
        // on insert and is left untouched on update. Reproduced by naming only the supplied columns — the
        // column names come from this fixed allowlist, never from input; values are always parameters.
        var columns = new List<string>();
        var parameters = new List<NpgsqlParameter>();

        void Add(string column, NpgsqlDbType type, object? value)
        {
            var name = $"p{parameters.Count}";
            columns.Add(column);
            parameters.Add(new NpgsqlParameter(name, type) { Value = value ?? DBNull.Value });
        }

        if (update.EmailEnabled is { } emailEnabled)
        {
            Add("email_enabled", NpgsqlDbType.Boolean, emailEnabled);
        }

        if (update.PushEnabled is { } pushEnabled)
        {
            Add("push_enabled", NpgsqlDbType.Boolean, pushEnabled);
        }

        if (update.CategoriesJson is { } categories)
        {
            Add("categories", NpgsqlDbType.Jsonb, categories);
        }

        if (update.ModulesJson is { } modules)
        {
            Add("modules", NpgsqlDbType.Jsonb, modules);
        }

        // .nullable().optional() — an explicitly sent null WRITES NULL; an unsent key writes nothing at all.
        if (update.QuietHoursStart.HasValue)
        {
            Add("quiet_hours_start", NpgsqlDbType.Text, update.QuietHoursStart.Value);
        }

        if (update.QuietHoursEnd.HasValue)
        {
            Add("quiet_hours_end", NpgsqlDbType.Text, update.QuietHoursEnd.Value);
        }

        var idParam = new NpgsqlParameter("id", NpgsqlDbType.Uuid) { Value = Guid.NewGuid() };
        var userParam = new NpgsqlParameter("user_id", NpgsqlDbType.Uuid) { Value = userId };
        var nowParam = TimestampParam("updated_at", now);

        var insertColumns = string.Join(", ", ["id", "user_id", "updated_at", .. columns]);
        var insertValues = string.Join(", ", ["@id", "@user_id", "@updated_at", .. parameters.Select(p => $"@{p.ParameterName}")]);
        var updateAssignments = string.Join(
            ", ", ["updated_at = @updated_at", .. columns.Select((c, i) => $"{c} = @{parameters[i].ParameterName}")]);

        var sql = $"""
                   INSERT INTO notification_preferences ({insertColumns})
                   VALUES ({insertValues})
                   ON CONFLICT (user_id) DO UPDATE SET {updateAssignments}
                   RETURNING email_enabled, push_enabled
                   """;

        var connection = _db.Database.GetDbConnection();
        await using var command = connection.CreateCommand();
        command.CommandText = sql;
        command.Transaction = _db.Database.CurrentTransaction?.GetDbTransaction();
        command.Parameters.Add(idParam);
        command.Parameters.Add(userParam);
        command.Parameters.Add(nowParam);
        foreach (var parameter in parameters)
        {
            command.Parameters.Add(parameter);
        }

        await using var reader = await command.ExecuteReaderAsync(cancellationToken).ConfigureAwait(false);
        await reader.ReadAsync(cancellationToken).ConfigureAwait(false);
        var result = new UpdatePreferencesResult(reader.GetBoolean(0), reader.GetBoolean(1));
        await reader.CloseAsync().ConfigureAwait(false);

        await scope.CommitAsync(cancellationToken).ConfigureAwait(false);
        return result;
    }

    public async Task<NotificationRow> CreateAsync(
        Guid? organizationId, NotificationCreateInput input, CancellationToken cancellationToken)
    {
        await using var scope = await TenantScope.BeginAsync(_db, organizationId, cancellationToken)
            .ConfigureAwait(false);

        var content = input.Content;

        // read/archived take their `false` defaults and created_at its CURRENT_TIMESTAMP default, exactly as
        // Prisma's create does by omitting them. The nullable optionals are bound as NULL, which for a column
        // with no default is indistinguishable from omitting it.
        var rows = await _db.Database
            .SqlQuery<NotificationProjection>(
                $"""
                 INSERT INTO notifications
                     (id, organization_id, user_id, type, title, message, module, entity_type, entity_id, action_url)
                 VALUES ({Guid.NewGuid()}, {organizationId}, {input.UserId}, {content.Type}, {content.Title},
                         {content.Message}, {content.Module}, {content.EntityType}, {content.EntityId},
                         {content.ActionUrl})
                 RETURNING id AS "Id", type AS "Type", title AS "Title", message AS "Message",
                           module AS "Module", read AS "Read", read_at AS "ReadAt",
                           entity_type AS "EntityType", entity_id AS "EntityId", action_url AS "ActionUrl",
                           created_at AS "CreatedAt"
                 """)
            .ToListAsync(cancellationToken)
            .ConfigureAwait(false);

        await scope.CommitAsync(cancellationToken).ConfigureAwait(false);
        return NotificationReadRepository.MapRow(rows[0]);
    }

    public async Task<int> BulkCreateAsync(
        Guid? organizationId,
        IReadOnlyList<Guid> userIds,
        NotificationCreateContent content,
        CancellationToken cancellationToken)
    {
        await using var scope = await TenantScope.BeginAsync(_db, organizationId, cancellationToken)
            .ConfigureAwait(false);

        // createMany — ONE multi-row INSERT, ids generated per row exactly as Prisma's client-side
        // @default(uuid()) does. userIds is NOT de-duplicated: createMany has no skipDuplicates here, so a
        // repeated id yields a repeated row and a count that includes it.
        var ids = userIds.Select(_ => Guid.NewGuid()).ToArray();

        var affected = await _db.Database
            .ExecuteSqlInterpolatedAsync(
                $"""
                 INSERT INTO notifications
                     (id, organization_id, user_id, type, title, message, module, entity_type, entity_id, action_url)
                 SELECT t.id, {organizationId}, t.user_id, {content.Type}, {content.Title}, {content.Message},
                        {content.Module}, {content.EntityType}, {content.EntityId}, {content.ActionUrl}
                 FROM unnest({ids}, {userIds.ToArray()}) AS t(id, user_id)
                 """,
                cancellationToken)
            .ConfigureAwait(false);

        await scope.CommitAsync(cancellationToken).ConfigureAwait(false);
        return affected;
    }

    /// <summary>
    /// TRAP 10/11 — an interpolation hole holding a bare <see cref="DateTime"/> is given EF's DEFAULT mapping,
    /// <c>timestamp with time zone</c>, which is wrong against these <c>timestamp(3) without time zone</c>
    /// columns; and Npgsql rejects a <see cref="DateTimeKind.Utc"/> value against the correct type outright.
    /// An explicit <see cref="NpgsqlParameter"/> pins both.
    /// </summary>
    private static NpgsqlParameter TimestampParam(string name, DateTime value) =>
        new(name, NpgsqlDbType.Timestamp) { Value = ToDbTimestamp(value) };

    /// <summary>
    /// Truncate to whole milliseconds and re-kind to Unspecified AT THE REPOSITORY BOUNDARY. The application
    /// layer works in UTC instants; the column cannot accept one.
    /// </summary>
    private static DateTime ToDbTimestamp(DateTime value) => DateTime.SpecifyKind(
        new DateTime(value.Ticks - (value.Ticks % TimeSpan.TicksPerMillisecond), DateTimeKind.Unspecified),
        DateTimeKind.Unspecified);
}
