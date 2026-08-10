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
/// <para><b>Why an ordinary tenant cannot reach the surface behind it.</b> No JWT or API-key identity is
/// ever consulted for AUTHORIZATION here: the route is <c>.AllowAnonymous()</c> and the only accepted
/// credential lives in the platform's own secret store, so holding a valid Supabase session or a valid
/// <c>tims_</c> API key grants exactly nothing. This matters more than usual because the caller may name
/// ANY organization — the secret is the entire authorization boundary for org selection.
///
/// (An earlier version of this comment claimed the endpoint "does not participate in the JWT or ApiKey
/// authentication schemes at all". That was FALSE and a review panel caught it: <c>UseAuthentication()</c>
/// runs globally in Program.cs, so the JWT scheme still AUTHENTICATES a bearer token on this route — it
/// just cannot authorize anything. The route is additionally exempted from
/// <c>PrincipalResolutionMiddleware</c> so no identity lookup happens either; see that class.)</para>
///
/// <para><b>Fail-closed on misconfiguration.</b> If the secret is unset, empty, whitespace, shorter than
/// <see cref="MinimumSecretLength"/>, or still the Terraform placeholder, EVERY request is rejected — the
/// endpoint cannot be accidentally left open by forgetting to configure it. The opposite default ("no
/// secret configured means no check") is how anonymous cross-org readers get shipped.</para>
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
    /// The literal <c>aws_secretsmanager_secret_version.placeholder</c> writes for EVERY secret this
    /// module manages (deploy/terraform/main.tf) so the ARN resolves before Federico sets the real value
    /// out-of-band.
    ///
    /// <b>Rejecting it is load-bearing, not defensive tidiness.</b> Adding this secret to
    /// <c>base_secrets</c> means a <c>terraform apply</c> provisions that placeholder — and a plain
    /// null/whitespace check would ACCEPT it, because it is a perfectly good non-empty string. With the
    /// read flag also on, any reader of this public-to-the-company repository could then present a
    /// credential they found in version control and read any organization's counts. A review panel caught
    /// that the "enabling the flag without the secret is inert, not open" claim written elsewhere in this
    /// PR was false for exactly this reason. Rejecting the literal makes the claim true.
    /// </summary>
    public const string TerraformPlaceholder = "REPLACE_ME_OUT_OF_BAND";

    /// <summary>
    /// A configured secret shorter than this is treated as unconfigured. The gate has no attempt counter
    /// and its route is exempt from the rate limiter (an unthrottled cron is the point), so the secret's
    /// own entropy IS the brute-force control — a short one silently removes it. 32 chars is well under
    /// any sane generated value and well over anything a human would type by accident.
    /// </summary>
    public const int MinimumSecretLength = 32;

    /// <summary>
    /// Null when the caller is authenticated; otherwise the 401 result to return. Deliberately a bare 401
    /// with no body — a mismatched secret must not learn whether a secret is configured at all.
    /// </summary>
    public static IResult? Authorize(HttpContext httpContext, PlatformOptions options)
    {
        if (!IsUsableSecret(options.AlertMetricsCronSecret))
        {
            return Results.StatusCode(StatusCodes.Status401Unauthorized);
        }

        var configured = options.AlertMetricsCronSecret!;

        var presented = httpContext.Request.Headers[HeaderName].ToString();
        if (string.IsNullOrEmpty(presented))
        {
            return Results.StatusCode(StatusCodes.Status401Unauthorized);
        }

        return FixedTimeEquals(presented, configured)
            ? null
            : Results.StatusCode(StatusCodes.Status401Unauthorized);
    }

    /// <summary>
    /// Is the CONFIGURED value usable as a credential at all? Deliberately separate from the comparison
    /// so the three "not really configured" states — absent, too short, still the Terraform placeholder —
    /// are one decision with one reason, and so the unit tests can assert it directly.
    ///
    /// The placeholder comparison is ordinal and exact. It is a known public constant, not a secret, so
    /// there is nothing to leak by timing here.
    /// </summary>
    public static bool IsUsableSecret(string? configured) =>
        !string.IsNullOrWhiteSpace(configured)
        && configured.Length >= MinimumSecretLength
        && !string.Equals(configured, TerraformPlaceholder, StringComparison.Ordinal);

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
