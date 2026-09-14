using System.Text.Json.Nodes;
using Tims.Domain.Identity;

namespace Tims.UnitTests.Identity;

/// <summary>
/// Pins <see cref="MfaGate"/> to the shared goldens (contracts/mfa-fixtures/cases.json) — the SAME
/// file the TS vitest (tests/security/mfa-gate-fixtures.test.ts) asserts against the REAL
/// <c>packages/shared/src/mfa.ts</c> exports the tRPC middleware and the (admin) layout both call.
///
/// #173. The gate had no C# implementation at all, so a privileged aal1 token was refused by tRPC
/// and served by the platform service. A shared golden is what stops the two stacks disagreeing
/// about WHO must step up and WHEN — the failure mode being that a role one stack treats as
/// privileged and the other does not silently escapes enforcement.
/// </summary>
public sealed class MfaGateFixtureTests
{
    private static JsonNode Fixture() =>
        JsonNode.Parse(File.ReadAllText(
            Path.Combine(AppContext.BaseDirectory, "mfa-fixtures", "cases.json")))!;

    private static JsonArray Section(string key) => Fixture()[key]!.AsArray();

    public static IEnumerable<object[]> BlockingRows() => Rows("cases");

    public static IEnumerable<object[]> FlagRows() => Rows("enforcedFlag");

    public static IEnumerable<object[]> PrivilegedRows() => Rows("privileged");

    private static IEnumerable<object[]> Rows(string key)
    {
        var arr = Section(key);
        for (var i = 0; i < arr.Count; i++)
        {
            yield return [i, arr[i]!["name"]!.GetValue<string>()];
        }
    }

    [Theory]
    [MemberData(nameof(BlockingRows))]
    public void IsBlocking_matches_golden(int index, string name)
    {
        var c = Section("cases")[index]!;
        var input = c["input"]!;
        Assert.Equal(
            c["expected"]!.GetValue<bool>(),
            MfaGate.IsBlocking(
                input["enforced"]!.GetValue<bool>(),
                input["isPrivileged"]!.GetValue<bool>(),
                input["currentLevel"]?.GetValue<string>()));
        _ = name;
    }

    [Theory]
    [MemberData(nameof(FlagRows))]
    public void IsEnforced_matches_golden(int index, string name)
    {
        var c = Section("enforcedFlag")[index]!;
        Assert.Equal(c["expected"]!.GetValue<bool>(), MfaGate.IsEnforced(c["input"]?.GetValue<string>()));
        _ = name;
    }

    [Theory]
    [MemberData(nameof(PrivilegedRows))]
    public void IsPrivileged_matches_golden(int index, string name)
    {
        var c = Section("privileged")[index]!;
        var roles = c["roles"]!.AsArray().Select(r => r!.GetValue<string>()).ToArray();
        Assert.Equal(
            c["expected"]!.GetValue<bool>(),
            MfaGate.IsPrivileged(roles, c["isPlatformOwner"]!.GetValue<bool>()));
        _ = name;
    }

    [Fact]
    public void Fixture_sections_are_not_empty()
    {
        // Floor guards: every assertion above is a quantifier over a section, so an emptied fixture
        // would leave this file green while asserting nothing.
        Assert.True(Section("cases").Count >= 8);
        Assert.True(Section("enforcedFlag").Count >= 5);
        Assert.True(Section("privileged").Count >= 5);
    }

    [Fact]
    public void The_sentinel_matches_the_string_the_web_client_redirects_on()
    {
        // apps/web/lib/trpc-provider.tsx compares err.message === MFA_REQUIRED to send the user to
        // /mfa. If this constant drifts, the refusal still happens but the recovery path silently
        // stops working — a dead end rather than a redirect.
        Assert.Equal("MFA_REQUIRED", MfaGate.MfaRequired);
    }
}
