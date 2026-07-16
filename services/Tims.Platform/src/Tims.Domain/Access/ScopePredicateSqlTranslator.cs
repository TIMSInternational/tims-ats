namespace Tims.Domain.Access;

/// <summary>
/// Translates a <see cref="ScopePredicate"/> (the Prisma-fragment algebra WP2.5a's
/// <c>ScopeWhereFor</c> emits) into a parameterized SQL boolean expression, walking it against the
/// current table's <see cref="ScopeProbeRegistry"/> entry. This is the SQL analog of the Prisma
/// <c>where</c> fragment <c>assertScoped</c> composes (scoped-probe.ts).
///
/// SECURITY: EVERY id/value is emitted as a bound parameter (<c>@p0</c>, <c>@p1</c>, …) — NEVER
/// interpolated. Table/column/nav identifiers come ONLY from <see cref="ScopeProbeRegistry"/>
/// (never user input), so the identifiers this emits are safe by construction. Pure — no IO.
///
/// Node → SQL:
/// <list type="bullet">
///   <item><description><c>FieldEquals(field, null)</c> → <c>t.col IS NULL</c> (no parameter).</description></item>
///   <item><description><c>FieldEquals(field, val)</c> → <c>t.col = @pN</c> (binds a Guid).</description></item>
///   <item><description><c>FieldIn(field, values)</c> → <c>t.col = ANY(@pN)</c> (binds Guid[]; empty ⇒ matches nothing).</description></item>
///   <item><description><c>Or([])</c> → <c>FALSE</c>; <c>And([])</c> → <c>TRUE</c>; non-empty ⇒ parenthesized join.</description></item>
///   <item><description><c>RelationTo(nav, inner)</c> → <c>EXISTS(SELECT 1 FROM navTable r WHERE r.id = t.fk AND inner)</c>.</description></item>
///   <item><description><c>RelationSome(nav, inner)</c> → <c>EXISTS(SELECT 1 FROM childTable c WHERE c.fk = t.id AND inner)</c>.</description></item>
///   <item><description><c>MatchAll</c> (<c>{}</c>) → <c>TRUE</c> (org/company scope).</description></item>
/// </list>
/// </summary>
public static class ScopePredicateSqlTranslator
{
    /// <summary>A translated predicate: SQL text referencing <c>@p{i}</c> placeholders and their ordered values.</summary>
    public sealed record Translated(string Sql, IReadOnlyList<object> Parameters);

    /// <summary>Translate <paramref name="predicate"/> rooted at <paramref name="rootTable"/> (alias <c>t</c>).</summary>
    public static Translated Translate(string rootTable, ScopePredicate predicate)
    {
        var parameters = new List<object>();
        var aliasSeq = 0;
        var sql = Walk(predicate, rootTable, "t", parameters, ref aliasSeq);
        return new Translated(sql, parameters);
    }

    private static string Walk(
        ScopePredicate node,
        string table,
        string alias,
        List<object> parameters,
        ref int aliasSeq)
    {
        switch (node)
        {
            case ScopePredicate.FieldEquals fe:
                {
                    var column = ScopeProbeRegistry.Column(table, fe.Field);
                    if (fe.Value is null)
                    {
                        return $"{alias}.{column} IS NULL";
                    }

                    parameters.Add(Guid.Parse(fe.Value));
                    return $"{alias}.{column} = @p{parameters.Count - 1}";
                }

            case ScopePredicate.FieldIn fi:
                {
                    var column = ScopeProbeRegistry.Column(table, fi.Field);
                    var ids = fi.Values.Select(Guid.Parse).ToArray();
                    parameters.Add(ids);
                    return $"{alias}.{column} = ANY(@p{parameters.Count - 1})";
                }

            case ScopePredicate.Or or:
                {
                    if (or.Arms.Count == 0)
                    {
                        return "FALSE";
                    }

                    var orArms = new List<string>(or.Arms.Count);
                    foreach (var arm in or.Arms)
                    {
                        orArms.Add(Walk(arm, table, alias, parameters, ref aliasSeq));
                    }

                    return "(" + string.Join(" OR ", orArms) + ")";
                }

            case ScopePredicate.And and:
                {
                    if (and.Arms.Count == 0)
                    {
                        return "TRUE";
                    }

                    var andArms = new List<string>(and.Arms.Count);
                    foreach (var arm in and.Arms)
                    {
                        andArms.Add(Walk(arm, table, alias, parameters, ref aliasSeq));
                    }

                    return "(" + string.Join(" AND ", andArms) + ")";
                }

            case ScopePredicate.RelationTo rt:
                {
                    var nav = ScopeProbeRegistry.Nav(table, rt.Nav);
                    var childAlias = "r" + aliasSeq++;
                    var inner = Walk(rt.Inner, nav.TargetTable, childAlias, parameters, ref aliasSeq);
                    return $"EXISTS (SELECT 1 FROM {nav.TargetTable} {childAlias} "
                        + $"WHERE {childAlias}.id = {alias}.{nav.ForeignKeyColumn} AND {inner})";
                }

            case ScopePredicate.RelationSome rs:
                {
                    var nav = ScopeProbeRegistry.Nav(table, rs.Nav);
                    var childAlias = "c" + aliasSeq++;
                    var inner = Walk(rs.Inner, nav.TargetTable, childAlias, parameters, ref aliasSeq);
                    return $"EXISTS (SELECT 1 FROM {nav.TargetTable} {childAlias} "
                        + $"WHERE {childAlias}.{nav.ForeignKeyColumn} = {alias}.id AND {inner})";
                }

            case ScopePredicate.MatchAllPredicate:
                // {} → org/company scope: every in-org row matches. The outer probe still gates id + org.
                return "TRUE";

            default:
                throw new InvalidOperationException($"Unhandled ScopePredicate node: {node.GetType().Name}");
        }
    }
}
