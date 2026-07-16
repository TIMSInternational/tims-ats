namespace Tims.Domain.RateLimiting;

/// <summary>
/// The outcome of one rate-limit decision, mirroring the fields the Upstash single-region
/// <c>slidingWindow.limit</c> returns (<c>success</c>, <c>limit</c>, <c>remaining</c>, <c>reset</c>).
/// <see cref="Allowed"/> is <c>remaining &gt;= 0</c> (the Lua returns -1 in the first element when
/// throttled). Pure — carries no infra concerns.
/// </summary>
public readonly record struct RateLimitResult(bool Allowed, int Limit, int Remaining, long ResetAtMs)
{
    /// <summary>
    /// Seconds until the caller may retry, matching TS
    /// <c>Math.max(1, Math.ceil((reset - Date.now()) / 1000))</c>. Never below 1.
    /// </summary>
    public int RetryAfterSeconds(long nowMs) =>
        Math.Max(1, (int)Math.Ceiling((ResetAtMs - nowMs) / 1000.0));
}
