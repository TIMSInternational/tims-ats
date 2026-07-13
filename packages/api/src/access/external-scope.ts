// Pure scope-narrowing decision for external API keys. Returns true if the key's
// scopes permit `requiredScope`. By default an EMPTY scopes[] is unrestricted (a
// wildcard — no narrowing, the role grant alone gates), matching the historical
// external read-surface model. `alwaysEnforceScope` overrides that for sensitive
// endpoints (e.g. vendor writes): the scope must be explicitly present even for an
// empty-scope key, so adding a role grant can never silently widen an existing key.
export function externalScopeSatisfied(
  requiredScope: string | undefined,
  scopes: string[],
  alwaysEnforceScope = false,
): boolean {
  if (!requiredScope) return true;
  if (!alwaysEnforceScope && scopes.length === 0) return true;
  return scopes.includes(requiredScope);
}
