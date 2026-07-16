namespace Tims.Domain.Access;

/// <summary>
/// Request-local anchor loader — the port of the <c>AnchorLoader</c> interface from
/// packages/api/src/access/anchors.ts. Domain owns the PORT (this interface); the real
/// EF-backed implementation lives in Infrastructure (slice 2.5b).
///
/// SECURITY: anchors are the authorization boundary for team/unit/panel scopes — an
/// implementation must NEVER cache them across requests (a revoked leader/hrbp/evaluator
/// must lose access on their next request). Memoize only within a single loader instance;
/// each request constructs a fresh loader. A rejected load stays memoized for that request
/// — deliberate: consistent fail-closed denial beats inconsistent retry (callers must
/// always await).
///
/// Floor semantics (from anchors.ts, an implementation MUST preserve them):
/// <list type="bullet">
///   <item><description><see cref="TeamMemberIdsAsync"/> floors to <c>[self]</c>, keeping team ⊇ own.</description></item>
///   <item><description><see cref="LedTeamIdsAsync"/> floors to <c>[]</c> (team ids the user leads).</description></item>
///   <item><description><see cref="UnitMemberIdsAsync"/> / <see cref="UnitIdsAsync"/> / <see cref="PanelInterviewIdsAsync"/> floor to <c>[]</c>.</description></item>
/// </list>
/// </summary>
public interface IAnchorLoader
{
    /// <summary>User ids in the teams the caller leads (floors to <c>[self]</c>).</summary>
    Task<IReadOnlyList<string>> TeamMemberIdsAsync(CancellationToken ct = default);

    /// <summary>Business-unit ids the caller is assigned to (floors to <c>[]</c>).</summary>
    Task<IReadOnlyList<string>> UnitIdsAsync(CancellationToken ct = default);

    /// <summary>Interview ids where the caller is an assigned evaluator (floors to <c>[]</c>).</summary>
    Task<IReadOnlyList<string>> PanelInterviewIdsAsync(CancellationToken ct = default);

    /// <summary>Team ids the caller leads (floors to <c>[]</c>); the vacancy team-scope anchor.</summary>
    Task<IReadOnlyList<string>> LedTeamIdsAsync(CancellationToken ct = default);

    /// <summary>User ids belonging to the caller's assigned units (floors to <c>[]</c>).</summary>
    Task<IReadOnlyList<string>> UnitMemberIdsAsync(CancellationToken ct = default);
}
