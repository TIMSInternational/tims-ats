using Microsoft.EntityFrameworkCore;
using Npgsql;
using Tims.Infrastructure.PlatformOrganizations;

namespace Tims.IntegrationTests.PlatformOrganizations;

/// <summary>
/// Regression guard for a defect slice 20 found in slice 19 (issue #76, PR #198).
///
/// <para><c>PlatformOrganizationsReadDbContext</c> maps four NATIVE Postgres enum columns
/// (<c>organizations.plan</c>, <c>subscriptions.plan</c>/<c>status</c>, <c>invoices.status</c>,
/// <c>platform_invitations.status</c>) onto C# <c>string</c> properties, but it was registered on a plain
/// connection string rather than an <c>EnableUnmappedTypes</c> data source. EFCore.PG cannot materialise an
/// unmapped enum into a string, so all three read endpoints would have thrown
/// <c>InvalidCastException</c> on their first row the moment
/// <c>Platform:PlatformOrganizationsReadEnabled</c> was turned on — while every unit test stayed green,
/// because the fault only exists against a real Postgres.</para>
///
/// <para>The second test here IS the proof, not a restatement: it builds the same context on a plain
/// connection string and asserts the throw. If someone later removes the data source, the first test goes
/// red; if the provider ever starts handling this natively, the second goes red and this file can be
/// deleted.</para>
/// </summary>
[Collection("PlatformOrganizationsWrite")]
public sealed class PlatformOrganizationsReadDbContextTests(PlatformOrganizationsWriteFixture fixture)
{
    [Fact]
    public async Task Reads_the_native_OrgPlan_enum_into_a_string_on_the_configured_data_source()
    {
        await using var db = fixture.NewReadContext(fixture.ConnectionString);

        var org = await db.Organizations
            .AsNoTracking()
            .FirstOrDefaultAsync(o => o.Id == PlatformOrganizationsWriteFixture.OrgB);

        Assert.NotNull(org);
        Assert.Equal("starter", org!.Plan);
    }

    [Fact]
    public async Task Fails_on_a_plain_connection_string_which_is_how_slice_19_shipped()
    {
        await using var db = new PlatformOrganizationsReadDbContext(
            new DbContextOptionsBuilder<PlatformOrganizationsReadDbContext>()
                .UseNpgsql(fixture.ConnectionString)
                .Options);

        var failure = await Assert.ThrowsAsync<InvalidCastException>(() =>
            db.Organizations.AsNoTracking().FirstOrDefaultAsync(o => o.Id == PlatformOrganizationsWriteFixture.OrgB));

        Assert.Contains("System.String", failure.Message, StringComparison.Ordinal);
    }

    [Fact]
    public async Task The_enum_column_really_is_a_native_type_not_text()
    {
        // Guards the premise. If the fixture ever declared `plan text`, both tests above would pass for the
        // wrong reason and this file would silently stop testing anything.
        await using var connection = new NpgsqlConnection(fixture.ConnectionString);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText =
            "SELECT udt_name FROM information_schema.columns WHERE table_name = 'organizations' AND column_name = 'plan'";

        Assert.Equal("OrgPlan", (string?)await command.ExecuteScalarAsync());
    }
}
