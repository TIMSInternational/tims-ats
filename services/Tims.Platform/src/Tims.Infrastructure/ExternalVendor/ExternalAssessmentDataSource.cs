using Npgsql;

namespace Tims.Infrastructure.ExternalVendor;

/// <summary>
/// Builds the Npgsql data source for <see cref="ExternalAssessmentDbContext"/> with UNMAPPED TYPES
/// enabled. The Prisma-OWNED <c>assessment_results.band</c> column is a NATIVE Postgres enum type
/// (<c>ScoreBand</c>, 4 labels: below_average/average/above_average/excellent); EFCore.PG does NOT read
/// an unmapped enum into a CLR <c>string</c> by default (it throws "Reading as 'System.String' is not
/// supported"). <see cref="NpgsqlDataSourceBuilder.EnableUnmappedTypes"/> makes Npgsql read/write that
/// enum as text, so the mapped C# string property resolves. <c>band</c> is READ-ONLY here and never
/// filtered on in a WHERE clause by this read surface, so this simpler pattern is used rather than
/// <c>MapEnum&lt;TEnum&gt;</c> (reserved for enums that ARE filtered). Shared by the Program.cs DI
/// registration and the Testcontainers fixture so both read identically. Read-only: the data source only
/// ever backs <c>AsNoTracking</c> reads under <see cref="TenantScope"/>.
/// </summary>
public static class ExternalAssessmentDataSource
{
    public static NpgsqlDataSource Build(string connectionString)
    {
        var builder = new NpgsqlDataSourceBuilder(connectionString);
        builder.EnableUnmappedTypes();
        return builder.Build();
    }
}

/// <summary>
/// DI holder for the external-assessment <see cref="NpgsqlDataSource"/>. It exists purely to ISOLATE the
/// EnableUnmappedTypes data source: EFCore.PG's <c>UseNpgsql(connectionString)</c> auto-resolves an
/// <see cref="NpgsqlDataSource"/> registered in the application service provider, so registering the raw
/// data source openly would silently bleed EnableUnmappedTypes into every OTHER string-based context
/// (Identity/Anchor/Hris/Billing/ExternalValidation/Audit). Registering THIS wrapper (not the raw
/// <see cref="NpgsqlDataSource"/> service type) keeps the data source exclusive to
/// <see cref="ExternalAssessmentDbContext"/>. Disposing it disposes the underlying source.
/// </summary>
public sealed class ExternalAssessmentDataSourceHolder(NpgsqlDataSource dataSource) : IDisposable
{
    public NpgsqlDataSource DataSource { get; } = dataSource;

    public void Dispose() => DataSource.Dispose();
}
