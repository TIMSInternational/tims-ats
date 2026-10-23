using StackExchange.Redis;

namespace Tims.Api.Http;

/// <summary>
/// ROLLBACK-WINDOW BRIDGE. Images before the DynamoDB store consumed relay nonces in Redis
/// (<c>tims:relay:nonce:{nonce}</c>, SET NX, 90 s). While old and new images can both serve traffic (a rolling
/// deploy, or a rollback, which swaps only the image), a nonce used on one must read as used on the other, so
/// while <c>Platform:RedisConnectionString</c> is still configured <see cref="RelayNonceStore"/> claims the old
/// key as well and accepts only if both claims succeed. Unset it, then retire the Upstash database, once no
/// pre-DynamoDB image can be rolled back to.
/// </summary>
public sealed class LegacyRelayNonceBridge(IConnectionMultiplexer redis)
{
    internal static readonly TimeSpan Timeout = TimeSpan.FromSeconds(2);

    /// <summary>The key pre-DynamoDB images write; must not change while any of them can run.</summary>
    public static string Key(string nonce) => $"tims:relay:nonce:{nonce}";

    /// <summary>True = claimed now; false = an image of either version already used this nonce.</summary>
    public Task<bool> TryClaimAsync(string nonce, TimeSpan lifetime) =>
        redis.GetDatabase().StringSetAsync(Key(nonce), "1", lifetime, When.NotExists).WaitAsync(Timeout);
}
