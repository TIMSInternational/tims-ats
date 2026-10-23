using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using StackExchange.Redis;
using Testcontainers.Redis;
using Tims.Api.Http;
using Tims.IntegrationTests.RateLimiting;

namespace Tims.IntegrationTests.Http;

/// <summary>A real Redis standing in for the Upstash database pre-DynamoDB images use for relay nonces.</summary>
public sealed class LegacyRedisFixture : IAsyncLifetime
{
    private readonly RedisContainer _container = new RedisBuilder("redis:7-alpine").Build();

    public IConnectionMultiplexer Connection { get; private set; } = null!;

    public async Task InitializeAsync()
    {
        await _container.StartAsync();
        Connection = await ConnectionMultiplexer.ConnectAsync(_container.GetConnectionString());
    }

    public async Task DisposeAsync()
    {
        if (Connection is not null)
        {
            await Connection.DisposeAsync();
        }

        await _container.DisposeAsync();
    }
}

/// <summary>
/// The rollback-window bridge: while old (Redis) and new (DynamoDB) images can both serve traffic, a relay
/// nonce used on either must be rejected by the other. The old image's behaviour is reproduced exactly: SET NX
/// on <c>tims:relay:nonce:{nonce}</c> with a 90 s expiry.
/// </summary>
[Collection(RateLimitStoreCollection.Name)]
public sealed class RelayNonceBridgeTests(DynamoDbRateLimitFixture dynamo, LegacyRedisFixture redis)
    : IClassFixture<LegacyRedisFixture>
{
    private RelayNonceStore NewImage(IConnectionMultiplexer? legacy)
    {
        var services = new ServiceCollection().AddSingleton(dynamo.Store());
        if (legacy is not null)
        {
            services.AddSingleton(new LegacyRelayNonceBridge(legacy));
        }

        return new RelayNonceStore(services.BuildServiceProvider(), new TestHostEnvironment("Production"));
    }

    private Task<bool> OldImageUses(string nonce) =>
        redis.Connection.GetDatabase().StringSetAsync($"tims:relay:nonce:{nonce}", "1", TimeSpan.FromSeconds(90), When.NotExists);

    [Fact]
    public async Task A_nonce_an_old_image_used_is_rejected_by_the_new_image()
    {
        var nonce = Guid.NewGuid().ToString();
        Assert.True(await OldImageUses(nonce));

        Assert.False(await NewImage(redis.Connection).TryUseAsync(nonce));
    }

    [Fact]
    public async Task A_nonce_the_new_image_used_is_rejected_by_an_old_image()
    {
        var nonce = Guid.NewGuid().ToString();
        Assert.True(await NewImage(redis.Connection).TryUseAsync(nonce));

        Assert.False(await OldImageUses(nonce));
        var ttl = await redis.Connection.GetDatabase().KeyTimeToLiveAsync(LegacyRelayNonceBridge.Key(nonce));
        Assert.InRange(ttl!.Value.TotalSeconds, 85, 90);
        // And the new image's own claim is in DynamoDB too.
        Assert.NotNull(await dynamo.ItemAsync(RelayNonceStore.PartitionKey(nonce)));
        Assert.False(await NewImage(redis.Connection).TryUseAsync(nonce));
    }

    [Fact]
    public async Task An_unreachable_legacy_store_rejects_the_nonce()
    {
        var config = ConfigurationOptions.Parse("127.0.0.1:1");
        config.AbortOnConnectFail = false;
        config.ConnectTimeout = 500;
        await using var dead = await ConnectionMultiplexer.ConnectAsync(config);

        Assert.False(await NewImage(dead).TryUseAsync(Guid.NewGuid().ToString()));
    }

    [Theory]
    [InlineData("127.0.0.1:1", true)]
    [InlineData(null, false)]
    public void The_host_registers_the_bridge_only_while_the_legacy_setting_is_present(string? setting, bool expected)
    {
        using var factory = new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.UseEnvironment("Development");
            builder.UseSetting("Platform:DatabaseConnectionString", "Host=127.0.0.1;Port=1;Database=x;Username=x;Password=x");
            if (setting is not null)
            {
                builder.UseSetting("Platform:RedisConnectionString", setting);
            }
        });

        Assert.Equal(expected, factory.Services.GetService<LegacyRelayNonceBridge>() is not null);
    }

    [Fact]
    public async Task Without_the_legacy_setting_only_DynamoDB_is_consulted()
    {
        var nonce = Guid.NewGuid().ToString();
        Assert.True(await NewImage(legacy: null).TryUseAsync(nonce));

        Assert.False(await redis.Connection.GetDatabase().KeyExistsAsync(LegacyRelayNonceBridge.Key(nonce)));
    }
}
