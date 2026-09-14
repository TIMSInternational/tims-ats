namespace Tims.Application.PlatformDashboard;

// Read models for `search` (routers/platform/dashboard.ts:405) — Phase-5 slice 23, issue #81, PR 2 of 3.
// The ONLY procedure in the dashboard cluster that declares an input, and therefore the only one in this
// slice with a 400 matrix.

/// <summary>One matched organization — <c>{ id, name, slug, plan, isActive }</c>.</summary>
public sealed record SearchOrganizationItem(string Id, string Name, string Slug, string Plan, bool IsActive);

/// <summary>The nested <c>organization</c> on a matched user. Prisma selects ONLY <c>name</c>, so this
/// record has exactly one property; the whole object is <c>null</c> for an org-less user (a platform
/// owner), and the key is always present.</summary>
public sealed record SearchUserOrganization(string Name);

/// <summary>One matched user. <c>Avatar</c> and <c>Organization</c> are nullable and carry NO
/// <c>JsonIgnore</c>: Prisma emits both keys with a <c>null</c> value, and superjson's <c>json</c> payload
/// keeps them, so omitting either would diff.</summary>
public sealed record SearchUserItem(
    string Id,
    string FirstName,
    string LastName,
    string Email,
    bool IsPlatformOwner,
    bool IsActive,
    string? Avatar,
    SearchUserOrganization? Organization);

/// <summary>One matched navigation page — the FULL static entry, <c>{ name, href, keywords }</c>. TS
/// returns the <c>SEARCH_PAGES</c> objects unchanged, so <c>keywords</c> (an internal match string) ships
/// to the client too.</summary>
public sealed record SearchPage(string Name, string Href, string Keywords);

/// <summary>The <c>search</c> payload — <c>{ organizations, users, pages }</c>. All three are empty arrays
/// when the trimmed query is empty, which is an EARLY RETURN in TS: no database round trip at all.
/// </summary>
public sealed record PlatformDashboardSearchResult(
    IReadOnlyList<SearchOrganizationItem> Organizations,
    IReadOnlyList<SearchUserItem> Users,
    IReadOnlyList<SearchPage> Pages);
