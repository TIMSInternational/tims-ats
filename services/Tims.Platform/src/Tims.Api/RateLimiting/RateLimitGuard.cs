using Amazon.Runtime;
using Tims.Domain.RateLimiting;
using Tims.Infrastructure.RateLimiting;

namespace Tims.Api.RateLimiting;

/// <summary>
/// Orchestrates the rate-limit decision with the fail-open policy. Prefers the shared DynamoDB limiter
/// (one budget with the TS stack); if the store is unreachable it falls back to the process-local
/// in-memory limiter ONLY in Development. This is a DELIBERATE, documented divergence from TS: the TS
/// stack degrades ordinary queries/mutations to per-instance memory during an outage, whereas the C#
/// port NEVER silently allows unlimited traffic in production — a store outage there fails closed (the
/// exception propagates → 5xx) rather than degrading the limiter to a per-instance memory map.
/// </summary>
public sealed class RateLimitGuard(
    DynamoDbSlidingWindowRateLimiter? sharedLimiter,
    InMemorySlidingWindowRateLimiter inMemoryLimiter,
    IHostEnvironment environment)
{
    private readonly DynamoDbSlidingWindowRateLimiter? _sharedLimiter = sharedLimiter;
    private readonly InMemorySlidingWindowRateLimiter _inMemoryLimiter = inMemoryLimiter;
    private readonly IHostEnvironment _environment = environment;

    public async Task<RateLimitResult> CheckAsync(
        string identifier,
        RateLimitCategory category,
        CancellationToken cancellationToken = default)
    {
        if (_sharedLimiter is not null)
        {
            try
            {
                return await _sharedLimiter.LimitAsync(identifier, category, cancellationToken).ConfigureAwait(false);
            }
            catch (Exception ex) when (IsStoreUnavailable(ex))
            {
                // Fail-open to in-memory ONLY in Development; production fails closed (rethrow).
                if (_environment.IsDevelopment())
                {
                    return await _inMemoryLimiter.LimitAsync(identifier, category, cancellationToken).ConfigureAwait(false);
                }

                throw;
            }
        }

        // Store not configured at all. In Development we mirror the TS local-dev in-memory path;
        // in production an unconfigured limiter is a misconfiguration, not a licence to allow all.
        if (_environment.IsDevelopment())
        {
            return await _inMemoryLimiter.LimitAsync(identifier, category, cancellationToken).ConfigureAwait(false);
        }

        throw new InvalidOperationException(
            "Rate limiter unavailable: the shared DynamoDB store is not configured and the in-memory fallback is Development-only.");
    }

    // Any AWS service or client error (throttling, access denied, missing table, network), and the store's
    // own deadline. A cancellation the caller requested is NOT an outage and propagates untouched.
    public static bool IsStoreUnavailable(Exception ex) =>
        ex is AmazonServiceException or AmazonClientException or HttpRequestException or TimeoutException;
}
