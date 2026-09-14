using Npgsql;

namespace Tims.Infrastructure.PlatformInvitations;

/// <summary>
/// Builds the Npgsql data source for <see cref="PlatformInvitationsReadDbContext"/> with UNMAPPED TYPES
/// enabled.
///
/// <para><b>Without this, every endpoint in this slice that returns a row throws at runtime — and every
/// unit test still passes.</b> Two mapped columns are native Postgres enums:
/// <c>platform_invitations.type</c> (<c>InvitationType</c>) and <c>platform_invitations.status</c>
/// (<c>InvitationStatus</c>). EFCore.PG will not read an unmapped enum into a CLR <c>string</c> on a plain
/// <c>UseNpgsql(connectionString)</c>; it fails with <c>InvalidCastException: Reading as 'System.String' is
/// not supported for fields having DataTypeName '-.-'</c> the FIRST time a row is materialised — which
/// means against a real Postgres only, i.e. the moment the flag is flipped in production.
/// <see cref="NpgsqlDataSourceBuilder.EnableUnmappedTypes"/> makes Npgsql read the enum as text.</para>
///
/// <para>Slice 19 shipped without this and would have thrown on flip; it was found by the first
/// integration test of slice 20 and fixed in #202. This slice pays for it up front instead. The pattern is
/// billing / evaluation360 / external-vendor / platform-organizations. DEI is NOT a precedent — it uses
/// <c>MapEnum&lt;T&gt;</c> onto real CLR enums because its GROUP BY needs typed keys.</para>
///
/// <para><b>Which endpoints would actually have failed:</b> <c>listInvitations</c> and
/// <c>exportInvitationsCsv</c> both project <c>type</c> and <c>status</c>, so both materialise an enum and
/// both would throw. <c>getInvitationKpis</c> is COUNT-only and materialises no row, so it would have
/// survived — but its three filtered counts compare <c>status</c> against text in a WHERE clause, which is
/// a DIFFERENT failure mode that is untested either way. "All three endpoints would have failed" would be
/// an overstatement; two would, and the third is unproven in both directions.</para>
/// </summary>
public static class PlatformInvitationsDataSource
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
/// matching <c>PlatformOrganizationsDataSourceHolder</c>.
/// </summary>
public sealed class PlatformInvitationsDataSourceHolder(NpgsqlDataSource dataSource) : IDisposable
{
    public NpgsqlDataSource DataSource { get; } = dataSource;

    public void Dispose() => DataSource.Dispose();
}
