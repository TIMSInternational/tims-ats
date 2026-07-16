namespace Tims.Domain.RateLimiting;

/// <summary>
/// The five rate-limit tiers, a 1:1 port of the TS <c>LIMITS</c> keys in
/// <c>packages/api/src/middleware/rate-limit.ts</c>. The enum member's lowercase name is the
/// wire token baked into the shared Upstash key prefix (<c>tims:ratelimit:{category}</c>), so a
/// C# limiter and the TS limiter address the SAME Redis buckets. Do NOT rename members without
/// updating <see cref="RateLimits.CategoryToken"/> and the cross-stack fixtures.
/// </summary>
public enum RateLimitCategory
{
    /// <summary>30 mutations / 1m.</summary>
    Mutation,

    /// <summary>100 queries / 1m.</summary>
    Query,

    /// <summary>10 auth attempts / 5m.</summary>
    Auth,

    /// <summary>10 AI calls / 1m — cost-controlled, keyed per-ORGANIZATION.</summary>
    Ai,

    /// <summary>5 exports / 5m.</summary>
    Export,
}
