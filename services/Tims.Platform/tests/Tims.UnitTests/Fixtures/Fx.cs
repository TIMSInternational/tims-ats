using System.Text.Json;
using Tims.Domain.Access;

namespace Tims.UnitTests.Fixtures;

/// <summary>
/// Loads the shared golden fixtures (contracts/access-fixtures/*.json, copied into the
/// test output) and exposes helpers so each fixture test asserts the C# port against the
/// SAME expected outputs the TS suite asserts. A behavior change edits the JSON once;
/// either stack disagreeing turns its CI red.
/// </summary>
internal static class Fx
{
    internal static readonly JsonSerializerOptions Options = new()
    {
        PropertyNameCaseInsensitive = true,
        Converters = { new System.Text.Json.Serialization.JsonStringEnumConverter() },
    };

    internal static T Load<T>(string file) => Load<T>("access-fixtures", file);

    internal static T Load<T>(string subdir, string file)
    {
        var json = File.ReadAllText(Path.Combine(AppContext.BaseDirectory, subdir, file));
        return JsonSerializer.Deserialize<T>(json, Options)
               ?? throw new InvalidOperationException($"Fixture {subdir}/{file} deserialized to null");
    }

    /// <summary>MemberData rows: (index, caseName) primitives — serializable, one test per case.</summary>
    internal static IEnumerable<object[]> Rows(IReadOnlyList<string> names) =>
        names.Select((name, i) => new object[] { i, name });

    internal static Grant ToGrant(GrantDto g) => new(g.Role, g.Module, g.Action, g.Scope);

    internal static void AssertDecision(ExpectedDecision expected, AccessDecision actual)
    {
        Assert.Equal(expected.Allowed, actual.Allowed);
        if (!expected.Allowed)
        {
            Assert.Null(actual.Scope);
            Assert.Null(actual.Roles);
            return;
        }

        Assert.NotNull(actual.Scope);
        Assert.Equal(expected.Scope, actual.Scope!.Value.ToWire());
        Assert.Equal(expected.Roles, actual.Roles);
    }
}
