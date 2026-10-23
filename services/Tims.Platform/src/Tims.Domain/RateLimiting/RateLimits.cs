using System.Security.Cryptography;
using System.Text;

namespace Tims.Domain.RateLimiting;

/// <summary>
/// The frozen tokens-per-window table + shared DynamoDB item layout, a byte-for-byte port of the TS
/// <c>LIMITS</c> map and <c>packages/api/src/middleware/rate-limit-store.ts</c>. These constants are
/// the cross-stack contract: the C# limiter and the TS limiter MUST address identical items with
/// identical per-window budgets or they would not share buckets. Frozen in
/// <c>contracts/ratelimit-fixtures/key-layout.md</c> and <c>dynamodb.json</c>.
/// </summary>
public static class RateLimits
{

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
    /// is the segment interpolated into the shared partition key, so it MUST stay lowercase and
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
    /// The fixed-window bucket index: <c>floor(nowMs / windowMs)</c>, computed identically in TS
    /// (<c>Math.floor(now / windowMs)</c>).
    /// </summary>
    public static long Bucket(RateLimitCategory category, long nowMs) => nowMs / WindowMs(category);

    /// <summary>
    /// The shared item's partition key: <c>rl#{category}#{lowercase hex sha256(utf8 identifier)}</c>.
    /// One item per category + identifier holds a counter per window; the raw identifier (user id,
    /// client IP, api-key id) never reaches the table.
    /// </summary>
    public static string PartitionKey(RateLimitCategory category, string identifier) =>
        $"rl#{CategoryToken(category)}#{Sha256Hex(identifier)}";

    /// <summary>The per-window counter attribute on the shared item: <c>w{bucket}</c>.</summary>
    public static string WindowAttribute(long bucket) => $"w{bucket}";

    /// <summary>
    /// The item's TTL (epoch seconds): it must outlive the NEXT window, for which this one is the
    /// "previous". <c>ceil((bucket + 2) * windowMs / 1000) + 60</c>.
    /// </summary>
    public static long ExpiresAtSeconds(RateLimitCategory category, long bucket) =>
        (long)Math.Ceiling((bucket + 2) * WindowMs(category) / 1000.0) + 60;

    /// <summary>Lowercase hex SHA-256 of the UTF-8 bytes — identical to Node's <c>digest('hex')</c>.</summary>
    public static string Sha256Hex(string value) =>
        Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(value)));

    /// <summary>
    /// Timestamp (unix ms) at which the current window rolls over: <c>(bucket + 1) * windowMs</c>,
    /// matching Upstash's <c>reset</c>. Used to compute the Spanish retry-after seconds.
    /// </summary>
    public static long ResetAtMs(RateLimitCategory category, long bucket) => (bucket + 1) * WindowMs(category);
}
