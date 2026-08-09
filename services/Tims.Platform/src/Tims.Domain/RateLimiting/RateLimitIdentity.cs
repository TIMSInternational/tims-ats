using Tims.Domain.Http;

namespace Tims.Domain.RateLimiting;

/// <summary>
/// Pure per-caller bucket-key builder — the port of the identifier logic in
/// <c>packages/api/src/trpc.ts</c> (<c>anonymousIdentifier</c> lines ~29-38, <c>withRateLimit</c>
/// lines ~46-49, and the external per-key limit at line ~207). The identifier is
/// category-agnostic in shape EXCEPT that the <c>ai</c> tier is keyed per-ORG. Golden-fixtured
/// (<c>contracts/ratelimit-fixtures/identifier.json</c>) against the same rules the TS asserts.
/// </summary>
public static class RateLimitIdentity
{
    /// <summary>
    /// Builds the rate-limit identifier for a caller. Precedence (faithful to the TS surfaces):
    /// <list type="number">
    /// <item>External API-key surface → <c>apikey:{apiKeyId}</c> (independent of IP/user; the
    /// per-key quota added in <c>requireApiKey</c>).</item>
    /// <item>AI tier with an org → <c>org:{organizationId}</c> (AI is cost-controlled per-org, so
    /// two users in the same org SHARE the bucket).</item>
    /// <item>Authenticated staff/owner → the raw user id (no prefix).</item>
    /// <item>Anonymous → <see cref="AnonymousIdentifier"/> (x-real-ip, else last XFF hop, else
    /// <c>anonymous</c>).</item>
    /// </list>
    /// </summary>
    /// <param name="category">The resolved category (only <c>ai</c> changes the shape → per-org).</param>
    /// <param name="userId">The authenticated staff/owner user id, or null for anonymous callers.</param>
    /// <param name="organizationId">The caller's org id, or null. Only consulted for the ai tier.</param>
    /// <param name="apiKeyId">The resolved external API key id, or null when not the API-key surface.</param>
    /// <param name="xRealIp">The <c>x-real-ip</c> header value (platform-edge set, not spoofable).</param>
    /// <param name="xForwardedFor">The raw <c>x-forwarded-for</c> header value (comma-separated hops).</param>
    public static string For(
        RateLimitCategory category,
        string? userId,
        string? organizationId,
        string? apiKeyId,
        string? xRealIp,
        string? xForwardedFor)
    {
        // (1) External API-key surface: the per-key quota keys on the resolved key id regardless of
        // source IP — an integration behind a NAT/proxy pool must still be throttled per key.
        if (!string.IsNullOrEmpty(apiKeyId))
        {
            return $"apikey:{apiKeyId}";
        }

        // (2) AI is metered per organization: neither one user nor an org's users collectively may
        // exceed the org's AI budget.
        if (category == RateLimitCategory.Ai && !string.IsNullOrEmpty(organizationId))
        {
            return $"org:{organizationId}";
        }

        // (3) Authenticated staff/owner → raw user id (no prefix, matching TS `ctx.user.id`).
        if (!string.IsNullOrEmpty(userId))
        {
            return userId;
        }

        // (4) Anonymous → trusted IP or the `anonymous` sentinel.
        return AnonymousIdentifier(xRealIp, xForwardedFor);
    }

    /// <summary>
    /// Derives a trusted client identifier for an anonymous request — the port of TS
    /// <c>anonymousIdentifier(headers)</c>. NEVER trusts the client-controlled LEFT-most
    /// <c>x-forwarded-for</c> hop (an attacker rotates it for a fresh bucket per request, defeating
    /// the limiter). Prefers <c>x-real-ip</c> (platform-edge, not spoofable); otherwise the LAST
    /// hop of <c>x-forwarded-for</c> (appended by the trusted proxy); otherwise <c>anonymous</c>.
    /// </summary>
    public static string AnonymousIdentifier(string? xRealIp, string? xForwardedFor)
    {
        // #174: the derivation itself now lives in Tims.Domain.Http.ClientIp, shared with the audit
        // writers, so the two consumers cannot drift. This method keeps only the identity SHAPE
        // (`ip:<addr>` / `anonymous`) that the limiter's key layout depends on.
        var ip = ClientIp.From(xRealIp, xForwardedFor);
        return ip is null ? "anonymous" : $"ip:{ip}";
    }
}
