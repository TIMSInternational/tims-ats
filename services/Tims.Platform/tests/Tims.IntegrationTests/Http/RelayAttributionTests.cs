using System.Buffers.Text;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Options;
using Tims.Api.Configuration;
using Tims.Api.Http;

namespace Tims.IntegrationTests.Http;

public sealed class RelayAttributionTests
{
    private const string Secret = "relay-test-secret";
    private static string Hash(string text) => Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(text)));
    private static string Envelope(string? ip, string? actor = null, long age = 0,
        string method = "GET", string path = "/test?q=a")
    {
        var body = Base64Url.EncodeToString(JsonSerializer.SerializeToUtf8Bytes(new
        {
            timestamp = DateTimeOffset.UtcNow.ToUnixTimeSeconds() - age,
            nonce = Guid.NewGuid().ToString(),
            method,
            path,
            authorizationHash = Hash(actor ?? "Bearer token"),
            cookieHash = Hash(""),
            ip,
            ua = "browser-test",
        }));
        return body + "." + Base64Url.EncodeToString(HMACSHA256.HashData(Encoding.UTF8.GetBytes(Secret),
            Encoding.UTF8.GetBytes("tims-platform-relay-attribution-v1\n" + body)));
    }
    private static DefaultHttpContext Request(string? envelope)
    {
        var context = new DefaultHttpContext
        { User = new ClaimsPrincipal(new ClaimsIdentity([new Claim("sub", "user")], "Bearer")) };
        context.Request.Method = "GET";
        context.Request.Path = "/test";
        context.Request.QueryString = new QueryString("?q=a");
        context.Request.Headers.Authorization = "Bearer token";
        context.Request.Headers["x-real-ip"] = "6.6.6.6";
        context.Request.Headers["x-forwarded-for"] = "203.0.113.99";
        if (envelope is not null) context.Request.Headers[RelayAttributionMiddleware.HeaderName] = envelope;
        return context;
    }
    private static Task Run(HttpContext context, IRelayNonceStore nonces, RequestDelegate next,
        string? allowWithoutIp = null, string environment = "Development", string? e2eMarker = null)
    {
        var options = Options.Create(new PlatformOptions
        { ImpersonationSecret = Secret, AllowAnonymousRelayWithoutClientIp = allowWithoutIp });
        var host = new Microsoft.Extensions.Hosting.Internal.HostingEnvironment { EnvironmentName = environment };
        var configuration = new ConfigurationBuilder().AddInMemoryCollection(
            new Dictionary<string, string?> { [RelayAttributionMiddleware.E2EStackMarker] = e2eMarker }).Build();
        return new TrustedProxyHeaderMiddleware(ctx =>
                new RelayAttributionMiddleware(next).InvokeAsync(ctx, options, nonces, host, configuration))
            .InvokeAsync(context, options);
    }
    [Theory]
    [InlineData("203.0.113.1")]
    [InlineData("203.0.113.2")]
    public async Task SignedClientsPreserveDistinctIpAndUa(string ip)
    {
        var context = Request(Envelope(ip));
        var called = false;
        await Run(context, new Nonces(), ctx =>
        {
            called = true;
            Assert.Equal(ip, ctx.ClientIpFor());
            Assert.Equal("browser-test", ctx.Request.Headers.UserAgent.ToString());
            return Task.CompletedTask;
        });
        Assert.True(called);
    }
    [Fact]
    public async Task TamperWrongBearerExpiredAndReplayedMetadataAreRejected()
    {
        var good = Envelope("203.0.113.1");
        var nonces = new Nonces();
        var called = 0;
        Task Next(HttpContext _) { called++; return Task.CompletedTask; }
        await Run(Request(good), nonces, Next);
        foreach (var envelope in new[] { good, good + "x", Envelope("203.0.113.1", "Bearer other"), Envelope("203.0.113.1", age: 100) })
        {
            var context = Request(envelope);
            await Run(context, nonces, Next);
            Assert.Equal(401, context.Response.StatusCode);
        }
        Assert.Equal(1, called);
    }
    [Fact]
    public async Task DirectCallerCannotSpoofTrustedIp()
    {
        var context = Request(null);
        await Run(context, new Nonces(), ctx =>
        {
            Assert.Equal("203.0.113.99", ctx.ClientIpFor());
            return Task.CompletedTask;
        });
    }
    [Fact]
    public async Task UnauthenticatedBearerCannotConsumeNonce()
    {
        var envelope = Envelope("203.0.113.1");
        var nonces = new Nonces();
        var unauthenticated = Request(envelope);
        unauthenticated.User = new ClaimsPrincipal(new ClaimsIdentity());
        var calls = 0;
        Task Next(HttpContext _) { calls++; return Task.CompletedTask; }
        await Run(unauthenticated, nonces, Next);
        Assert.Equal(401, unauthenticated.Response.StatusCode);
        await Run(Request(envelope), nonces, Next);
        Assert.Equal(1, calls);
    }

    [Fact]
    public async Task SignedAnonymousInvitationSetupReceivesDistinctTrustedIp()
    {
        var context = Request(Envelope("203.0.113.7", actor: "", method: "POST",
            path: "/invitations/setup/preview"));
        context.User = new ClaimsPrincipal(new ClaimsIdentity());
        context.Request.Method = "POST";
        context.Request.Path = "/invitations/setup/preview";
        context.Request.QueryString = QueryString.Empty;
        context.Request.Headers.Authorization = "";
        var called = false;
        await Run(context, new Nonces(), ctx =>
        {
            called = true;
            Assert.Equal("203.0.113.7", ctx.ClientIpFor());
            return Task.CompletedTask;
        });
        Assert.True(called);
    }

    [Theory]
    [InlineData("/interviews/candidate-join")]
    [InlineData("/interviews/candidate-join/")]
    public async Task SignedAnonymousCandidateInterviewJoinReceivesDistinctTrustedIp(string path)
    {
        var context = Request(Envelope("203.0.113.8", actor: "", method: "POST", path: path));
        context.User = new ClaimsPrincipal(new ClaimsIdentity());
        context.Request.Method = "POST";
        context.Request.Path = path;
        context.Request.QueryString = QueryString.Empty;
        context.Request.Headers.Authorization = "";
        var called = false;
        await Run(context, new Nonces(), ctx =>
        {
            called = true;
            Assert.Equal("203.0.113.8", ctx.ClientIpFor());
            return Task.CompletedTask;
        });
        Assert.True(called);
    }

    [Fact]
    public async Task AnonymousRelayIsStillRefusedOnOtherInterviewRoutes()
    {
        const string path = "/interviews/candidate-join-other";
        var context = Request(Envelope("203.0.113.8", actor: "", method: "POST", path: path));
        context.User = new ClaimsPrincipal(new ClaimsIdentity());
        context.Request.Method = "POST";
        context.Request.Path = path;
        context.Request.QueryString = QueryString.Empty;
        context.Request.Headers.Authorization = "";
        await Run(context, new Nonces(), _ => throw new InvalidOperationException("must not be reached"));
        Assert.Equal(401, context.Response.StatusCode);
    }

    private static DefaultHttpContext AnonymousRequest(string? ip, string path)
    {
        var context = Request(Envelope(ip, actor: "", method: "POST", path: path));
        context.User = new ClaimsPrincipal(new ClaimsIdentity());
        context.Request.Method = "POST";
        context.Request.Path = path;
        context.Request.QueryString = QueryString.Empty;
        context.Request.Headers.Authorization = "";
        return context;
    }

    [Theory]
    [InlineData("/interviews/candidate-join")]
    [InlineData("/invitations/setup/preview")]
    public async Task AnonymousRelayWithoutAClientIpFailsClosed(string path)
    {
        // #329 item 2: with no vouched IP every anonymous caller would share the single `anonymous` rate-limit
        // bucket (and write IP-less audit rows). Refused with 503 before anything downstream runs — including
        // the stale direct-caller x-forwarded-for, which must NOT be substituted for the missing relay IP.
        var context = AnonymousRequest(null, path);
        await Run(context, new Nonces(), _ => throw new InvalidOperationException("must not be reached"));
        Assert.Equal(StatusCodes.Status503ServiceUnavailable, context.Response.StatusCode);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("TRUE")]
    [InlineData("1")]
    public async Task OnlyAnExactTrueOptsOutOfTheNullIpRefusal(string? flag)
    {
        var context = AnonymousRequest(null, "/interviews/candidate-join");
        await Run(context, new Nonces(), _ => throw new InvalidOperationException("must not be reached"), flag);
        Assert.Equal(StatusCodes.Status503ServiceUnavailable, context.Response.StatusCode);
    }

    [Fact]
    public async Task TheDevelopmentOptOutLetsANullIpAnonymousRelayThrough()
    {
        var context = AnonymousRequest(null, "/interviews/candidate-join");
        var called = false;
        await Run(context, new Nonces(), ctx =>
        {
            called = true;
            Assert.Null(ctx.ClientIpFor()); // unknown stays unknown — the relay edge is never substituted
            return Task.CompletedTask;
        }, "true");
        Assert.True(called);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("true")]
    [InlineData("0")]
    [InlineData(" 1")]
    public async Task InProductionTheOptOutIsRefusedWithoutTheExactE2EMarker(string? marker)
    {
        // A stray Platform__AllowAnonymousRelayWithoutClientIp on App Runner (Production host) must not re-open the
        // shared anonymous bucket: the 503 stands unless the process is explicitly the E2E stack.
        var context = AnonymousRequest(null, "/invitations/setup/preview");
        await Run(context, new Nonces(), _ => throw new InvalidOperationException("must not be reached"),
            "true", environment: "Production", e2eMarker: marker);
        Assert.Equal(StatusCodes.Status503ServiceUnavailable, context.Response.StatusCode);
    }

    [Fact]
    public async Task InProductionTheOptOutIsHonouredOnlyWithTheE2EMarker()
    {
        var context = AnonymousRequest(null, "/invitations/setup/preview");
        var called = false;
        await Run(context, new Nonces(), _ => { called = true; return Task.CompletedTask; },
            "true", environment: "Production", e2eMarker: "1");
        Assert.True(called);
    }

    [Theory]
    [InlineData(null, "Development", null, false)]
    [InlineData("true", "Development", null, true)]
    [InlineData("true", "Staging", null, true)]
    [InlineData("true", "Production", null, false)]
    [InlineData("true", "production", null, false)]
    [InlineData("true", "Production", "1", true)]
    [InlineData("TRUE", "Production", "1", false)]
    [InlineData(null, "Production", "1", false)] // the marker alone opts nothing out
    public void OptOutPolicy(string? flag, string environment, string? marker, bool allowed) =>
        Assert.Equal(allowed, RelayAttributionMiddleware.AllowsAnonymousWithoutClientIp(flag, environment, marker));

    [Fact]
    public async Task AnAuthenticatedRelayWithoutAClientIpIsNotRefused()
    {
        // Authenticated callers are keyed by their principal, not their IP, so a missing IP does not collapse them.
        var context = Request(Envelope(null));
        var called = false;
        await Run(context, new Nonces(), _ => { called = true; return Task.CompletedTask; });
        Assert.True(called);
        Assert.NotEqual(StatusCodes.Status503ServiceUnavailable, context.Response.StatusCode);
    }

    private sealed class Nonces : IRelayNonceStore
    {
        private readonly HashSet<string> _seen = [];
        public Task<bool> TryUseAsync(string nonce) => Task.FromResult(_seen.Add(nonce));
    }
}
