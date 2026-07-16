using System.Globalization;

namespace Tims.UnitTests.CompDiffHarness;

/// <summary>
/// WP1.6 THROWAWAY. A minimal, read-only C# port of ONE pure compensation calc
/// (roundMoney, packages/api/src/lib/currency.ts) used only to validate the byte-identical
/// diff methodology we reuse in Phase 5. It deliberately lives in the test project, NOT in
/// Tims.Domain — it is not a committed compensation migration.
/// </summary>
internal static class MoneyCalc
{
    // JS Number.EPSILON (2^-52). NOT C# double.Epsilon (the smallest denormal, ~4.9e-324) —
    // using the wrong constant would break the 1.005 -> 1.01 rounding the harness pins.
    private const double JsNumberEpsilon = 2.220446049250313e-16;

    /// <summary>Port of `Math.round((amount + Number.EPSILON) * 100) / 100`.</summary>
    public static double RoundMoney(double amount) =>
        Math.Floor((amount + JsNumberEpsilon) * 100 + 0.5) / 100;

    /// <summary>Canonical output form both stacks compare byte-for-byte: fixed 2 decimals, invariant.</summary>
    public static string Canonical(double amount, double rate) =>
        RoundMoney(amount * rate).ToString("F2", CultureInfo.InvariantCulture);
}
