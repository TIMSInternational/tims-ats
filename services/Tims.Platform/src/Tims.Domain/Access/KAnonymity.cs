namespace Tims.Domain.Access;

/// <summary>One group's suppressed count. <see cref="Count"/> is null when suppressed.</summary>
public sealed record SuppressedCount(bool Suppressed, int? Count);

/// <summary>An aggregate group: its key, its (possibly suppressed) count, and the flag.</summary>
public sealed record AggregateGroup(string Key, int? Count, bool Suppressed);

/// <summary>
/// Ported 1:1 from packages/api/src/access/aggregate.ts — k-anonymity min-5 suppression
/// for sensitive aggregates (engagement, DEI, comp). A group of 1..4 is suppressed so an
/// individual cannot be re-identified; an EMPTY group (0) passes through (reveals no
/// person). If the TOTAL row count is below the threshold, EVERY group is suppressed
/// (anti-differencing).
/// </summary>
public static class KAnonymity
{
    public const int MinAggregateSize = 5;

    public static SuppressedCount SuppressBelowMin5(int count)
    {
        if (count > 0 && count < MinAggregateSize) return new SuppressedCount(true, null);
        return new SuppressedCount(false, count);
    }

    /// <summary>
    /// Group the pre-computed <paramref name="keys"/> (one entry per row, in row order —
    /// the caller's keyFn already applied) and suppress any group below the threshold.
    /// Group emission order follows first-seen key order, matching the JS Map/entries
    /// iteration the TS version relies on.
    ///
    /// WARNING (caller responsibility, per the TS doc): when ANY group is suppressed the
    /// caller MUST NOT also disclose the total row count — total-N minus visible counts
    /// arithmetically recovers a suppressed group's size.
    /// </summary>
    public static IReadOnlyList<AggregateGroup> AggregateGroups(IReadOnlyList<string> keys)
    {
        if (keys.Count == 0) return Array.Empty<AggregateGroup>();

        var order = new List<string>();
        var counts = new Dictionary<string, int>();
        foreach (var k in keys)
        {
            if (counts.TryGetValue(k, out var c))
            {
                counts[k] = c + 1;
            }
            else
            {
                counts[k] = 1;
                order.Add(k);
            }
        }

        var totalSuppress = keys.Count < MinAggregateSize;
        return order.Select(key =>
        {
            var s = totalSuppress ? new SuppressedCount(true, null) : SuppressBelowMin5(counts[key]);
            return new AggregateGroup(key, s.Count, s.Suppressed);
        }).ToList();
    }
}
