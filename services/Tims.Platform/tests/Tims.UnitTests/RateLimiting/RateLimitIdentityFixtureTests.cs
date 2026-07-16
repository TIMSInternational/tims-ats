using Tims.Domain.RateLimiting;
using Tims.UnitTests.Fixtures;

namespace Tims.UnitTests.RateLimiting;

/// <summary>
/// Pins <see cref="RateLimitIdentity.For"/> to the shared golden fixture
/// (contracts/ratelimit-fixtures/identifier.json), the SAME cases the TS vitest suite asserts
/// against the mirrored trpc.ts identifier logic. Also carries the three REQUIRED historical-fix
/// regression tests as explicit facts so each one visibly BITES (a wrong impl goes red):
/// rl-xff-spoof-bucket, rl-per-apikey-quota, rl-ai-per-org-budget.
/// </summary>
public sealed class RateLimitIdentityFixtureTests
{
    private sealed record Root(string Description, List<Case> Cases);
    private sealed record Case(
        string Name,
        RateLimitCategory Category,
        string? UserId,
        string? OrganizationId,
        string? ApiKeyId,
        string? XRealIp,
        string? XForwardedFor,
        string Expected);

    private static readonly Root Data = Fx.Load<Root>("ratelimit-fixtures", "identifier.json");

    private static string Build(Case c) =>
        RateLimitIdentity.For(c.Category, c.UserId, c.OrganizationId, c.ApiKeyId, c.XRealIp, c.XForwardedFor);

    public static IEnumerable<object[]> Cases() => Fx.Rows(Data.Cases.Select(c => c.Name).ToList());

    [Theory]
    [MemberData(nameof(Cases))]
    public void Matches_golden_fixture(int index, string name)
    {
        var c = Data.Cases[index];
        Assert.Equal(name, c.Name);
        Assert.Equal(c.Expected, Build(c));
    }

    // --- Named regression tests (each MUST bite) ------------------------------------------

    [Fact]
    public void rl_xff_spoof_bucket_keys_on_last_hop_not_client_first_hop()
    {
        // No x-real-ip: the identifier is the LAST x-forwarded-for hop (trusted proxy), NEVER the
        // client-controlled first hop. An attacker rotating the first hop lands in the SAME bucket.
        var victim = RateLimitIdentity.AnonymousIdentifier(null, "1.1.1.1, 2.2.2.2");
        var attackerRotatedFirstHop = RateLimitIdentity.AnonymousIdentifier(null, "9.9.9.9, 2.2.2.2");

        Assert.Equal("ip:2.2.2.2", victim);
        Assert.Equal(victim, attackerRotatedFirstHop);
        // A first-hop impl would return "ip:1.1.1.1" vs "ip:9.9.9.9" — different buckets → red here.
        Assert.NotEqual("ip:1.1.1.1", victim);

        // x-real-ip (platform edge, unspoofable) always wins when present.
        Assert.Equal("ip:203.0.113.5", RateLimitIdentity.AnonymousIdentifier("203.0.113.5", "1.1.1.1, 2.2.2.2"));
    }

    [Fact]
    public void rl_per_apikey_quota_keys_on_apikey_independent_of_ip()
    {
        // The external surface keys on the resolved key id, not the source IP: the same key from
        // two different IPs shares one bucket (so a per-key quota actually throttles).
        var fromIpA = RateLimitIdentity.For(RateLimitCategory.Query, null, "org-7", "key-xyz", "1.1.1.1", null);
        var fromIpB = RateLimitIdentity.For(RateLimitCategory.Query, null, "org-7", "key-xyz", "9.9.9.9", null);

        Assert.Equal("apikey:key-xyz", fromIpA);
        Assert.Equal(fromIpA, fromIpB);
    }

    [Fact]
    public void rl_ai_per_org_budget_shares_bucket_across_users_in_org()
    {
        // AI is metered per organization: two distinct users in one org share the AI bucket, while
        // a non-AI category stays per-user.
        var aiUserA = RateLimitIdentity.For(RateLimitCategory.Ai, "user-A", "org-X", null, null, null);
        var aiUserB = RateLimitIdentity.For(RateLimitCategory.Ai, "user-B", "org-X", null, null, null);
        var queryUserA = RateLimitIdentity.For(RateLimitCategory.Query, "user-A", "org-X", null, null, null);

        Assert.Equal("org:org-X", aiUserA);
        Assert.Equal(aiUserA, aiUserB);
        Assert.Equal("user-A", queryUserA);
        Assert.NotEqual(aiUserA, queryUserA);
    }
}
