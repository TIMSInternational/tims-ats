namespace Tims.Domain.Access;

/// <summary>
/// Ported from the AccessDecision union in types.ts:
///   { allowed: false }  |  { allowed: true; scope; roles[] }
///
/// Modeled as a single record where <see cref="Scope"/>/<see cref="Roles"/> are null
/// iff <see cref="Allowed"/> is false. Use <see cref="Deny"/> / <see cref="Allow"/> to
/// construct — never the primary constructor with mismatched state.
/// </summary>
public sealed record AccessDecision
{
    public bool Allowed { get; private init; }
    public AccessScope? Scope { get; private init; }

    /// <summary>Contributing role slugs, de-duplicated in first-seen order (matches the TS Set spread).</summary>
    public IReadOnlyList<string>? Roles { get; private init; }

    public static readonly AccessDecision Deny = new() { Allowed = false, Scope = null, Roles = null };

    public static AccessDecision Allow(AccessScope scope, IReadOnlyList<string> roles) =>
        new() { Allowed = true, Scope = scope, Roles = roles };
}
