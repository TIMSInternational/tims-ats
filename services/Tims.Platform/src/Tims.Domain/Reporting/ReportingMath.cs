using System;

namespace Tims.Domain.Reporting;

/// <summary>
/// Rounding parity helper for the reporting kernels. JS <c>Math.round</c> rounds half-UP (toward
/// +Infinity), NOT to-even like .NET's default banker's rounding — so every ported metric uses
/// <c>Floor(x + 0.5)</c>. All reporting metrics are non-negative, so half-up-toward-+Infinity and
/// half-away-from-zero coincide.
/// </summary>
public static class ReportingMath
{
    public static long JsRound(double x) => (long)Math.Floor(x + 0.5);
}
