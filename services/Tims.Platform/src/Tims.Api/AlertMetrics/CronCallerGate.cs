using System.Security.Cryptography;
using System.Text;
using Tims.Api.Configuration;

namespace Tims.Api.AlertMetrics;

/// <summary>
/// Authenticates the PLATFORM-LEVEL SCHEDULED CALLER of the cross-org alert-metric surface
/// (§8 Q0b slice 2, issue #172).
///
/// <para><b>Why this is not a *StaffGate.</b> Every other gate on this service answers "is the resolved
/// principal allowed?" — they need a USER. The alert-evaluation cron has no user: it is a Vercel Cron GET
/// whose only credential is a shared secret (apps/web/app/api/cron/evaluate-alerts/route.ts:16-20). So
/// this surface uses the same class of credential the Stripe webhook uses: an ANONYMOUS route whose
/// authentication IS the secret, checked in the handler.</para>
///
/// <para><b>Why an ordinary tenant cannot reach the surface behind it.</b> The endpoint does not
/// participate in the JWT or ApiKey authentication schemes at all, so holding a valid Supabase session or
/// a valid <c>tims_</c> API key grants exactly nothing here — there is no code path from any user or
/// tenant identity to this gate. The only accepted credential lives in the platform's own secret store.
/// This matters more than usual because the caller may name ANY organization: the secret is the entire
/// authorization boundary for org selection.</para>
///
/// <para><b>Fail-closed on misconfiguration.</b> If the secret is unset, empty, or whitespace, EVERY
/// request is rejected — the endpoint cannot be accidentally left open by forgetting to configure it.
/// The opposite default ("no secret configured means no check") is how anonymous cross-org readers get
/// shipped.</para>
///
/// The comparison is fixed-time (<see cref="CryptographicOperations.FixedTimeEquals"/>) over SHA-256
/// digests, so neither the secret's value nor its length is recoverable by timing.
/// </summary>
public static class CronCallerGate
{
    /// <summary>
    /// A dedicated header, NOT <c>Authorization</c>: <c>Authorization</c> is consumed by the JWT/ApiKey
    /// schemes, and reusing it would make a machine credential look like a user credential in logs,
    /// proxies and incident review. A distinct header keeps the two credential classes visibly separate.
    /// </summary>
    public const string HeaderName = "X-Tims-Cron-Secret";

    /// <summary>
    /// Null when the caller is authenticated; otherwise the 401 result to return. Deliberately a bare 401
    /// with no body — a mismatched secret must not learn whether a secret is configured at all.
    /// </summary>
    public static IResult? Authorize(HttpContext httpContext, PlatformOptions options)
    {
        var configured = options.AlertMetricsCronSecret;
        if (string.IsNullOrWhiteSpace(configured))
        {
            return Results.StatusCode(StatusCodes.Status401Unauthorized);
        }

        var presented = httpContext.Request.Headers[HeaderName].ToString();
        if (string.IsNullOrEmpty(presented))
        {
            return Results.StatusCode(StatusCodes.Status401Unauthorized);
        }

        return FixedTimeEquals(presented, configured)
            ? null
            : Results.StatusCode(StatusCodes.Status401Unauthorized);
    }

    // SHA-256 both sides first so FixedTimeEquals always compares two 32-byte spans: comparing the raw
    // UTF-8 bytes would return early on a length mismatch and leak the secret's length.
    private static bool FixedTimeEquals(string presented, string configured)
    {
        Span<byte> presentedHash = stackalloc byte[32];
        Span<byte> configuredHash = stackalloc byte[32];
        SHA256.HashData(Encoding.UTF8.GetBytes(presented), presentedHash);
        SHA256.HashData(Encoding.UTF8.GetBytes(configured), configuredHash);
        return CryptographicOperations.FixedTimeEquals(presentedHash, configuredHash);
    }
}
