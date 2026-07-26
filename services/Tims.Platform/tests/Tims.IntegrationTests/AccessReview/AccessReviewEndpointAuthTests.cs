using System.Net;
using System.Net.Http.Json;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text.Json;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;

namespace Tims.IntegrationTests.AccessReview;

/// <summary>
/// Phase-5 Slice 18 endpoint boot matrix — mirrors `AuditReadEndpointAuthTests` exactly:
/// platform-owner → 200; resolvable org-user → 403; no/tampered JWT → 401; flags OFF (default) → 404.
/// </summary>
[Collection("AccessReview")]
public sealed class AccessReviewEndpointAuthTests(AccessReviewFixture fixture)
{
    private const string Issuer = "https://test-project.supabase.co/auth/v1";
    private const string Audience = "authenticated";
    private const string ReportPath = "/access-review";
    private const string ExportPath = "/access-review/export";
    private const string AttestPath = "/access-review/attest";
    private const string HistoryPath = "/access-review/attestations";

    private static readonly RSA SigningRsa = RSA.Create(2048);
    private static readonly RsaSecurityKey PrivateKey = new(SigningRsa) { KeyId = "access-review-test-key" };

    private readonly AccessReviewFixture _fixture = fixture;

    private WebApplicationFactory<Program> EnabledFactory() =>
        new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.UseSetting("Platform:DatabaseConnectionString", _fixture.ConnectionString);
            builder.UseSetting("Platform:AccessReviewReadEnabled", "true");
            builder.UseSetting("Platform:AccessReviewWriteEnabled", "true");
            builder.UseSetting("Platform:SupabaseJwtIssuer", Issuer);
            builder.UseSetting("Platform:SupabaseJwtAudience", Audience);

            var publicJwk = JsonWebKeyConverter.ConvertFromRSASecurityKey(
                new RsaSecurityKey(SigningRsa.ExportParameters(false)) { KeyId = PrivateKey.KeyId });
            builder.ConfigureTestServices(services =>
                services.PostConfigure<JwtBearerOptions>(JwtBearerDefaults.AuthenticationScheme, options =>
                {
                    options.RequireHttpsMetadata = false;
                    options.TokenValidationParameters.IssuerSigningKeys = [publicJwk];
                }));
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

    private static async Task<HttpResponseMessage> Get(HttpClient client, string path, string? token)
    {
        var request = new HttpRequestMessage(HttpMethod.Get, path);
        if (token is not null) request.Headers.Add("Authorization", $"Bearer {token}");
        return await client.SendAsync(request);
    }

    [Fact]
    public async Task PlatformOwner_Report_Is200()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();

        var response = await Get(client, $"{ReportPath}?organizationId={AccessReviewFixture.OrgA}", Mint(AccessReviewFixture.PlatformOwnerSub));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        Assert.Contains("neverLoggedIn", body);
    }

    [Fact]
    public async Task OrdinaryOrgUser_Report_Is403()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();

        var response = await Get(client, $"{ReportPath}?organizationId={AccessReviewFixture.OrgA}", Mint(AccessReviewFixture.OrgUserSub));

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJhdHRhY2tlciJ9.c2ln")]
    public async Task RejectedCredential_Report_Is401(string? token)
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        Assert.Equal(HttpStatusCode.Unauthorized, (await Get(client, $"{ReportPath}?organizationId={AccessReviewFixture.OrgA}", token)).StatusCode);
    }

    [Fact]
    public async Task Route_Is404_WhenFlagsDefaultOff()
    {
        await using var factory = DarkFactory();
        using var client = factory.CreateClient();

        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync($"{ReportPath}?organizationId={AccessReviewFixture.OrgA}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await client.PostAsync(AttestPath, JsonContent.Create(new { organizationId = AccessReviewFixture.OrgA }))).StatusCode);
    }

    [Fact]
    public async Task PlatformOwner_Export_Is200_WithHardenedCsv()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();

        var response = await Get(client, $"{ExportPath}?organizationId={AccessReviewFixture.OrgA}", Mint(AccessReviewFixture.PlatformOwnerSub));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        using var json = JsonDocument.Parse(body);
        var csv = json.RootElement.GetProperty("data").GetString();
        Assert.Contains("\"Usuario\",\"Email\",\"Organizacion\"", csv);
    }

    [Fact]
    public async Task PlatformOwner_Attest_Is200_ThenOrgUser_Is403()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();

        var request = new HttpRequestMessage(HttpMethod.Post, AttestPath)
        {
            Content = JsonContent.Create(new { organizationId = AccessReviewFixture.OrgA, notes = "Q3 review" }),
        };
        request.Headers.Add("Authorization", $"Bearer {Mint(AccessReviewFixture.PlatformOwnerSub)}");
        var response = await client.SendAsync(request);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        var forbiddenRequest = new HttpRequestMessage(HttpMethod.Post, AttestPath)
        {
            Content = JsonContent.Create(new { organizationId = AccessReviewFixture.OrgA }),
        };
        forbiddenRequest.Headers.Add("Authorization", $"Bearer {Mint(AccessReviewFixture.OrgUserSub)}");
        Assert.Equal(HttpStatusCode.Forbidden, (await client.SendAsync(forbiddenRequest)).StatusCode);
    }

    [Fact]
    public async Task Attest_Is404_WhenOrgDoesNotExist()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();

        var request = new HttpRequestMessage(HttpMethod.Post, AttestPath)
        {
            Content = JsonContent.Create(new { organizationId = Guid.NewGuid() }),
        };
        request.Headers.Add("Authorization", $"Bearer {Mint(AccessReviewFixture.PlatformOwnerSub)}");

        Assert.Equal(HttpStatusCode.NotFound, (await client.SendAsync(request)).StatusCode);
    }

    [Fact]
    public async Task PlatformOwner_Attestations_Is200()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();

        var response = await Get(client, $"{HistoryPath}?organizationId={AccessReviewFixture.OrgA}", Mint(AccessReviewFixture.PlatformOwnerSub));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }
}
