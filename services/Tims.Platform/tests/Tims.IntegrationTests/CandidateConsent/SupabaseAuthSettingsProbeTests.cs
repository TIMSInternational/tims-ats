using System.Net;
using System.Text;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;
using Tims.Api.CandidateConsent;
using Tims.Infrastructure.CandidateConsent;

namespace Tims.IntegrationTests.CandidateConsent;

/// <summary>
/// The fail-closed auth-settings probe over a fake HTTP handler (no container): parsing, the apikey header, the
/// success/failure cache, and the startup warning for an unconfigured auth service.
/// </summary>
public sealed class SupabaseAuthSettingsProbeTests
{
    private const string Url = "https://proj.supabase.co";
    private const string Key = "service-key";

    [Theory]
    [InlineData("""{"mailer_autoconfirm":false,"external":{}}""", false)]
    [InlineData("""{"mailer_autoconfirm":true}""", true)]
    public void Parse_ReadsTheBoolean(string json, bool expected) =>
        Assert.Equal(expected, SupabaseAuthSettingsProbe.ParseAutoconfirm(json));

    [Theory]
    [InlineData("""{"mailer_autoconfirm":"false"}""")]
    [InlineData("""{"mailer_autoconfirm":null}""")]
    [InlineData("""{"disable_signup":false}""")]
    [InlineData("""[]""")]
    [InlineData("""not json""")]
    public void Parse_AnythingElse_IsNull(string json) => Assert.Null(SupabaseAuthSettingsProbe.ParseAutoconfirm(json));

    [Fact]
    public async Task AutoconfirmOff_RequiresConfirmation_SendsApiKey_AndIsCachedFiveMinutes()
    {
        var handler = new FakeHandler(HttpStatusCode.OK, """{"mailer_autoconfirm":false}""");
        var clock = new ManualClock();
        var probe = Probe(handler, clock);

        Assert.True(await probe.RequiresEmailConfirmationAsync(CancellationToken.None));
        Assert.True(await probe.RequiresEmailConfirmationAsync(CancellationToken.None));
        Assert.Equal(1, handler.Calls);
        Assert.Equal("https://proj.supabase.co/auth/v1/settings", handler.LastUri?.AbsoluteUri);
        Assert.Equal(Key, handler.LastApiKey);

        clock.Advance(TimeSpan.FromMinutes(5) + TimeSpan.FromSeconds(1));
        Assert.True(await probe.RequiresEmailConfirmationAsync(CancellationToken.None));
        Assert.Equal(2, handler.Calls);
    }

    [Fact]
    public async Task AutoconfirmOn_IsFalse()
    {
        var probe = Probe(new FakeHandler(HttpStatusCode.OK, """{"mailer_autoconfirm":true}"""), new ManualClock());
        Assert.False(await probe.RequiresEmailConfirmationAsync(CancellationToken.None));
    }

    [Theory]
    [InlineData(HttpStatusCode.InternalServerError, """{"mailer_autoconfirm":false}""")]
    [InlineData(HttpStatusCode.Unauthorized, """{"mailer_autoconfirm":false}""")]
    [InlineData(HttpStatusCode.OK, """{}""")]
    [InlineData(HttpStatusCode.OK, """<html>""")]
    public async Task FetchOrParseFailure_FailsClosed_AndIsRetriedSoon(HttpStatusCode code, string body)
    {
        var handler = new FakeHandler(code, body);
        var clock = new ManualClock();
        var probe = Probe(handler, clock);

        Assert.False(await probe.RequiresEmailConfirmationAsync(CancellationToken.None));
        Assert.False(await probe.RequiresEmailConfirmationAsync(CancellationToken.None));
        Assert.Equal(1, handler.Calls); // briefly cached

        clock.Advance(TimeSpan.FromSeconds(11));
        handler.Respond(HttpStatusCode.OK, """{"mailer_autoconfirm":false}""");
        Assert.True(await probe.RequiresEmailConfirmationAsync(CancellationToken.None));
        Assert.Equal(2, handler.Calls);
    }

    [Fact]
    public async Task TransportError_FailsClosed()
    {
        var handler = new FakeHandler(HttpStatusCode.OK, "{}") { Throw = true };
        Assert.False(await Probe(handler, new ManualClock()).RequiresEmailConfirmationAsync(CancellationToken.None));
    }

    [Theory]
    [InlineData(null, Key)]
    [InlineData(Url, null)]
    [InlineData(Url, "REPLACE_ME_OUT_OF_BAND")]
    [InlineData("REPLACE_ME_OUT_OF_BAND", Key)]
    [InlineData("http://proj.supabase.co", Key)]
    public async Task Unconfigured_FailsClosed_WithoutAnyRequest(string? url, string? key)
    {
        var handler = new FakeHandler(HttpStatusCode.OK, """{"mailer_autoconfirm":false}""");
        var probe = Probe(handler, new ManualClock(), url, key);
        Assert.False(await probe.RequiresEmailConfirmationAsync(CancellationToken.None));
        Assert.Equal(0, handler.Calls);
    }

    [Theory]
    [InlineData(false, null, null, false)]
    [InlineData(true, Url, Key, false)]
    [InlineData(true, null, Key, true)]
    [InlineData(true, Url, "", true)]
    [InlineData(true, Url, "REPLACE_ME_OUT_OF_BAND", true)]
    public void StartupWarning_OnlyWhenEnabledAndUnconfigured(bool enabled, string? url, string? key, bool warns) =>
        Assert.Equal(warns, CandidateConsentEndpoints.WarnIfSelfServiceUnconfigured(
            NullLogger.Instance, enabled, url, key));

    private static SupabaseAuthSettingsProbe Probe(
        FakeHandler handler, TimeProvider clock, string? url = Url, string? key = Key)
    {
        var configuration = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["Invitations:SupabaseUrl"] = url,
            ["Invitations:SupabaseServiceKey"] = key,
        }).Build();
        return new SupabaseAuthSettingsProbe(new Factory(handler), configuration, clock);
    }

    private sealed class Factory(HttpMessageHandler handler) : IHttpClientFactory
    {
        public HttpClient CreateClient(string name) => new(handler, disposeHandler: false);
    }

    private sealed class ManualClock : TimeProvider
    {
        private DateTimeOffset _now = new(2026, 10, 1, 12, 0, 0, TimeSpan.Zero);

        public override DateTimeOffset GetUtcNow() => _now;

        public void Advance(TimeSpan by) => _now += by;
    }

    private sealed class FakeHandler(HttpStatusCode code, string body) : HttpMessageHandler
    {
        private HttpStatusCode _code = code;
        private string _body = body;

        public int Calls { get; private set; }

        public Uri? LastUri { get; private set; }

        public string? LastApiKey { get; private set; }

        public bool Throw { get; init; }

        public void Respond(HttpStatusCode newCode, string newBody)
        {
            _code = newCode;
            _body = newBody;
        }

        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            Calls++;
            LastUri = request.RequestUri;
            LastApiKey = request.Headers.TryGetValues("apikey", out var values) ? values.Single() : null;
            if (Throw)
            {
                throw new HttpRequestException("connection refused");
            }

            return Task.FromResult(new HttpResponseMessage(_code)
            {
                Content = new StringContent(_body, Encoding.UTF8, "application/json"),
            });
        }
    }
}
