using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace Tims.IntegrationTests.PlatformInvitations;

/// <summary>
/// Proof that <c>PlatformInvitationsDataSource</c> is load-bearing rather than decorative (TRAP 3) — the
/// slice-22 analog of <c>PlatformOrganizationsReadDbContextTests</c>, written up front instead of after a
/// flip broke production.
///
/// <para>This context maps TWO native Postgres enum columns onto C# <c>string</c> properties:
/// <c>platform_invitations.type</c> (<c>InvitationType</c>) and <c>.status</c>
/// (<c>InvitationStatus</c>). EFCore.PG cannot materialise an unmapped enum into a string, so on a plain
/// connection string <c>listInvitations</c> and <c>exportInvitationsCsv</c> would both throw
/// <c>InvalidCastException</c> on their first row the moment the flag was flipped — with every unit test
/// green, because the fault exists only against a real Postgres.</para>
///
/// <para>The three tests are a set: one asserts the configured path WORKS, one asserts the unconfigured
/// path THROWS (so removing the data source cannot pass silently), and one guards the PREMISE that the
/// columns are really native enums (so a fixture drifting to <c>text</c> cannot make the first two pass for
/// the wrong reason).</para>
/// </summary>
[Collection("PlatformInvitationsRead")]
public sealed class PlatformInvitationsReadDbContextTests(PlatformInvitationsReadFixture fixture)
{
    private readonly PlatformInvitationsReadFixture _fixture = fixture;

    [Fact]
    public async Task Reads_both_native_enums_into_strings_on_the_configured_data_source()
    {
        await using var db = _fixture.NewReadContext();

        var invitation = await db.Invitations
            .AsNoTracking()
            .FirstOrDefaultAsync(i => i.Id == PlatformInvitationsReadFixture.InvitationSentOrgA);

        Assert.NotNull(invitation);
        Assert.Equal("org_admin", invitation!.Type);
        Assert.Equal("sent", invitation.Status);
    }

    [Fact]
    public async Task Fails_on_a_plain_connection_string_which_is_how_slice_19_shipped()
    {
        await using var db = _fixture.NewReadContextWithoutUnmappedTypes();

        var failure = await Assert.ThrowsAsync<InvalidCastException>(() =>
            db.Invitations.AsNoTracking().FirstOrDefaultAsync(i => i.Id == PlatformInvitationsReadFixture.InvitationSentOrgA));

        Assert.Contains("System.String", failure.Message, StringComparison.Ordinal);
    }

    [Theory]
    [InlineData("type", "InvitationType")]
    [InlineData("status", "InvitationStatus")]
    public async Task The_enum_columns_really_are_native_types_not_text(string column, string expectedUdt)
    {
        await using var connection = new NpgsqlConnection(_fixture.ConnectionString);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText =
            "SELECT udt_name FROM information_schema.columns WHERE table_name = 'platform_invitations' AND column_name = @column";
        command.Parameters.AddWithValue("column", column);

        Assert.Equal(expectedUdt, (string?)await command.ExecuteScalarAsync());
    }

    /// <summary>
    /// <b>The proof behind <c>EF.Constant</c> in <c>PlatformInvitationsReadRepository.ApplyFilters</c>.</b>
    ///
    /// <para>A native enum column compared against a PARAMETERISED string fails: EF Core parameterises a
    /// captured variable, Npgsql types it <c>text</c>, and Postgres has no <c>"InvitationStatus" = text</c>
    /// operator. <c>EnableUnmappedTypes</c> does not help — it governs reading an enum into a string, not
    /// binding a string into one. This is a SEPARATE trap from the materialisation failure above, and it
    /// took two endpoint 500s to find because <c>GetKpisAsync</c>'s literal comparison works fine.</para>
    ///
    /// <para>Without this test, "simplifying" <c>EF.Constant(status)</c> back to <c>status</c> would
    /// reintroduce a 500 on <c>listInvitations</c> and <c>exportInvitationsCsv</c> whenever a filter is
    /// supplied, and every unfiltered test would stay green. The paired test below it proves the form the
    /// repository actually uses SUCCEEDS, so the two together pin the reason rather than just the symptom.
    /// </para>
    /// </summary>
    [Fact]
    public async Task A_parameterised_enum_comparison_fails_which_is_why_the_repository_uses_EF_Constant()
    {
        await using var db = _fixture.NewReadContext();

        // A local, hence a captured variable, hence an EF parameter — the exact shape the repository must
        // avoid. Deliberately obtained at run time so no compiler constant-folding can turn it into a
        // literal and make this test vacuous.
        var status = bool.Parse("true") ? "revoked" : "sent";

        var failure = await Record.ExceptionAsync(() =>
            db.Invitations.AsNoTracking().Where(i => i.Status == status).CountAsync());

        Assert.NotNull(failure);
    }

    /// <summary>The form the repository DOES use, against the same column and the same value.</summary>
    [Fact]
    public async Task An_EF_Constant_enum_comparison_succeeds()
    {
        await using var db = _fixture.NewReadContext();

        var status = bool.Parse("true") ? "revoked" : "sent";

        var count = await db.Invitations
            .AsNoTracking()
            .Where(i => i.Status == Microsoft.EntityFrameworkCore.EF.Constant(status))
            .CountAsync();

        Assert.Equal(1, count);
    }

    /// <summary>
    /// Guards the OTHER premise this slice's parity rests on: the timestamp columns must be
    /// <c>timestamp without time zone</c>. If the fixture (or a migration) moved them to <c>timestamptz</c>,
    /// Npgsql would yield <c>DateTimeKind.Utc</c>, the NodeIso converters would still emit a <c>Z</c>, and
    /// the wire assertions would pass while the PRODUCTION shape had changed underneath them.
    /// </summary>
    [Theory]
    [InlineData("sent_at")]
    [InlineData("accepted_at")]
    [InlineData("expires_at")]
    [InlineData("created_at")]
    public async Task The_timestamp_columns_are_without_time_zone(string column)
    {
        await using var connection = new NpgsqlConnection(_fixture.ConnectionString);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText =
            "SELECT data_type FROM information_schema.columns WHERE table_name = 'platform_invitations' AND column_name = @column";
        command.Parameters.AddWithValue("column", column);

        Assert.Equal("timestamp without time zone", (string?)await command.ExecuteScalarAsync());
    }
}
