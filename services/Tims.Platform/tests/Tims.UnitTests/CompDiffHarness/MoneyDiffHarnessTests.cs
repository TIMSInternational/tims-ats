using System.Text.Json;
using Tims.UnitTests.Fixtures;

namespace Tims.UnitTests.CompDiffHarness;

/// <summary>
/// WP1.6 THROWAWAY. Asserts the C# roundMoney port emits the canonical string pinned in
/// contracts/comp-fixtures/round-money.json. The matching TS test asserts the SAME fixture
/// against the real roundMoney — so a value flows byte-identically through both stacks.
/// This is the diff methodology Phase 5 reuses for strangler parity; the calc itself is not
/// a committed migration.
/// </summary>
public sealed class MoneyDiffHarnessTests
{
    private sealed record Root(List<Case> Cases);
    private sealed record Case(string Name, double Amount, double Rate, string Expected);

    private static readonly Root Data = Load();

    private static Root Load()
    {
        var path = Path.Combine(AppContext.BaseDirectory, "comp-fixtures", "round-money.json");
        return JsonSerializer.Deserialize<Root>(File.ReadAllText(path),
                   new JsonSerializerOptions { PropertyNameCaseInsensitive = true })
               ?? throw new InvalidOperationException("round-money.json deserialized to null");
    }

    public static IEnumerable<object[]> Cases() => Fx.Rows(Data.Cases.Select(c => c.Name).ToList());

    [Theory]
    [MemberData(nameof(Cases))]
    public void CSharp_output_is_byte_identical_to_fixture(int index, string name)
    {
        var c = Data.Cases[index];
        Assert.Equal(name, c.Name);
        Assert.Equal(c.Expected, MoneyCalc.Canonical(c.Amount, c.Rate));
    }
}
