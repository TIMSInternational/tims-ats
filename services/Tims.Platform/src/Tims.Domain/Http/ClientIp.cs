namespace Tims.Domain.Http;

/// <summary>
/// Trusted client-IP derivation — the C# counterpart of TS
/// <c>packages/api/src/lib/client-ip.ts</c> (<c>clientIpFrom</c>), pinned to it by the shared
/// goldens in <c>contracts/client-ip-fixtures/cases.json</c>.
///
/// NEVER trust the client-controlled LEFT-most <c>x-forwarded-for</c> hop — a caller sets it
/// freely. Prefer <c>x-real-ip</c> (written by the platform edge, not spoofable); otherwise take
/// the LAST hop of <c>x-forwarded-for</c>, the entry appended by the trusted proxy.
///
/// WHY THIS EXISTS AS ITS OWN PRIMITIVE (#174). The rate limiter already had this rule right in
/// <see cref="Tims.Domain.RateLimiting.RateLimitIdentity"/>, but SEVEN audit writers each re-derived
/// it by hand and got it wrong — they took the raw whole header, so the one forensic field the
/// Ley 1581 §21 obligation produces was attacker-chosen and stored a comma-joined hop list rather
/// than an address. The asymmetry is instructive and worth stating: a spoofable rate-limit key
/// fails loudly (the limiter stops working), whereas a spoofable audit IP still writes a row — it
/// just cannot be trusted. So the safe version only ever got written where failure was visible.
///
/// <see cref="RateLimitIdentity.AnonymousIdentifier"/> now delegates here, so the two consumers
/// cannot drift apart: there is exactly one implementation of the rule in this stack.
/// </summary>
public static class ClientIp
{
    /// <summary>
    /// The trusted client address, or <c>null</c> when neither header yields one.
    /// Returns a SINGLE address — never the comma-joined hop list.
    /// </summary>
    /// <param name="xRealIp">The <c>x-real-ip</c> header value (platform-edge set, not spoofable).</param>
    /// <param name="xForwardedFor">The raw <c>x-forwarded-for</c> header value (comma-separated hops).</param>
    public static string? From(string? xRealIp, string? xForwardedFor)
    {
        var realIp = xRealIp?.Trim();
        if (!string.IsNullOrEmpty(realIp))
        {
            return realIp;
        }

        if (!string.IsNullOrEmpty(xForwardedFor))
        {
            var hops = xForwardedFor
                .Split(',')
                .Select(hop => hop.Trim())
                .Where(hop => hop.Length > 0)
                .ToArray();
            if (hops.Length > 0)
            {
                return hops[^1];
            }
        }

        return null;
    }
}
