using System.Collections.Concurrent;
using StackExchange.Redis;

namespace Tims.Api.Http;

public interface IRelayNonceStore
{
    Task<bool> TryUseAsync(string nonce);
}

/// <summary>Atomic single-use nonce across App Runner instances. No production fail-open.</summary>
public sealed class RelayNonceStore(IServiceProvider services, IHostEnvironment environment) : IRelayNonceStore
{
    private readonly ConcurrentDictionary<string, long> _local = new();

    public async Task<bool> TryUseAsync(string nonce)
    {
        var redis = services.GetService<IConnectionMultiplexer>();
        if (redis is not null)
        {
            try
            {
                return await redis.GetDatabase().StringSetAsync($"tims:relay:nonce:{nonce}", "1",
                    TimeSpan.FromSeconds(90), When.NotExists).WaitAsync(TimeSpan.FromSeconds(2));
            }
            catch { return false; }
        }
        if (!environment.IsDevelopment()) return false;
        var now = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
        foreach (var entry in _local)
            if (entry.Value < now) _local.TryRemove(entry.Key, out _);
        return _local.Count < 10000 && _local.TryAdd(nonce, now + 90);
    }
}
