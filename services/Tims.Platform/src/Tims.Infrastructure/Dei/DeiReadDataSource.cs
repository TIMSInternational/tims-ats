using Npgsql;
using Npgsql.EntityFrameworkCore.PostgreSQL.Infrastructure;

namespace Tims.Infrastructure.Dei;

/// <summary>
/// Builds the Npgsql data source for <see cref="DeiReadDbContext"/> with the three NATIVE Prisma enum types on
/// <c>employee_demographics</c> mapped to CLR enums. The DEI demographic reads GROUP BY <c>gender</c>,
/// <c>ethnicity</c> and <c>disability_status</c> (all native Postgres enums), and Postgres has no implicit
/// <c>enum = text</c> operator — so the enums are mapped so EF Core emits correctly-typed enum parameters and
/// materializes the grouped key as the CLR enum (not <c>int</c>). Shared by the Program.cs DI registration and the
/// Testcontainers fixture so both read identically. Read-only: the source only backs <c>AsNoTracking</c> reads
/// under <see cref="TenantScope"/>.
/// </summary>
public static class DeiReadDataSource
{
    public static NpgsqlDataSource Build(string connectionString)
    {
        var builder = new NpgsqlDataSourceBuilder(connectionString);
        builder.MapEnum<GenderPg>("Gender");
        builder.MapEnum<EthnicityPg>("Ethnicity");
        builder.MapEnum<DisabilityStatusPg>("DisabilityStatus");
        return builder.Build();
    }

    /// <summary>
    /// Registers the three native Prisma enums on the EF Core options (SAME store-type names as
    /// <see cref="Build"/>). This is what teaches EFCore.PG's type-mapping source that the CLR enum properties map
    /// to native Postgres enums — WITHOUT it EF materializes the columns as <c>int</c> (<c>GetInt32</c> →
    /// InvalidCastException) and emits <c>= integer</c> GROUP BY / WHERE clauses (error 42883). It also makes EF
    /// build a dedicated, per-options data source carrying these mappings, so they never bleed into the other
    /// string-based contexts.
    /// </summary>
    public static void MapEnums(NpgsqlDbContextOptionsBuilder options)
    {
        options.MapEnum<GenderPg>("Gender");
        options.MapEnum<EthnicityPg>("Ethnicity");
        options.MapEnum<DisabilityStatusPg>("DisabilityStatus");
    }
}

/// <summary>
/// DI holder for the DEI <see cref="NpgsqlDataSource"/>. It ISOLATES the enum-mapped data source: EFCore.PG's
/// <c>UseNpgsql(connectionString)</c> auto-resolves an <see cref="NpgsqlDataSource"/> registered in the
/// application service provider, so registering the raw source openly would bleed the enum mappings into every
/// OTHER string-based context. Registering THIS wrapper keeps the source exclusive to
/// <see cref="DeiReadDbContext"/> (exactly like <c>Evaluation360ReadDataSourceHolder</c>). Disposing it disposes
/// the underlying source.
/// </summary>
public sealed class DeiReadDataSourceHolder(NpgsqlDataSource dataSource) : IDisposable
{
    public NpgsqlDataSource DataSource { get; } = dataSource;

    public void Dispose() => DataSource.Dispose();
}
