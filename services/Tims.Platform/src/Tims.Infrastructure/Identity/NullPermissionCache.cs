using Tims.Application.Identity;
using Tims.Domain.Access;

namespace Tims.Infrastructure.Identity;

/// <summary>
/// The fail-soft default <see cref="IPermissionCache"/>: every read is a MISS and every write is a
/// no-op, so the permission check always falls through to a direct DB grant fetch. This is the
/// no-Redis baseline (tests + local runs need no cache server); a real Redis-backed cache is a
/// config-gated, deploy-verified swap for this registration (mirrors the JWKS-fetch pattern:
/// fail-closed/soft when unconfigured, never a hard dependency at boot).
/// </summary>
public sealed class NullPermissionCache : IPermissionCache
{
    public Task<AccessDecision?> GetAsync(string key, CancellationToken ct) =>
        Task.FromResult<AccessDecision?>(null);

    public Task SetAsync(string key, AccessDecision decision, TimeSpan ttl, CancellationToken ct) =>
        Task.CompletedTask;
}
