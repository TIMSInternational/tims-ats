using Tims.Application.PlatformInvitations;
using Tims.UnitTests.Fixtures;

namespace Tims.UnitTests.PlatformInvitations;

/// <summary>
/// The C# half of the slice-22 CSV golden. Reads the SAME file the TS suite reads —
/// <c>contracts/invitation-fixtures/export-invitations-csv.json</c>, copied into the test output by
/// <c>Tims.UnitTests.csproj</c> — so the two stacks assert against one artifact rather than two
/// hand-maintained literals that can drift apart silently.
///
/// <para>The TS half is <c>tests/parity/invitation-fixtures.test.ts</c>. Between them they close the gap
/// that a coverage review found after commit <c>7ad7b683</c>: the C# side pinned the hardened CSV bytes and
/// the TS side pinned nothing, so reverting the TS hunk alone left every suite green while reopening
/// CWE-1236 on the live path.</para>
/// </summary>
public sealed class PlatformInvitationsCsvFixtureTests
{
    private static readonly CsvGolden Golden =
        Fx.Load<CsvGolden>("invitation-fixtures", "export-invitations-csv.json");

    [Fact]
    public void CsvHeader_matches_the_shared_golden() =>
        Assert.Equal(Golden.Header, PlatformInvitationsReadUseCase.CsvHeader);

    /// <summary>
    /// The hostile row, built by the REAL <see cref="PlatformInvitationsReadUseCase.BuildCsv"/> rather than
    /// by re-deriving it here, so this fails if the C# side is un-hardened — the mirror of the TS source
    /// guard. The fixture's date cells are already the formatted strings TS emits, so the row is constructed
    /// with dates that format to those exact values.
    /// </summary>
    [Fact]
    public void BuildCsv_row_matches_the_shared_golden_byte_for_byte()
    {
        var sample = Golden.Sample;
        var row = new PlatformInvitationExportRow(
            sample.Email,
            sample.Type,
            sample.OrganizationName,
            // The golden stores the EMITTED cell ("-"), which is what a falsy role_slug becomes. Feeding the
            // empty string back in is what proves BuildCsv still applies the `|| '-'` falsy rule.
            string.Empty,
            sample.Status,
            SentAt: null,
            ExpiresAt: new DateTime(2026, 8, 1, 0, 0, 0, DateTimeKind.Unspecified),
            AcceptedAt: null);

        var csv = PlatformInvitationsReadUseCase.BuildCsv([row]);
        var lines = csv.Split('\n');

        Assert.Equal(Golden.Header, lines[0]);
        Assert.Equal(Golden.ExpectedCsvRow, lines[1]);
    }

    internal sealed record CsvGolden(string Header, string[] HeaderLabels, CsvSample Sample, string ExpectedCsvRow);

    internal sealed record CsvSample(
        string Email,
        string Type,
        string OrganizationName,
        string RoleSlug,
        string Status,
        string SentAt,
        string ExpiresAt,
        string AcceptedAt);
}
