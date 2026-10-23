using System.Globalization;
using Amazon.DynamoDBv2;
using Amazon.DynamoDBv2.Model;
using Tims.Domain.RateLimiting;

namespace Tims.Infrastructure.RateLimiting;

/// <summary>
/// The shared rate-limit store: one DynamoDB table (on-demand), partition key <c>pk</c>, TTL attribute
/// <c>expiresAt</c>. A byte-for-byte port of the TS store (<c>packages/api/src/middleware/rate-limit-store.ts</c>)
/// so both stacks read and write the SAME items and a caller has ONE budget across them. The item layout
/// and the exact expressions are frozen in <c>contracts/ratelimit-fixtures/dynamodb.json</c>, which both
/// test suites assert.
///
/// Sliding window = <c>@upstash/ratelimit</c>'s algorithm: the previous window's count is weighted by its
/// remaining overlap, and a denied request is not counted. Admission is atomic, as Upstash's Lua script
/// was: both windows live on one item and one conditional write checks that the current window has room,
/// that the previous window is exactly what was weighed, and that no later window has started. A late or
/// stale write is rejected and re-decided at the current time (at most <see cref="Attempts"/>); if late
/// writes keep landing the request is DENIED, never failed — the store answered every call.
///
/// Every call runs under <see cref="TimeoutMs"/>; the deadline cancels the in-flight request and surfaces
/// as <see cref="TimeoutException"/>. Store errors propagate; the caller owns the outage policy.
/// </summary>
public sealed class DynamoDbRateLimitStore
{
    /// <summary>Hard deadline per store call, matching the TS <c>SHARED_LIMIT_TIMEOUT_MS</c>.</summary>
    public const int TimeoutMs = 1_000;

    /// <summary>Bounded re-reads when the windows move under a request (TS <c>SLIDING_WINDOW_ATTEMPTS</c>).</summary>
    internal const int Attempts = 3;

    /// <summary>Retry hint when re-reads are exhausted (TS <c>CONTENTION_RETRY_MS</c>).</summary>
    internal const long ContentionRetryMs = 1_000;

    internal const string UpdateExpression = "ADD #cur :one SET #e = :exp";
    internal const string CurrentHasRoom = "(attribute_not_exists(#cur) OR #cur < :max)";
    internal const string ClaimCondition = "attribute_not_exists(pk) OR #e <= :now";

    private readonly IAmazonDynamoDB _client;
    private readonly string _tableName;
    private readonly Func<long> _nowMs;

    public DynamoDbRateLimitStore(IAmazonDynamoDB client, string tableName)
        : this(client, tableName, () => DateTimeOffset.UtcNow.ToUnixTimeMilliseconds())
    {
    }

    /// <summary>Test seam: inject a deterministic clock to pin the bucket + sliding weight.</summary>
    internal DynamoDbRateLimitStore(IAmazonDynamoDB client, string tableName, Func<long> nowMs)
    {
        ArgumentNullException.ThrowIfNull(client);
        ArgumentException.ThrowIfNullOrWhiteSpace(tableName);
        _client = client;
        _tableName = tableName;
        _nowMs = nowMs;
    }

    /// <summary>Consume one token for <paramref name="identifier"/> in <paramref name="category"/>.</summary>
    public Task<RateLimitResult> SlidingWindowAsync(
        RateLimitCategory category,
        string identifier,
        CancellationToken cancellationToken = default)
    {
        ArgumentException.ThrowIfNullOrEmpty(identifier);
        return WithDeadlineAsync(token => SlidingWindowCoreAsync(category, identifier, token), cancellationToken);
    }

    /// <summary>
    /// Claims <paramref name="partitionKey"/> for <paramref name="window"/> (rolling). True = claimed now;
    /// false = already claimed within the window. Errors and timeouts propagate.
    /// </summary>
    public Task<bool> ClaimOnceAsync(string partitionKey, TimeSpan window, CancellationToken cancellationToken = default)
    {
        ArgumentException.ThrowIfNullOrEmpty(partitionKey);
        return WithDeadlineAsync(token => ClaimOnceCoreAsync(partitionKey, window, token), cancellationToken);
    }

    /// <summary>Readiness probe: one strongly consistent read of a fixed key. Throws when unreachable.</summary>
    public Task ProbeAsync(CancellationToken cancellationToken = default) =>
        WithDeadlineAsync(
            async token =>
            {
                await _client.GetItemAsync(
                    new GetItemRequest
                    {
                        TableName = _tableName,
                        Key = new Dictionary<string, AttributeValue> { ["pk"] = new() { S = "health#probe" } },
                        ConsistentRead = true,
                    },
                    token).ConfigureAwait(false);
                return true;
            },
            cancellationToken);

    private async Task<RateLimitResult> SlidingWindowCoreAsync(
        RateLimitCategory category,
        string identifier,
        CancellationToken token)
    {
        var tokens = RateLimits.Tokens(category);
        var windowMs = RateLimits.WindowMs(category);
        var key = new Dictionary<string, AttributeValue>
        {
            ["pk"] = new() { S = RateLimits.PartitionKey(category, identifier) },
        };

        for (var attempt = 0; attempt < Attempts; attempt++)
        {
            var read = await _client.GetItemAsync(
                new GetItemRequest
                {
                    TableName = _tableName,
                    Key = key,
                    // Strongly consistent: an eventually consistent read just after a window
                    // boundary can miss the previous window's latest increments.
                    ConsistentRead = true,
                },
                token).ConfigureAwait(false);

            var counts = WindowCounts(read.Item);
            var now = _nowMs();
            var current = now / windowMs;
            var overlap = 1 - ((double)(now % windowMs) / windowMs);
            // Another instance's clock is ahead and already opened a later window: adopt it, and
            // count the previous window in full (we cannot know how far into it we are).
            if (counts.Count > 0 && counts.Keys.Max() > current)
            {
                current = counts.Keys.Max();
                overlap = 1;
            }

            var resetAtMs = (current + 1) * windowMs;
            var previousCount = counts.GetValueOrDefault(current - 1);
            var currentCount = counts.GetValueOrDefault(current);
            var allowedInCurrent = tokens - (long)Math.Floor(previousCount * overlap);
            if (currentCount >= allowedInCurrent)
            {
                return new RateLimitResult(Allowed: false, Limit: tokens, Remaining: 0, ResetAtMs: resetAtMs);
            }

            var curName = RateLimits.WindowAttribute(current);
            var names = new Dictionary<string, string>
            {
                ["#cur"] = curName,
                ["#prev"] = RateLimits.WindowAttribute(current - 1),
                ["#next"] = RateLimits.WindowAttribute(current + 1),
                ["#e"] = "expiresAt",
            };
            var stale = counts.Keys.Where(w => w < current - 1).OrderBy(w => w).ToList();
            for (var i = 0; i < stale.Count; i++)
            {
                names[$"#old{i}"] = RateLimits.WindowAttribute(stale[i]);
            }

            var values = new Dictionary<string, AttributeValue>
            {
                [":one"] = Number(1),
                [":max"] = Number(allowedInCurrent),
                [":exp"] = Number(RateLimits.ExpiresAtSeconds(category, current)),
            };
            if (previousCount > 0)
            {
                values[":prevSeen"] = Number(previousCount);
            }

            try
            {
                var updated = await _client.UpdateItemAsync(
                    new UpdateItemRequest
                    {
                        TableName = _tableName,
                        Key = key,
                        UpdateExpression = UpdateExpression
                            + (stale.Count > 0 ? " REMOVE " + string.Join(", ", stale.Select((_, i) => $"#old{i}")) : string.Empty),
                        ConditionExpression = SlidingWindowCondition(previousCount > 0),
                        ExpressionAttributeNames = names,
                        ExpressionAttributeValues = values,
                        ReturnValues = ReturnValue.UPDATED_NEW,
                    },
                    token).ConfigureAwait(false);

                var newCount = updated.Attributes is { } attrs && attrs.TryGetValue(curName, out var v)
                    ? long.Parse(v.N, CultureInfo.InvariantCulture)
                    : currentCount + 1;
                return new RateLimitResult(
                    Allowed: true,
                    Limit: tokens,
                    Remaining: (int)Math.Max(0, allowedInCurrent - newCount),
                    ResetAtMs: resetAtMs);
            }
            catch (ConditionalCheckFailedException)
            {
                // Full, or the windows moved under us: re-read and decide again.
            }
        }

        return new RateLimitResult(
            Allowed: false,
            Limit: tokens,
            Remaining: 0,
            ResetAtMs: _nowMs() + ContentionRetryMs);
    }

    private async Task<bool> ClaimOnceCoreAsync(string partitionKey, TimeSpan window, CancellationToken token)
    {
        var nowSeconds = _nowMs() / 1000;
        try
        {
            await _client.PutItemAsync(
                new PutItemRequest
                {
                    TableName = _tableName,
                    Item = new Dictionary<string, AttributeValue>
                    {
                        ["pk"] = new() { S = partitionKey },
                        ["expiresAt"] = Number(nowSeconds + (long)Math.Ceiling(window.TotalSeconds)),
                    },
                    // DynamoDB TTL deletes lazily, so an expired claim may still be present.
                    ConditionExpression = ClaimCondition,
                    ExpressionAttributeNames = new Dictionary<string, string> { ["#e"] = "expiresAt" },
                    ExpressionAttributeValues = new Dictionary<string, AttributeValue> { [":now"] = Number(nowSeconds) },
                },
                token).ConfigureAwait(false);
            return true;
        }
        catch (ConditionalCheckFailedException)
        {
            return false;
        }
    }

    /// <summary>The exact condition string the TS store sends (frozen in the contract fixture).</summary>
    internal static string SlidingWindowCondition(bool hasPrevious) =>
        $"{CurrentHasRoom} AND {(hasPrevious ? "#prev = :prevSeen" : "attribute_not_exists(#prev)")} AND attribute_not_exists(#next)";

    /// <summary>Window index → count, from an item's <c>w&lt;index&gt;</c> attributes.</summary>
    internal static Dictionary<long, long> WindowCounts(Dictionary<string, AttributeValue>? item)
    {
        var counts = new Dictionary<long, long>();
        if (item is null)
        {
            return counts;
        }

        foreach (var (name, value) in item)
        {
            if (name.Length > 1 && name[0] == 'w' && name.AsSpan(1).IndexOfAnyExceptInRange('0', '9') < 0
                && long.TryParse(name.AsSpan(1), NumberStyles.None, CultureInfo.InvariantCulture, out var window)
                && value.N is { } n)
            {
                counts[window] = long.Parse(n, CultureInfo.InvariantCulture);
            }
        }

        return counts;
    }

    private static AttributeValue Number(long value) => new() { N = value.ToString(CultureInfo.InvariantCulture) };

    /// <summary>
    /// Runs <paramref name="call"/> under <see cref="TimeoutMs"/>. Expiry cancels the in-flight request and
    /// surfaces as <see cref="TimeoutException"/>; a cancellation the CALLER requested (client went away)
    /// still surfaces as <see cref="OperationCanceledException"/>.
    /// </summary>
    private static async Task<T> WithDeadlineAsync<T>(Func<CancellationToken, Task<T>> call, CancellationToken cancellationToken)
    {
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        deadline.CancelAfter(TimeoutMs);
        try
        {
            return await call(deadline.Token).ConfigureAwait(false);
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            throw new TimeoutException("Shared rate-limit store timed out");
        }
    }
}
