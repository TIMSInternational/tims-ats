using System.Globalization;
using System.Text;

namespace Tims.Application.PlatformInvitations;

/// <summary>
/// The platform-owner invitations READ use case (Phase-5 slice 22, issue #75). Thin over
/// <see cref="IPlatformInvitationsReadRepository"/>; what genuinely lives here is (a) the Zod bounds, as
/// constants and predicates the endpoint calls, and (b) the CSV shaping — both pure, so both unit-test
/// without booting a web host.
/// </summary>
public sealed class PlatformInvitationsReadUseCase(IPlatformInvitationsReadRepository repository)
{
    /// <summary>Zod: <c>z.number().int().min(0).default(0)</c> (<c>listInvitations</c> input).</summary>
    public const int DefaultPage = 0;

    /// <summary>Zod: <c>z.number().int().min(1).max(50).default(20)</c>.</summary>
    public const int DefaultLimit = 20;

    /// <summary>Zod <c>.min(1)</c> on <c>limit</c>.</summary>
    public const int MinLimit = 1;

    /// <summary>Zod <c>.max(50)</c> on <c>limit</c> — NOT the 100 that <c>listOrganizations</c> uses.</summary>
    public const int MaxLimit = 50;

    /// <summary>Zod <c>.max(100)</c> on <c>search</c>.</summary>
    public const int MaxSearchLength = 100;

    /// <summary>
    /// <c>INVITATION_TYPE = z.enum(['org_admin', 'user'])</c> (<c>invitations.ts</c>, top of file).
    ///
    /// <para>An UNKNOWN value is a 400, not an ignored filter. That distinction is load-bearing and is the
    /// opposite of <c>listOrganizations</c>'s <c>status</c>, which is a tri-state that silently ignores
    /// anything but two literals. Here the filter goes through <c>z.enum(...).optional()</c>, so Zod
    /// rejects an unknown value before the resolver runs — reproducing "ignore it" would return a full
    /// unfiltered page where TS returns an error.</para>
    /// </summary>
    private static readonly HashSet<string> ValidTypes = new(StringComparer.Ordinal) { "org_admin", "user" };

    /// <summary><c>INVITATION_STATUS = z.enum(['pending','sent','accepted','expired','revoked'])</c>. Five
    /// values — the same set as the Prisma <c>InvitationStatus</c> enum.</summary>
    private static readonly HashSet<string> ValidStatuses =
        new(StringComparer.Ordinal) { "pending", "sent", "accepted", "expired", "revoked" };

    /// <summary>The <c>exportInvitationsCsv</c> header, byte-for-byte. Unaccented, as the TS is.</summary>
    public const string CsvHeader = "Email,Tipo,Organizacion,Rol,Estado,Enviada,Expira,Aceptada";

    /// <summary>
    /// A <c>page</c>/<c>limit</c> pair whose OFFSET cannot be expressed as an <see cref="int"/>.
    ///
    /// <para>Zod bounds <c>limit</c> at 50 but puts NO upper bound on <c>page</c>, so TS accepts
    /// <c>page: 2_000_000_000</c> and hands Prisma <c>skip: 100_000_000_000</c> — legal, because Postgres
    /// OFFSET is a bigint. EF Core's <c>Skip</c> takes an <see cref="int"/>, so the same input would
    /// overflow to a negative offset and throw. This constant marks the boundary where the port answers
    /// with an EMPTY page instead, which is not a divergence but the same answer Postgres gives: an OFFSET
    /// above the row count returns no rows, and <c>total</c> is computed independently of the offset so it
    /// stays exact. The reproduction is only inexact if <c>platform_invitations</c> ever holds more than
    /// <see cref="int.MaxValue"/> rows.</para>
    /// </summary>
    public const long MaxExpressibleOffset = int.MaxValue;

    public Task<PlatformInvitationKpis> GetKpisAsync(CancellationToken cancellationToken) =>
        repository.GetKpisAsync(cancellationToken);

    public static bool IsValidType(string? type) => type is null || ValidTypes.Contains(type);

    public static bool IsValidStatus(string? status) => status is null || ValidStatuses.Contains(status);

    /// <summary>
    /// Reproduces <c>if (search?.trim())</c> — TRIM FIRST, then test for emptiness, and treat a
    /// whitespace-only search as no filter at all rather than as a filter on the empty string.
    ///
    /// <para>The difference is observable: <c>ILIKE '%%'</c> matches every row including those whose email
    /// is NULL-free but empty, and more importantly it is a different SQL plan and a different
    /// <c>total</c> from "no predicate" in the presence of a NULL email. <c>platform_invitations.email</c>
    /// is NOT NULL today, so the two agree on row COUNT — but the guard is written to match TS's control
    /// flow rather than to rely on that column staying NOT NULL.</para>
    ///
    /// <para>Note the asymmetry with the C# default: <c>string.IsNullOrWhiteSpace</c> is the right test
    /// here, but the value passed to the query must be the TRIMMED one (TS passes
    /// <c>search.trim()</c>, not <c>search</c>), so a search of <c>"  acme  "</c> must query
    /// <c>%acme%</c>. Returning the trimmed value rather than a bool is what makes that hard to get
    /// wrong.</para>
    /// </summary>
    public static string? NormalizeSearch(string? search)
    {
        if (search is null)
        {
            return null;
        }

        var trimmed = search.Trim();
        return trimmed.Length == 0 ? null : trimmed;
    }

    /// <summary>
    /// The Zod <c>.max(100)</c> applies to the RAW input, before trimming — <c>z.string().max(100)</c> runs
    /// on what the client sent. A 120-character all-spaces search is a 400 in TS even though it trims to
    /// nothing, so the length check must not be folded into <see cref="NormalizeSearch"/>.
    /// </summary>
    public static bool IsValidSearch(string? search) => search is null || search.Length <= MaxSearchLength;

    public Task<PlatformInvitationListResult> ListAsync(
        PlatformInvitationListQuery query,
        CancellationToken cancellationToken) =>
        repository.ListAsync(query, cancellationToken);

    public async Task<PlatformInvitationExportResult> ExportAsync(
        PlatformInvitationExportQuery query,
        CancellationToken cancellationToken)
    {
        var rows = await repository.ExportAsync(query, cancellationToken).ConfigureAwait(false);
        return new PlatformInvitationExportResult(BuildCsv(rows), rows.Count);
    }

    /// <summary>
    /// Builds the CSV EXACTLY as <c>exportInvitationsCsv</c> does, which means deliberately NOT using
    /// <c>Tims.Domain.Csv.CsvCell</c>.
    ///
    /// <para><b>This is the single most counter-intuitive line of the slice, so it is spelled out.</b>
    /// <c>CsvCell.Row</c> is the port of <c>packages/shared/src/csv.ts</c> and it quotes EVERY cell plus
    /// neutralises a leading <c>=+-@</c> (CWE-1236 formula injection). The audit-log export uses it because
    /// its TS side uses <c>csvRow</c>. <c>exportInvitationsCsv</c> does NOT: it hand-rolls the row and
    /// quotes exactly ONE field, <c>organizationName</c>. <c>invitations.ts</c> imports only
    /// <c>getAppUrl</c> from <c>@tims/shared</c> — never <c>csvCell</c>. Using the shared helper here would
    /// emit <c>"a@b.com","user",…</c> where TS emits <c>a@b.com,user,…</c>: byte-different on every row of
    /// every export, i.e. a guaranteed parity FAIL.</para>
    ///
    /// <para><b>So this port reproduces two real TS defects, on purpose.</b> (1) No formula-injection
    /// defence on any field — a <c>roleSlug</c> or <c>email</c> beginning <c>=</c> executes when the file
    /// is opened in Excel or Sheets, which is exactly the CWE the shared helper exists to prevent, and this
    /// surface's data is attacker-influenced (<c>email</c> arrives from an unauthenticated-adjacent invite
    /// flow). (2) Only <c>organizationName</c> is quoted, so a comma in <c>email</c>, <c>roleSlug</c>,
    /// <c>type</c> or <c>status</c> silently shifts every later column of that row. Both are reproduced
    /// because a C#-only fix is invisible to users while the flag is dark and merely makes the parity diff
    /// uninterpretable — "the port is wrong" and "the port is deliberately better" become the same
    /// signal. Both are filed as their own issue; the fix belongs in BOTH stacks in one change, and it is
    /// the kind of divergence the strangler doc requires Federico to decide.</para>
    /// </summary>
    public static string BuildCsv(IReadOnlyList<PlatformInvitationExportRow> rows)
    {
        var builder = new StringBuilder(CsvHeader);
        foreach (var row in rows)
        {
            // TS `[...].join(',')` over the eight cells, then `[header, ...rows].join('\n')`.
            builder.Append('\n')
                .Append(row.Email)
                .Append(',')
                .Append(row.Type)
                // The ONE quoted field: `"${(inv.organizationName || '').replace(/"/g, '""')}"`. The `||`
                // is a FALSY check, so an empty string takes the fallback too — same emitted result (`""`)
                // as null, which is why this reads as a plain null-or-empty coalesce.
                .Append(",\"")
                .Append((row.OrganizationName ?? string.Empty).Replace("\"", "\"\"", StringComparison.Ordinal))
                .Append("\",")
                // `inv.roleSlug || '-'` — again FALSY, so an empty-string role_slug becomes "-" and not an
                // empty cell. `?? "-"` alone would be wrong for that row.
                .Append(string.IsNullOrEmpty(row.RoleSlug) ? "-" : row.RoleSlug)
                .Append(',')
                .Append(row.Status)
                .Append(',')
                .Append(FormatCsvDate(row.SentAt))
                .Append(',')
                .Append(FormatCsvDate(row.ExpiresAt))
                .Append(',')
                .Append(FormatCsvDate(row.AcceptedAt));
        }

        return builder.ToString();
    }

    /// <summary>
    /// TS <c>fmt = (d) =&gt; (d ? d.toISOString().split('T')[0] : '-')</c> — the UTC date part, or
    /// <c>'-'</c>.
    ///
    /// <para><b>Deliberately does NOT call <c>ToUniversalTime()</c>.</b> The columns are
    /// <c>timestamp without time zone</c>, so Npgsql yields <see cref="DateTimeKind.Unspecified"/> holding
    /// the stored wall-clock value, and Prisma reads that same naked timestamp as a UTC instant — meaning
    /// the TS <c>toISOString()</c> date part IS the stored date part. Converting here would shift by the
    /// host's offset and produce off-by-one-day cells on any machine west of UTC, while every unit test on
    /// a UTC CI box stayed green. <c>NodeIsoDateTimeConverter.ToNodeIso(DateTime)</c> omits the conversion
    /// for the same reason.</para>
    /// </summary>
    public static string FormatCsvDate(DateTime? value) =>
        value.HasValue ? value.Value.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture) : "-";
}
