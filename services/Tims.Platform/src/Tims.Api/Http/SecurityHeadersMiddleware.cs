namespace Tims.Api.Http;

/// <summary>
/// Adds baseline transport/content security headers to every response outside Development:
/// <c>X-Content-Type-Options: nosniff</c> (no MIME sniffing of JSON responses) and
/// <c>Strict-Transport-Security</c> (browsers only reach this API over HTTPS). Development is
/// excluded so a local plain-HTTP host is never pinned to HTTPS by a browser.
/// </summary>
/// <remarks>
/// An exception that escapes the pipeline before the response starts would otherwise reach the
/// server, which resets every response header and writes its own 500 (and does not run
/// <c>OnStarting</c> callbacks for a failed request). The middleware therefore turns such an
/// exception into the same empty 500 itself, logs it, and keeps the headers on it. A response that
/// has already started, or a request the client aborted, is rethrown unchanged.
/// </remarks>
public sealed class SecurityHeadersMiddleware(
    RequestDelegate next,
    IHostEnvironment environment,
    ILogger<SecurityHeadersMiddleware> logger)
{
    public const string ContentTypeOptionsHeader = "X-Content-Type-Options";
    public const string ContentTypeOptionsValue = "nosniff";
    public const string StrictTransportSecurityHeader = "Strict-Transport-Security";
    public const string StrictTransportSecurityValue = "max-age=31536000; includeSubDomains";

    private readonly RequestDelegate _next = next;
    private readonly ILogger<SecurityHeadersMiddleware> _logger = logger;
    private readonly bool _enabled = !environment.IsDevelopment();

    public async Task InvokeAsync(HttpContext context)
    {
        if (!_enabled)
        {
            await _next(context);
            return;
        }

        // Set before the rest of the pipeline runs, while the response has not started; later
        // middleware and endpoints can still add their own headers on top.
        Apply(context.Response);
        try
        {
            await _next(context);
        }
        catch (Exception ex) when (!context.Response.HasStarted && !context.RequestAborted.IsCancellationRequested)
        {
            _logger.LogError(ex, "Unhandled exception while processing request {TraceIdentifier}", context.TraceIdentifier);
            context.Response.Clear();
            context.Response.StatusCode = StatusCodes.Status500InternalServerError;
            Apply(context.Response);
        }
    }

    private static void Apply(HttpResponse response)
    {
        response.Headers[ContentTypeOptionsHeader] = ContentTypeOptionsValue;
        response.Headers[StrictTransportSecurityHeader] = StrictTransportSecurityValue;
    }
}
