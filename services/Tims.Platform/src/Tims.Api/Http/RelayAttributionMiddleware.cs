using System.Buffers.Text;
using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Options;
using Microsoft.AspNetCore.Http.Features;
using Tims.Api.Configuration;

namespace Tims.Api.Http;

/// <summary>Authenticates relay attribution separately from JWT identity and impersonation.</summary>
public sealed class RelayAttributionMiddleware(RequestDelegate next)
{
    public const string HeaderName = "x-tims-relay-attribution";
    private const string Purpose = "tims-platform-relay-attribution-v1\n";

    public async Task InvokeAsync(HttpContext context, IOptions<PlatformOptions> options, IRelayNonceStore nonces)
    {
        if (!context.Request.Headers.TryGetValue(HeaderName, out var values))
        {
            await next(context);
            return;
        }
        if (context.User.Identity?.IsAuthenticated != true)
        {
            context.Response.StatusCode = StatusCodes.Status401Unauthorized;
            return;
        }
        var envelope = values.ToString();
        // Never reflect or log the signed envelope: it contains client attribution.
        var metadata = values.Count == 1 ? Verify(envelope, context, options.Value.ImpersonationSecret) : null;
        if (metadata is null || !await nonces.TryUseAsync(metadata.Nonce))
        {
            context.Response.StatusCode = StatusCodes.Status401Unauthorized;
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

    private static Metadata? Verify(string envelope, HttpContext context, string? secret)
    {
        if (string.IsNullOrEmpty(secret) || envelope.Length > 8192) return null;
        var dot = envelope.IndexOf('.');
        if (dot <= 0) return null;
        try
        {
            var expected = HMACSHA256.HashData(Encoding.UTF8.GetBytes(secret), Encoding.UTF8.GetBytes(Purpose + envelope[..dot]));
            var signature = Base64Url.DecodeFromChars(envelope.AsSpan(dot + 1));
            if (!CryptographicOperations.FixedTimeEquals(expected, signature)) return null;
            var metadata = JsonSerializer.Deserialize<Metadata>(Base64Url.DecodeFromChars(envelope.AsSpan(0, dot)), JsonOptions);
            if (metadata is null || metadata.Timestamp < DateTimeOffset.UtcNow.ToUnixTimeSeconds() - 30
                || metadata.Timestamp > DateTimeOffset.UtcNow.ToUnixTimeSeconds() + 5
                || !Guid.TryParseExact(metadata.Nonce, "D", out _)
                || metadata.Method != context.Request.Method
                || metadata.Path != RawTarget(context)
                || metadata.AuthorizationHash != Hash(context.Request.Headers.Authorization.ToString())
                || metadata.CookieHash != Hash(context.Request.Headers.Cookie.ToString())
                || string.IsNullOrEmpty(context.Request.Headers.Authorization)
                || metadata.Ua is null || metadata.Ua.Length > 512 || metadata.Ua.Any(char.IsControl)
                || (metadata.Ip is not null && (metadata.Ip.Length > 45 || !IPAddress.TryParse(metadata.Ip, out _)))) return null;
            return metadata;
        }
        catch (Exception ex) when (ex is FormatException or JsonException or ArgumentException) { return null; }
    }

    private static string RawTarget(HttpContext context) =>
        context.Features.Get<IHttpRequestFeature>()?.RawTarget is { Length: > 0 } raw
            ? raw : context.Request.PathBase + context.Request.Path + context.Request.QueryString;

    private static readonly JsonSerializerOptions JsonOptions = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
    private static string Hash(string value) => Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(value)));
    private sealed record Metadata(long Timestamp, string Nonce, string Method, string Path,
        string AuthorizationHash, string CookieHash, string? Ip, string Ua);
}
