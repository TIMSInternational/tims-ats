using System.Net;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text.Json;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;

namespace Tims.IntegrationTests.Audit;

/// <summary>
/// Phase-5 Slice 17 endpoint boot matrix: real host + real Postgres, driving the REAL HTTP
/// pipeline through PrincipalResolver + PlatformOwnerGate:
///   platform-owner → 200; resolvable ordinary org-user → 403; no/tampered JWT → 401;
///   flag OFF (default) → 404 (dark, bite-proven, matching every prior slice).
/// </summary>
[Collection("AuditRead")]
public sealed class AuditReadEndpointAuthTests(AuditReadFixture fixture)
{
    private const string Issuer = "https://test-project.supabase.co/auth/v1";
    private const string Audience = "authenticated";
    private const string LogsPath = "/audit/logs";
    private const string ExportPath = "/audit/logs/export";

    private static readonly RSA SigningRsa = RSA.Create(2048);
    private static readonly RsaSecurityKey PrivateKey = new(SigningRsa) { KeyId = "audit-test-key" };

    private readonly AuditReadFixture _fixture = fixture;

    private WebApplicationFactory<Program> EnabledFactory() =>
        new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.UseSetting("Platform:DatabaseConnectionString", _fixture.ConnectionString);
            builder.UseSetting("Platform:AuditLogReadEnabled", "true");
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
    public async Task PlatformOwner_Is200()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();

        var response = await Get(client, LogsPath, Mint(AuditReadFixture.PlatformOwnerSub));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        Assert.Contains("login_failed", body); // cross-org rows visible — both OrgA and OrgB rows present
    }

    [Fact]
    public async Task OrdinaryOrgUser_Is403()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();

        var response = await Get(client, LogsPath, Mint(AuditReadFixture.OrgUserSub));

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJhdHRhY2tlciJ9.c2ln")]
    public async Task RejectedCredential_Is401(string? token)
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        Assert.Equal(HttpStatusCode.Unauthorized, (await Get(client, LogsPath, token)).StatusCode);
    }

    [Fact]
    public async Task Route_Is404_WhenFlagDefaultsOff()
    {
        await using var factory = DarkFactory();
        using var client = factory.CreateClient();

        var response = await client.GetAsync(LogsPath);

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    // ---- export endpoint: platform-owner gate applies identically, and the CSV is hardened -------
    [Fact]
    public async Task PlatformOwner_Export_Is200_WithHardenedCsv()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();

        var response = await Get(client, ExportPath, Mint(AuditReadFixture.PlatformOwnerSub));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        // The endpoint wraps the CSV in a JSON envelope ({ format, data, count } — Task 6), so pull the
        // "data" field back out via JsonDocument rather than substring-matching the raw (quote-escaped)
        // response bytes.
        var body = await response.Content.ReadAsStringAsync();
        using var json = JsonDocument.Parse(body);
        var csv = json.RootElement.GetProperty("data").GetString();
        Assert.NotNull(csv);
        Assert.Contains("\"Fecha\",\"Organizacion\",\"Actor\",\"Accion\",\"Entidad\",\"ID Entidad\",\"IP\"", csv);
        Assert.Contains("Sistema", csv); // the OrgB row has actor_id NULL (system-actioned)
    }

    [Fact]
    public async Task PlatformOwner_Export_Json_Is200_WithStringData()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();

        var response = await Get(client, $"{ExportPath}?format=json", Mint(AuditReadFixture.PlatformOwnerSub));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        // Matches TS `exportAuditLogsCsv`'s json branch: `data` is a JSON.stringify'd STRING, not a
        // nested array — GetString() throws InvalidOperationException if `data` came back as an array.
        var body = await response.Content.ReadAsStringAsync();
        using var json = JsonDocument.Parse(body);
        Assert.Equal("json", json.RootElement.GetProperty("format").GetString());
        var data = json.RootElement.GetProperty("data").GetString();
        Assert.NotNull(data);
        using var rows = JsonDocument.Parse(data);
        Assert.Equal(JsonValueKind.Array, rows.RootElement.ValueKind);
        Assert.Contains("login_failed", data);
    }

    [Fact]
    public async Task OrdinaryOrgUser_Export_Is403()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();

        var response = await Get(client, ExportPath, Mint(AuditReadFixture.OrgUserSub));

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }
}
