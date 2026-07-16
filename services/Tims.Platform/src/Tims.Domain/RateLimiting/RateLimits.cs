namespace Tims.Domain.RateLimiting;

/// <summary>
/// The frozen tokens-per-window table + Redis key layout, a byte-for-byte port of the TS
/// <c>LIMITS</c> map and the <c>@upstash/ratelimit</c> single-region <c>slidingWindow</c> key
/// structure (verified against <c>@upstash/ratelimit@2.0.8</c>). These constants are the
/// cross-stack contract: the C# limiter and the TS limiter MUST produce identical keys and
/// identical per-window budgets or they would not share buckets. Frozen in
/// <c>contracts/ratelimit-fixtures/key-layout.md</c>.
/// </summary>
public static class RateLimits
{
    /// <summary>The shared Redis key namespace (Upstash <c>Ratelimit.prefix</c> stem).</summary>
    public const string KeyNamespace = "tims:ratelimit";

    /// <summary>Requests (tokens) permitted per sliding window for a category.</summary>
    public static int Tokens(RateLimitCategory category) => category switch
    {
        RateLimitCategory.Mutation => 30,
        RateLimitCategory.Query => 100,
        RateLimitCategory.Auth => 10,
        RateLimitCategory.Ai => 10,
        RateLimitCategory.Export => 5,
        _ => throw new ArgumentOutOfRangeException(nameof(category), category, null),
    };

    /// <summary>Sliding-window length in milliseconds for a category (1m or 5m).</summary>
    public static long WindowMs(RateLimitCategory category) => category switch
    {
        RateLimitCategory.Mutation => 60_000,
        RateLimitCategory.Query => 60_000,
        RateLimitCategory.Auth => 300_000,
        RateLimitCategory.Ai => 60_000,
        RateLimitCategory.Export => 300_000,
        _ => throw new ArgumentOutOfRangeException(nameof(category), category, null),
    };

    /// <summary>
    /// The lowercase wire token for a category, matching the TS <c>LIMITS</c> object key. This
    /// is the segment interpolated into the shared Upstash prefix, so it MUST stay lowercase and
    /// identical to the TS keys (mutation/query/auth/ai/export).
    /// </summary>
    public static string CategoryToken(RateLimitCategory category) => category switch
    {
        RateLimitCategory.Mutation => "mutation",
        RateLimitCategory.Query => "query",
        RateLimitCategory.Auth => "auth",
        RateLimitCategory.Ai => "ai",
        RateLimitCategory.Export => "export",
        _ => throw new ArgumentOutOfRangeException(nameof(category), category, null),
    };

    /// <summary>
    /// The Upstash <c>Ratelimit.prefix</c> for a category: <c>tims:ratelimit:{category}</c>.
    /// Upstash builds <c>getKey(identifier) = "{prefix}:{identifier}"</c>, then the sliding-window
    /// limiter appends <c>":{bucket}"</c> — see <see cref="CurrentKey"/>/<see cref="PreviousKey"/>.
    /// </summary>
    public static string Prefix(RateLimitCategory category) => $"{KeyNamespace}:{CategoryToken(category)}";

    /// <summary>
    /// The fixed-window bucket index: <c>floor(nowMs / windowMs)</c>, computed identically in
    /// <c>@upstash/ratelimit</c> JS (<c>Math.floor(now / windowSize)</c>) — NOT in Lua.
    /// </summary>
    public static long Bucket(RateLimitCategory category, long nowMs) => nowMs / WindowMs(category);

    /// <summary>
    /// The current-window Redis key: <c>tims:ratelimit:{category}:{identifier}:{bucket}</c>.
    /// This is the exact key both stacks INCRBY, which is what makes the buckets shared.
    /// </summary>
    public static string CurrentKey(RateLimitCategory category, string identifier, long bucket) =>
        $"{Prefix(category)}:{identifier}:{bucket}";

    /// <summary>The previous-window key (<c>bucket - 1</c>), read for the sliding interpolation.</summary>
    public static string PreviousKey(RateLimitCategory category, string identifier, long bucket) =>
        $"{Prefix(category)}:{identifier}:{bucket - 1}";

    /// <summary>
    /// Timestamp (unix ms) at which the current window rolls over: <c>(bucket + 1) * windowMs</c>,
    /// matching Upstash's <c>reset</c>. Used to compute the Spanish retry-after seconds.
    /// </summary>
    public static long ResetAtMs(RateLimitCategory category, long bucket) => (bucket + 1) * WindowMs(category);
}
