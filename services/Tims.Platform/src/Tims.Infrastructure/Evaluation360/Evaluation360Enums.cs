using NpgsqlTypes;

namespace Tims.Infrastructure.Evaluation360;

/// <summary>
/// CLR mirrors of the NATIVE Prisma enum types on the evaluation360 tables (<c>ReviewCycleStatus</c>,
/// <c>RaterRelationship</c>, <c>RaterAssignmentStatus</c> — packages/db/prisma/schema/evaluation360.prisma).
/// Unlike the billing/reporting reads (which only SELECT enums, or read plain-String columns), this surface
/// FILTERS on these enum columns in WHERE clauses (status='pending', cycle.status='open', status='published',
/// status='submitted'), and Postgres has no implicit <c>enum = text</c> operator — so the columns are mapped as
/// real CLR enums (via <see cref="Evaluation360ReadDataSource"/>'s <c>MapEnum</c>), letting EF translate the
/// filters natively. The DB labels are pinned with <see cref="PgNameAttribute"/> so the mapping is exact
/// regardless of the default name translator; <see cref="Eval360EnumLabels"/> converts back to those labels for
/// the wire + the kernel (which compares the relationship as its literal string).
/// </summary>
public enum ReviewCycleStatusPg
{
    [PgName("draft")] Draft,
    [PgName("open")] Open,
    [PgName("closed")] Closed,
    [PgName("published")] Published,
}

public enum RaterRelationshipPg
{
    [PgName("self")] Self,
    [PgName("manager")] Manager,
    [PgName("peer")] Peer,
    [PgName("direct_report")] DirectReport,
}

public enum RaterAssignmentStatusPg
{
    [PgName("pending")] Pending,
    [PgName("submitted")] Submitted,
}

/// <summary>Converts the mapped CLR enums back to their exact Prisma DB labels — the strings the TS wire uses and
/// the strings the pure <c>Eval360Aggregate</c> kernel compares (<c>"self"/"manager"/"peer"/"direct_report"</c>).</summary>
public static class Eval360EnumLabels
{
    public static string Label(this ReviewCycleStatusPg status) => status switch
    {
        ReviewCycleStatusPg.Draft => "draft",
        ReviewCycleStatusPg.Open => "open",
        ReviewCycleStatusPg.Closed => "closed",
        ReviewCycleStatusPg.Published => "published",
        _ => throw new ArgumentOutOfRangeException(nameof(status), status, "unknown ReviewCycleStatus"),
    };

    public static string Label(this RaterRelationshipPg relationship) => relationship switch
    {
        RaterRelationshipPg.Self => "self",
        RaterRelationshipPg.Manager => "manager",
        RaterRelationshipPg.Peer => "peer",
        RaterRelationshipPg.DirectReport => "direct_report",
        _ => throw new ArgumentOutOfRangeException(nameof(relationship), relationship, "unknown RaterRelationship"),
    };

    public static string Label(this RaterAssignmentStatusPg status) => status switch
    {
        RaterAssignmentStatusPg.Pending => "pending",
        RaterAssignmentStatusPg.Submitted => "submitted",
        _ => throw new ArgumentOutOfRangeException(nameof(status), status, "unknown RaterAssignmentStatus"),
    };
}
