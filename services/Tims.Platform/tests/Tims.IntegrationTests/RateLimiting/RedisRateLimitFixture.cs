using StackExchange.Redis;
using Testcontainers.Redis;

namespace Tims.IntegrationTests.RateLimiting;

/// <summary>
/// Spins up one real Redis container and exposes a StackExchange.Redis connection so the
/// WP2.6 tests can run the C# limiter against a live server and inspect the exact
/// <c>tims:ratelimit:{category}:{identifier}:{bucket}</c> keys/counters it writes — the empirical
/// cross-stack sharing proof (a TS reader would see the identical key + value).
/// </summary>
public sealed class RedisRateLimitFixture : IAsyncLifetime
{
    private readonly RedisContainer _container = new RedisBuilder("redis:7-alpine").Build();

    public IConnectionMultiplexer Connection { get; private set; } = null!;

    /// <summary>The container's Redis connection string — fed to a booted host's <c>Platform:RedisConnectionString</c>.</summary>
    public string ConnectionString { get; private set; } = string.Empty;

    public async Task InitializeAsync()
    {
        await _container.StartAsync();
        ConnectionString = _container.GetConnectionString();
        Connection = await ConnectionMultiplexer.ConnectAsync(ConnectionString);
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
