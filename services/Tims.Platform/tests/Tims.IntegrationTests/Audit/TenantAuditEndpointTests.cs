using System.Net;
using Tims.Application.Audit;
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

[Collection("TenantAudit")]
public sealed partial class TenantAuditEndpointTests(TenantAuditFixture fixture)
{
    private const string Issuer = "https://test-project.supabase.co/auth/v1";
    private const string Audience = "authenticated";
    private const string LogsPath = "/tenant-audit/access-report";


    private static readonly RSA SigningRsa = RSA.Create(2048);
    private static readonly RsaSecurityKey PrivateKey = new(SigningRsa) { KeyId = "audit-test-key" };

    private readonly TenantAuditFixture _fixture = fixture;

    private WebApplicationFactory<Program> EnabledFactory(ISecurityEventWriter? audit = null, string? impersonationSecret = null) =>
        new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.UseSetting("Platform:DatabaseConnectionString", _fixture.ConnectionString);
            builder.UseSetting("Platform:TenantAuditReadEnabled", "true");
            if (impersonationSecret is not null) builder.UseSetting("Platform:ImpersonationSecret", impersonationSecret);
            builder.UseSetting("Platform:SupabaseJwtIssuer", Issuer);
            builder.UseSetting("Platform:SupabaseJwtAudience", Audience);

            var publicJwk = JsonWebKeyConverter.ConvertFromRSASecurityKey(
                new RsaSecurityKey(SigningRsa.ExportParameters(false)) { KeyId = PrivateKey.KeyId });
            builder.ConfigureTestServices(services =>
            {
                if (audit is not null) services.AddSingleton(audit);
                services.PostConfigure<JwtBearerOptions>(JwtBearerDefaults.AuthenticationScheme, options =>
                {
                    options.RequireHttpsMetadata = false;
                    options.TokenValidationParameters.IssuerSigningKeys = [publicJwk];
                });
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

    private static async Task<HttpResponseMessage> Get(HttpClient client, string path, string? token)
    {
        var request = new HttpRequestMessage(HttpMethod.Get, path);
        if (token is not null) request.Headers.Add("Authorization", $"Bearer {token}");
        return await client.SendAsync(request);
    }

    [Fact]
    public async Task GrantedStaff_GetsOnlyOwnTenantAccessCounts()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Get(client, LogsPath, Mint(TenantAuditFixture.OrgUserSub));
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        var row = Assert.Single(json.RootElement.EnumerateArray());
        Assert.Equal(TenantAuditFixture.OrgUserId, row.GetProperty("actorId").GetGuid());
        Assert.Equal("candidate", row.GetProperty("entity").GetString());
        Assert.Equal(2, row.GetProperty("_count").GetProperty("id").GetInt32());
        Assert.Equal(3, row.EnumerateObject().Count());
    }

    [Theory]
    [InlineData(null, 401)]
    [InlineData("tampered", 401)]
    [InlineData("sub-audit-denied", 403)]
    [InlineData(TenantAuditFixture.PlatformOwnerSub, 400)]
    public async Task UnauthorizedOrOrglessCaller_CannotRead(string? sub, int expected)
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var token = sub is null ? null : sub == "tampered" ? "invalid.jwt.signature" : Mint(sub);
        var response = await Get(client, LogsPath, token);
        Assert.Equal(expected, (int)response.StatusCode);
    }

    [Theory]
    [InlineData("dateFrom=2026-07-21T10:00:00Z&dateTo=2026-07-21T10:00:00Z", 1)]
    [InlineData("dateFrom=2026-07-21T12:00:00%2B02:00&dateTo=2026-07-21T12:00:00%2B02:00", 1)]
    [InlineData("dateFrom=2026-07-22T00:00:00Z", 0)]
    [InlineData("dateTo=2026-07-20T23:59:59Z", 0)]
    public async Task Dates_AreInclusiveAndNormalized(string query, int count)
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Get(client, LogsPath + "?" + query, Mint(TenantAuditFixture.OrgUserSub));
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.Equal(count, json.RootElement.GetArrayLength());
    }

    [Fact]
    public async Task InvalidDate_Is400()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Get(client, LogsPath + "?dateFrom=not-a-date", Mint(TenantAuditFixture.OrgUserSub));
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task FlagOff_Is404()
    {
        await using var factory = DarkFactory();
        using var client = factory.CreateClient();
        var response = await Get(client, LogsPath, null);
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }
}
