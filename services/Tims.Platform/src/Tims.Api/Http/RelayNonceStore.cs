using System.Collections.Concurrent;
using Tims.Domain.RateLimiting;
using Tims.Infrastructure.RateLimiting;

namespace Tims.Api.Http;

public interface IRelayNonceStore
{
    Task<bool> TryUseAsync(string nonce);
}

/// <summary>
/// Atomic single-use nonce across App Runner instances, held in the shared DynamoDB store as a 90 s claim
/// on <c>relay#{sha256(nonce)}</c> (the raw nonce never reaches the table). No production fail-open: a
/// missing store or any store error/timeout rejects the nonce, even in Development once a store exists.
/// </summary>
public sealed class RelayNonceStore(IServiceProvider services, IHostEnvironment environment) : IRelayNonceStore
{
    internal static readonly TimeSpan NonceLifetime = TimeSpan.FromSeconds(90);
    private readonly ConcurrentDictionary<string, long> _local = new();

    public static string PartitionKey(string nonce) => $"relay#{RateLimits.Sha256Hex(nonce)}";

    public async Task<bool> TryUseAsync(string nonce)
    {
        var store = services.GetService<DynamoDbRateLimitStore>();
        if (store is not null)
        {
            try
            {
                return await store.ClaimOnceAsync(PartitionKey(nonce), NonceLifetime).ConfigureAwait(false);
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
