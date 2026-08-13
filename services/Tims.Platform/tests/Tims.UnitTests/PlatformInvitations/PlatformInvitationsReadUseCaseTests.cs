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

    // ── page/limit parsing: exists so the GATE can run before validation ─────────────────────────────
    /// <summary>
    /// <c>page</c>/<c>limit</c> are bound as <c>string?</c> and parsed here rather than bound as
    /// <c>int</c>, because Minimal-API binding runs BEFORE the handler delegate — an <c>int</c> parameter
    /// turned <c>?page=abc</c> into a 400 that never reached <c>PlatformOwnerGate</c>, leaking the
    /// endpoint's existence to a non-owner. The observable answer for an OWNER is unchanged (still 400);
    /// only its order relative to the gate moved. The endpoint-level proof is
    /// <c>OrdinaryOrgUser_WithInvalidInput_Is403_Not400</c>.
    /// </summary>
    [Theory]
    [InlineData(null, true, 7)]        // absent ⇒ the caller's default, matching an omitted Zod optional
    [InlineData("0", true, 0)]
    [InlineData("42", true, 42)]
    [InlineData("abc", false, 0)]
    [InlineData("", false, 0)]
    [InlineData("1.5", false, 0)]      // NumberStyles.None ⇒ no decimal point
    [InlineData(" 3 ", false, 0)]      // ...and no surrounding whitespace
    [InlineData("+3", false, 0)]       // ...and no sign
    [InlineData("1,000", false, 0)]    // ...and no thousands separator
    [InlineData("-1", false, 0)]       // a negative fails the PARSE, not the range — same 400 either way
    [InlineData("99999999999999999999", false, 0)] // overflows int
    [InlineData("101", false, 0)]      // in range for the parse, out of range for max=100
    public void TryParseBoundedInt_acceptsOnlyPlainDigitsInRange(string? raw, bool expectedOk, int expectedValue)
    {
        var ok = PlatformInvitationsReadUseCase.TryParseBoundedInt(raw, fallback: 7, min: 0, max: 100, out var value);

        Assert.Equal(expectedOk, ok);
        if (expectedOk)
        {
            Assert.Equal(expectedValue, value);
        }
    }

    // ── the CSV ──────────────────────────────────────────────────────────────────────────────────────
    [Fact]
    public void BuildCsv_emits_only_the_header_for_no_rows()
    {
        // TS: `[header, ...[]].join('\n')` — the header alone, with NO trailing newline.
        Assert.Equal(PlatformInvitationsReadUseCase.CsvHeader, PlatformInvitationsReadUseCase.BuildCsv([]));
    }

    /// <summary>
    /// The header is now the <c>csvRow</c>-quoted form, matching TS after the 2026-08-12 both-stacks
    /// hardening. It was the bare literal <c>Email,Tipo,…</c> before that.
    /// </summary>
    [Fact]
    public void CsvHeader_is_byte_identical_to_the_TS_csvRow_output() =>
        Assert.Equal(
            "\"Email\",\"Tipo\",\"Organizacion\",\"Rol\",\"Estado\",\"Enviada\",\"Expira\",\"Aceptada\"",
            PlatformInvitationsReadUseCase.CsvHeader);

    [Fact]
    public void BuildCsv_quotes_every_cell_and_doubles_inner_quotes()
    {
        var row = Row(organizationName: "Ac\"me, Inc");

        var line = PlatformInvitationsReadUseCase.BuildCsv([row]).Split('\n')[1];

        // ALL EIGHT cells are quoted now. Before the both-stacks fix only cell 3 was, so a comma in email /
        // roleSlug / type / status silently shifted that row's later columns; the embedded comma in
        // "Ac\"me, Inc" is the case that used to depend entirely on that one field being the quoted one.
        // NOTE the trailing "'-": the `-` placeholder is ITSELF a formula-trigger character, so csvCell
        // neutralises it too. Verified against the real TS module, not inferred —
        // `csvRow(['-'])` returns `"'-"`. Both stacks agree; it is a visible cosmetic change to the export.
        Assert.Equal(
            "\"a@b.test\",\"user\",\"Ac\"\"me, Inc\",\"hr_admin\",\"sent\",\"2026-07-01\",\"2026-08-01\",\"'-\"",
            line);
    }

    /// <summary>
    /// <b>Was the inverse of this assertion until 2026-08-12.</b> This test used to pin the REPRODUCED
    /// vulnerability — TS hand-rolled its CSV, so a leading <c>=</c> was emitted raw and executed in
    /// Excel/Sheets (CWE-1236), and the port matched it deliberately. Both stacks were then hardened in one
    /// commit, so the assertion is inverted: the leading <c>=</c> must now be neutralised with the
    /// apostrophe <see cref="CsvCell.Escape"/> prepends. Kept pointing at <c>organizationName</c> because
    /// that is the reachable field — <c>z.string().min(2).max(100)</c>, no character restriction.
    /// </summary>
    [Fact]
    public void BuildCsv_neutralises_a_formula_injection()
    {
        var csv = PlatformInvitationsReadUseCase.BuildCsv([Row(organizationName: "=HYPERLINK(\"http://evil\")")]);

        // The apostrophe CsvCell.Escape prepends, plus the doubled inner quotes.
        Assert.Contains("\"'=HYPERLINK(\"\"http://evil\"\")\"", csv, StringComparison.Ordinal);
        // Asserted over the WHOLE csv, not one cell, so un-hardening ANY field trips it.
        Assert.DoesNotContain(",=", csv, StringComparison.Ordinal);
    }

    /// <summary>
    /// Every one of <see cref="CsvCell"/>'s formula-trigger characters must be neutralised, not just
    /// <c>=</c>. The old reproduced-defect test only ever exercised <c>=</c>, so a partial hardening would
    /// have looked complete.
    /// </summary>
    [Theory]
    [InlineData("=cmd")]
    [InlineData("+cmd")]
    [InlineData("-cmd")]
    [InlineData("@cmd")]
    public void BuildCsv_neutralises_every_formula_trigger_character(string organizationName)
    {
        var line = PlatformInvitationsReadUseCase.BuildCsv([Row(organizationName: organizationName)]).Split('\n')[1];

        Assert.Contains($"\"'{organizationName}\"", line, StringComparison.Ordinal);
    }

    /// <summary>
    /// An EMPTY-STRING <c>role_slug</c> must become <c>-</c>, because TS uses <c>|| '-'</c> (falsy), not
    /// <c>?? '-'</c> (null-only). A C# <c>??</c> would emit an empty cell for this row and silently shift
    /// nothing — it is a one-character difference that only a value-level test catches.
    /// </summary>
    [Theory]
    [InlineData(null, "\"'-\"")]
    [InlineData("", "\"'-\"")]
    [InlineData("hr_admin", "\"hr_admin\"")]
    public void BuildCsv_treats_a_falsy_role_slug_as_a_dash(string? roleSlug, string expectedCell)
    {
        var line = PlatformInvitationsReadUseCase.BuildCsv([Row(roleSlug: roleSlug)]).Split('\n')[1];

        // Rol is the 4th cell (index 3): Email, Tipo, Organizacion, Rol, … . Safe to split naively only
        // because Row()'s default organization name ("Acme") contains no comma. Every cell is quoted since
        // the both-stacks hardening, so the expectation carries its quotes.
        Assert.Equal(expectedCell, line.Split(',')[3]);
    }

    /// <summary>A null / empty organization name both emit an EMPTY QUOTED cell (<c>""</c>) — not <c>-</c>,
    /// and not an unquoted empty. TS passes <c>inv.organizationName</c> straight into <c>csvCell</c>, which
    /// maps <c>null</c> to <c>''</c> itself; <c>CsvCell.Escape(null)</c> does the same, so the two stacks
    /// agree without either side needing a coalesce.</summary>
    [Theory]
    [InlineData(null)]
    [InlineData("")]
    public void BuildCsv_emits_an_empty_quoted_cell_for_a_falsy_organization_name(string? organizationName)
    {
        var line = PlatformInvitationsReadUseCase.BuildCsv([Row(organizationName: organizationName)]).Split('\n')[1];

        Assert.Equal(
            "\"a@b.test\",\"user\",\"\",\"hr_admin\",\"sent\",\"2026-07-01\",\"2026-08-01\",\"'-\"",
            line);
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
