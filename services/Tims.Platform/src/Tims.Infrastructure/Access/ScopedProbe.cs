using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Npgsql;
using Tims.Domain.Access;

namespace Tims.Infrastructure.Access;

/// <summary>
/// The by-id IDOR probe — the C# port of <c>assertScoped</c> (packages/api/src/access/scoped-probe.ts).
/// A narrow-scoped caller must not reach an out-of-scope row by id-guessing. Builds the WP2.5a scope
/// predicate, translates it to parameterized SQL, and runs an <c>EXISTS</c> probe under
/// <see cref="TenantScope"/>. No matching row → <see cref="ScopedNotFoundException"/> (NOT_FOUND, never
/// FORBIDDEN — the response must not confirm the id exists).
///
/// The probe query is <c>SELECT 1 FROM &lt;table&gt; t WHERE t.id = @id AND t.organization_id = @org
/// [AND t.deleted_at IS NULL] AND (&lt;predicate&gt;) LIMIT 1</c>. Table/column/nav identifiers come
/// ONLY from <see cref="ScopeProbeRegistry"/> (never user input); every id/value is a bound Npgsql
/// parameter (<c>@id</c>, <c>@org</c>, <c>@p0…</c>) — never interpolated.
/// </summary>
public sealed class ScopedProbe(IDbContextFactory<AnchorDbContext> contextFactory)
{
    public async Task AssertScopedAsync(
        ScopedEntity entity,
        Guid id,
        AccessScope scope,
        IAnchorLoader anchors,
        Guid organizationId,
        Guid userId,
        CancellationToken ct = default)
    {
        var predicate = await ScopeWhereFor.BuildAsync(entity, scope, anchors, userId.ToString(), ct);

        if (!ScopeProbeRegistry.EntityRootTable.TryGetValue(entity, out var table))
        {
            throw new InvalidOperationException(
                $"No scoped probe map registered for entity '{entity.ToWire()}'. WP2.5b registers only the "
                + "representative set (vacancy, candidate, application, interview, okr, team); the remaining "
                + "entities register their probe map in Phase 3 when built.");
        }

        var translated = ScopePredicateSqlTranslator.Translate(table, predicate);
        var softDeleteClause = ScopeProbeRegistry.SoftDeletable.Contains(entity)
            ? " AND t.deleted_at IS NULL"
            : string.Empty;

        // Identifiers ({table}, columns inside translated.Sql) are fixed registry constants, never
        // user input — identifier-safe. All ids/values are bound parameters below.
        var sql = $"SELECT 1 FROM {table} t "
            + $"WHERE t.id = @id AND t.organization_id = @org{softDeleteClause} "
            + $"AND ({translated.Sql}) LIMIT 1";

        await using var db = await contextFactory.CreateDbContextAsync(ct);
        await using var tenant = await TenantScope.BeginAsync(db, organizationId, ct);

        var connection = (NpgsqlConnection)db.Database.GetDbConnection();
        var transaction = (NpgsqlTransaction)db.Database.CurrentTransaction!.GetDbTransaction();

        await using var command = new NpgsqlCommand(sql, connection, transaction);
        command.Parameters.AddWithValue("id", id);
        command.Parameters.AddWithValue("org", organizationId);
        for (var i = 0; i < translated.Parameters.Count; i++)
        {
            command.Parameters.AddWithValue($"p{i}", translated.Parameters[i]);
        }

        var found = await command.ExecuteScalarAsync(ct);
        await tenant.CommitAsync(ct);

        if (found is null)
        {
            throw new ScopedNotFoundException(entity);
        }
    }
}
