using System.Buffers.Text;
using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Options;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Http.Features;
using Tims.Api.Configuration;

namespace Tims.Api.Http;

/// <summary>Authenticates relay attribution separately from JWT identity and impersonation.</summary>
/// <remarks>
/// Every refusal is an EMPTY-body 401 (or the 503 below) written before Serilog's request logging and the denial
/// observer run, so without a log line here it leaves no trace in C# at all. Round 11 (the unexplained empty-body 401
/// on /api/platform/assessments/provider-attempts in the round-10 e2e): each refusal now logs ONE warning with a
/// reason code, the request method and path (never the query, the envelope, a token or an address), and for a
/// timestamp refusal the clock difference in seconds; for an unauthenticated bearer, the authentication failure's
/// exception type (for example <c>SecurityTokenExpiredException</c>). The response is unchanged.
/// </remarks>
public sealed partial class RelayAttributionMiddleware(
    RequestDelegate next, ILogger<RelayAttributionMiddleware>? logger = null)
{
    public const string HeaderName = "x-tims-relay-attribution";
    private const string Purpose = "tims-platform-relay-attribution-v1\n";

    /// <summary>The explicit marker the E2E stack sets on its API container (mirrors the web side's TIMS_E2E_STACK).</summary>
    public const string E2EStackMarker = "TIMS_E2E_STACK";

    /// <summary>
    /// #329 item 2 — whether an anonymous relayed request with NO vouched client IP may pass. Only when
    /// <see cref="PlatformOptions.AllowAnonymousRelayWithoutClientIp"/> is exactly "true", AND the host is not
    /// Production unless the process also carries <see cref="E2EStackMarker"/> exactly "1". So the flag alone can
    /// never re-open the shared anonymous bucket on a production deployment: a mis-set flag is refused (the 503
    /// stays), and Program logs it at ERROR.
    /// </summary>
    public static bool AllowsAnonymousWithoutClientIp(string? flag, string environmentName, string? e2eMarker) =>
        string.Equals(flag, "true", StringComparison.Ordinal)
        && (!string.Equals(environmentName, Environments.Production, StringComparison.OrdinalIgnoreCase)
            || string.Equals(e2eMarker, "1", StringComparison.Ordinal));

    public async Task InvokeAsync(HttpContext context, IOptions<PlatformOptions> options, IRelayNonceStore nonces,
        IHostEnvironment environment, IConfiguration configuration)
    {
        if (!context.Request.Headers.TryGetValue(HeaderName, out var values))
        {
            await next(context);
            return;
        }
        // Anonymous capability-token routes relayed by the web app: invitation setup and the candidate
        // interview join (WP-H). Everything else must carry an authenticated identity.
        var anonymousInvitationSetup = context.User.Identity?.IsAuthenticated != true
            && (context.Request.Path.StartsWithSegments("/invitations/setup")
                || Tims.Api.InterviewJoin.CandidateInterviewJoinEndpoints.IsRoute(context.Request.Path))
            && string.IsNullOrEmpty(context.Request.Headers.Authorization);
        if (context.User.Identity?.IsAuthenticated != true && !anonymousInvitationSetup)
        {
            var failure = context.Features.Get<IAuthenticateResultFeature>()?.AuthenticateResult?.Failure;
            Reject(context, RejectReason.Unauthenticated, failure?.GetType().Name ?? "none");
            return;
        }
        var envelope = values.ToString();
        // Never reflect or log the signed envelope: it contains client attribution.
        var (metadata, reason, skew) = values.Count == 1
            ? Verify(envelope, context, options.Value.ImpersonationSecret, anonymousInvitationSetup)
            : (null, RejectReason.MultipleHeaders, null);
        if (metadata is null)
        {
            Reject(context, reason, skew is { } seconds ? $"skew {seconds}s" : "none");
            return;
        }
        if (!await nonces.TryUseAsync(metadata.Nonce))
        {
            Reject(context, RejectReason.NonceRejected, "none");
            return;
        }
        // #329 item 2 — fail closed. An anonymous relayed request has NO principal to key the limiter on, so its
        // only identity is the relay-vouched IP. The web relay vouches for one only on Vercel; without it every
        // anonymous caller (every candidate, every invitee) would collapse into the one shared `anonymous` bucket —
        // one caller can then exhaust it for all — and its audit rows would carry no address. Refuse instead.
        if (anonymousInvitationSetup && metadata.Ip is null
            && !AllowsAnonymousWithoutClientIp(options.Value.AllowAnonymousRelayWithoutClientIp,
                environment.EnvironmentName, configuration[E2EStackMarker]))
        {
            context.Response.StatusCode = StatusCodes.Status503ServiceUnavailable;
            return;
        }
        // Runs AFTER the untrusted-header stripper, BEFORE all attribution consumers.
        // Unknown web IP stays unknown; do not accidentally substitute the relay edge.
        context.Request.Headers.Remove("x-forwarded-for");
        context.Request.Headers.Remove("x-real-ip");
        if (metadata.Ip is not null) context.Request.Headers["x-real-ip"] = metadata.Ip;
        context.Request.Headers.UserAgent = metadata.Ua;
        context.Request.Headers.Remove(HeaderName);
        await next(context);
    }

    /// <summary>Why a relayed request was refused (the log's reason code).</summary>
    public enum RejectReason
    {
        Unauthenticated,
        MultipleHeaders,
        Unverifiable,
        Malformed,
        BadSignature,
        Stale,
        FromTheFuture,
        BadNonce,
        MethodMismatch,
        PathMismatch,
        AuthorizationMismatch,
        CookieMismatch,
        MissingAuthorization,
        BadUserAgent,
        BadIp,
        NonceRejected,
    }

    private void Reject(HttpContext context, RejectReason reason, string detail)
    {
        if (logger is not null)
        {
            LogRejected(logger, reason, detail, context.Request.Method, context.Request.Path.Value ?? string.Empty);
        }

        context.Response.StatusCode = StatusCodes.Status401Unauthorized;
    }

    [LoggerMessage(Level = LogLevel.Warning,
        Message = "Relay attribution refused with an empty 401: {Reason} ({Detail}) for {Method} {Path}")]
    private static partial void LogRejected(
        ILogger logger, RejectReason reason, string detail, string method, string path);

    // The refusal order is the original single condition's, split so each refusal names its reason. Skew is the
    // envelope's timestamp minus this host's clock, in seconds, reported only for a timestamp refusal.
    private static (Metadata? Metadata, RejectReason Reason, long? Skew) Verify(
        string envelope, HttpContext context, string? secret, bool allowAnonymous)
    {
        if (string.IsNullOrEmpty(secret) || envelope.Length > 8192) return (null, RejectReason.Unverifiable, null);
        var dot = envelope.IndexOf('.');
        if (dot <= 0) return (null, RejectReason.Malformed, null);
        try
        {
            var expected = HMACSHA256.HashData(Encoding.UTF8.GetBytes(secret), Encoding.UTF8.GetBytes(Purpose + envelope[..dot]));
            var signature = Base64Url.DecodeFromChars(envelope.AsSpan(dot + 1));
            if (!CryptographicOperations.FixedTimeEquals(expected, signature)) return (null, RejectReason.BadSignature, null);
            var metadata = JsonSerializer.Deserialize<Metadata>(Base64Url.DecodeFromChars(envelope.AsSpan(0, dot)), JsonOptions);
            if (metadata is null) return (null, RejectReason.Malformed, null);
            var now = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
            RejectReason? reason =
                metadata.Timestamp < now - 30 ? RejectReason.Stale
                : metadata.Timestamp > now + 5 ? RejectReason.FromTheFuture
                : !Guid.TryParseExact(metadata.Nonce, "D", out _) ? RejectReason.BadNonce
                : metadata.Method != context.Request.Method ? RejectReason.MethodMismatch
                : metadata.Path != RawTarget(context) ? RejectReason.PathMismatch
                : metadata.AuthorizationHash != Hash(context.Request.Headers.Authorization.ToString()) ? RejectReason.AuthorizationMismatch
                : metadata.CookieHash != Hash(context.Request.Headers.Cookie.ToString()) ? RejectReason.CookieMismatch
                : !allowAnonymous && string.IsNullOrEmpty(context.Request.Headers.Authorization) ? RejectReason.MissingAuthorization
                : metadata.Ua is null || metadata.Ua.Length > 512 || metadata.Ua.Any(char.IsControl) ? RejectReason.BadUserAgent
                : metadata.Ip is not null && (metadata.Ip.Length > 45 || !IPAddress.TryParse(metadata.Ip, out _)) ? RejectReason.BadIp
                : null;
            if (reason is { } refused)
            {
                long? skew = refused is RejectReason.Stale or RejectReason.FromTheFuture ? metadata.Timestamp - now : null;
                return (null, refused, skew);
            }

            return (metadata, default, null);
        }
        catch (Exception ex) when (ex is FormatException or JsonException or ArgumentException)
        {
            return (null, RejectReason.Malformed, null);
        }
    }

    private static string RawTarget(HttpContext context) =>
        context.Features.Get<IHttpRequestFeature>()?.RawTarget is { Length: > 0 } raw
            ? raw : context.Request.PathBase + context.Request.Path + context.Request.QueryString;

    private static readonly JsonSerializerOptions JsonOptions = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
    private static string Hash(string value) => Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(value)));
    private sealed record Metadata(long Timestamp, string Nonce, string Method, string Path,
        string AuthorizationHash, string CookieHash, string? Ip, string Ua);
}
