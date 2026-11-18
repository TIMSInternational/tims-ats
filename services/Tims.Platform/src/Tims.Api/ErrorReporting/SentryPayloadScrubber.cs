using System.Text.RegularExpressions;
using Sentry;

namespace Tims.Api.ErrorReporting;

/// <summary>
/// Removes request data that can carry credentials or personal data from every payload the Sentry SDK sends
/// (rule: api-security.md §Observability — never ship request bodies, tokens or PII off-box). Wired as the
/// SDK's BeforeSend / BeforeSendTransaction / BeforeBreadcrumb hooks by <see cref="ErrorReportingExtensions"/>.
/// </summary>
/// <remarks>
/// <para>
/// Headers are filtered by ALLOW-list, not deny-list: every header other than the content-negotiation and
/// client-identification ones below is dropped, so Authorization, Cookie, API keys, the relay attribution
/// header, cron/webhook signatures, forwarded client IPs — and any credential header added later — never
/// leave the process. Request bodies, query strings and cookies are dropped outright; the URL keeps only
/// scheme, host and path (route parameters in this API are record ids or permission names, never credentials).
/// </para>
/// <para>
/// Fail-closed: if scrubbing itself throws, the payload is DROPPED (null), never sent unscrubbed. Sentry 7.x
/// also drops an event or transaction whose callback throws; catching here keeps the guarantee independent of
/// that SDK detail.
/// </para>
/// </remarks>
public static partial class SentryPayloadScrubber
{
    /// <summary>The only request headers an error report may carry. Matched case-insensitively.</summary>
    public static readonly IReadOnlySet<string> AllowedRequestHeaders = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
    {
        "Accept",
        "Accept-Encoding",
        "Accept-Language",
        "Content-Length",
        "Content-Type",
        "Host",
        "Origin",
        "User-Agent",
    };

    /// <summary>BeforeSend hook: scrubs an error/message event in place, or drops it if scrubbing fails.</summary>
    public static SentryEvent? Scrub(SentryEvent sentryEvent)
    {
        ArgumentNullException.ThrowIfNull(sentryEvent);
        return TryScrubEventLike(sentryEvent) ? sentryEvent : null;
    }

    /// <summary>BeforeSendTransaction hook (only reached if tracing is turned on): same rules as events.</summary>
    public static SentryTransaction? Scrub(SentryTransaction transaction)
    {
        ArgumentNullException.ThrowIfNull(transaction);
        return TryScrubEventLike(transaction) ? transaction : null;
    }

    /// <summary>
    /// BeforeBreadcrumb hook: strips query strings and fragments from the breadcrumb's message and data — from
    /// absolute URLs, and from any <c>?name=value…</c> run in free text (log-line breadcrumbs render the request
    /// path and query string as separate quoted values, so there is no URL to match) — and drops the SDK's
    /// separate <c>http.query</c> / <c>http.fragment</c> data entries. A breadcrumb with nothing to strip is
    /// returned unchanged.
    /// </summary>
    public static Breadcrumb? Scrub(Breadcrumb breadcrumb)
    {
        ArgumentNullException.ThrowIfNull(breadcrumb);
        try
        {
            var message = StripUrlQueries(breadcrumb.Message);
            Dictionary<string, string>? data = null;
            var dataChanged = false;
            if (breadcrumb.Data is { } original)
            {
                data = new Dictionary<string, string>(original.Count, StringComparer.Ordinal);
                foreach (var (key, value) in original)
                {
                    if (IsQueryDataKey(key))
                    {
                        dataChanged = true;
                        continue;
                    }

                    var scrubbed = StripUrlQueries(value) ?? string.Empty;
                    dataChanged |= !string.Equals(scrubbed, value, StringComparison.Ordinal);
                    data[key] = scrubbed;
                }
            }

            if (!dataChanged && string.Equals(message, breadcrumb.Message, StringComparison.Ordinal))
            {
                return breadcrumb;
            }

            return new Breadcrumb(message ?? string.Empty, breadcrumb.Type ?? "default", data, breadcrumb.Category, breadcrumb.Level);
        }
        catch (Exception ex) when (ex is not OutOfMemoryException)
        {
            return null;
        }
    }

    private static bool TryScrubEventLike(IEventLike payload)
    {
        try
        {
            ScrubRequest(payload.Request);
            ScrubUser(payload.User);
            if (payload is SentryEvent { Message: { } message })
            {
                // An event raised from a log line (the Serilog sink) carries the rendered line.
                message.Formatted = StripUrlQueries(message.Formatted);
            }

            return true;
        }
        catch (Exception ex) when (ex is not OutOfMemoryException)
        {
            return false;
        }
    }

    private static void ScrubRequest(SentryRequest request)
    {
        request.Data = null;
        request.QueryString = null;
        request.Cookies = null;
        request.Url = StripQueryAndFragment(request.Url);

        foreach (var name in request.Headers.Keys.Where(name => !AllowedRequestHeaders.Contains(name)).ToList())
        {
            request.Headers.Remove(name);
        }

        // Only the SDK's server identity keys are kept (SERVER_NAME / SERVER_PORT / SERVER_SOFTWARE); the
        // REMOTE_* keys are the caller's address.
        foreach (var key in request.Env.Keys.Where(key => !key.StartsWith("SERVER_", StringComparison.Ordinal)).ToList())
        {
            request.Env.Remove(key);
        }

        request.Other.Clear();
    }

    private static void ScrubUser(SentryUser user)
    {
        user.IpAddress = null;
        user.Email = null;
        user.Username = null;
        user.Other.Clear();
    }

    private static bool IsQueryDataKey(string key) =>
        key.Equals("http.query", StringComparison.OrdinalIgnoreCase)
        || key.Equals("http.fragment", StringComparison.OrdinalIgnoreCase);

    private static string? StripQueryAndFragment(string? url)
    {
        if (string.IsNullOrEmpty(url))
        {
            return url;
        }

        var cut = url.IndexOfAny(['?', '#']);
        return cut < 0 ? url : url[..cut];
    }

    private static string? StripUrlQueries(string? text) =>
        string.IsNullOrEmpty(text)
            ? text
            : FreeTextQuery().Replace(AbsoluteUrlQuery().Replace(text, "$1"), string.Empty);

    // An absolute http(s) URL followed by a query string and/or fragment: keeps scheme://host/path only.
    [GeneratedRegex(@"(https?://[^\s?#""'<>]*)[?#][^\s""'<>]*", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)]
    private static partial Regex AbsoluteUrlQuery();

    // A query string anywhere in free text: "?" + a parameter name + "=" and everything up to the next
    // whitespace or quote (so "?token=…&next=…" goes as one run).
    [GeneratedRegex(@"\?[A-Za-z0-9_.~%\[\]-]+=[^\s""'<>]*", RegexOptions.CultureInvariant)]
    private static partial Regex FreeTextQuery();
}
