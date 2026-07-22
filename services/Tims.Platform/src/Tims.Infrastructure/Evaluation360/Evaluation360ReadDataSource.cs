using Npgsql;
using Npgsql.EntityFrameworkCore.PostgreSQL.Infrastructure;

namespace Tims.Infrastructure.Evaluation360;

/// <summary>
/// Builds the Npgsql data source for <see cref="Evaluation360ReadDbContext"/> with the three NATIVE Prisma enum
/// types mapped to CLR enums. The evaluation360 reads FILTER on <c>review_cycles.status</c>,
/// <c>rater_assignments.relationship</c> and <c>rater_assignments.status</c> (all native Postgres enums), and
/// Postgres has no implicit <c>enum = text</c> operator — so, unlike the billing read (which uses
/// EnableUnmappedTypes purely to READ enums as text and never filters on them), this context maps the enums so
/// EF Core emits correctly-typed enum parameters in WHERE/GROUP BY. Shared by the Program.cs DI registration and
/// the Testcontainers fixture so both read/filter identically. Read-only: the source only backs
/// <c>AsNoTracking</c> reads under <see cref="TenantScope"/>.
/// </summary>
public static class Evaluation360ReadDataSource
{
    public static NpgsqlDataSource Build(string connectionString)
    {
        var builder = new NpgsqlDataSourceBuilder(connectionString);
        builder.MapEnum<ReviewCycleStatusPg>("ReviewCycleStatus");
        builder.MapEnum<RaterRelationshipPg>("RaterRelationship");
        builder.MapEnum<RaterAssignmentStatusPg>("RaterAssignmentStatus");
        return builder.Build();
    }

    /// <summary>
    /// Registers the three native Prisma enums on the EF Core options (SAME store-type names as
    /// <see cref="Build"/>). This is what actually teaches EFCore.PG's type-mapping source that the CLR enum
    /// properties map to native Postgres enums — WITHOUT it EF materializes the columns as <c>int</c>
    /// (<c>GetInt32</c> → InvalidCastException) and emits <c>= integer</c> WHERE clauses (error 42883). It also
    /// makes EF build a dedicated, per-options data source that carries these mappings, so they never bleed into
    /// the other string-based contexts (same isolation the old holder gave, now the framework-owned way).
    /// </summary>
    public static void MapEnums(NpgsqlDbContextOptionsBuilder options)
    {
        options.MapEnum<ReviewCycleStatusPg>("ReviewCycleStatus");
        options.MapEnum<RaterRelationshipPg>("RaterRelationship");
        options.MapEnum<RaterAssignmentStatusPg>("RaterAssignmentStatus");
    }
}

/// <summary>
/// DI holder for the evaluation360 <see cref="NpgsqlDataSource"/>. It ISOLATES the enum-mapped data source:
/// EFCore.PG's <c>UseNpgsql(connectionString)</c> auto-resolves an <see cref="NpgsqlDataSource"/> registered in
/// the application service provider, so registering the raw source openly would bleed the enum mappings into
/// every OTHER string-based context. Registering THIS wrapper keeps the source exclusive to
/// <see cref="Evaluation360ReadDbContext"/> (exactly like <c>BillingReadDataSourceHolder</c>). Disposing it
/// disposes the underlying source.
/// </summary>
public sealed class Evaluation360ReadDataSourceHolder(NpgsqlDataSource dataSource) : IDisposable
{
    public NpgsqlDataSource DataSource { get; } = dataSource;

    public void Dispose() => DataSource.Dispose();
}
