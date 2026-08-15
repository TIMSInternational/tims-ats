namespace Tims.Application.PlatformDashboard;

/// <summary>
/// The platform global <c>search</c> (Phase-5 slice 23 / issue #81, PR 2 of 3) — organizations, users and
/// static navigation pages for one term.
///
/// <para><b>The only procedure in the cluster with an input</b>, so it is the only one where TRAP 9
/// applies: the minimal-API binder runs BEFORE the handler, so a required non-nullable parameter would
/// 400 an unauthenticated caller before <c>PlatformOwnerGate</c> ever ran, inverting the tRPC order
/// (middleware, then Zod). The endpoint therefore binds <c>string?</c> and validates HERE, after the gate.
/// </para>
/// </summary>
public sealed class PlatformDashboardSearchUseCase(IPlatformDashboardSearchRepository repository)
{
    /// <summary><c>take: 5</c> on both database queries.</summary>
    public const int RowTake = 5;

    /// <summary><c>.slice(0, 4)</c> on the matched static pages — a different cap from the rows.</summary>
    public const int PageTake = 4;

    /// <summary><c>z.string().min(1).max(100)</c>, applied to the RAW input before any trimming: a
    /// hundred-and-one-character query is a 400, but a query of three spaces is valid and simply matches
    /// nothing.</summary>
    public const int MinQueryLength = 1;

    public const int MaxQueryLength = 100;

    /// <summary>
    /// <c>SEARCH_PAGES</c> (<c>dashboard.helpers.ts:171</c>), verbatim and in order. Both stacks pin this
    /// list against <c>searchPages</c> in <c>contracts/dashboard-fixtures/dashboard-kernels.json</c> —
    /// it is duplicated source-of-truth whose whole observable behaviour is which strings it contains, so
    /// a keyword added on one side only is exactly the drift a golden exists to catch.
    /// </summary>
    public static readonly IReadOnlyList<SearchPage> SearchPages =
    [
        new("Dashboard", "/dashboard", "inicio home panel"),
        new("Organizaciones", "/platform/organizations", "orgs empresas clients"),
        new("Suscripciones", "/platform/subscriptions", "billing planes pagos facturacion stripe"),
        new("Usuarios", "/platform/users", "users personas cuentas"),
        new("Salud del Sistema", "/platform/health", "health status uptime monitoreo"),
        new("Feature Flags", "/platform/feature-flags", "flags toggles features modulos"),
        new("Agentes IA", "/platform/ai-agents", "ai agents bedrock claude haiku sonnet inteligencia artificial agentes"),
        new("Analytics", "/platform/analytics", "metricas estadisticas growth crecimiento"),
        new("Auditoria", "/platform/audit", "audit logs registro actividad"),
        new("Soporte", "/platform/support", "support ayuda impersonar reset"),
        new("Facturas", "/platform/invoices", "invoices facturas pagos billing cobros"),
        new("Invitaciones", "/platform/invitations", "invitations invitaciones onboarding invite"),
    ];

    /// <summary><c>z.string().min(1).max(100)</c>. Length is measured in UTF-16 code units on both sides
    /// (JS <c>String.length</c>, .NET <c>string.Length</c>), so an astral character counts as two in both.
    /// </summary>
    public static bool IsValidQuery(string? query) =>
        query is not null && query.Length >= MinQueryLength && query.Length <= MaxQueryLength;

    public async Task<PlatformDashboardSearchResult> SearchAsync(string query, CancellationToken cancellationToken)
    {
        var term = JsTrim(query);

        // `if (!q) return { organizations: [], users: [], pages: [] }` — an early return BEFORE any
        // query, so a whitespace-only search costs nothing and matches no page either.
        if (term.Length == 0)
        {
            return new PlatformDashboardSearchResult([], [], []);
        }

        var organizations = await repository.SearchOrganizationsAsync(term, RowTake, cancellationToken).ConfigureAwait(false);
        var users = await repository.SearchUsersAsync(term, RowTake, cancellationToken).ConfigureAwait(false);

        return new PlatformDashboardSearchResult(organizations, users, MatchPages(term));
    }

    /// <summary>
    /// <c>SEARCH_PAGES.filter(p =&gt; p.name.toLowerCase().includes(ql) || p.keywords.includes(ql)).slice(0, 4)</c>.
    ///
    /// <para>Note the ASYMMETRY, reproduced: the NAME is lower-cased before matching, the KEYWORDS are
    /// not. The keyword strings happen to be all-lowercase already, so this is currently invisible — but
    /// a keyword list that ever gained a capital letter would become unmatchable, and that is TS's
    /// behaviour to keep, not to fix inside a port.</para>
    ///
    /// <para><c>includes</c> is a substring test over the WHOLE keyword string, not a word test, so the
    /// query <c>"gs emp"</c> matches "Organizaciones" through <c>"orgs empresas clients"</c>.</para>
    /// </summary>
    public static IReadOnlyList<SearchPage> MatchPages(string term)
    {
        var lowered = term.ToLowerInvariant();

        return SearchPages
            .Where(p => p.Name.ToLowerInvariant().Contains(lowered, StringComparison.Ordinal)
                || p.Keywords.Contains(lowered, StringComparison.Ordinal))
            .Take(PageTake)
            .ToList();
    }

    /// <summary>
    /// JS <c>String.prototype.trim()</c>, which is NOT <see cref="string.Trim()"/>.
    ///
    /// <para>The two whitespace sets differ in BOTH directions, and either difference turns a query one
    /// stack treats as empty (early return, three empty arrays) into one the other runs against the
    /// database:</para>
    /// <list type="bullet">
    /// <item>.NET strips <c>U+0085</c> (NEXT LINE). ECMA-262 does not — it is neither
    /// <c>WhiteSpace</c> nor a <c>LineTerminator</c>.</item>
    /// <item>ECMA-262 strips <c>U+FEFF</c> (ZERO WIDTH NO-BREAK SPACE / BOM), which is explicitly listed
    /// in its <c>WhiteSpace</c> production. .NET does not consider it whitespace at all.</item>
    /// </list>
    /// <para>Every other member coincides: .NET's whitespace set minus <c>U+0085</c> is exactly ECMA's
    /// <c>WhiteSpace</c> ∪ <c>LineTerminator</c> (the ASCII controls U+0009–U+000D, SPACE, NBSP, every
    /// Space_Separator, and U+2028/U+2029).</para>
    /// </summary>
    public static string JsTrim(string value)
    {
        var start = 0;
        var end = value.Length;

        while (start < end && IsJsWhiteSpace(value[start]))
        {
            start++;
        }

        while (end > start && IsJsWhiteSpace(value[end - 1]))
        {
            end--;
        }

        return value[start..end];
    }

    private static bool IsJsWhiteSpace(char c) =>
        (char.IsWhiteSpace(c) && c != '\u0085') || c == '\uFEFF';
}
