namespace Tims.Domain.Access;

/// <summary>Whether a relation nav is to-one (<c>RelationTo</c>) or to-many (<c>RelationSome</c>).</summary>
public enum ProbeNavKind
{
    /// <summary>To-one: <c>EXISTS(SELECT 1 FROM target r WHERE r.id = parent.&lt;fk&gt; AND inner)</c>.</summary>
    To,

    /// <summary>To-many: <c>EXISTS(SELECT 1 FROM target c WHERE c.&lt;fk&gt; = parent.id AND inner)</c>.</summary>
    Some,
}

/// <summary>A relation navigation in the probe registry: how to join, to which table, on which FK column.</summary>
/// <param name="Kind">To-one or to-many.</param>
/// <param name="TargetTable">The related table (must itself be a registered <see cref="ScopeProbeRegistry"/> entry).</param>
/// <param name="ForeignKeyColumn">
/// For <see cref="ProbeNavKind.To"/>, the FK column on the PARENT pointing at <c>target.id</c>.
/// For <see cref="ProbeNavKind.Some"/>, the FK column on the CHILD pointing back at <c>parent.id</c>.
/// </param>
public sealed record ProbeNav(ProbeNavKind Kind, string TargetTable, string ForeignKeyColumn);

/// <summary>
/// One table's probe map: its camelCase-field → snake_case-column dictionary and its
/// camelCase-nav → <see cref="ProbeNav"/> dictionary. Recursive: a nav's target table is
/// itself keyed in <see cref="ScopeProbeRegistry.Tables"/>.
/// </summary>
public sealed record ProbeTable(
    IReadOnlyDictionary<string, string> Fields,
    IReadOnlyDictionary<string, ProbeNav> Navs);

/// <summary>
/// The fixed per-table column/nav registry that drives <c>ScopePredicateSqlTranslator</c> and the
/// IDOR probe. Table/column/nav names come ONLY from here (never user input), which is what makes
/// interpolating identifiers into probe SQL safe — every id/value is still a bound parameter.
///
/// WP2.5b registers the REPRESENTATIVE probe set — the six top-level entities
/// (<see cref="EntityRootTable"/>: vacancy, candidate, application, interview, okr, team) plus the
/// relation-target tables they reach (vacancies, applications, interview_evaluators). The machinery
/// is reusable: the other 16 scoped entities have their scope LOGIC golden-fixtured in WP2.5a and
/// register their probe map in Phase 3 when the entity is built.
/// </summary>
public static class ScopeProbeRegistry
{
    /// <summary>
    /// Per-table field/nav maps. Keyed by snake_case table name. Recursive — a nav's
    /// <see cref="ProbeNav.TargetTable"/> is itself a key here.
    /// </summary>
    public static readonly IReadOnlyDictionary<string, ProbeTable> Tables = new Dictionary<string, ProbeTable>
    {
        ["vacancies"] = new ProbeTable(
            Fields: new Dictionary<string, string>
            {
                ["teamId"] = "team_id",
                ["assignedTo"] = "assigned_to",
                ["createdBy"] = "created_by",
                ["businessUnitId"] = "business_unit_id",
                ["deletedAt"] = "deleted_at",
            },
            Navs: new Dictionary<string, ProbeNav>()),

        ["candidates"] = new ProbeTable(
            Fields: new Dictionary<string, string>
            {
                ["deletedAt"] = "deleted_at",
            },
            Navs: new Dictionary<string, ProbeNav>
            {
                ["applications"] = new ProbeNav(ProbeNavKind.Some, "applications", "candidate_id"),
            }),

        ["applications"] = new ProbeTable(
            Fields: new Dictionary<string, string>(),
            Navs: new Dictionary<string, ProbeNav>
            {
                ["vacancy"] = new ProbeNav(ProbeNavKind.To, "vacancies", "vacancy_id"),
            }),

        ["interviews"] = new ProbeTable(
            Fields: new Dictionary<string, string>(),
            Navs: new Dictionary<string, ProbeNav>
            {
                ["vacancy"] = new ProbeNav(ProbeNavKind.To, "vacancies", "vacancy_id"),
                ["evaluators"] = new ProbeNav(ProbeNavKind.Some, "interview_evaluators", "interview_id"),
            }),

        ["interview_evaluators"] = new ProbeTable(
            Fields: new Dictionary<string, string>
            {
                ["userId"] = "user_id",
            },
            Navs: new Dictionary<string, ProbeNav>()),

        ["okrs"] = new ProbeTable(
            Fields: new Dictionary<string, string>
            {
                ["userId"] = "user_id",
            },
            Navs: new Dictionary<string, ProbeNav>()),

        ["teams"] = new ProbeTable(
            Fields: new Dictionary<string, string>
            {
                ["id"] = "id",
                ["businessUnitId"] = "business_unit_id",
            },
            Navs: new Dictionary<string, ProbeNav>()),
    };

    /// <summary>
    /// The top-level scoped entities that have a registered probe map (the representative set),
    /// mapped to their root table. An <c>AssertScopedAsync</c> for any entity NOT here throws a
    /// clear <see cref="InvalidOperationException"/> (never silently passes).
    /// </summary>
    public static readonly IReadOnlyDictionary<ScopedEntity, string> EntityRootTable = new Dictionary<ScopedEntity, string>
    {
        [ScopedEntity.Vacancy] = "vacancies",
        [ScopedEntity.Candidate] = "candidates",
        [ScopedEntity.Application] = "applications",
        [ScopedEntity.Interview] = "interviews",
        [ScopedEntity.Okr] = "okrs",
        [ScopedEntity.Team] = "teams",
    };

    /// <summary>
    /// The only soft-deletable scoped entities (schema fact) — the probe adds
    /// <c>AND t.deleted_at IS NULL</c> for these, matching <c>SOFT_DELETABLE</c> in scoped-probe.ts.
    /// </summary>
    public static readonly IReadOnlySet<ScopedEntity> SoftDeletable = new HashSet<ScopedEntity>
    {
        ScopedEntity.Vacancy,
        ScopedEntity.Candidate,
    };

    /// <summary>Field-name → column lookup for a registered table (throws on an unknown table/field).</summary>
    public static string Column(string table, string field)
    {
        if (!Tables.TryGetValue(table, out var spec))
        {
            throw new InvalidOperationException($"No probe registry entry for table '{table}'");
        }

        return spec.Fields.TryGetValue(field, out var column)
            ? column
            : throw new InvalidOperationException($"No column mapping for field '{field}' on table '{table}'");
    }

    /// <summary>Nav-name → <see cref="ProbeNav"/> lookup for a registered table (throws on an unknown table/nav).</summary>
    public static ProbeNav Nav(string table, string nav)
    {
        if (!Tables.TryGetValue(table, out var spec))
        {
            throw new InvalidOperationException($"No probe registry entry for table '{table}'");
        }

        return spec.Navs.TryGetValue(nav, out var probeNav)
            ? probeNav
            : throw new InvalidOperationException($"No nav mapping for '{nav}' on table '{table}'");
    }
}
