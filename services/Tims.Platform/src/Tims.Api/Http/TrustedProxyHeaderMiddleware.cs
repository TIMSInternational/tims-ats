using Microsoft.Extensions.Options;
using Tims.Api.Configuration;

namespace Tims.Api.Http;

/// <summary>
/// Strips the client-controlled <c>x-real-ip</c> header at the very front of the pipeline, so nothing
/// downstream can mistake a caller-supplied value for one written by a trusted edge (#181).
///
/// <para><b>The problem.</b> <see cref="Tims.Domain.Http.ClientIp"/> prefers <c>x-real-ip</c> over the
/// last <c>x-forwarded-for</c> hop, documented as "written by the platform edge, not spoofable". On
/// Vercel that holds — Vercel sets it. On THIS service it does not: the platform API is deployed to AWS
/// App Runner (deploy/terraform/main.tf) and is reached directly, with no ALB, no CloudFront and no
/// <c>UseForwardedHeaders</c> anywhere in the pipeline. App Runner populates <c>X-Forwarded-For</c>; it
/// neither sets nor strips <c>x-real-ip</c>. So any caller could send <c>x-real-ip: 10.0.0.9</c> and have
/// it recorded verbatim as the forensic address on every <c>audit_logs</c> row — and, through
/// <see cref="Tims.Domain.RateLimiting.RateLimitIdentity"/>, rotate it to evade the anonymous quota.</para>
///
/// <para><b>Why the fix is here and not in <c>ClientIp</c>.</b> That derivation is a SHARED kernel, pinned
/// byte-for-byte to the TS implementation by <c>contracts/client-ip-fixtures/cases.json</c> (#174). The
/// rule is not wrong — it is correct for a deployment whose edge sets the header, which is exactly the TS
/// side. What differs is the TRUST ENVIRONMENT, not the algorithm. Changing the kernel would diverge the
/// two stacks to fix a deployment fact, so instead this removes the untrusted input before the kernel
/// ever sees it. The goldens stay green and both stacks keep one rule.</para>
///
/// <para><b>This is not expected to change behaviour for real traffic.</b> App Runner sends no
/// <c>x-real-ip</c>, so legitimate requests already fall through to the last <c>X-Forwarded-For</c> hop —
/// the entry an appending proxy controls. All this removes is the attacker's lever.</para>
///
/// <para><b>Polarity note.</b> Unlike <c>Platform:MfaEnforced</c>, which fails OPEN so a garbled value can
/// never lock operators out, this flag fails to the STRIPPING side: anything other than the exact string
/// "true" means do not trust the header. The safe default for "is this input authentic?" is no. Set
/// <see cref="PlatformOptions.TrustXRealIpHeader"/> to "true" only if a trusted edge that genuinely writes
/// (and overwrites) <c>x-real-ip</c> is ever placed in front of this service.</para>
/// </summary>
public sealed class TrustedProxyHeaderMiddleware(RequestDelegate next)
{
    public const string XRealIpHeader = "x-real-ip";

    private readonly RequestDelegate _next = next;

    public Task InvokeAsync(HttpContext context, IOptions<PlatformOptions> platformOptions)
    {
        if (!IsTrusted(platformOptions.Value.TrustXRealIpHeader))
        {
            // Remove, do not overwrite. Leaving an empty value would still be a non-null header that a
            // future reader might treat as meaningful; ClientIp's own null/empty handling then falls
            // through to the X-Forwarded-For branch exactly as if the caller had never sent it.
            context.Request.Headers.Remove(XRealIpHeader);
        }

        return _next(context);
    }

    /// <summary>Exact "true" only — see the polarity note on the class.</summary>
    public static bool IsTrusted(string? flag) => string.Equals(flag, "true", StringComparison.Ordinal);
}
