using Tims.Domain.Http;

namespace Tims.Api.Http;

/// <summary>
/// The one place an ASP.NET request turns into a trusted audit IP (#174).
///
/// Before this, seven endpoint files each read the headers by hand and each took the RAW whole
/// <c>x-forwarded-for</c> — the client-controlled left-most hop — writing a comma-joined hop list
/// into <c>data_access_logs</c> / <c>security_events</c> rather than an address. Three of them
/// carried a comment claiming parity with the TS side; #158 moved TS onto
/// <c>packages/api/src/lib/client-ip.ts</c> and made that false.
///
/// The derivation lives in <see cref="ClientIp"/> (Domain, header-agnostic, golden-fixtured against
/// the TS helper). This is only the adapter that pulls the two header values out of an
/// <see cref="HttpContext"/>, so the rule is not restated anywhere.
/// </summary>
public static class HttpContextClientIp
{
    /// <summary>The trusted client address for audit attribution, or <c>null</c> if undeterminable.</summary>
    public static string? ClientIpFor(this HttpContext httpContext)
    {
        var xRealIp = httpContext.Request.Headers["x-real-ip"].ToString();
        var xForwardedFor = httpContext.Request.Headers["x-forwarded-for"].ToString();
        return ClientIp.From(xRealIp, xForwardedFor);
    }
}
