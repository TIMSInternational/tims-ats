using System.Net;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Amazon.Bedrock;
using Amazon.Runtime;
using Amazon.S3;
using Amazon.SimpleEmail;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;
using Tims.Infrastructure.PlatformHealth;
using Tims.IntegrationTests.PlatformDashboard;

namespace Tims.IntegrationTests.PlatformHealth;

/// <summary>
/// <c>GET /platform/health/dependencies</c> through the REAL host: real Postgres (the platform-dashboard
/// fixture's identity plane), real <c>PrincipalResolver</c> + <c>PlatformOwnerGate</c>, the real probe classes
/// and the REAL AWS SDK request/response pipeline — only the HTTP transport underneath the SDK clients and the
/// Supabase HttpClient is an in-memory stub, so nothing leaves the process.
///
/// <para>TRAP 4: owner 200, ordinary org-user 403, missing/tampered JWT 401, flag-default 404. The payload
/// tests pin the exact per-dependency status/reason, and that configured identifiers (bucket name, guardrail
/// id, Supabase host, service key) never reach the response body.</para>
/// </summary>
[Collection("PlatformDashboardRead")]
public sealed class PlatformHealthEndpointTests(PlatformDashboardReadFixture fixture)
{
    private const string Issuer = "https://test-project.supabase.co/auth/v1";
    private const string Audience = "authenticated";
    private const string Path = "/platform/health/dependencies";

    private const string Bucket = "tims-cv-uploads-secret-name";
    private const string GuardrailId = "gr0secretid42";
    private const string SupabaseOrigin = "https://stub-project-ref.supabase.co";
    private const string ServiceKey = "stub-service-key-never-echoed";

    private static readonly RSA SigningRsa = RSA.Create(2048);
    private static readonly RsaSecurityKey PrivateKey = new(SigningRsa) { KeyId = "platform-health-test-key" };

    private readonly PlatformDashboardReadFixture _fixture = fixture;

    private WebApplicationFactory<Program> Factory(bool configured, StubTransport transport) =>
        new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.UseSetting("Platform:DatabaseConnectionString", _fixture.ConnectionString);
            builder.UseSetting("Platform:PlatformHealthProbesEnabled", "true");
            builder.UseSetting("Platform:SupabaseJwtIssuer", Issuer);
            builder.UseSetting("Platform:SupabaseJwtAudience", Audience);
            if (configured)
            {
                builder.UseSetting("PlatformHealth:CvUploadsBucket", Bucket);
                builder.UseSetting("PlatformHealth:CvUploadsRegion", "us-east-2");
                builder.UseSetting("PlatformHealth:BedrockGuardrailId", GuardrailId);
                builder.UseSetting("PlatformHealth:BedrockRegion", "us-east-2");
                builder.UseSetting("Invitations:SupabaseUrl", SupabaseOrigin);
                builder.UseSetting("Invitations:SupabaseServiceKey", ServiceKey);
                builder.UseSetting("Email:Enabled", "true");
                builder.UseSetting("Email:Region", "us-east-1");
                builder.UseSetting("Email:FromAddress", "sender@example.test");
            }

            var publicJwk = JsonWebKeyConverter.ConvertFromRSASecurityKey(
                new RsaSecurityKey(SigningRsa.ExportParameters(false)) { KeyId = PrivateKey.KeyId });
            builder.ConfigureTestServices(services =>
            {
                services.PostConfigure<JwtBearerOptions>(JwtBearerDefaults.AuthenticationScheme, options =>
                {
                    options.RequireHttpsMetadata = false;
                    options.TokenValidationParameters.IssuerSigningKeys = [publicJwk];
                });
                services.AddSingleton<IAwsHealthClientFactory>(new StubAwsClients(transport));
                services.AddSingleton<IAmazonSimpleEmailService>(new AmazonSimpleEmailServiceClient(
                    new AnonymousAWSCredentials(),
                    new AmazonSimpleEmailServiceConfig
                    {
                        RegionEndpoint = Amazon.RegionEndpoint.USEast1,
                        MaxErrorRetry = 0,
                        HttpClientFactory = new StubSdkHttpFactory(transport),
                    }));
                services.AddHttpClient(SupabaseAuthHealthProbe.HttpClientName)
                    .ConfigurePrimaryHttpMessageHandler(() => new DelegatingStub(transport));
            });
        });

    private static WebApplicationFactory<Program> DarkFactory() =>
        new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
            builder.UseSetting("Platform:DatabaseConnectionString", "Host=localhost;Port=5432;Database=x;Username=x"));

    private static string Mint(string sub)
    {
        var descriptor = new SecurityTokenDescriptor
        {
            Issuer = Issuer,
            Audience = Audience,
            Subject = new ClaimsIdentity([new Claim("sub", sub)]),
            Expires = DateTime.UtcNow.AddMinutes(10),
            SigningCredentials = new SigningCredentials(PrivateKey, SecurityAlgorithms.RsaSha256),
        };
        return new JsonWebTokenHandler().CreateToken(descriptor);
    }

    private static async Task<HttpResponseMessage> Get(HttpClient client, string? token)
    {
        var request = new HttpRequestMessage(HttpMethod.Get, Path);
        if (token is not null)
        {
            request.Headers.Add("Authorization", $"Bearer {token}");
        }

        return await client.SendAsync(request);
    }

    // ── the gate ─────────────────────────────────────────────────────────────────────────────────────
    [Fact]
    public async Task OrdinaryOrgUser_Is403_AndNoProbeRuns()
    {
        var transport = new StubTransport();
        await using var factory = Factory(configured: true, transport);
        using var client = factory.CreateClient();

        Assert.Equal(HttpStatusCode.Forbidden, (await Get(client, Mint(PlatformDashboardReadFixture.OrgUserSub))).StatusCode);
        Assert.Empty(transport.Requests);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJhdHRhY2tlciJ9.c2ln")]
    public async Task RejectedCredential_Is401(string? token)
    {
        var transport = new StubTransport();
        await using var factory = Factory(configured: true, transport);
        using var client = factory.CreateClient();

        Assert.Equal(HttpStatusCode.Unauthorized, (await Get(client, token)).StatusCode);
        Assert.Empty(transport.Requests);
    }

    [Fact]
    public async Task Route_Is404_WhenFlagDefaultsOff()
    {
        await using var factory = DarkFactory();
        using var client = factory.CreateClient();

        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync(Path)).StatusCode);
    }

    // ── the payload ──────────────────────────────────────────────────────────────────────────────────
    [Fact]
    public async Task PlatformOwner_GetsEveryDependency_ClassifiedFromRealSdkResponses()
    {
        var transport = new StubTransport();
        await using var factory = Factory(configured: true, transport);
        using var client = factory.CreateClient();

        var response = await Get(client, Mint(PlatformDashboardReadFixture.PlatformOwnerSub));
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("no-store", response.Headers.CacheControl?.ToString());
        var text = await response.Content.ReadAsStringAsync();
        var body = JsonDocument.Parse(text).RootElement;

        Assert.Equal(["checkedAt", "cacheSeconds", "dependencies"], body.EnumerateObject().Select(p => p.Name).ToArray());
        Assert.Equal(30, body.GetProperty("cacheSeconds").GetInt32());
        var deps = body.GetProperty("dependencies").EnumerateArray().ToDictionary(d => d.GetProperty("id").GetString()!);
        Assert.Equal(["api_gateway", "auth", "storage", "jobs", "ai", "email", "realtime"],
            body.GetProperty("dependencies").EnumerateArray().Select(d => d.GetProperty("id").GetString()!).ToArray());

        // The API's own readiness: Postgres reachable, Redis not configured (degraded) → /ready's 200 → operational.
        AssertState(deps["api_gateway"], "operational", null);
        Assert.Equal("healthy", MetricValue(deps["api_gateway"], "ready_postgres"));
        Assert.Equal("degraded", MetricValue(deps["api_gateway"], "ready_redis"));

        AssertState(deps["auth"], "operational", null);
        AssertState(deps["storage"], "down", "not_found"); // HeadBucket → 404
        AssertState(deps["jobs"], "not_monitored", "not_deployed"); // no qrtz_* tables in this database
        AssertState(deps["ai"], "operational", null);
        Assert.Equal("ready", MetricValue(deps["ai"], "guardrail_status"));
        AssertState(deps["email"], "degraded", "quota_near_limit"); // 900 of 1000
        Assert.Equal("90", MetricValue(deps["email"], "quota_used_pct"));
        AssertState(deps["realtime"], "not_monitored", "not_used");

        // What actually went over the (stub) wire: one cheap read per dependency, never an inference or a send.
        Assert.Contains(transport.Requests, r => r.Method == "HEAD" && r.Url.Contains(Bucket, StringComparison.Ordinal));
        Assert.Contains(transport.Requests, r => r.Method == "GET" && r.Url.Contains($"/guardrails/{GuardrailId}", StringComparison.Ordinal));
        Assert.Contains(transport.Requests, r => r.Body.Contains("Action=GetSendQuota", StringComparison.Ordinal));
        Assert.Contains(transport.Requests, r => r.Body.Contains("Action=GetAccountSendingEnabled", StringComparison.Ordinal));
        var auth = Assert.Single(transport.Requests, r => r.Url.StartsWith(SupabaseOrigin, StringComparison.Ordinal));
        Assert.Equal($"{SupabaseOrigin}/auth/v1/health", auth.Url);
        Assert.Equal(ServiceKey, auth.ApiKey);
        Assert.DoesNotContain(transport.Requests, r => r.Url.Contains("invoke", StringComparison.OrdinalIgnoreCase)
            || r.Body.Contains("SendEmail", StringComparison.Ordinal) || r.Body.Contains("SendRawEmail", StringComparison.Ordinal));

        // Nothing configured is echoed back.
        foreach (var secretish in new[] { Bucket, GuardrailId, "stub-project-ref", ServiceKey, "amazonaws", "supabase.co" })
        {
            Assert.DoesNotContain(secretish, text, StringComparison.OrdinalIgnoreCase);
        }
    }

    [Fact]
    public async Task SecondCallWithinTheWindow_IsServedFromCache()
    {
        var transport = new StubTransport();
        await using var factory = Factory(configured: true, transport);
        using var client = factory.CreateClient();
        var token = Mint(PlatformDashboardReadFixture.PlatformOwnerSub);

        var first = JsonDocument.Parse(await (await Get(client, token)).Content.ReadAsStringAsync()).RootElement;
        var callsAfterFirst = transport.Requests.Count;
        var second = JsonDocument.Parse(await (await Get(client, token)).Content.ReadAsStringAsync()).RootElement;

        Assert.True(callsAfterFirst > 0);
        Assert.Equal(callsAfterFirst, transport.Requests.Count);
        Assert.Equal(first.GetProperty("checkedAt").GetString(), second.GetProperty("checkedAt").GetString());
    }

    [Fact]
    public async Task Unconfigured_Dependencies_AreNotConfigured_NotGuessed()
    {
        var transport = new StubTransport();
        await using var factory = Factory(configured: false, transport);
        using var client = factory.CreateClient();

        var response = await Get(client, Mint(PlatformDashboardReadFixture.PlatformOwnerSub));
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var deps = JsonDocument.Parse(await response.Content.ReadAsStringAsync()).RootElement
            .GetProperty("dependencies").EnumerateArray().ToDictionary(d => d.GetProperty("id").GetString()!);

        foreach (var id in new[] { "auth", "storage", "ai", "email" })
        {
            AssertState(deps[id], "not_configured", "missing_config");
        }

        Assert.Empty(transport.Requests);
    }

    private static void AssertState(JsonElement dependency, string status, string? reason)
    {
        Assert.Equal(status, dependency.GetProperty("status").GetString());
        if (reason is null)
        {
            Assert.Equal(JsonValueKind.Null, dependency.GetProperty("reason").ValueKind);
        }
        else
        {
            Assert.Equal(reason, dependency.GetProperty("reason").GetString());
        }
    }

    private static string? MetricValue(JsonElement dependency, string id) =>
        dependency.GetProperty("metrics").EnumerateArray()
            .Single(m => m.GetProperty("id").GetString() == id)
            .GetProperty("value").GetString();

    // ── in-memory transport: routes by URL, records every request ────────────────────────────────────
    internal sealed record RecordedRequest(string Method, string Url, string Body, string? ApiKey);

    internal sealed class StubTransport
    {
        private readonly List<RecordedRequest> _requests = [];

        public IReadOnlyList<RecordedRequest> Requests
        {
            get
            {
                lock (_requests)
                {
                    return [.. _requests];
                }
            }
        }

        public async Task<HttpResponseMessage> HandleAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            var url = request.RequestUri!.ToString();
            var body = request.Content is null ? "" : await request.Content.ReadAsStringAsync(cancellationToken);
            var apiKey = request.Headers.TryGetValues("apikey", out var values) ? values.Single() : null;
            lock (_requests)
            {
                _requests.Add(new RecordedRequest(request.Method.Method, url, body, apiKey));
            }

            if (url.StartsWith(SupabaseOrigin, StringComparison.Ordinal))
            {
                return Json(HttpStatusCode.OK, """{"version":"v2","name":"GoTrue","description":"stub"}""");
            }

            if (request.Method == HttpMethod.Head)
            {
                return new HttpResponseMessage(HttpStatusCode.NotFound) { Content = new ByteArrayContent([]) };
            }

            if (url.Contains("/guardrails/", StringComparison.Ordinal))
            {
                return Json(HttpStatusCode.OK,
                    $$"""{"guardrailId":"{{GuardrailId}}","guardrailArn":"arn:aws:bedrock:us-east-2:000000000000:guardrail/{{GuardrailId}}","name":"pii-mask","status":"READY","version":"DRAFT","createdAt":1760000000,"updatedAt":1760000000,"blockedInputMessaging":"x","blockedOutputsMessaging":"x"}""");
            }

            if (body.Contains("Action=GetSendQuota", StringComparison.Ordinal))
            {
                return Xml("<GetSendQuotaResponse xmlns=\"http://ses.amazonaws.com/doc/2010-12-01/\"><GetSendQuotaResult><SentLast24Hours>900</SentLast24Hours><Max24HourSend>1000</Max24HourSend><MaxSendRate>14</MaxSendRate></GetSendQuotaResult><ResponseMetadata><RequestId>q</RequestId></ResponseMetadata></GetSendQuotaResponse>");
            }

            if (body.Contains("Action=GetAccountSendingEnabled", StringComparison.Ordinal))
            {
                return Xml("<GetAccountSendingEnabledResponse xmlns=\"http://ses.amazonaws.com/doc/2010-12-01/\"><GetAccountSendingEnabledResult><Enabled>true</Enabled></GetAccountSendingEnabledResult><ResponseMetadata><RequestId>e</RequestId></ResponseMetadata></GetAccountSendingEnabledResponse>");
            }

            return new HttpResponseMessage(HttpStatusCode.InternalServerError) { Content = new StringContent("unexpected") };
        }

        private static HttpResponseMessage Json(HttpStatusCode status, string json) =>
            new(status) { Content = new StringContent(json, Encoding.UTF8, "application/json") };

        private static HttpResponseMessage Xml(string xml) =>
            new(HttpStatusCode.OK) { Content = new StringContent(xml, Encoding.UTF8, "text/xml") };
    }

    private sealed class DelegatingStub(StubTransport transport) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken) =>
            transport.HandleAsync(request, cancellationToken);
    }

    private sealed class StubSdkHttpFactory(StubTransport transport) : HttpClientFactory
    {
        public override HttpClient CreateHttpClient(IClientConfig clientConfig) => new(new DelegatingStub(transport));
    }

    private sealed class StubAwsClients(StubTransport transport) : IAwsHealthClientFactory
    {
        public IAmazonS3 S3(string region) => new AmazonS3Client(new AnonymousAWSCredentials(), new AmazonS3Config
        {
            RegionEndpoint = Amazon.RegionEndpoint.GetBySystemName(region),
            MaxErrorRetry = 0,
            HttpClientFactory = new StubSdkHttpFactory(transport),
        });

        public IAmazonBedrock Bedrock(string region) => new AmazonBedrockClient(new AnonymousAWSCredentials(), new AmazonBedrockConfig
        {
            RegionEndpoint = Amazon.RegionEndpoint.GetBySystemName(region),
            MaxErrorRetry = 0,
            HttpClientFactory = new StubSdkHttpFactory(transport),
        });
    }
}
