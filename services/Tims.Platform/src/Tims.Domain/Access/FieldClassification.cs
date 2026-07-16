namespace Tims.Domain.Access;

/// <summary>
/// First column-classification kernel in C#: a faithful port of <c>fieldsVisibleTo</c> +
/// <c>selectFor</c> (packages/api/src/access/classification.ts + select-for.ts) for the entities the
/// external-vendor read surface needs. Purely FIELD-level (row-scope is <see cref="ScopeWhereFor"/>'s
/// concern): each field lists the ROLES that may SELECT it; a field no role grants is visible to NO ONE
/// (fail-closed union — a field is included iff AT LEAST ONE of the caller's roles grants it).
///
/// Only <c>assessmentResult</c> is registered (the sole entity this slice reads); the registry is
/// extensible. An UNKNOWN entity resolves fail-closed: <see cref="FieldsVisibleTo"/> → empty,
/// <see cref="SelectFor"/> → <c>{ id }</c> (the safe minimum), matching the TS defaults exactly.
/// Field order is registry-declaration order, byte-for-byte with the TS object-key order.
/// </summary>
public static class FieldClassification
{
    // Convenience role bundles (matrix columns), mirroring classification.ts.
    private const string Super = "super_admin";
    private const string Hr = "hr_admin";
    private const string Hrbp = "hrbp";
    private const string Recruiter = "recruiter";
    private const string Employee = "employee";

    // external = API-key integrations (Wave 2.5 slice 7b): the analysis-engine consumer is the
    // second-most-privileged psychometric reader (Federico Jun 15), reading the FULL normed profile.
    private const string External = "external";

    private sealed record FieldRule(string Field, IReadOnlyList<string> Roles);

    // assessmentResult — declaration order is the ONLY source of field order (matches TS).
    private static readonly IReadOnlyDictionary<string, IReadOnlyList<FieldRule>> Registry =
        new Dictionary<string, IReadOnlyList<FieldRule>>(StringComparer.Ordinal)
        {
            ["assessmentResult"] = new FieldRule[]
            {
                new("breakdown", [Super, External]),
                new("rawScore", [Super, External]),
                new("normalizedScore", [Super, Hr, Hrbp, Recruiter, Employee, External]),
                new("percentile", [Super, Hr, Hrbp, Recruiter, Employee, External]),
                new("interpretation", [Super, Hr, Hrbp, Recruiter, Employee, External]),
                new("modelVersion", [Super, Hr, External]),
            },
        };

    // Non-sensitive structural anchors ALWAYS selected (never classified). Per select-for.ts:
    // assessmentResult anchors on id, organizationId, assignmentId (NOT userId).
    private static readonly IReadOnlyDictionary<string, IReadOnlyList<string>> AnchorFields =
        new Dictionary<string, IReadOnlyList<string>>(StringComparer.Ordinal)
        {
            ["assessmentResult"] = ["id", "organizationId", "assignmentId"],
        };

    /// <summary>
    /// Fields the given roles may SELECT for an entity (fail-closed union; declaration order).
    /// Unknown entity or no matching roles → empty, matching the TS <c>fieldsVisibleTo</c>.
    /// </summary>
    public static IReadOnlyList<string> FieldsVisibleTo(IReadOnlyCollection<string> roles, string entity)
    {
        if (!Registry.TryGetValue(entity, out var fields))
        {
            return [];
        }

        var roleSet = new HashSet<string>(roles, StringComparer.Ordinal);
        return fields
            .Where(rule => rule.Roles.Any(roleSet.Contains))
            .Select(rule => rule.Field)
            .ToList();
    }

    /// <summary>
    /// The Prisma-<c>select</c> field set for an entity given the caller's roles: anchors (always) ∪
    /// <see cref="FieldsVisibleTo"/>, in [anchors, then visible-fields] order. Unknown entity →
    /// <c>{ id }</c> (safe minimum), matching the TS <c>selectFor</c>. Returned as an ordered list so a
    /// cross-stack golden fixture pins the exact key order the TS object emits.
    /// </summary>
    public static IReadOnlyList<string> SelectFor(IReadOnlyCollection<string> roles, string entity)
    {
        if (!Registry.ContainsKey(entity) || !AnchorFields.TryGetValue(entity, out var anchors))
        {
            return ["id"];
        }

        var select = new List<string>(anchors);
        select.AddRange(FieldsVisibleTo(roles, entity));
        return select;
    }
}
