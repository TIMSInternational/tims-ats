using Sentry;
using Tims.Api.ErrorReporting;

namespace Tims.IntegrationTests.ErrorReporting;

public sealed class SentryPayloadScrubberTests
{
    private const string SecretValue = "s3cr3t-credential-value";

    private static void FillRequest(SentryRequest request)
    {
        request.Method = "POST";
        request.Url = "https://api.example.test/tenant/candidates/7d6f0d7e-3a52-4d0e-9c8a-2b1f1e9b8c11/consent?token=" + SecretValue + "#frag";
        request.QueryString = "?token=" + SecretValue + "&email=person@example.test";
        request.Cookies = "sb-access-token=" + SecretValue;
        request.Data = "{\"email\":\"person@example.test\",\"salary\":120000}";
        foreach (var name in new[]
                 {
                     "Authorization", "Cookie", "x-api-key", "X-Tims-Cron-Secret", "x-tims-relay-attribution",
                     "Stripe-Signature", "TIMS-Signature", "x-real-ip", "X-Forwarded-For", "Referer", "X-Some-Future-Token",
                 })
        {
            request.Headers[name] = SecretValue;
        }

        request.Headers["User-Agent"] = "Mozilla/5.0";
        request.Headers["content-type"] = "application/json";
        request.Headers["Host"] = "api.example.test";
        request.Env["REMOTE_ADDR"] = "203.0.113.7";
        request.Env["SERVER_NAME"] = "ip-10-0-0-1";
        request.Other["anything"] = SecretValue;
    }

    private static void AssertRequestScrubbed(SentryRequest request)
    {
        Assert.Null(request.Data);
        Assert.Null(request.QueryString);
        Assert.Null(request.Cookies);
        Assert.Equal("https://api.example.test/tenant/candidates/7d6f0d7e-3a52-4d0e-9c8a-2b1f1e9b8c11/consent", request.Url);
        Assert.Equal("POST", request.Method);
        Assert.Equal(
            ["content-type", "Host", "User-Agent"],
            request.Headers.Keys.OrderBy(key => key, StringComparer.OrdinalIgnoreCase).ToArray());
        Assert.DoesNotContain(SecretValue, request.Headers.Values);
        Assert.False(request.Env.ContainsKey("REMOTE_ADDR"));
        Assert.Equal("ip-10-0-0-1", request.Env["SERVER_NAME"]);
        Assert.Empty(request.Other);
    }

    [Fact]
    public void EventKeepsOnlyAllowListedHeadersAndDropsBodyQueryCookiesAndCallerAddress()
    {
        var sentryEvent = new SentryEvent(new InvalidOperationException("boom"));
        FillRequest(sentryEvent.Request);
        sentryEvent.User.Id = "8a1d4f43-1c39-4f5e-9b7b-7d1f0f3c2a10";
        sentryEvent.User.Email = "person@example.test";
        sentryEvent.User.Username = "person";
        sentryEvent.User.IpAddress = "203.0.113.7";
        sentryEvent.User.Other["phone"] = "+50600000000";

        var scrubbed = SentryPayloadScrubber.Scrub(sentryEvent);

        Assert.Same(sentryEvent, scrubbed);
        AssertRequestScrubbed(scrubbed!.Request);
        Assert.Null(scrubbed.User.Email);
        Assert.Null(scrubbed.User.Username);
        Assert.Null(scrubbed.User.IpAddress);
        Assert.Empty(scrubbed.User.Other);
        Assert.Equal("8a1d4f43-1c39-4f5e-9b7b-7d1f0f3c2a10", scrubbed.User.Id);
    }

    [Fact]
    public void TransactionGetsTheSameRequestScrubbing()
    {
        var transaction = new SentryTransaction("POST /tenant/candidates/{candidateId:guid}/consent", "http.server");
        FillRequest(transaction.Request);
        transaction.User.IpAddress = "203.0.113.7";

        var scrubbed = SentryPayloadScrubber.Scrub(transaction);

        Assert.Same(transaction, scrubbed);
        AssertRequestScrubbed(scrubbed!.Request);
        Assert.Null(scrubbed.User.IpAddress);
    }

    [Fact]
    public void AllowListIsCaseInsensitiveAndHoldsNoCredentialHeader()
    {
        Assert.Contains("user-agent", SentryPayloadScrubber.AllowedRequestHeaders);
        foreach (var name in new[] { "authorization", "cookie", "x-api-key", "x-tims-relay-attribution", "x-real-ip", "x-forwarded-for", "referer" })
        {
            Assert.DoesNotContain(name, SentryPayloadScrubber.AllowedRequestHeaders);
        }
    }

    [Fact]
    public void BreadcrumbUrlsLoseTheirQueryStringAndFragment()
    {
        var breadcrumb = new Breadcrumb(
            "GET https://api.daily.co/v1/rooms/abc?token=" + SecretValue + " failed",
            "http",
            new Dictionary<string, string>
            {
                ["url"] = "https://api.daily.co/v1/rooms/abc?token=" + SecretValue + "#x",
                ["method"] = "GET",
                ["http.query"] = "token=" + SecretValue,
                ["http.fragment"] = "x",
            },
            "http",
            BreadcrumbLevel.Info);

        var scrubbed = SentryPayloadScrubber.Scrub(breadcrumb);

        Assert.NotNull(scrubbed);
        Assert.Equal("GET https://api.daily.co/v1/rooms/abc failed", scrubbed.Message);
        Assert.Equal("https://api.daily.co/v1/rooms/abc", scrubbed.Data!["url"]);
        Assert.Equal("GET", scrubbed.Data["method"]);
        Assert.False(scrubbed.Data.ContainsKey("http.query"));
        Assert.False(scrubbed.Data.ContainsKey("http.fragment"));
        Assert.Equal("http", scrubbed.Type);
        Assert.Equal("http", scrubbed.Category);
        Assert.Equal(BreadcrumbLevel.Info, scrubbed.Level);
    }

    [Fact]
    public void QueryStringsInLogLineTextAreStrippedEvenWithoutAnAbsoluteUrl()
    {
        // The shape ASP.NET Core's "Request starting" line renders to: path and query string are separate values.
        var breadcrumb = new Breadcrumb(
            "Request starting \"HTTP/1.1\" \"POST\" \"http\"://\"127.0.0.1:5000\"\"\"\"/x/consent\"\"?token=" + SecretValue
            + "&next=/home\" - \"application/json\" 31",
            "default",
            new Dictionary<string, string> { ["exception_message"] = "lookup failed for ?code=" + SecretValue },
            "Microsoft.AspNetCore.Hosting.Diagnostics",
            BreadcrumbLevel.Info);
        var sentryEvent = new SentryEvent
        {
            Message = new SentryMessage { Formatted = "callback rejected: ?state=abc&code=" + SecretValue },
        };

        var scrubbedCrumb = SentryPayloadScrubber.Scrub(breadcrumb);
        var scrubbedEvent = SentryPayloadScrubber.Scrub(sentryEvent);

        Assert.NotNull(scrubbedCrumb);
        Assert.DoesNotContain(SecretValue, scrubbedCrumb.Message, StringComparison.Ordinal);
        Assert.Contains("/x/consent", scrubbedCrumb.Message, StringComparison.Ordinal);
        Assert.Equal("lookup failed for ", scrubbedCrumb.Data!["exception_message"]);
        Assert.Equal("callback rejected: ", scrubbedEvent!.Message!.Formatted);
    }

    [Fact]
    public void BreadcrumbWithoutAUrlIsReturnedUnchanged()
    {
        var breadcrumb = new Breadcrumb(
            "HTTP GET /health responded 200",
            "default",
            new Dictionary<string, string> { ["StatusCode"] = "200" },
            "Serilog.AspNetCore.RequestLoggingMiddleware",
            BreadcrumbLevel.Info);

        Assert.Same(breadcrumb, SentryPayloadScrubber.Scrub(breadcrumb));
    }
}
