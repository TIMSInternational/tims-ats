using System.Buffers.Text;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace Tims.Domain.Identity;

/// <summary>The verified impersonation claim (mirrors <c>ImpersonationPayload</c>, impersonation.ts).</summary>
public sealed record ImpersonationPayload(string ImpersonatorId, string TargetUserId, long Exp);

/// <summary>
/// Ported 1:1 from packages/api/src/lib/impersonation.ts. The HMAC-signed platform-owner
/// impersonation cookie: <c>&lt;base64url(body)&gt;.&lt;base64url(hmacSHA256(secret, body))&gt;</c>
/// where <c>body = base64url(JSON {impersonatorId, targetUserId, exp})</c> and <c>exp</c> is epoch
/// MILLISECONDS (JS <c>Date.now()</c>).
///
/// The token alone grants NOTHING: it is only honored when the request's REAL authenticated user is
/// a platform owner (enforced by <see cref="StaffContextResolver"/>). The HMAC is defense-in-depth
/// so the {impersonatorId, targetUserId} pair can't be tampered with. Every function FAILS CLOSED —
/// a bad/forged/expired/absent cookie simply means "not impersonating" (null, never throws).
///
/// Pure: <paramref name="nowUnixMs"/> is passed in (workflow-safe — no <see cref="DateTime.UtcNow"/>
/// inside), and the HMAC secret is a parameter (the caller supplies it, fail-closed when unset).
/// </summary>
public static class ImpersonationCookie
{
    /// <summary>Cookie name (matches the TS <c>IMPERSONATION_COOKIE</c>).</summary>
    public const string CookieName = "tims_impersonation";

    /// <summary>Default TTL = 1 hour in ms (matches the TS <c>TTL_MS</c>).</summary>
    public const long DefaultTtlMs = 60L * 60L * 1000L;

    /// <summary>
    /// Mint a signed token. The inverse of <see cref="VerifyImpersonationToken"/>: needed to produce
    /// valid cookies (route handlers, tests). <c>exp = nowUnixMs + ttlMs</c>.
    /// </summary>
    public static string SignImpersonationToken(
        string secret,
        string impersonatorId,
        string targetUserId,
        long nowUnixMs,
        long ttlMs = DefaultTtlMs)
    {
        var payload = new JsonObject
        {
            ["impersonatorId"] = impersonatorId,
            ["targetUserId"] = targetUserId,
            ["exp"] = nowUnixMs + ttlMs,
        };
        var body = Base64Url.EncodeToString(Encoding.UTF8.GetBytes(payload.ToJsonString()));
        var sig = Base64Url.EncodeToString(HmacSha256(secret, body));
        return $"{body}.{sig}";
    }

    /// <summary>
    /// Verify a token against <paramref name="secret"/> at <paramref name="nowUnixMs"/>. Returns the
    /// payload when the signature is valid, the required fields are present, and it has not expired;
    /// otherwise null (any problem — missing secret/token, malformed, tampered, expired — is null).
    /// </summary>
    public static ImpersonationPayload? VerifyImpersonationToken(string? token, string? secret, long nowUnixMs)
    {
        if (string.IsNullOrEmpty(secret) || string.IsNullOrEmpty(token))
        {
            return null;
        }

        var dot = token.IndexOf('.', StringComparison.Ordinal);
        if (dot <= 0)
        {
            return null;
        }

        var body = token[..dot];
        var sig = token[(dot + 1)..];

        // Constant-time compare of the base64url signature bytes (length-check first).
        var presented = Encoding.UTF8.GetBytes(sig);
        var expected = Base64Url.EncodeToString(HmacSha256(secret, body));
        var expectedBytes = Encoding.UTF8.GetBytes(expected);
        if (presented.Length != expectedBytes.Length
            || !CryptographicOperations.FixedTimeEquals(presented, expectedBytes))
        {
            return null;
        }

        try
        {
            var bodyBytes = Base64Url.DecodeFromChars(body);
            using var document = JsonDocument.Parse(bodyBytes);
            var root = document.RootElement;
            if (root.ValueKind != JsonValueKind.Object
                || !root.TryGetProperty("impersonatorId", out var impersonator)
                || impersonator.ValueKind != JsonValueKind.String
                || !root.TryGetProperty("targetUserId", out var target)
                || target.ValueKind != JsonValueKind.String
                || !root.TryGetProperty("exp", out var exp)
                || exp.ValueKind != JsonValueKind.Number
                // Intentional micro-divergence from TS (`typeof exp === 'number'`): a non-integer
                // exp (e.g. 123.45) is rejected here. Inert — real tokens always mint integer epoch-ms.
                || !exp.TryGetInt64(out var expMs))
            {
                return null;
            }

            var impersonatorId = impersonator.GetString();
            var targetUserId = target.GetString();
            if (string.IsNullOrEmpty(impersonatorId) || string.IsNullOrEmpty(targetUserId))
            {
                return null;
            }

            return nowUnixMs > expMs
                ? null
                : new ImpersonationPayload(impersonatorId, targetUserId, expMs);
        }
#pragma warning disable CA1031 // Fail-closed by design: this is a security-critical auth path, and
        // the TS source (impersonation.ts) guarantees "any problem -> null (never throw)". A blanket
        // catch makes that never-throw guarantee STRUCTURAL rather than incidental on the specific
        // exception types today's Base64Url/JSON parsing happens to raise.
        catch (Exception)
#pragma warning restore CA1031
        {
            return null;
        }
    }

    /// <summary>
    /// Extract the impersonation token value from a raw <c>Cookie</c> header (split on ';', key
    /// before the first '='), URL-decoded. Returns null when the cookie is absent.
    /// </summary>
    public static string? ReadImpersonationCookie(string? cookieHeader)
    {
        if (string.IsNullOrEmpty(cookieHeader))
        {
            return null;
        }

        foreach (var part in cookieHeader.Split(';'))
        {
            var eq = part.IndexOf('=', StringComparison.Ordinal);
            if (eq < 0)
            {
                continue;
            }

            if (part[..eq].Trim() == CookieName)
            {
                return Uri.UnescapeDataString(part[(eq + 1)..].Trim());
            }
        }

        return null;
    }

    private static byte[] HmacSha256(string secret, string message) =>
        HMACSHA256.HashData(Encoding.UTF8.GetBytes(secret), Encoding.UTF8.GetBytes(message));
}
