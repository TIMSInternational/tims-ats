using System.Net;
using System.Security.Claims;
using System.Security.Cryptography;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;

namespace Tims.IntegrationTests;

/// <summary>
/// WP2.5 end-to-end (real host + real Postgres): boots Program with the Supabase JWT scheme against
/// a locally-minted JWKS and the container DB, seeds a user whose <c>supabase_user_id == sub</c> with
/// roles granting candidate:read@organization + performance:read@team, and proves the guarded probe
/// endpoints enforce the resolved permission. This pins the JWT → PrincipalResolver →
/// PermissionService → AccessKernel wiring the deferred Slice-2 registration promised.
/// </summary>
public sealed class ApiPermissionAuthTests(PermissionFixture fixture) : IClassFixture<PermissionFixture>
{
    private const string Issuer = "https://test-project.supabase.co/auth/v1";
    private const string Audience = "authenticated";

    private static readonly RSA SigningRsa = RSA.Create(2048);
    private static readonly RsaSecurityKey PrivateKey = new(SigningRsa) { KeyId = "test-key-1" };

    private readonly PermissionFixture _fixture = fixture;

    private WebApplicationFactory<Program> Factory() =>
        new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.UseSetting("Platform:DatabaseConnectionString", _fixture.ConnectionString);
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
        if (token is not null)
        {
            request.Headers.Add("Authorization", $"Bearer {token}");
        }

        return await client.SendAsync(request);
    }

    [Fact]
    public async Task RequirePermission_GrantedModuleAction_Is200Allowed()
    {
        await using var factory = Factory();
        using var client = factory.CreateClient();

        var response = await Get(client, "/require-permission/candidate/read", Mint(PermissionFixture.HttpUserSub));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        Assert.Contains("\"allowed\":true", body);
        Assert.Contains("organization", body);
    }

    [Fact]
    public async Task RequirePermission_UngrantedAction_Is403()
    {
        await using var factory = Factory();
        using var client = factory.CreateClient();

        var response = await Get(client, "/require-permission/candidate/delete", Mint(PermissionFixture.HttpUserSub));

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Fact]
    public async Task RequirePermission_NoToken_Is401()
    {
        await using var factory = Factory();
        using var client = factory.CreateClient();

        var response = await Get(client, "/require-permission/candidate/read", token: null);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task RequirePermission_ValidJwt_ButSubNotStaffResolvable_Is401()
    {
        // A validly-signed JWT whose sub is not an active staff/owner row (candidate session /
        // deactivated / unprovisioned) is `ctx.user === null` in the TS API → 401, NOT a
        // resolved-but-denied 403.
        await using var factory = Factory();
        using var client = factory.CreateClient();

        var response = await Get(client, "/require-permission/candidate/read", Mint("sub-with-no-user-row"));

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task RequireOrgScope_OrgScopeGrant_Is200()
    {
        await using var factory = Factory();
        using var client = factory.CreateClient();

        // recruiter grants candidate:read @ organization → org-scope gate satisfied.
        var response = await Get(client, "/require-org-scope/candidate/read", Mint(PermissionFixture.HttpUserSub));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Fact]
    public async Task RequireOrgScope_NarrowScopeGrant_Is403()
    {
        await using var factory = Factory();
        using var client = factory.CreateClient();

        // performance:read is granted only @ team (leader) → narrow, org-rollup gate FORBIDS it.
        var response = await Get(client, "/require-org-scope/performance/read", Mint(PermissionFixture.HttpUserSub));

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }
}
