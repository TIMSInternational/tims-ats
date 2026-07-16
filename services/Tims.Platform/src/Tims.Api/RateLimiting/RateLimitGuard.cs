using StackExchange.Redis;
using Tims.Application.RateLimiting;
using Tims.Domain.RateLimiting;
using Tims.Infrastructure.RateLimiting;

namespace Tims.Api.RateLimiting;

/// <summary>
/// Orchestrates the rate-limit decision with the fail-open policy. Prefers the shared-bucket
/// Redis limiter; if Redis is unreachable it falls back to the process-local in-memory limiter
/// ONLY in Development. This is a DELIBERATE, documented divergence from TS: the TS stack falls
/// back to in-memory whenever the Upstash env vars are absent (any environment), whereas the C#
/// port NEVER silently allows unlimited traffic in production — a Redis outage there fails closed
/// (the exception propagates → 5xx) rather than degrading the limiter to a per-instance memory map.
/// </summary>
public sealed class RateLimitGuard(
    RedisSlidingWindowRateLimiter? redisLimiter,
    InMemorySlidingWindowRateLimiter inMemoryLimiter,
    IHostEnvironment environment)
{
    private readonly RedisSlidingWindowRateLimiter? _redisLimiter = redisLimiter;
    private readonly InMemorySlidingWindowRateLimiter _inMemoryLimiter = inMemoryLimiter;
    private readonly IHostEnvironment _environment = environment;

    public async Task<RateLimitResult> CheckAsync(
        string identifier,
        RateLimitCategory category,
        CancellationToken cancellationToken = default)
    {
        if (_redisLimiter is not null)
        {
            try
            {
                return await _redisLimiter.LimitAsync(identifier, category, cancellationToken).ConfigureAwait(false);
            }
            catch (Exception ex) when (IsRedisUnavailable(ex))
            {
                // Fail-open to in-memory ONLY in Development; production fails closed (rethrow).
                if (_environment.IsDevelopment())
                {
                    return await _inMemoryLimiter.LimitAsync(identifier, category, cancellationToken).ConfigureAwait(false);
                }

                throw;
            }
        }

        // Redis not configured at all. In Development we mirror the TS local-dev in-memory path;
        // in production an unconfigured limiter is a misconfiguration, not a licence to allow all.
        if (_environment.IsDevelopment())
        {
            return await _inMemoryLimiter.LimitAsync(identifier, category, cancellationToken).ConfigureAwait(false);
        }

        throw new InvalidOperationException(
            "Rate limiter unavailable: Redis is not configured and the in-memory fallback is Development-only.");
    }

    private static bool IsRedisUnavailable(Exception ex) =>
        ex is RedisConnectionException or RedisTimeoutException or TimeoutException;
}
