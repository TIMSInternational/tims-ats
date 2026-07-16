using Tims.Domain.Access;

namespace Tims.Application.Identity;

/// <summary>
/// Cache-aside store for the non-privileged permission decision (5-min TTL, WP2.5). Ported from
/// the TS <c>cacheGet</c>/<c>cacheSet</c> pair (packages/api/src/lib/cache.ts) that fronts the DB
/// grant fetch. Implementations MUST be fail-soft: a cache miss / outage degrades to a direct DB
/// read, never a failed request. The default (<c>NullPermissionCache</c>) always misses and
/// no-ops set, so tests and local runs need no Redis; a real Redis-backed impl is config-gated and
/// deploy-verified separately.
/// </summary>
public interface IPermissionCache
{
    /// <summary>Returns the cached decision for <paramref name="key"/>, or null on miss / any error.</summary>
    Task<AccessDecision?> GetAsync(string key, CancellationToken ct);

    /// <summary>Stores <paramref name="decision"/> under <paramref name="key"/> for <paramref name="ttl"/>; a no-op on any error.</summary>
    Task SetAsync(string key, AccessDecision decision, TimeSpan ttl, CancellationToken ct);
}
