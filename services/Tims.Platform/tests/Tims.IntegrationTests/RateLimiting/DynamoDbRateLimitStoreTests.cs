using Amazon.DynamoDBv2.Model;
using Tims.Domain.RateLimiting;
using Tims.Infrastructure.RateLimiting;

namespace Tims.IntegrationTests.RateLimiting;

/// <summary>
/// The shared DynamoDB store against a REAL DynamoDB engine (DynamoDB Local): budgets, the weighted sliding
/// window, atomic admission across windows (late and stale writes), contention, clock skew, counter cleanup
/// and the claim primitive. Items are inspected directly — the cross-stack sharing proof: the TS store
/// reads and writes these exact items (contracts/ratelimit-fixtures/dynamodb.json).
/// </summary>
[Collection(RateLimitStoreCollection.Name)]
public sealed class DynamoDbRateLimitStoreTests(DynamoDbRateLimitFixture fixture)
{
    private static string NewId() => $"user-{Guid.NewGuid():N}";

    private static long At(RateLimitCategory category, long bucket, long offsetMs = 0) =>
        (bucket * RateLimits.WindowMs(category)) + offsetMs;

    private async Task<long?> CounterAsync(RateLimitCategory category, string id, long bucket)
    {
        var item = await fixture.ItemAsync(RateLimits.PartitionKey(category, id));
        return item is not null && item.TryGetValue(RateLimits.WindowAttribute(bucket), out var v) ? long.Parse(v.N) : null;
    }

    [Fact]
    public async Task Allows_exactly_the_budget_and_does_not_count_the_denied_request()
    {
        var id = NewId();
        const RateLimitCategory category = RateLimitCategory.Export; // 5 tokens / 300000ms
        const long bucket = 100_000;
        var store = fixture.StoreAt(At(category, bucket, 150_000));

        for (var i = 1; i <= RateLimits.Tokens(category); i++)
        {
            var allowed = await store.SlidingWindowAsync(category, id);
            Assert.True(allowed.Allowed, $"request {i} should be allowed");
            Assert.Equal(RateLimits.Tokens(category) - i, allowed.Remaining);
        }

        var blocked = await store.SlidingWindowAsync(category, id);
        Assert.False(blocked.Allowed);
        Assert.Equal(RateLimits.Tokens(category), blocked.Limit);
        Assert.Equal(RateLimits.ResetAtMs(category, bucket), blocked.ResetAtMs);

        // The exact item a TS reader addresses: one counter, 5 (the denial did not increment), and a TTL.
        var item = await fixture.ItemAsync(RateLimits.PartitionKey(category, id));
        Assert.NotNull(item);
        Assert.Equal("5", item![RateLimits.WindowAttribute(bucket)].N);
        Assert.Equal(RateLimits.ExpiresAtSeconds(category, bucket).ToString(), item["expiresAt"].N);
        Assert.DoesNotContain(item.Values, v => v.S is { } s && s.Contains(id, StringComparison.Ordinal));
    }

    [Fact]
    public async Task Window_slides_carrying_the_previous_bucket_weighted()
    {
        var id = NewId();
        const RateLimitCategory category = RateLimitCategory.Export;
        var windowMs = RateLimits.WindowMs(category);
        const long bucket = 200_000;

        var inW = fixture.StoreAt(At(category, bucket, 150_000));
        for (var i = 0; i < RateLimits.Tokens(category); i++)
        {
            Assert.True((await inW.SlidingWindowAsync(category, id)).Allowed);
        }

        // Start of W+1: the previous 5 still count in full → blocked.
        Assert.False((await fixture.StoreAt(At(category, bucket + 1)).SlidingWindowAsync(category, id)).Allowed);
        // Late in W+1 the previous window has slid out → allowed again.
        Assert.True((await fixture.StoreAt(At(category, bucket + 1, windowMs - 1_000)).SlidingWindowAsync(category, id)).Allowed);
    }

    [Fact]
    public async Task Ai_category_keys_on_one_org_bucket_shared_across_users()
    {
        var orgIdentifier = $"org:org-{Guid.NewGuid():N}";
        const RateLimitCategory category = RateLimitCategory.Ai; // 10 tokens / 60000ms
        const long bucket = 300_000;
        var store = fixture.StoreAt(At(category, bucket, 30_000));

        for (var i = 0; i < RateLimits.Tokens(category); i++)
        {
            Assert.True((await store.SlidingWindowAsync(category, orgIdentifier)).Allowed);
        }

        Assert.False((await store.SlidingWindowAsync(category, orgIdentifier)).Allowed);
        Assert.Equal(RateLimits.Tokens(category), await CounterAsync(category, orgIdentifier, bucket));
    }

    [Fact]
    public async Task Honors_an_item_written_by_the_TS_stack()
    {
        // A previous-window counter exactly as packages/api writes it: same pk, same attribute names.
        var id = NewId();
        const RateLimitCategory category = RateLimitCategory.Ai;
        const long bucket = 400_000;
        await fixture.PutItemAsync(new Dictionary<string, AttributeValue>
        {
            ["pk"] = new() { S = RateLimits.PartitionKey(category, id) },
            [RateLimits.WindowAttribute(bucket)] = new() { N = "10" },
            ["expiresAt"] = new() { N = RateLimits.ExpiresAtSeconds(category, bucket).ToString() },
        });

        // Start of the next window: TS's 10 count in full, so C# must block.
        Assert.False((await fixture.StoreAt(At(category, bucket + 1)).SlidingWindowAsync(category, id)).Allowed);
    }

    [Fact]
    public async Task A_concurrent_burst_cannot_exceed_the_budget()
    {
        var id = NewId();
        const RateLimitCategory category = RateLimitCategory.Ai; // 10
        const long bucket = 500_000;
        var store = fixture.StoreAt(At(category, bucket, 5_000));

        var results = await Task.WhenAll(Enumerable.Range(0, 15).Select(_ => store.SlidingWindowAsync(category, id)));

        Assert.Equal(10, results.Count(r => r.Allowed));
        Assert.Equal(10, await CounterAsync(category, id, bucket));
    }

    [Fact]
    public async Task A_late_previous_window_write_between_read_and_write_is_seen()
    {
        // Exactly at the boundary the previous window overlaps 100%: 9 seen → room for 1; 10 → none.
        var id = NewId();
        const RateLimitCategory category = RateLimitCategory.Ai;
        const long bucket = 600_000;
        var pk = RateLimits.PartitionKey(category, id);
        await fixture.PutItemAsync(new Dictionary<string, AttributeValue>
        {
            ["pk"] = new() { S = pk },
            [RateLimits.WindowAttribute(bucket)] = new() { N = "9" },
        });
        var (client, hooks) = HookedDynamoDb.Wrap(fixture.Client);
        var landed = false;
        hooks.BeforeUpdate = async _ =>
        {
            if (landed) return;
            landed = true; // the 10th previous-window request commits after our read
            await fixture.PutItemAsync(new Dictionary<string, AttributeValue>
            {
                ["pk"] = new() { S = pk },
                [RateLimits.WindowAttribute(bucket)] = new() { N = "10" },
            });
        };
        var store = new DynamoDbRateLimitStore(client, DynamoDbRateLimitFixture.TableName, () => At(category, bucket + 1));

        var result = await store.SlidingWindowAsync(category, id);

        Assert.False(result.Allowed); // admitting it would make 11 of 10
        Assert.Null(await CounterAsync(category, id, bucket + 1));
    }

    [Fact]
    public async Task Re_decides_after_a_late_write_and_still_admits_when_room_remains()
    {
        var id = NewId();
        const RateLimitCategory category = RateLimitCategory.Ai;
        const long bucket = 700_000;
        var pk = RateLimits.PartitionKey(category, id);
        await fixture.PutItemAsync(new Dictionary<string, AttributeValue>
        {
            ["pk"] = new() { S = pk },
            [RateLimits.WindowAttribute(bucket)] = new() { N = "5" },
        });
        var (client, hooks) = HookedDynamoDb.Wrap(fixture.Client);
        var landed = false;
        hooks.BeforeUpdate = async _ =>
        {
            if (landed) return;
            landed = true;
            await fixture.PutItemAsync(new Dictionary<string, AttributeValue>
            {
                ["pk"] = new() { S = pk },
                [RateLimits.WindowAttribute(bucket)] = new() { N = "6" },
            });
        };
        var store = new DynamoDbRateLimitStore(client, DynamoDbRateLimitFixture.TableName, () => At(category, bucket + 1));

        Assert.True((await store.SlidingWindowAsync(category, id)).Allowed);
        Assert.Equal(2, hooks.UpdateCalls); // first write rejected (previous changed), re-read, admitted
        Assert.Equal(1, await CounterAsync(category, id, bucket + 1));
    }

    [Fact]
    public async Task Denies_with_a_short_retry_when_late_writes_land_on_every_re_read()
    {
        var id = NewId();
        const RateLimitCategory category = RateLimitCategory.Ai;
        const long bucket = 800_000;
        var pk = RateLimits.PartitionKey(category, id);
        var previous = 7;
        await fixture.PutItemAsync(new Dictionary<string, AttributeValue>
        {
            ["pk"] = new() { S = pk },
            [RateLimits.WindowAttribute(bucket)] = new() { N = previous.ToString() },
        });
        var (client, hooks) = HookedDynamoDb.Wrap(fixture.Client);
        hooks.BeforeUpdate = async _ =>
        {
            previous++;
            await fixture.PutItemAsync(new Dictionary<string, AttributeValue>
            {
                ["pk"] = new() { S = pk },
                [RateLimits.WindowAttribute(bucket)] = new() { N = previous.ToString() },
            });
        };
        var now = At(category, bucket + 1);
        var store = new DynamoDbRateLimitStore(client, DynamoDbRateLimitFixture.TableName, () => now);

        var result = await store.SlidingWindowAsync(category, id);

        Assert.False(result.Allowed);
        Assert.True(result.ResetAtMs - now <= DynamoDbRateLimitStore.ContentionRetryMs);
        Assert.Equal(DynamoDbRateLimitStore.Attempts, hooks.UpdateCalls);
        Assert.Null(await CounterAsync(category, id, bucket + 1));
    }

    [Fact]
    public async Task Adopts_a_later_window_another_instance_already_opened()
    {
        var id = NewId();
        const RateLimitCategory category = RateLimitCategory.Ai;
        const long bucket = 900_000;
        await fixture.PutItemAsync(new Dictionary<string, AttributeValue>
        {
            ["pk"] = new() { S = RateLimits.PartitionKey(category, id) },
            [RateLimits.WindowAttribute(bucket)] = new() { N = "6" },
            [RateLimits.WindowAttribute(bucket + 1)] = new() { N = "1" },
        });
        // This instance's clock is 50 ms behind the boundary.
        var store = fixture.StoreAt(At(category, bucket + 1) - 50);

        var allowed = 0;
        for (var i = 0; i < 10; i++) if ((await store.SlidingWindowAsync(category, id)).Allowed) allowed++;

        Assert.Equal(3, allowed); // previous 6 in full, 1 used → 3 more
        Assert.Equal(4, await CounterAsync(category, id, bucket + 1));
    }

    [Fact]
    public async Task Removes_counters_older_than_the_previous_window()
    {
        var id = NewId();
        const RateLimitCategory category = RateLimitCategory.Ai;
        const long bucket = 1_000_000;
        await fixture.PutItemAsync(new Dictionary<string, AttributeValue>
        {
            ["pk"] = new() { S = RateLimits.PartitionKey(category, id) },
            [RateLimits.WindowAttribute(bucket)] = new() { N = "4" },
            [RateLimits.WindowAttribute(bucket + 2)] = new() { N = "2" },
        });

        await fixture.StoreAt(At(category, bucket + 3, 1)).SlidingWindowAsync(category, id);

        var item = await fixture.ItemAsync(RateLimits.PartitionKey(category, id));
        Assert.Equal(
            new[] { "expiresAt", "pk", RateLimits.WindowAttribute(bucket + 2), RateLimits.WindowAttribute(bucket + 3) }.Order(),
            item!.Keys.Order());
    }

    [Fact]
    public async Task Claim_once_holds_for_the_window_and_releases_after_it()
    {
        var pk = $"relay#{Guid.NewGuid():N}";
        var now = 1_800_000_000_000L;
        var store = new DynamoDbRateLimitStore(fixture.Client, DynamoDbRateLimitFixture.TableName, () => now);

        Assert.True(await store.ClaimOnceAsync(pk, TimeSpan.FromSeconds(90)));
        Assert.False(await store.ClaimOnceAsync(pk, TimeSpan.FromSeconds(90)));
        now += 89_000;
        Assert.False(await store.ClaimOnceAsync(pk, TimeSpan.FromSeconds(90)));
        // Expired but not yet deleted by TTL: the claim must be available again.
        now += 2_000;
        Assert.True(await store.ClaimOnceAsync(pk, TimeSpan.FromSeconds(90)));
    }

    [Fact]
    public async Task A_hanging_store_call_times_out_at_the_deadline_and_is_cancelled()
    {
        var (client, hooks) = HookedDynamoDb.Wrap(fixture.Client);
        var cancelled = false;
        hooks.Override = (method, args) =>
        {
            if (method.Name != nameof(Amazon.DynamoDBv2.IAmazonDynamoDB.GetItemAsync)) return null;
            var token = (CancellationToken)args![1]!;
            var tcs = new TaskCompletionSource<GetItemResponse>(TaskCreationOptions.RunContinuationsAsynchronously);
            token.Register(() => { cancelled = true; tcs.TrySetCanceled(token); });
            return tcs.Task;
        };
        var store = new DynamoDbRateLimitStore(client, DynamoDbRateLimitFixture.TableName);

        var started = System.Diagnostics.Stopwatch.StartNew();
        var call = store.SlidingWindowAsync(RateLimitCategory.Query, NewId());
        // Without a working deadline the stubbed request never completes; fail instead of hanging.
        Assert.Same(call, await Task.WhenAny(call, Task.Delay(10_000)));
        await Assert.ThrowsAsync<TimeoutException>(() => call);

        Assert.True(cancelled, "the in-flight request must be cancelled, not just abandoned");
        Assert.InRange(started.ElapsedMilliseconds, DynamoDbRateLimitStore.TimeoutMs - 100, DynamoDbRateLimitStore.TimeoutMs + 2_000);
    }

    [Fact]
    public async Task A_store_call_that_ignores_cancellation_still_times_out_at_the_deadline()
    {
        var (client, hooks) = HookedDynamoDb.Wrap(fixture.Client);
        var never = new TaskCompletionSource<GetItemResponse>(TaskCreationOptions.RunContinuationsAsynchronously);
        hooks.Override = (method, _) =>
            method.Name == nameof(Amazon.DynamoDBv2.IAmazonDynamoDB.GetItemAsync) ? never.Task : null;
        var store = new DynamoDbRateLimitStore(client, DynamoDbRateLimitFixture.TableName);

        var started = System.Diagnostics.Stopwatch.StartNew();
        var call = store.SlidingWindowAsync(RateLimitCategory.Query, NewId());
        Assert.Same(call, await Task.WhenAny(call, Task.Delay(10_000)));
        await Assert.ThrowsAsync<TimeoutException>(() => call);
        Assert.InRange(started.ElapsedMilliseconds, DynamoDbRateLimitStore.TimeoutMs - 100, DynamoDbRateLimitStore.TimeoutMs + 2_000);
    }
}
