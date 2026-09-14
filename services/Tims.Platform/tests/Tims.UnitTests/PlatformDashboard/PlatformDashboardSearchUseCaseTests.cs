using Tims.Application.PlatformDashboard;

namespace Tims.UnitTests.PlatformDashboard;

/// <summary>
/// Unit coverage for the <c>search</c> kernel (Phase-5 slice 23 / issue #81, PR 2 of 3) — the Zod bounds,
/// the JS-exact trim, and the static-page match rule with its lower-case asymmetry.
///
/// <para>Every invisible character below is written as a <c>\uXXXX</c> escape, deliberately. An earlier
/// draft embedded the real code points; U+0085 is a LINE BREAK to most tooling, so a raw one inside a
/// string literal silently split the source line and would not have compiled.</para>
/// </summary>
public sealed class PlatformDashboardSearchUseCaseTests
{
    // ── z.string().min(1).max(100), applied to the RAW input ────────────────────────────────────────
    [Fact]
    public void IsValidQuery_rejects_missing_and_empty_and_over_long()
    {
        Assert.False(PlatformDashboardSearchUseCase.IsValidQuery(null));
        Assert.False(PlatformDashboardSearchUseCase.IsValidQuery(string.Empty));
        Assert.False(PlatformDashboardSearchUseCase.IsValidQuery(new string('a', 101)));

        Assert.True(PlatformDashboardSearchUseCase.IsValidQuery("a"));
        Assert.True(PlatformDashboardSearchUseCase.IsValidQuery(new string('a', 100)));
    }

    [Fact]
    public void IsValidQuery_accepts_whitespace_because_Zod_runs_BEFORE_the_trim()
    {
        // "   " is three characters, so it satisfies min(1) and is a 200 with three empty arrays — NOT a
        // 400. Validating the trimmed value instead would turn that into a bad request.
        Assert.True(PlatformDashboardSearchUseCase.IsValidQuery("   "));
    }

    // ── JS String.prototype.trim(), which differs from string.Trim() in both directions ─────────────
    [Fact]
    public void JsTrim_strips_the_ASCII_and_Unicode_space_separators()
    {
        Assert.Equal("acme", PlatformDashboardSearchUseCase.JsTrim("  acme  "));
        Assert.Equal("acme", PlatformDashboardSearchUseCase.JsTrim("\t\r\n acme   "));
        Assert.Equal("acme", PlatformDashboardSearchUseCase.JsTrim("\u00A0\u3000acme\u2028"));
        Assert.Equal(string.Empty, PlatformDashboardSearchUseCase.JsTrim("   "));
        Assert.Equal("a c", PlatformDashboardSearchUseCase.JsTrim(" a c ")); // interior space untouched
    }

    [Fact]
    public void JsTrim_strips_U_FEFF_which_string_Trim_does_NOT()
    {
        const string withBom = "\uFEFFacme\uFEFF";

        // ECMA-262 lists U+FEFF in its WhiteSpace production; .NET does not consider it whitespace at
        // all, so string.Trim() would leave a query TS reads as "acme" with the BOM still attached — a
        // different ILIKE pattern, and a different result set.
        Assert.Equal("acme", PlatformDashboardSearchUseCase.JsTrim(withBom));
        Assert.NotEqual("acme", withBom.Trim());
    }

    [Fact]
    public void JsTrim_KEEPS_U_0085_which_string_Trim_would_strip()
    {
        const string withNel = "acme\u0085";

        // U+0085 (NEXT LINE) is neither WhiteSpace nor a LineTerminator in ECMA-262, so JS keeps it.
        // The divergence bites hardest at the emptiness check: a lone U+0085 is a NON-empty query in TS
        // (it reaches the database and matches nothing), but string.Trim() would reduce it to "" and take
        // the early-return path with three empty arrays instead.
        Assert.Equal(withNel, PlatformDashboardSearchUseCase.JsTrim(withNel));
        Assert.Equal("acme", withNel.Trim());
        Assert.NotEmpty(PlatformDashboardSearchUseCase.JsTrim("\u0085"));
        Assert.Empty("\u0085".Trim());
    }

    // ── the static page match ───────────────────────────────────────────────────────────────────────
    [Fact]
    public void MatchPages_matches_on_the_lowercased_NAME()
    {
        var pages = PlatformDashboardSearchUseCase.MatchPages("organiza");

        Assert.Equal("Organizaciones", Assert.Single(pages).Name);
    }

    [Fact]
    public void MatchPages_matches_a_substring_of_the_KEYWORD_string_across_word_boundaries()
    {
        // `keywords.includes(ql)` is a plain substring test over the whole string, so a query spanning
        // two keywords still matches: "orgs empresas clients".
        var pages = PlatformDashboardSearchUseCase.MatchPages("gs emp");

        Assert.Equal("Organizaciones", Assert.Single(pages).Name);
    }

    /// <summary>
    /// The QUERY is lowercased for both legs; only the KEYWORDS side skips lowercasing its own value.
    ///
    /// <para>So an upper-case query still matches a lowercase keyword — the asymmetry is invisible today
    /// precisely because every keyword string is already lowercase. It would surface the moment one
    /// gained a capital: that keyword could never be matched by any query, since the query is always
    /// folded down before the comparison. Reproduced, not fixed.</para>
    /// </summary>
    [Fact]
    public void MatchPages_lowercases_the_QUERY_for_both_legs_and_the_NAME_only_on_its_own_side()
    {
        // Name leg: the page name is folded before the test.
        Assert.Equal("Salud del Sistema", Assert.Single(PlatformDashboardSearchUseCase.MatchPages("SALUD")).Name);

        // Keyword leg: "uptime" appears only in a KEYWORD string, and an upper-case query still finds it,
        // because `ql` is already lowercase by the time either leg runs.
        Assert.Equal("Salud del Sistema", Assert.Single(PlatformDashboardSearchUseCase.MatchPages("UPTIME")).Name);
        Assert.Equal("Salud del Sistema", Assert.Single(PlatformDashboardSearchUseCase.MatchPages("uptime")).Name);

        // The consequence of the missing fold on the keyword side, stated directly: matching is
        // case-insensitive in the query but case-SENSITIVE in the stored keyword.
        Assert.All(
            PlatformDashboardSearchUseCase.SearchPages,
            p => Assert.Equal(p.Keywords, p.Keywords.ToLowerInvariant()));
    }

    [Fact]
    public void MatchPages_caps_at_four_even_when_more_match()
    {
        var pages = PlatformDashboardSearchUseCase.MatchPages("a");

        Assert.Equal(PlatformDashboardSearchUseCase.PageTake, pages.Count);
        // The cap is applied AFTER filtering, in SEARCH_PAGES order — so the first match wins, and the
        // first page whose lowercased NAME contains "a" is "Dashboard".
        Assert.Equal("Dashboard", pages[0].Name);
    }

    [Fact]
    public void MatchPages_returns_the_FULL_entry_including_the_internal_keywords_string()
    {
        var page = Assert.Single(PlatformDashboardSearchUseCase.MatchPages("feature flags"));

        // TS returns the SEARCH_PAGES objects unchanged, so `keywords` ships to the client.
        Assert.Equal("Feature Flags", page.Name);
        Assert.Equal("/platform/feature-flags", page.Href);
        Assert.Equal("flags toggles features modulos", page.Keywords);
    }

    [Fact]
    public void MatchPages_onNoMatch_isEmpty()
    {
        Assert.Empty(PlatformDashboardSearchUseCase.MatchPages("zzzzzz"));
    }

    // ── the whitespace-only early return ────────────────────────────────────────────────────────────
    [Fact]
    public async Task SearchAsync_onAWhitespaceOnlyQuery_returns_three_empty_arrays_without_querying()
    {
        var repository = new ThrowingSearchRepository();
        var useCase = new PlatformDashboardSearchUseCase(repository);

        var result = await useCase.SearchAsync("   ", CancellationToken.None);

        // The repository throws if touched — proving the early return happens BEFORE any database work,
        // which is what `if (!q) return …` does in TS.
        Assert.Empty(result.Organizations);
        Assert.Empty(result.Users);
        Assert.Empty(result.Pages);
    }

    [Fact]
    public async Task SearchAsync_queries_with_the_TRIMMED_term()
    {
        var repository = new RecordingSearchRepository();
        var useCase = new PlatformDashboardSearchUseCase(repository);

        await useCase.SearchAsync("  acme  ", CancellationToken.None);

        // Both legs receive the trimmed value — TS builds its `contains` filter from `q`, not `input.query`.
        Assert.Equal("acme", repository.OrganizationTerm);
        Assert.Equal("acme", repository.UserTerm);
        Assert.Equal(PlatformDashboardSearchUseCase.RowTake, repository.Take);
    }

    private sealed class ThrowingSearchRepository : IPlatformDashboardSearchRepository
    {
        public Task<IReadOnlyList<SearchOrganizationItem>> SearchOrganizationsAsync(string term, int take, CancellationToken cancellationToken) =>
            throw new InvalidOperationException("the empty-query path must not reach the database");

        public Task<IReadOnlyList<SearchUserItem>> SearchUsersAsync(string term, int take, CancellationToken cancellationToken) =>
            throw new InvalidOperationException("the empty-query path must not reach the database");
    }

    private sealed class RecordingSearchRepository : IPlatformDashboardSearchRepository
    {
        public string? OrganizationTerm { get; private set; }

        public string? UserTerm { get; private set; }

        public int Take { get; private set; }

        public Task<IReadOnlyList<SearchOrganizationItem>> SearchOrganizationsAsync(string term, int take, CancellationToken cancellationToken)
        {
            OrganizationTerm = term;
            Take = take;
            return Task.FromResult<IReadOnlyList<SearchOrganizationItem>>([]);
        }

        public Task<IReadOnlyList<SearchUserItem>> SearchUsersAsync(string term, int take, CancellationToken cancellationToken)
        {
            UserTerm = term;
            Take = take;
            return Task.FromResult<IReadOnlyList<SearchUserItem>>([]);
        }
    }
}
