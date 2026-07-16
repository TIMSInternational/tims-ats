using StackExchange.Redis;
using Tims.Domain.RateLimiting;
using Tims.Infrastructure.RateLimiting;

namespace Tims.IntegrationTests.RateLimiting;

/// <summary>
/// WP2.6 cross-stack sharing proof. Runs the C# <see cref="RedisSlidingWindowRateLimiter"/> against
/// a real Redis (Testcontainer) and inspects the EXACT Upstash key layout
/// (<c>tims:ratelimit:{category}:{identifier}:{bucket}</c>) + counter it writes — the value a TS
/// <c>@upstash/ratelimit</c> reader would also see. Also proves the block threshold and the
/// two-window sliding interpolation deterministically (injected clock).
/// </summary>
[Collection(RedisRateLimitCollection.Name)]
public sealed class RedisSlidingWindowRateLimiterTests(RedisRateLimitFixture fixture)
{
    private readonly IConnectionMultiplexer _redis = fixture.Connection;

    private RedisSlidingWindowRateLimiter LimiterAt(long nowMs) => new(_redis, () => nowMs);

    [Fact]
    public async Task Writes_exact_upstash_key_and_shares_counter_cross_stack()
    {
        // A unique identifier so parallel test runs never collide on the shared container.
        var identifier = $"user-{Guid.NewGuid():N}";
        const RateLimitCategory category = RateLimitCategory.Export; // 5 tokens / 300000ms
        var windowMs = RateLimits.WindowMs(category);
        var bucket = 100_000L;
        var nowMs = (bucket * windowMs) + 150_000; // mid-window (percentageInCurrent = 0.5)
        var limiter = LimiterAt(nowMs);

        // Consume the full budget: the first 5 are allowed, the 6th is throttled.
        for (var i = 1; i <= RateLimits.Tokens(category); i++)
        {
            var allowed = await limiter.LimitAsync(identifier, category);
            Assert.True(allowed.Allowed, $"request {i} should be allowed");
        }

        var blocked = await limiter.LimitAsync(identifier, category);
        Assert.False(blocked.Allowed);
        Assert.Equal(RateLimits.Tokens(category), blocked.Limit);

        // The EXACT key a TS reader addresses, byte-for-byte.
        var expectedKey = $"tims:ratelimit:export:{identifier}:{bucket}";
        Assert.Equal(RateLimits.CurrentKey(category, identifier, bucket), expectedKey);

        var db = _redis.GetDatabase();
        var counter = await db.StringGetAsync(expectedKey);
        Assert.True(counter.HasValue, "the shared counter key must exist");
        Assert.Equal(RateLimits.Tokens(category), (int)counter); // 5 allowed increments; the block did NOT INCRBY

        // PEXPIRE was set on first write (windowMs*2 + 1000) so the bucket self-expires.
        var pttl = await db.KeyTimeToLiveAsync(expectedKey);
        Assert.NotNull(pttl);
        Assert.True(pttl!.Value.TotalMilliseconds <= (windowMs * 2) + 1000);
    }

    [Fact]
    public async Task Window_slides_carrying_the_previous_bucket_weighted()
    {
        var identifier = $"user-{Guid.NewGuid():N}";
        const RateLimitCategory category = RateLimitCategory.Export; // 5 tokens / 300000ms
        var windowMs = RateLimits.WindowMs(category);
        var bucket = 200_000L;

        // Window W (mid): fill the budget so the previous bucket carries 5 used tokens.
        var wMid = (bucket * windowMs) + 150_000;
        var limiterW = LimiterAt(wMid);
        for (var i = 0; i < RateLimits.Tokens(category); i++)
        {
            Assert.True((await limiterW.LimitAsync(identifier, category)).Allowed);
        }

        // Window W+1 at its very START (percentageInCurrent ~ 0 → previous weighted fully): the
        // sliding window still counts the previous bucket's 5, so the first request is BLOCKED.
        var w1Start = ((bucket + 1) * windowMs) + 0;
        var atStart = await LimiterAt(w1Start).LimitAsync(identifier, category);
        Assert.False(atStart.Allowed);

        // Window W+1 LATE (percentageInCurrent ~ 0.997 → previous weight ~ 0): the window has slid
        // past the old bucket, so requests are allowed again.
        var w1Late = ((bucket + 1) * windowMs) + (windowMs - 1_000);
        var atLate = await LimiterAt(w1Late).LimitAsync(identifier, category);
        Assert.True(atLate.Allowed);
    }

    [Fact]
    public async Task Ai_category_keys_on_org_bucket_shared_across_users()
    {
        // rl-ai-per-org-budget end-to-end against Redis: two users in one org hit ONE bucket.
        var org = $"org-{Guid.NewGuid():N}";
        var orgIdentifier = $"org:{org}";
        const RateLimitCategory category = RateLimitCategory.Ai; // 10 tokens / 60000ms
        var windowMs = RateLimits.WindowMs(category);
        var bucket = 300_000L;
        var limiter = LimiterAt((bucket * windowMs) + 30_000);

        // Both users resolve to the same org identifier (per RateLimitIdentity.For), so together
        // they consume ONE org budget of 10.
        for (var i = 0; i < RateLimits.Tokens(category); i++)
        {
            Assert.True((await limiter.LimitAsync(orgIdentifier, category)).Allowed);
        }

        Assert.False((await limiter.LimitAsync(orgIdentifier, category)).Allowed);

        var expectedKey = $"tims:ratelimit:ai:org:{org}:{bucket}";
        var counter = await _redis.GetDatabase().StringGetAsync(expectedKey);
        Assert.Equal(RateLimits.Tokens(category), (int)counter);
    }
}
