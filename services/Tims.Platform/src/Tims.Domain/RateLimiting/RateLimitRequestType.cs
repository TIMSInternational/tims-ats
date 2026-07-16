namespace Tims.Domain.RateLimiting;

/// <summary>
/// The tRPC procedure kind that <see cref="RateLimitPolicy.CategoryFor"/> falls back to when a
/// path matches no special (auth/ai/export) rule — the C# analog of the TS
/// <c>type: 'query' | 'mutation'</c> argument to <c>getRateLimitCategory</c>.
/// </summary>
public enum RateLimitRequestType
{
    /// <summary>A read (tRPC query) — default category <see cref="RateLimitCategory.Query"/>.</summary>
    Query,

    /// <summary>A write (tRPC mutation) — default category <see cref="RateLimitCategory.Mutation"/>.</summary>
    Mutation,
}
