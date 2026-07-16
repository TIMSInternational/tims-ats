using System.Net;
using System.Security.Claims;
using System.Security.Cryptography;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;

namespace Tims.IntegrationTests.ExternalVendor;

/// <summary>
/// FIX 2 (opus High / Codex Medium): boots <c>WebApplicationFactory&lt;Program&gt;</c> against the real
/// container and drives the REAL HTTP pipeline for the external assessment READ endpoints, proving the
/// full reject-matrix through the actual auth scheme + <see cref="Tims.Application.Identity.PermissionService"/>
/// grant + <see cref="Tims.Domain.Access.ExternalScope"/> + per-key rate-limit filter — not just the
/// use-case unit path. A completed assessment result is seeded (via <see cref="ExternalAssessmentFixture"/>)
/// so the 200 path returns real data. This is the endpoint's security parity gate: the exported surface is
/// restricted psychometric data, so every rejected credential MUST 401/403.
///
/// Matrix (list + getOne, SYMMETRIC): valid key + assessment:read grant + (empty scope OR
/// scope⊇assessment:read) → 200; missing / JWT-shaped bearer / revoked / expired / suspended-org key →
/// 401 on BOTH endpoints; granted org but scope EXCLUDES assessment:read → 403; org whose external role
/// LACKS the grant → 403. Cross-scheme isolation is proven in BOTH directions: a valid ApiKey → 401 on
/// the JWT-only /whoami, AND a GENUINELY VALID Supabase JWT (accepted at /whoami) → 401 on the
/// ApiKey-only external endpoints — a valid JWT must never satisfy the ApiKey scheme.
/// </summary>
[Collection("ExternalAssessment")]
public sealed class ExternalAssessmentEndpointAuthTests(ExternalAssessmentFixture fixture)
{
    private const string ListPath = "/external/assessment-results";

    private static string GetOnePath(Guid assignmentId) => $"/external/assessment-results/{assignmentId}";

    private WebApplicationFactory<Program> Factory() =>
        new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.UseSetting("Platform:DatabaseConnectionString", fixture.ConnectionString);
            // FIX 1: the read surface is dark by default — enable the deploy flag so the routes are mapped.
            builder.UseSetting("Platform:ExternalVendorReadEnabled", "true");
        });

    private static async Task<HttpResponseMessage> Get(HttpClient client, string path, string? token)
    {
        var request = new HttpRequestMessage(HttpMethod.Get, path);
        if (token is not null)
        {
            request.Headers.Add("Authorization", $"Bearer {token}");
        }

        return await client.SendAsync(request);
    }

    // ---- 200: valid granted key (empty scope = wildcard) returns real data on BOTH endpoints --------
    [Fact]
    public async Task ValidGrantedKey_EmptyScope_List_Is200_WithItems()
    {
        await using var factory = Factory();
        using var client = factory.CreateClient();

        var response = await Get(client, ListPath, ExternalAssessmentFixture.ValidEmptyScopeToken);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        Assert.Contains("items", body);
        Assert.Contains(ExternalAssessmentFixture.AssignmentA1.ToString(), body);
    }

    [Fact]
    public async Task ValidGrantedKey_ScopeIncludesAssessmentRead_List_Is200()
    {
        await using var factory = Factory();
        using var client = factory.CreateClient();

        var response = await Get(client, ListPath, ExternalAssessmentFixture.ValidScopedToken);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Fact]
    public async Task ValidGrantedKey_GetOne_CompletedRow_Is200()
    {
        await using var factory = Factory();
        using var client = factory.CreateClient();

        var response = await Get(
            client, GetOnePath(ExternalAssessmentFixture.AssignmentA1), ExternalAssessmentFixture.ValidEmptyScopeToken);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Contains("v1", await response.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task ValidGrantedKey_GetOne_UnknownAssignment_Is404()
    {
        await using var factory = Factory();
        using var client = factory.CreateClient();

        var response = await Get(client, GetOnePath(Guid.NewGuid()), ExternalAssessmentFixture.ValidEmptyScopeToken);

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    // ---- 403: grant present but the key's non-empty scope set EXCLUDES assessment:read --------------
    [Theory]
    [InlineData(ListPath)]
    [InlineData("/external/assessment-results/a0000000-0000-0000-0000-000000000001")]
    public async Task ScopeExcludesAssessmentRead_Is403(string path)
    {
        await using var factory = Factory();
        using var client = factory.CreateClient();

        var response = await Get(client, path, ExternalAssessmentFixture.ScopeExcludesToken);

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    // ---- 403: valid key on an org whose `external` role LACKS the assessment:read grant -------------
    [Theory]
    [InlineData(ListPath)]
    [InlineData("/external/assessment-results/a0000000-0000-0000-0000-000000000001")]
    public async Task OrgLacksGrant_Is403(string path)
    {
        await using var factory = Factory();
        using var client = factory.CreateClient();

        var response = await Get(client, path, ExternalAssessmentFixture.NoGrantOrgToken);

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    // ---- 401: no token, JWT-shaped bearer, revoked / expired / suspended-org keys — SYMMETRIC over
    // BOTH the list and getOne surfaces (a rejected credential must never reach either). ---------------

    // A JWT-shaped bearer presented to the ApiKey-only endpoint hashes to no api_keys row → 401.
    private const string JwtShapedBearer = "eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJhdHRhY2tlciJ9.c2ln";

    // null = "no Authorization header at all".
    public static TheoryData<string?> RejectedCredentials => new()
    {
        null,
        JwtShapedBearer,
        ExternalAssessmentFixture.RevokedToken,
        ExternalAssessmentFixture.ExpiredToken,
        ExternalAssessmentFixture.SuspendedOrgToken,
    };

    [Theory]
    [MemberData(nameof(RejectedCredentials))]
    public async Task RejectedCredential_List_Is401(string? token)
    {
        await using var factory = Factory();
        using var client = factory.CreateClient();
        Assert.Equal(HttpStatusCode.Unauthorized, (await Get(client, ListPath, token)).StatusCode);
    }

    [Theory]
    [MemberData(nameof(RejectedCredentials))]
    public async Task RejectedCredential_GetOne_Is401(string? token)
    {
        await using var factory = Factory();
        using var client = factory.CreateClient();
        var response = await Get(client, GetOnePath(ExternalAssessmentFixture.AssignmentA1), token);
        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    // ---- Cross-scheme isolation, direction 1: a valid ApiKey is not a valid JWT → 401 on the
    // JWT-only /whoami. --------------------------------------------------------------------------------
    [Fact]
    public async Task ValidApiKey_On_JwtWhoami_Is401()
    {
        await using var factory = Factory();
        using var client = factory.CreateClient();
        Assert.Equal(HttpStatusCode.Unauthorized, (await Get(client, "/whoami", ExternalAssessmentFixture.ValidEmptyScopeToken)).StatusCode);
    }

    // ---- Cross-scheme isolation, direction 2 (Codex Low — the untested direction): a GENUINELY VALID
    // Supabase JWT must NOT satisfy the ApiKey-only external endpoints. The JWT is proven genuinely valid
    // by authenticating /whoami (200), then the SAME token is rejected (401) on the external list + getOne
    // — the ApiKey scheme never accepts a bearer it did not itself issue. ------------------------------
    private const string JwtIssuer = "https://test-project.supabase.co/auth/v1";
    private const string JwtAudience = "authenticated";
    private const string JwtSub = "11111111-2222-3333-4444-555555555555";
    private static readonly RSA JwtSigningRsa = RSA.Create(2048);
    private static readonly RsaSecurityKey JwtSigningKey = new(JwtSigningRsa) { KeyId = "ext-cross-scheme-key" };

    // A host that BOTH points at the fixture DB AND trusts the locally-minted JWKS (issuer/audience +
    // public signing key), so the Supabase JWT scheme genuinely validates a token minted below.
    private WebApplicationFactory<Program> JwtEnabledFactory() =>
        new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.UseSetting("Platform:DatabaseConnectionString", fixture.ConnectionString);
            builder.UseSetting("Platform:ExternalVendorReadEnabled", "true"); // FIX 1: map the read routes
            builder.UseSetting("Platform:SupabaseJwtIssuer", JwtIssuer);
            builder.UseSetting("Platform:SupabaseJwtAudience", JwtAudience);

            var publicJwk = JsonWebKeyConverter.ConvertFromRSASecurityKey(
                new RsaSecurityKey(JwtSigningRsa.ExportParameters(false)) { KeyId = JwtSigningKey.KeyId });
            builder.ConfigureTestServices(services =>
                services.PostConfigure<JwtBearerOptions>(JwtBearerDefaults.AuthenticationScheme, options =>
                {
                    options.RequireHttpsMetadata = false;
                    options.TokenValidationParameters.IssuerSigningKeys = [publicJwk];
                }));
        });

    private static string MintValidJwt()
    {
        var descriptor = new SecurityTokenDescriptor
        {
            Issuer = JwtIssuer,
            Audience = JwtAudience,
            Subject = new ClaimsIdentity([new Claim("sub", JwtSub)]),
            Expires = DateTime.UtcNow.AddMinutes(10),
            SigningCredentials = new SigningCredentials(JwtSigningKey, SecurityAlgorithms.RsaSha256),
        };
        return new JsonWebTokenHandler().CreateToken(descriptor);
    }

    [Fact]
    public async Task ValidJwt_On_JwtWhoami_Is200_ProvesGenuinelyValid()
    {
        await using var factory = JwtEnabledFactory();
        using var client = factory.CreateClient();
        var response = await Get(client, "/whoami", MintValidJwt());
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Contains(JwtSub, await response.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task ValidJwt_On_ExternalList_Is401()
    {
        await using var factory = JwtEnabledFactory();
        using var client = factory.CreateClient();
        Assert.Equal(HttpStatusCode.Unauthorized, (await Get(client, ListPath, MintValidJwt())).StatusCode);
    }

    [Fact]
    public async Task ValidJwt_On_ExternalGetOne_Is401()
    {
        await using var factory = JwtEnabledFactory();
        using var client = factory.CreateClient();
        var response = await Get(client, GetOnePath(ExternalAssessmentFixture.AssignmentA1), MintValidJwt());
        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }
}
