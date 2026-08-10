using Npgsql;

namespace Tims.Infrastructure.PlatformOrganizations;

/// <summary>
/// Builds the Npgsql data source for the platform organizations contexts with UNMAPPED TYPES enabled.
///
/// <para><b>Without this, the endpoints in this domain that materialise a row throw at runtime.</b>
/// These contexts map FIVE columns whose Postgres types are native enums, across FOUR enum types:
/// <c>organizations.plan</c> and <c>subscriptions.plan</c> (<c>OrgPlan</c>), <c>subscriptions.status</c>
/// (<c>SubscriptionStatus</c>), <c>invoices.status</c> (<c>InvoiceStatus</c>) and
/// <c>platform_invitations.status</c> (<c>InvitationStatus</c>). EFCore.PG does not read an unmapped enum
/// into a CLR <c>string</c> by default; it fails with
/// <c>InvalidCastException: Reading as 'System.String' is not supported for fields having DataTypeName
/// '-.-'</c> the first time a row is materialised.
/// <see cref="NpgsqlDataSourceBuilder.EnableUnmappedTypes"/> makes Npgsql read that enum as text, which is
/// the pattern billing, evaluation360 and external-vendor already use for exactly the same reason. (DEI
/// solves the same problem the other way, with <c>MapEnum&lt;T&gt;</c> onto real CLR enums, because its
/// GROUP BY needs typed keys — so it is not a precedent for this file.)</para>
///
/// <para><b>Added in slice 20 and applied to the slice-19 READ context too, which was missing it.</b> The
/// read slice shipped registered on a plain connection string. <c>listOrganizations</c> and
/// <c>getOrganization</c> materialise organization rows, so both would have thrown the moment the flag was
/// flipped — with unit tests green, because the fault only exists against a real Postgres.
/// <c>getOrganizationKpis</c> is COUNT-only and does NOT materialise a row; whether its
/// <c>status == 'trialing'</c> predicate against an enum column also fails is a DIFFERENT failure mode and
/// is untested either way, so "all three endpoints" would be an overstatement. Found by the first
/// integration test written for the write slice; the regression guard is
/// <c>PlatformOrganizationsReadDbContextTests</c>, which covers <c>organizations.plan</c> only — the other
/// four columns and every enum-in-WHERE path remain uncovered.</para>
///
/// <para>The write path does not depend on this for WRITING <c>plan</c> — it casts an explicitly bound
/// text parameter (<c>{plan}::"OrgPlan"</c>) — but it does depend on it for reading the updated row back.</para>
/// </summary>
public static class PlatformOrganizationsDataSource
{
    public static NpgsqlDataSource Build(string connectionString)
    {
        var builder = new NpgsqlDataSourceBuilder(connectionString);
        builder.EnableUnmappedTypes();
        return builder.Build();
    }
}

/// <summary>
/// DI holder isolating the platform organizations <see cref="NpgsqlDataSource"/>. It exists purely so
/// <c>EnableUnmappedTypes</c> cannot bleed: EFCore.PG's <c>UseNpgsql(connectionString)</c> auto-resolves an
/// <see cref="NpgsqlDataSource"/> registered in the application service provider, so registering the raw
/// data source openly would silently change the type handling of every OTHER string-based context. Both the
/// read (slice 19) and write (slice 20) contexts of this domain share this ONE holder — the connection
/// string, and therefore the pooling, are identical either way.
/// </summary>
public sealed class PlatformOrganizationsDataSourceHolder(NpgsqlDataSource dataSource) : IDisposable
{
    public NpgsqlDataSource DataSource { get; } = dataSource;

    public void Dispose() => DataSource.Dispose();
}
