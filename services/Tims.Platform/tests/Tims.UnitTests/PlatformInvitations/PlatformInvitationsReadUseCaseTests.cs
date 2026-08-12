using Tims.Application.PlatformInvitations;

namespace Tims.UnitTests.PlatformInvitations;

/// <summary>
/// Unit coverage for the pure parts of the slice-22 read use case (issue #75): the Zod bounds and the CSV
/// shaping. Everything here runs without a database or a web host; the gate, the wire serialisation and the
/// native-enum handling are covered by the integration tests, which is where they belong.
/// </summary>
public sealed class PlatformInvitationsReadUseCaseTests
{
    // ── the enum filters: an unknown value is INVALID, not ignored ───────────────────────────────────
    [Theory]
    [InlineData(null, true)]
    [InlineData("org_admin", true)]
    [InlineData("user", true)]
    [InlineData("admin", false)]
    [InlineData("ORG_ADMIN", false)] // z.enum is case-SENSITIVE
    [InlineData("", false)]
    public void IsValidType_matches_the_two_literal_enum_members(string? type, bool expected) =>
        Assert.Equal(expected, PlatformInvitationsReadUseCase.IsValidType(type));

    [Theory]
    [InlineData(null, true)]
    [InlineData("pending", true)]
    [InlineData("sent", true)]
    [InlineData("accepted", true)]
    [InlineData("expired", true)]
    [InlineData("revoked", true)]
    [InlineData("Sent", false)]
    [InlineData("cancelled", false)]
    [InlineData("", false)]
    public void IsValidStatus_matches_the_five_literal_enum_members(string? status, bool expected) =>
        Assert.Equal(expected, PlatformInvitationsReadUseCase.IsValidStatus(status));

    /// <summary>
    /// The five valid statuses are exactly the Prisma <c>InvitationStatus</c> members. Pinned as a SET so
    /// adding a sixth to the enum without updating the filter is visible here, and stated adjacent to the
    /// count: FIVE — pending, sent, accepted, expired, revoked.
    /// </summary>
    [Fact]
    public void The_status_enum_has_exactly_five_members()
    {
        string[] members = ["pending", "sent", "accepted", "expired", "revoked"];
        Assert.Equal(5, members.Length);
        Assert.All(members, m => Assert.True(PlatformInvitationsReadUseCase.IsValidStatus(m)));
    }

    // ── search: trim-then-emptiness, and the length bound applies to the RAW input ───────────────────
    [Theory]
    [InlineData(null, null)]
    [InlineData("", null)]
    [InlineData("   ", null)]
    [InlineData("\t\n", null)]
    [InlineData("acme", "acme")]
    [InlineData("  acme  ", "acme")]
    public void NormalizeSearch_trims_then_treats_blank_as_no_filter(string? input, string? expected) =>
        Assert.Equal(expected, PlatformInvitationsReadUseCase.NormalizeSearch(input));

    /// <summary>
    /// The <c>.max(100)</c> is checked against what the client SENT, before trimming — so 101 spaces is a
    /// 400 in TS even though it normalises to no filter at all. Folding the bound into
    /// <see cref="PlatformInvitationsReadUseCase.NormalizeSearch"/> would have turned that 400 into a 200.
    /// </summary>
    [Fact]
    public void IsValidSearch_bounds_the_raw_input_not_the_trimmed_one()
    {
        Assert.True(PlatformInvitationsReadUseCase.IsValidSearch(new string('a', 100)));
        Assert.False(PlatformInvitationsReadUseCase.IsValidSearch(new string('a', 101)));
        Assert.False(PlatformInvitationsReadUseCase.IsValidSearch(new string(' ', 101)));
        Assert.True(PlatformInvitationsReadUseCase.IsValidSearch(null));
    }

    // ── the CSV ──────────────────────────────────────────────────────────────────────────────────────
    [Fact]
    public void BuildCsv_emits_only_the_header_for_no_rows()
    {
        // TS: `[header, ...[]].join('\n')` — the header alone, with NO trailing newline.
        Assert.Equal(PlatformInvitationsReadUseCase.CsvHeader, PlatformInvitationsReadUseCase.BuildCsv([]));
    }

    [Fact]
    public void CsvHeader_is_byte_identical_to_the_TS_literal() =>
        Assert.Equal("Email,Tipo,Organizacion,Rol,Estado,Enviada,Expira,Aceptada", PlatformInvitationsReadUseCase.CsvHeader);

    [Fact]
    public void BuildCsv_quotes_only_the_organization_name_and_doubles_inner_quotes()
    {
        var row = Row(organizationName: "Ac\"me, Inc");

        var line = PlatformInvitationsReadUseCase.BuildCsv([row]).Split('\n')[1];

        // Only cell 3 is quoted. email/type/status are raw, exactly as the TS hand-rolled row builder emits.
        Assert.Equal("a@b.test,user,\"Ac\"\"me, Inc\",hr_admin,sent,2026-07-01,2026-08-01,-", line);
    }

    /// <summary>
    /// <b>Pins a reproduced vulnerability on purpose.</b> The TS export does not use <c>csvCell</c>, so a
    /// leading <c>=</c> is emitted raw and executes in Excel/Sheets (CWE-1236). The port must match. If
    /// someone hardens the C# side alone, this fails — which is the intended forcing function, because the
    /// fix belongs in both stacks in one change and is filed as its own issue.
    /// </summary>
    [Fact]
    public void BuildCsv_does_NOT_neutralise_a_formula_injection_because_TS_does_not()
    {
        var csv = PlatformInvitationsReadUseCase.BuildCsv([Row(organizationName: "=HYPERLINK(\"http://evil\")")]);

        Assert.Contains("\"=HYPERLINK(", csv, StringComparison.Ordinal);
        // The apostrophe CsvCell.Escape would have prepended. Asserted over the WHOLE csv, not one cell, so
        // hardening any field trips it.
        Assert.DoesNotContain("'=", csv, StringComparison.Ordinal);
    }

    /// <summary>
    /// An EMPTY-STRING <c>role_slug</c> must become <c>-</c>, because TS uses <c>|| '-'</c> (falsy), not
    /// <c>?? '-'</c> (null-only). A C# <c>??</c> would emit an empty cell for this row and silently shift
    /// nothing — it is a one-character difference that only a value-level test catches.
    /// </summary>
    [Theory]
    [InlineData(null, "-")]
    [InlineData("", "-")]
    [InlineData("hr_admin", "hr_admin")]
    public void BuildCsv_treats_a_falsy_role_slug_as_a_dash(string? roleSlug, string expectedCell)
    {
        var line = PlatformInvitationsReadUseCase.BuildCsv([Row(roleSlug: roleSlug)]).Split('\n')[1];

        // Rol is the 4th cell (index 3): email, Tipo, "Organizacion", Rol, … . Safe to split naively here
        // only because Row()'s default organization name contains no comma — which is exactly the TS defect
        // this port reproduces, and why the byte-for-byte assertions above use a full-line comparison.
        Assert.Equal(expectedCell, line.Split(',')[3]);
    }

    /// <summary>A null / empty organization name both emit an EMPTY QUOTED cell (<c>""</c>), because the TS
    /// falls back to <c>''</c> and then quotes it — not <c>-</c>, and not an unquoted empty.</summary>
    [Theory]
    [InlineData(null)]
    [InlineData("")]
    public void BuildCsv_emits_an_empty_quoted_cell_for_a_falsy_organization_name(string? organizationName)
    {
        var line = PlatformInvitationsReadUseCase.BuildCsv([Row(organizationName: organizationName)]).Split('\n')[1];

        Assert.Equal("a@b.test,user,\"\",hr_admin,sent,2026-07-01,2026-08-01,-", line);
    }

    [Theory]
    [InlineData(null, "-")]
    [InlineData("2026-07-01T23:59:59.999", "2026-07-01")]
    [InlineData("2026-01-05T00:00:00.000", "2026-01-05")]
    public void FormatCsvDate_is_the_UTC_date_part_or_a_dash(string? iso, string expected)
    {
        DateTime? value = iso is null ? null : DateTime.Parse(iso, System.Globalization.CultureInfo.InvariantCulture);

        Assert.Equal(expected, PlatformInvitationsReadUseCase.FormatCsvDate(value));
    }

    /// <summary>
    /// <b>The date must NOT be shifted by the host's timezone.</b> <c>timestamp without time zone</c> yields
    /// <see cref="DateTimeKind.Unspecified"/>, and TS reads the same naked value as a UTC instant, so the
    /// stored date part IS the emitted date part. A <c>ToUniversalTime()</c> in the formatter would move
    /// 00:30 on the 2nd back to the 1st on any host west of UTC — green on a UTC CI box, wrong in Bogotá.
    /// Asserted with an <c>Unspecified</c> value just after midnight, which is exactly where a conversion
    /// changes the day.
    /// </summary>
    [Fact]
    public void FormatCsvDate_does_not_shift_the_day_for_an_unspecified_kind_just_after_midnight()
    {
        var justAfterMidnight = new DateTime(2026, 7, 2, 0, 30, 0, DateTimeKind.Unspecified);

        Assert.Equal("2026-07-02", PlatformInvitationsReadUseCase.FormatCsvDate(justAfterMidnight));
    }

    [Fact]
    public void BuildCsv_joins_rows_with_a_newline_and_never_a_trailing_one()
    {
        var csv = PlatformInvitationsReadUseCase.BuildCsv([Row(), Row(), Row()]);

        Assert.Equal(4, csv.Split('\n').Length); // header + 3
        Assert.False(csv.EndsWith('\n'));
    }

    private static PlatformInvitationExportRow Row(
        string email = "a@b.test",
        string type = "user",
        string? organizationName = "Acme",
        string? roleSlug = "hr_admin",
        string status = "sent") =>
        new(
            email,
            type,
            organizationName,
            roleSlug,
            status,
            new DateTime(2026, 7, 1, 8, 0, 0, DateTimeKind.Unspecified),
            new DateTime(2026, 8, 1, 0, 0, 0, DateTimeKind.Unspecified),
            null);
}
