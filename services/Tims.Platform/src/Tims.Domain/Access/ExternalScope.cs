namespace Tims.Domain.Access;

/// <summary>
/// Ported 1:1 from packages/api/src/access/external-scope.ts (Sprint 1.6).
///
/// Pure scope-narrowing decision for external API keys. An EMPTY scopes list is a
/// wildcard by default (no per-key narrowing — the role grant alone gates), matching
/// the historical external read-surface model. <paramref name="alwaysEnforceScope"/>
/// overrides that for sensitive endpoints (e.g. vendor writes): the scope must be
/// explicitly present even for an empty-scope key, so adding a role grant can never
/// silently widen an existing key.
/// </summary>
public static class ExternalScope
{
    public static bool ExternalScopeSatisfied(
        string? requiredScope,
        IReadOnlyList<string> scopes,
        bool alwaysEnforceScope = false)
    {
        if (string.IsNullOrEmpty(requiredScope)) return true;
        if (!alwaysEnforceScope && scopes.Count == 0) return true;
        return scopes.Contains(requiredScope);
    }
}
