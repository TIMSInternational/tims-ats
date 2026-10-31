using Tims.Application.RateLimiting;
using Tims.Domain.RateLimiting;

namespace Tims.Infrastructure.RateLimiting;

/// <summary>
/// The production <see cref="IRateLimiter"/>: the shared DynamoDB sliding window (<see cref="DynamoDbRateLimitStore"/>),
/// whose items are SHARED with the TS stack, so a caller has one budget across both. Throws on a store
/// outage; <c>RateLimitGuard</c> owns the outage policy.
/// </summary>
public sealed class DynamoDbSlidingWindowRateLimiter(DynamoDbRateLimitStore store) : IRateLimiter
{
    private readonly DynamoDbRateLimitStore _store = store;

    public Task<RateLimitResult> LimitAsync(
        string identifier,
        RateLimitCategory category,
        CancellationToken cancellationToken = default) =>
        _store.SlidingWindowAsync(category, identifier, cancellationToken);
}
