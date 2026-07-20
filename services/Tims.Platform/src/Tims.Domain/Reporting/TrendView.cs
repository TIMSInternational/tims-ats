using System;
using System.Collections.Generic;

namespace Tims.Domain.Reporting;

/// <summary>One month bucket on the wire: UTC <see cref="Year"/>, 0-indexed UTC <see cref="Month"/>
/// (JS <c>getUTCMonth</c>: January = 0), and the application <see cref="Count"/>.</summary>
public sealed record TrendBucket(int Year, int Month, int Count);

/// <summary>
/// Pure builder for the <c>recruitmentAnalytics.getTrend</c> response — the port of the TS
/// <c>buildTrendView</c> (@tims/shared). Six UTC calendar-month buckets ending in <c>nowMs</c>'s UTC
/// month, OLDEST-FIRST; every timestamp is epoch-milliseconds and UTC year/month are derived here so the
/// DB's UTC timestamps bucket identically in both stacks. INTERNAL staff read = raw view shape, no
/// <c>schemaVersion</c>. Golden-fixtured BOTH stacks (contracts/reporting-fixtures/trend-view.json).
/// </summary>
public static class TrendViewBuilder
{
    /// <summary>Reproduces JS <c>Date.UTC(year, month0, 1)</c> month normalization: <paramref name="month0"/>
    /// (a possibly-negative 0-indexed month) is folded into the year via floored div/mod, so an underflow
    /// like <c>m - 5</c> in January rolls back into the prior year — matching V8, unlike <c>new DateTime</c>.</summary>
    private static (int Year, int Month) NormalizeMonth(int year, int month0)
    {
        var total = year * 12 + month0;
        var y = (int)Math.Floor(total / 12.0);
        var m = total - y * 12; // 0..11
        return (y, m);
    }

    public static IReadOnlyList<TrendBucket> Build(long nowMs, IReadOnlyList<long> appliedAtMs)
    {
        var now = DateTimeOffset.FromUnixTimeMilliseconds(nowMs).UtcDateTime;
        var y = now.Year;
        var m0 = now.Month - 1; // 0-indexed to match JS getUTCMonth

        var buckets = new int[6];
        var index = new Dictionary<(int Year, int Month), int>();
        var keys = new (int Year, int Month)[6];
        for (var i = 5; i >= 0; i--)
        {
            var slot = 5 - i;
            keys[slot] = NormalizeMonth(y, m0 - i);
            index[keys[slot]] = slot;
        }

        foreach (var ms in appliedAtMs)
        {
            var d = DateTimeOffset.FromUnixTimeMilliseconds(ms).UtcDateTime;
            var key = (d.Year, d.Month - 1);
            if (index.TryGetValue(key, out var slot)) buckets[slot]++;
        }

        var result = new List<TrendBucket>(6);
        for (var i = 0; i < 6; i++) result.Add(new TrendBucket(keys[i].Year, keys[i].Month, buckets[i]));
        return result;
    }
}
