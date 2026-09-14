using System.Buffers.Text;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Options;
using Tims.Api.Configuration;
using Tims.Api.Http;

namespace Tims.IntegrationTests.Http;

public sealed class RelayAttributionTests
{
    private const string Secret = "relay-test-secret";
    private static string Hash(string text) => Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(text)));
    private static string Envelope(string ip, string? actor = null, long age = 0)
    {
        var body = Base64Url.EncodeToString(JsonSerializer.SerializeToUtf8Bytes(new
        {
            timestamp = DateTimeOffset.UtcNow.ToUnixTimeSeconds() - age,
            nonce = Guid.NewGuid().ToString(),
            method = "GET",
            path = "/test?q=a",
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
    private static Task Run(HttpContext context, IRelayNonceStore nonces, RequestDelegate next)
    {
        var options = Options.Create(new PlatformOptions { ImpersonationSecret = Secret });
        return new TrustedProxyHeaderMiddleware(ctx => new RelayAttributionMiddleware(next).InvokeAsync(ctx, options, nonces))
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

    private sealed class Nonces : IRelayNonceStore
    {
        private readonly HashSet<string> _seen = [];
        public Task<bool> TryUseAsync(string nonce) => Task.FromResult(_seen.Add(nonce));
    }
}
