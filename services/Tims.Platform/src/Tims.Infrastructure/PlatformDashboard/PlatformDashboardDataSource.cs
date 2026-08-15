using Npgsql;

namespace Tims.Infrastructure.PlatformDashboard;

/// <summary>
/// Builds the Npgsql data source for <see cref="PlatformDashboardReadDbContext"/> with UNMAPPED TYPES
/// enabled.
///
/// <para><b>Which endpoints fail without this, stated precisely (TRAP 3).</b> Two mapped columns are the
/// native Postgres enum <c>OrgPlan</c>: <c>subscriptions.plan</c> and <c>organizations.plan</c>. EFCore.PG
/// will not read an unmapped enum into a CLR <c>string</c> on a plain <c>UseNpgsql(connectionString)</c>;
/// it throws <c>InvalidCastException: Reading as 'System.String' is not supported for fields having
/// DataTypeName '-.-'</c> the FIRST time a row is materialised — against a real Postgres only, with every
/// unit test green. <c>getPlanDistribution</c> materialises <c>subscriptions.plan</c> on every row and
/// <c>getRecentActivity</c> materialises <c>organizations.plan</c>, so BOTH would throw.
/// <c>getUserGrowth</c> is raw SQL projecting <c>to_char(...)</c> text and a <c>bigint</c> — no enum ever
/// reaches the reader, so it alone would survive. The regression proof lives in
/// <c>PlatformDashboardReadDbContextTests</c>, which runs the same repository against a data source
/// WITHOUT unmapped types and asserts the throw.</para>
///
/// <para>No <c>EF.Constant</c> is needed anywhere in this slice, and that is worth recording against
/// TRAP 8: no query filters on an enum column (the plan distribution reads ALL subscriptions, the recent
/// lists have no <c>where</c> at all), so the parameter-binding failure mode has no surface here.</para>
///
/// <para>The pattern is billing / evaluation360 / external-vendor / platform-organizations /
/// platform-invitations. DEI is NOT a precedent — it uses <c>MapEnum&lt;T&gt;</c> onto real CLR enums
/// because its GROUP BY needs typed keys.</para>
/// </summary>
public static class PlatformDashboardDataSource
{
    public static NpgsqlDataSource Build(string connectionString)
    {
        var builder = new NpgsqlDataSourceBuilder(connectionString);
        builder.EnableUnmappedTypes();
        return builder.Build();
    }
}

/// <summary>
/// DI holder isolating this domain's <see cref="NpgsqlDataSource"/>. It exists so
/// <c>EnableUnmappedTypes</c> cannot bleed: EFCore.PG's <c>UseNpgsql(connectionString)</c> auto-resolves an
/// <see cref="NpgsqlDataSource"/> registered openly in the application service provider, which would
/// silently change type handling for every OTHER string-based context in the host. One holder per domain,
/// matching <c>PlatformInvitationsDataSourceHolder</c>.
/// </summary>
public sealed class PlatformDashboardDataSourceHolder(NpgsqlDataSource dataSource) : IDisposable
{
    public NpgsqlDataSource DataSource { get; } = dataSource;

    public void Dispose() => DataSource.Dispose();
}
