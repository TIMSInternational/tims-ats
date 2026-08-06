using System.Security.Cryptography;
using System.Text;
using Tims.Api.Configuration;

namespace Tims.Api.AlertMetrics;

/// <summary>
/// Authenticates the PLATFORM-LEVEL SCHEDULED CALLER of the cross-org alert-metric surface.
///
/// <b>Why this is not <see cref="Tims.Api.Audit.PlatformOwnerGate"/>.</b> That gate answers "is the resolved
/// principal a platform owner?" — it needs a USER. The alert-evaluation cron has no user: it is a Vercel
/// Cron GET whose only credential is the shared <c>CRON_SECRET</c>
/// (apps/web/app/api/cron/evaluate-alerts/route.ts:16-20). So this surface uses the same class of credential
/// the Stripe webhook endpoint uses (<see cref="Tims.Api.Billing.BillingWebhookEndpoints"/>): an ANONYMOUS
/// route whose authentication IS the secret, checked in the handler.
///
/// <b>Why an ordinary tenant cannot reach the surface behind it.</b> The endpoint does not participate in the
/// JWT or ApiKey authentication schemes at all, so holding a valid Supabase session or a valid <c>tims_</c>
/// API key grants exactly nothing here — there is no code path from any user or tenant identity to this
/// gate. The only accepted credential is a value that lives in the platform's own secret store.
///
/// <b>Fail-closed on misconfiguration.</b> If the secret is unset, empty, or whitespace, EVERY request is
/// rejected — the endpoint cannot be accidentally left open by forgetting to configure it. (The opposite
/// default — "no secret configured means no check" — is how anonymous cross-org readers get shipped.)
///
/// The comparison is fixed-time (<see cref="CryptographicOperations.FixedTimeEquals"/>) over the UTF-8 bytes,
/// with the length compared inside the fixed-time path by hashing first, so neither the value nor its length
/// is recoverable by timing.
/// </summary>
public static class CronCallerGate
{
    /// <summary>
    /// A dedicated header, NOT <c>Authorization</c>: <c>Authorization</c> is consumed by the JWT/ApiKey
    /// schemes, and reusing it would make a cron credential look like a user credential in logs, proxies and
    /// incident review. A distinct header keeps the two credential classes visibly separate.
    /// </summary>
    public const string HeaderName = "X-Tims-Cron-Secret";

    /// <summary>
    /// Null when the caller is authenticated; otherwise the 401 result to return. Deliberately returns a
    /// bare 401 with no body — a mismatched secret must not learn whether the secret is configured at all.
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
