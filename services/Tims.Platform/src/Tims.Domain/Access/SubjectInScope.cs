namespace Tims.Domain.Access;

/// <summary>
/// Pure, loader-injected port of <c>assertSubjectInScope</c>
/// (packages/api/src/access/write-rules.ts): the write-rule for creates that TARGET another
/// user (e.g. an OKR for user X, a coaching session for employee X). Such creates have no
/// row to probe, so the rule is "the target must be inside the caller's subject set".
///
/// This port stays PURE and returns a bool (true = allowed). The FORBIDDEN throw is the
/// caller's concern in slice 2.5b — here, a false result stands in for the TS throw so the
/// golden fixtures can assert both stacks identically.
///
/// organization/company → allowed (deploy-neutral; pre-seed grants are org-wide);
/// own → self only; team → <see cref="IAnchorLoader.TeamMemberIdsAsync"/>;
/// unit → <see cref="IAnchorLoader.UnitMemberIdsAsync"/>; narrow scope with no anchor
/// loader → denied (fail closed, never silently unscoped).
/// </summary>
public static class SubjectInScope
{
    public static async Task<bool> IsSatisfiedAsync(
        AccessScope scope,
        IAnchorLoader? anchors,
        string userId,
        string targetUserId,
        CancellationToken ct = default)
    {
        if (scope is AccessScope.Organization or AccessScope.Company)
        {
            return true;
        }

        if (scope == AccessScope.Own)
        {
            return targetUserId == userId;
        }

        // Narrow scope (team/unit) with no anchor loader — fail closed.
        if (anchors is null)
        {
            return false;
        }

        var subjects = scope == AccessScope.Team
            ? await anchors.TeamMemberIdsAsync(ct)
            : await anchors.UnitMemberIdsAsync(ct);

        return subjects.Contains(targetUserId);
    }
}
