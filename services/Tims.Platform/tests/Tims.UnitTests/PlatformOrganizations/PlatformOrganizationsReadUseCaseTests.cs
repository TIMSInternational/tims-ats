using Tims.Application.PlatformOrganizations;

namespace Tims.UnitTests.PlatformOrganizations;

/// <summary>
/// Phase-5 slice 19 (issue #76) — the pure input-handling rules of the platform organizations READ
/// surface, pinned against the Zod schema they port (<c>routers/platform/organizations.ts:32-41</c>).
///
/// <para>These assert the boundary that is easy to get subtly wrong in a port: which inputs are
/// DEFAULTED and which are REJECTED. tRPC validates with Zod and throws BAD_REQUEST on an out-of-range
/// value; clamping instead would silently accept input the TS side refuses, and no parity fixture would
/// catch it because the TS side never produces such a response to diff against.</para>
/// </summary>
public class PlatformOrganizationsReadUseCaseTests
{
    private static PlatformOrganizationListQuery Query(
        int page = 0,
        int limit = 20,
        string? search = null,
        string? plan = null,
        string? status = null,
        string? sortBy = null,
        string? sortDir = null) =>
        new(null, page, limit, search, plan, status, sortBy, sortDir);

    // ── Defaults (what Zod fills in) ──────────────────────────────────────────────────────────────

    [Fact]
    public void NormalizeListQuery_applies_the_Zod_defaults_for_page_and_limit()
    {
        var normalized = PlatformOrganizationsReadUseCase.NormalizeListQuery(Query(page: -1, limit: 0));

        Assert.Equal(PlatformOrganizationsReadUseCase.DefaultPage, normalized.Page);
        Assert.Equal(PlatformOrganizationsReadUseCase.DefaultLimit, normalized.Limit);
    }

    [Fact]
    public void NormalizeListQuery_keeps_valid_values_untouched()
    {
        var normalized = PlatformOrganizationsReadUseCase.NormalizeListQuery(Query(page: 3, limit: 50));

        Assert.Equal(3, normalized.Page);
        Assert.Equal(50, normalized.Limit);
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    public void NormalizeListQuery_treats_blank_filters_as_absent(string blank)
    {
        // TS: `if (search)` / `if (plan)` — an empty string is falsy there, so it must not become a
        // filter here either. A blank `search` that reached the query would ILIKE '%%' and match nothing
        // meaningful while looking like a deliberate filter.
        var normalized = PlatformOrganizationsReadUseCase.NormalizeListQuery(Query(search: blank, plan: blank, status: blank));

        Assert.Null(normalized.Search);
        Assert.Null(normalized.Plan);
        Assert.Null(normalized.Status);
    }

    // ── Validation (what Zod REJECTS — endpoint returns 400, it does not clamp) ────────────────────

    [Theory]
    [InlineData(null)]
    [InlineData("name")]
    [InlineData("plan")]
    [InlineData("createdAt")]
    [InlineData("users")]
    public void IsValidSortBy_accepts_absent_and_the_four_sortable_fields(string? sortBy) =>
        Assert.True(PlatformOrganizationsReadUseCase.IsValidSortBy(sortBy));

    [Theory]
    [InlineData("id")]
    [InlineData("createdat")] // case-sensitive, like the Zod enum
    [InlineData("users; DROP TABLE organizations")]
    public void IsValidSortBy_rejects_anything_outside_the_enum(string sortBy) =>
        Assert.False(PlatformOrganizationsReadUseCase.IsValidSortBy(sortBy));

    [Theory]
    [InlineData(null)]
    [InlineData("asc")]
    [InlineData("desc")]
    public void IsValidSortDir_accepts_absent_asc_and_desc(string? sortDir) =>
        Assert.True(PlatformOrganizationsReadUseCase.IsValidSortDir(sortDir));

    [Theory]
    [InlineData("ASC")]
    [InlineData("ascending")]
    public void IsValidSortDir_rejects_anything_else(string sortDir) =>
        Assert.False(PlatformOrganizationsReadUseCase.IsValidSortDir(sortDir));

    // ── The bounds themselves, pinned as constants ────────────────────────────────────────────────

    [Fact]
    public void The_Zod_bounds_are_reproduced_exactly()
    {
        // If any of these drift from routers/platform/organizations.ts:32-41 the port silently accepts
        // or refuses input the TS side does not. Pinned here so a change is a deliberate edit.
        Assert.Equal(0, PlatformOrganizationsReadUseCase.DefaultPage);
        Assert.Equal(20, PlatformOrganizationsReadUseCase.DefaultLimit);
        Assert.Equal(1, PlatformOrganizationsReadUseCase.MinLimit);
        Assert.Equal(50, PlatformOrganizationsReadUseCase.MaxLimit);
        Assert.Equal(200, PlatformOrganizationsReadUseCase.MaxSearchLength);
        Assert.Equal(50, PlatformOrganizationsReadUseCase.MaxPlanLength);
        Assert.Equal(50, PlatformOrganizationsReadUseCase.MaxStatusLength);
    }
}
