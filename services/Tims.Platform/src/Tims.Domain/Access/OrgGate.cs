namespace Tims.Domain.Access;

/// <summary>
/// Ported from packages/api/src/access/org-gate.ts. The org-rollup analytics gate: an
/// endpoint whose queries aggregate ORG-WIDE is reachable only at organization or
/// company scope. The TS side throws FORBIDDEN for narrower scopes; this pure predicate
/// returns the allow/deny the fixtures pin (the TS fixture test maps throw→false).
/// </summary>
public static class OrgGate
{
    public static bool RequireOrgScopeSatisfied(AccessScope scope) =>
        scope is AccessScope.Organization or AccessScope.Company;
}
