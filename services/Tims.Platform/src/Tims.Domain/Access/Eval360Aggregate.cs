namespace Tims.Domain.Access;

/// <summary>
/// Pure port of packages/api/src/services/evaluation360-aggregate.ts — the highest-risk
/// module in Sprint 1.7. The anonymity rules are LOCKED (Federico-approved):
///   - self / manager  → always shown, attributed, comments included (>= 1 rater).
///   - peer / direct_report → per-competency average, shown ONLY when the distinct
///     rater count >= <see cref="Min360BucketSize"/>; below 3 (incl. 0/1/2) the bucket
///     is OMITTED entirely (suppress-by-omission — closes the presence leak where a
///     sub-threshold group differed from a zero group by bucket existence). Comments are
///     NEVER surfaced for peer/direct_report.
/// No rater identity ever flows through: rows carry <c>AssignmentId</c>, never a user id.
/// </summary>
public static class Eval360Aggregate
{
    public const int Min360BucketSize = 3;

    private static readonly IReadOnlyList<string> RelationshipOrder =
        new[] { "self", "manager", "peer", "direct_report" };

    private static readonly ISet<string> AttributedRelationships =
        new HashSet<string> { "self", "manager" };

    public sealed record AggregateInputRow(
        string AssignmentId,
        string Relationship,
        string CompetencyKey,
        int Rating,
        string? Comment);

    public sealed record CompetencyAverage(string CompetencyKey, double Average);

    public sealed record ReportBucket(
        string Relationship,
        int RaterCount,
        IReadOnlyList<CompetencyAverage> Competencies,
        IReadOnlyList<string>? Comments);

    public static IReadOnlyList<ReportBucket> Aggregate360Report(IReadOnlyList<AggregateInputRow> rows)
    {
        var byRelationship = new Dictionary<string, List<AggregateInputRow>>();
        foreach (var r in rows)
        {
            if (!byRelationship.TryGetValue(r.Relationship, out var group))
            {
                group = new List<AggregateInputRow>();
                byRelationship[r.Relationship] = group;
            }
            group.Add(r);
        }

        var buckets = new List<ReportBucket>();
        foreach (var relationship in RelationshipOrder)
        {
            if (!byRelationship.TryGetValue(relationship, out var group) || group.Count == 0) continue;

            var raterCount = group.Select(r => r.AssignmentId).Distinct().Count();

            if (AttributedRelationships.Contains(relationship))
            {
                buckets.Add(new ReportBucket(
                    relationship,
                    raterCount,
                    ComputeAverages(group),
                    NonNullComments(group)));
                continue;
            }

            // peer / direct_report — min-3 gated, comments never surfaced. Below
            // threshold: omit the bucket entirely so 0/1/2 raters are indistinguishable.
            if (raterCount >= Min360BucketSize)
            {
                buckets.Add(new ReportBucket(
                    relationship,
                    raterCount,
                    ComputeAverages(group),
                    Comments: null));
            }
        }

        return buckets;
    }

    private static IReadOnlyList<CompetencyAverage> ComputeAverages(IReadOnlyList<AggregateInputRow> rows)
    {
        var order = new List<string>();
        var sums = new Dictionary<string, (double Total, int Count)>();
        foreach (var r in rows)
        {
            if (sums.TryGetValue(r.CompetencyKey, out var e))
            {
                sums[r.CompetencyKey] = (e.Total + r.Rating, e.Count + 1);
            }
            else
            {
                sums[r.CompetencyKey] = (r.Rating, 1);
                order.Add(r.CompetencyKey);
            }
        }

        return order.Select(key =>
        {
            var (total, count) = sums[key];
            return new CompetencyAverage(key, RoundTo2(total / count));
        }).ToList();
    }

    private static IReadOnlyList<string> NonNullComments(IReadOnlyList<AggregateInputRow> rows) =>
        rows.Where(r => r.Comment is not null).Select(r => r.Comment!).ToList();

    // Reproduces JS `Math.round((total / count) * 100) / 100`. JS Math.round is
    // floor(x + 0.5); ratings are positive so this equals half-up rounding. Doing it
    // this way (not Math.Round, which is banker's rounding by default) keeps C# output
    // byte-identical to the TS averages the golden fixtures were seeded from.
    private static double RoundTo2(double value) => Math.Floor(value * 100 + 0.5) / 100;
}
