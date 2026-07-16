using Tims.Domain.RateLimiting;

namespace Tims.Application.RateLimiting;

/// <summary>
/// The rate-limiter port. Implementations consume one token for <paramref name="identifier"/> in
/// <paramref name="category"/> and report whether the request is allowed. The production impl
/// (<c>RedisSlidingWindowRateLimiter</c>) shares buckets with the TS stack; the dev-only fallback
/// (<c>InMemorySlidingWindowRateLimiter</c>) is process-local.
/// </summary>
public interface IRateLimiter
{
    /// <summary>Consume one token and return the decision (allowed/blocked + reset).</summary>
    Task<RateLimitResult> LimitAsync(
        string identifier,
        RateLimitCategory category,
        CancellationToken cancellationToken = default);
}
