using System.Text.Json.Nodes;
using Tims.Domain.Http;
using Tims.Domain.RateLimiting;

namespace Tims.UnitTests.Http;

/// <summary>
/// Pins <see cref="ClientIp.From"/> to the shared goldens (contracts/client-ip-fixtures/cases.json)
/// — the SAME file the TS vitest (tests/governance/audit-ip-derivation.test.ts) asserts against
/// <c>packages/api/src/lib/client-ip.ts</c>. One JSON, two stacks: a drift on either side turns that
/// side's CI red, and a deliberate behaviour change has to edit the golden once and face both.
///
/// #174. Before this, seven C# audit writers each re-derived the rule by hand and each took the RAW
/// whole <c>x-forwarded-for</c>, so the audit IP was attacker-chosen. Three of them even carried a
/// comment asserting parity with TS — which #158 made false. A shared fixture is the thing that
/// makes such a claim checkable instead of aspirational.
/// </summary>
public sealed class ClientIpFixtureTests
{
    private static JsonArray Cases() =>
        JsonNode.Parse(File.ReadAllText(
            Path.Combine(AppContext.BaseDirectory, "client-ip-fixtures", "cases.json")))!["cases"]!.AsArray();

    public static IEnumerable<object[]> Rows()
    {
        var cases = Cases();
        for (var i = 0; i < cases.Count; i++)
        {
            yield return [i, cases[i]!["name"]!.GetValue<string>()];
        }
    }

    [Theory]
    [MemberData(nameof(Rows))]
    public void From_matches_golden_fixture(int index, string name)
    {
        var c = Cases()[index]!;
        var input = c["input"]!;
        var xRealIp = input["xRealIp"]?.GetValue<string>();
        var xForwardedFor = input["xForwardedFor"]?.GetValue<string>();
        var expected = c["expected"]?.GetValue<string>();

        Assert.Equal(expected, ClientIp.From(xRealIp, xForwardedFor));
        _ = name;
    }

    [Fact]
    public void Fixture_is_not_empty()
    {
        // A floor guard: every assertion above is a quantifier over the case list, so an unreadable
        // or emptied fixture would make this whole file pass while asserting nothing.
        Assert.True(Cases().Count >= 10);
    }

    [Fact]
    public void Rate_limiter_and_audit_writers_share_one_derivation()
    {
        // The anti-drift assertion. RateLimitIdentity had the rule right while the audit writers did
        // not; it now delegates to ClientIp, so a change to the rule cannot fix one and miss the
        // other. Stated as behaviour rather than trusting the refactor: for every golden case the
        // limiter's anonymous identity must be exactly `ip:<derived>` (or `anonymous` when null).
        foreach (var c in Cases())
        {
            var input = c!["input"]!;
            var xRealIp = input["xRealIp"]?.GetValue<string>();
            var xForwardedFor = input["xForwardedFor"]?.GetValue<string>();

            var derived = ClientIp.From(xRealIp, xForwardedFor);
            var expectedIdentity = derived is null ? "anonymous" : $"ip:{derived}";

            Assert.Equal(expectedIdentity, RateLimitIdentity.AnonymousIdentifier(xRealIp, xForwardedFor));
        }
    }
}
