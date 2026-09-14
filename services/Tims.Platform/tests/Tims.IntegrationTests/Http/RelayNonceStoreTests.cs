using System.Reflection;
using Microsoft.Extensions.DependencyInjection;
using StackExchange.Redis;
using Tims.Api.Http;
using Tims.IntegrationTests.RateLimiting;

namespace Tims.IntegrationTests.Http;

[Collection(RedisRateLimitCollection.Name)]
public sealed class RelayNonceStoreTests(RedisRateLimitFixture fixture)
{
    [Fact]
    public async Task TwoInstancesAtomicallyConsumeOneNonceWithNinetySecondExpiry()
    {
        using var services = new ServiceCollection().AddSingleton(fixture.Connection).BuildServiceProvider();
        var first = new RelayNonceStore(services, new TestHostEnvironment("Production"));
        var second = new RelayNonceStore(services, new TestHostEnvironment("Production"));
        var nonce = Guid.NewGuid().ToString();
        var results = await Task.WhenAll(first.TryUseAsync(nonce), second.TryUseAsync(nonce));
        Assert.Single(results, accepted => accepted);
        Assert.False(await first.TryUseAsync(nonce));
        var database = fixture.Connection.GetDatabase();
        Assert.Equal("1", (string?)await database.StringGetAsync($"tims:relay:nonce:{nonce}"));
        var ttl = await database.KeyTimeToLiveAsync($"tims:relay:nonce:{nonce}");
        Assert.NotNull(ttl);
        Assert.InRange(ttl.Value.TotalSeconds, 80, 90);
    }

    [Theory]
    [InlineData("Production")]
    [InlineData("Staging")]
    public async Task MissingRedisFailsClosedOutsideDevelopment(string environment)
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
    public async Task RedisFailureOrTimeoutNeverFallsBackEvenInDevelopment(bool stall)
    {
        var pending = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
        var writes = 0;
        var database = DispatchProxy.Create<IDatabase, RedisCallProxy>();
        ((RedisCallProxy)(object)database).InvokeCall = (method, _) =>
        {
            if (method.Name != "StringSetAsync") throw new InvalidOperationException(method.Name);
            writes++;
            return stall ? pending.Task : Task.FromException<bool>(new RedisException("test failure"));
        };
        var connection = DispatchProxy.Create<IConnectionMultiplexer, RedisCallProxy>();
        ((RedisCallProxy)(object)connection).InvokeCall = (method, _) => method.Name == "GetDatabase"
            ? database : throw new InvalidOperationException(method.Name);
        using var services = new ServiceCollection().AddSingleton(connection).BuildServiceProvider();
        var store = new RelayNonceStore(services, new TestHostEnvironment("Development"));
        Assert.False(await store.TryUseAsync(Guid.NewGuid().ToString()).WaitAsync(TimeSpan.FromSeconds(5)));
        Assert.Equal(1, writes);
        pending.TrySetResult(false);
    }

    public class RedisCallProxy : DispatchProxy
    {
        public Func<MethodInfo, object?[]?, object?> InvokeCall { get; set; } = null!;
        protected override object? Invoke(MethodInfo? targetMethod, object?[]? args) => InvokeCall(targetMethod!, args);
    }
}
