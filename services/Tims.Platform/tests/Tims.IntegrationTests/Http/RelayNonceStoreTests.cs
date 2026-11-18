using Amazon.DynamoDBv2;
using Amazon.DynamoDBv2.Model;
using Microsoft.Extensions.DependencyInjection;
using Tims.Api.Http;
using Tims.Infrastructure.RateLimiting;
using Tims.IntegrationTests.RateLimiting;

namespace Tims.IntegrationTests.Http;

[Collection(RateLimitStoreCollection.Name)]
public sealed class RelayNonceStoreTests(DynamoDbRateLimitFixture fixture)
{
    [Fact]
    public async Task TwoInstancesAtomicallyConsumeOneNonceWithNinetySecondExpiry()
    {
        using var services = new ServiceCollection().AddSingleton(fixture.Store()).BuildServiceProvider();
        var first = new RelayNonceStore(services, new TestHostEnvironment("Production"));
        var second = new RelayNonceStore(services, new TestHostEnvironment("Production"));
        var nonce = Guid.NewGuid().ToString();
        var before = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
        var results = await Task.WhenAll(first.TryUseAsync(nonce), second.TryUseAsync(nonce));
        Assert.Single(results, accepted => accepted);
        Assert.False(await first.TryUseAsync(nonce));

        // Stored under sha256(nonce): the raw nonce never reaches the table.
        Assert.Null(await fixture.ItemAsync($"relay#{nonce}"));
        var item = await fixture.ItemAsync(RelayNonceStore.PartitionKey(nonce));
        Assert.NotNull(item);
        Assert.InRange(long.Parse(item!["expiresAt"].N) - before, 89, 91);
    }

    [Theory]
    [InlineData("Production")]
    [InlineData("Staging")]
    public async Task MissingStoreFailsClosedOutsideDevelopment(string environment)
    {
        using var services = new ServiceCollection().BuildServiceProvider();
        var store = new RelayNonceStore(services, new TestHostEnvironment(environment));
        Assert.False(await store.TryUseAsync(Guid.NewGuid().ToString()));
    }

    [Fact]
    public async Task DevelopmentFallbackAcceptsOnceAndRejectsReplay()
    {
        using var services = new ServiceCollection().BuildServiceProvider();
        var store = new RelayNonceStore(services, new TestHostEnvironment("Development"));
        var nonce = Guid.NewGuid().ToString();
        Assert.True(await store.TryUseAsync(nonce));
        Assert.False(await store.TryUseAsync(nonce));
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task StoreFailureOrTimeoutNeverFallsBackEvenInDevelopment(bool stall)
    {
        var (client, hooks) = HookedDynamoDb.Wrap(fixture.Client);
        var writes = 0;
        hooks.Override = (method, args) =>
        {
            if (method.Name != nameof(IAmazonDynamoDB.PutItemAsync)) throw new InvalidOperationException(method.Name);
            writes++;
            if (!stall) return Task.FromException<PutItemResponse>(new AmazonDynamoDBException("test failure"));
            var tcs = new TaskCompletionSource<PutItemResponse>(TaskCreationOptions.RunContinuationsAsynchronously);
            ((CancellationToken)args![1]!).Register(() => tcs.TrySetCanceled());
            return tcs.Task;
        };
        using var services = new ServiceCollection()
            .AddSingleton(new DynamoDbRateLimitStore(client, DynamoDbRateLimitFixture.TableName))
            .BuildServiceProvider();
        var store = new RelayNonceStore(services, new TestHostEnvironment("Development"));
        Assert.False(await store.TryUseAsync(Guid.NewGuid().ToString()).WaitAsync(TimeSpan.FromSeconds(5)));
        Assert.Equal(1, writes);
    }
}
