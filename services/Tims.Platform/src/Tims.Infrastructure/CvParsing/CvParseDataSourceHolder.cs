using Npgsql;

namespace Tims.Infrastructure.CvParsing;

/// <summary>Private worker connection; never register an open NpgsqlDataSource in API DI.</summary>
public sealed class CvParseDataSourceHolder(NpgsqlDataSource dataSource) : IDisposable
{
    public NpgsqlDataSource DataSource { get; } = dataSource;
    public void Dispose() => DataSource.Dispose();
}
