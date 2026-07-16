using StackExchange.Redis;
using Tims.Application.RateLimiting;
using Tims.Domain.RateLimiting;

namespace Tims.Infrastructure.RateLimiting;

/// <summary>
/// A rate limiter that reproduces <c>@upstash/ratelimit@2.0.8</c> single-region
/// <c>slidingWindow</c> BYTE-FOR-BYTE so its Redis buckets are SHARED with the TS stack. It talks
/// raw Redis via StackExchange.Redis (Upstash exposes a Redis TCP endpoint; the KEYS + algorithm,
/// not the client library, are what make the limits shared) and EVALs the identical Lua script on
/// the identical keys.
///
/// Key layout replicated (verified against node_modules):
///   prefix      = "tims:ratelimit:{category}"                       (Upstash Ratelimit.prefix)
///   getKey(id)  = "{prefix}:{identifier}"                           ([prefix, id].join(":"))
///   bucket      = floor(now_ms / window_ms)                         (computed in JS/C#, not Lua)
///   currentKey  = "{prefix}:{identifier}:{bucket}"                  ([key, currentWindow].join(":"))
///   previousKey = "{prefix}:{identifier}:{bucket-1}"
/// EVAL KEYS = [currentKey, previousKey, "" (dynamicLimitKey)], ARGV = [tokens, now, window, incrementBy=1].
/// success = result[0] >= 0 (Lua returns {-1, limit} when throttled).
/// </summary>
public sealed class RedisSlidingWindowRateLimiter : IRateLimiter
{
    private readonly IConnectionMultiplexer _connection;
    private readonly Func<long> _nowMs;

    public RedisSlidingWindowRateLimiter(IConnectionMultiplexer connection)
        : this(connection, () => DateTimeOffset.UtcNow.ToUnixTimeMilliseconds())
    {
    }

    /// <summary>Test seam: inject a deterministic clock to pin the bucket + sliding weight.</summary>
    internal RedisSlidingWindowRateLimiter(IConnectionMultiplexer connection, Func<long> nowMs)
    {
        _connection = connection;
        _nowMs = nowMs;
    }

    /// <summary>
    /// The EXACT single-region <c>slidingWindowLimitScript</c> from <c>@upstash/ratelimit@2.0.8</c>
    /// (dist/index.js). Reproduced verbatim so both stacks compute the identical weighted
    /// sliding-window decision on the shared keys. DynamicLimitKey is unused ("") — TIMS does not
    /// enable dynamic limits.
    /// </summary>
    internal const string SlidingWindowLimitScript = """
        local currentKey  = KEYS[1]           -- identifier including prefixes
        local previousKey = KEYS[2]           -- key of the previous bucket
        local dynamicLimitKey = KEYS[3]       -- optional: key for dynamic limit in redis
        local tokens      = tonumber(ARGV[1]) -- default tokens per window
        local now         = ARGV[2]           -- current timestamp in milliseconds
        local window      = ARGV[3]           -- interval in milliseconds
        local incrementBy = tonumber(ARGV[4]) -- increment rate per request at a given value, default is 1

        -- Check for dynamic limit
        local effectiveLimit = tokens
        if dynamicLimitKey ~= "" then
          local dynamicLimit = redis.call("GET", dynamicLimitKey)
          if dynamicLimit then
            effectiveLimit = tonumber(dynamicLimit)
          end
        end

        local requestsInCurrentWindow = redis.call("GET", currentKey)
        if requestsInCurrentWindow == false then
          requestsInCurrentWindow = 0
        end

        local requestsInPreviousWindow = redis.call("GET", previousKey)
        if requestsInPreviousWindow == false then
          requestsInPreviousWindow = 0
        end
        local percentageInCurrent = ( now % window ) / window
        -- weighted requests to consider from the previous window
        requestsInPreviousWindow = math.floor(( 1 - percentageInCurrent ) * requestsInPreviousWindow)

        -- Only check limit if not refunding (negative rate)
        if incrementBy > 0 and requestsInPreviousWindow + requestsInCurrentWindow >= effectiveLimit then
          return {-1, effectiveLimit}
        end

        local newValue = redis.call("INCRBY", currentKey, incrementBy)
        if newValue == incrementBy then
          -- The first time this key is set, the value will be equal to incrementBy.
          -- So we only need the expire command once
          redis.call("PEXPIRE", currentKey, window * 2 + 1000)
        end
        return {effectiveLimit - ( newValue + requestsInPreviousWindow ), effectiveLimit}
        """;

    public async Task<RateLimitResult> LimitAsync(
        string identifier,
        RateLimitCategory category,
        CancellationToken cancellationToken = default)
    {
        ArgumentException.ThrowIfNullOrEmpty(identifier);
        cancellationToken.ThrowIfCancellationRequested();

        var nowMs = _nowMs();
        var windowMs = RateLimits.WindowMs(category);
        var bucket = RateLimits.Bucket(category, nowMs);
        var tokens = RateLimits.Tokens(category);

        var currentKey = RateLimits.CurrentKey(category, identifier, bucket);
        var previousKey = RateLimits.PreviousKey(category, identifier, bucket);

        var database = _connection.GetDatabase();
        var raw = await database.ScriptEvaluateAsync(
            SlidingWindowLimitScript,
            // Third key is the (unused) dynamicLimitKey — Upstash passes "" so the Lua's
            // `if dynamicLimitKey ~= ""` guard short-circuits and no GET is issued.
            keys: [currentKey, previousKey, (RedisKey)string.Empty],
            values: [tokens, nowMs, windowMs, 1]).ConfigureAwait(false);

        // The Lua returns a two-element array: {remaining, effectiveLimit}. remaining < 0 (== -1)
        // means throttled — exactly TS `success = remainingTokens >= 0`.
        var values = (RedisValue[]?)raw ?? throw new InvalidOperationException("ratelimit EVAL returned a non-array reply");
        var remaining = (int)values[0];
        var effectiveLimit = (int)values[1];

        return new RateLimitResult(
            Allowed: remaining >= 0,
            Limit: effectiveLimit,
            Remaining: Math.Max(0, remaining),
            ResetAtMs: RateLimits.ResetAtMs(category, bucket));
    }
}
