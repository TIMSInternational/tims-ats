namespace Tims.Api.Http;

/// <summary>
/// Adds baseline transport/content security headers to every response outside Development:
/// <c>X-Content-Type-Options: nosniff</c> (no MIME sniffing of JSON responses) and
/// <c>Strict-Transport-Security</c> (browsers only reach this API over HTTPS). Development is
/// excluded so a local plain-HTTP host is never pinned to HTTPS by a browser.
/// </summary>
public sealed class SecurityHeadersMiddleware(RequestDelegate next, IHostEnvironment environment)
{
    public const string ContentTypeOptionsHeader = "X-Content-Type-Options";
    public const string ContentTypeOptionsValue = "nosniff";
    public const string StrictTransportSecurityHeader = "Strict-Transport-Security";
    public const string StrictTransportSecurityValue = "max-age=31536000; includeSubDomains";

    private readonly RequestDelegate _next = next;
    private readonly bool _enabled = !environment.IsDevelopment();

    public Task InvokeAsync(HttpContext context)
    {
        if (_enabled)
        {
            // Set before the rest of the pipeline runs, while the response has not started; later
            // middleware and endpoints can still add their own headers on top.
            context.Response.Headers[ContentTypeOptionsHeader] = ContentTypeOptionsValue;
            context.Response.Headers[StrictTransportSecurityHeader] = StrictTransportSecurityValue;
        }

        return _next(context);
    }
}
