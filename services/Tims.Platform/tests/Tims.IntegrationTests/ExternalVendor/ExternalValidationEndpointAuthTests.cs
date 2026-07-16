using System.Net;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;

namespace Tims.IntegrationTests.ExternalVendor;

/// <summary>
/// Boots <c>WebApplicationFactory&lt;Program&gt;</c> against the real container and drives the REAL HTTP
/// pipeline for the external-vendor validation WRITE endpoint, proving the full reject-matrix through the
/// actual ApiKey scheme + <see cref="Tims.Application.Identity.PermissionService"/> grant +
/// <see cref="Tims.Domain.Access.ExternalScope"/> (alwaysEnforce) + per-key rate-limit filter — the write's
/// security parity gate.
///
/// Matrix: valid write-scoped key + pending → 200; already-finalized → 409; unknown id → 404; bad body →
/// 400; empty-scope key → 403 (alwaysEnforce — the CONTRAST with the read's wildcard); scope excludes
/// validation:write → 403; org whose external role LACKS the validation:update grant → 403; no token /
/// JWT-shaped / revoked / expired / suspended-org key → 401; and cross-scheme isolation — a GENUINELY valid
/// Supabase JWT (accepted at /whoami) → 401 here (a valid JWT must never satisfy the ApiKey scheme).
/// </summary>
[Collection("ExternalValidation")]
public sealed class ExternalValidationEndpointAuthTests(ExternalValidationFixture fixture)
{
    private static string Path(Guid validationId) => $"/external/validations/{validationId}/result";

    private static readonly string ValidBody =
        """{"status":"passed","result":{"cleared":true},"notes":"ok"}""";

    private WebApplicationFactory<Program> Factory() =>
        new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.UseSetting("Platform:DatabaseConnectionString", fixture.ConnectionString);
            // FIX 1: the write surface is dark by default — enable the deploy flag so the route is mapped.
            builder.UseSetting("Platform:ExternalVendorWriteEnabled", "true");
        });

    private static async Task<HttpResponseMessage> Post(HttpClient client, string path, string? token, string body)
    {
        var request = new HttpRequestMessage(HttpMethod.Post, path)
        {
            Content = new StringContent(body, Encoding.UTF8, "application/json"),
        };
        if (token is not null)
        {
            request.Headers.Add("Authorization", $"Bearer {token}");
        }

        return await client.SendAsync(request);
    }

    // ---- 200: valid write-scoped key on a pending row returns the v1 ------------------------------
    [Fact]
    public async Task ValidScopedKey_PendingRow_Is200_WithV1()
    {
        await using var factory = Factory();
        using var client = factory.CreateClient();

        var response = await Post(client, Path(ExternalValidationFixture.ValidationEndpoint), ExternalValidationFixture.ValidScopedToken, ValidBody);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        Assert.Contains("v1", body);
        Assert.Contains("passed", body);

        // FIX 8: over the wire, completedAt is the canonical Node toISOString() form (…fffZ), not STJ's
        // +00:00 offset form — proven on the real HTTP response, not just the unit-level converter fixture.
        var completedAt = JsonDocument.Parse(body).RootElement.GetProperty("completedAt").GetString();
        Assert.Matches(@"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$", completedAt);
    }

    // ---- 409: valid key on an already-finalized row ----------------------------------------------
    [Fact]
    public async Task ValidScopedKey_AlreadyFinalizedRow_Is409()
    {
        await using var factory = Factory();
        using var client = factory.CreateClient();

        var response = await Post(client, Path(ExternalValidationFixture.ValidationAlreadyPassed), ExternalValidationFixture.ValidScopedToken, ValidBody);

        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
    }

    // ---- 404: valid key, unknown validation id ---------------------------------------------------
    [Fact]
    public async Task ValidScopedKey_UnknownId_Is404()
    {
        await using var factory = Factory();
        using var client = factory.CreateClient();

        var response = await Post(client, Path(Guid.NewGuid()), ExternalValidationFixture.ValidScopedToken, ValidBody);

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    // ---- 400: valid key, invalid body (bad status / non-object result) ---------------------------
    [Theory]
    [InlineData("""{"status":"maybe","result":{"x":1}}""")]
    [InlineData("""{"status":"passed","result":[1,2,3]}""")]
    [InlineData("""{"status":"passed"}""")]
    public async Task ValidScopedKey_InvalidBody_Is400(string body)
    {
        await using var factory = Factory();
        using var client = factory.CreateClient();

        var response = await Post(client, Path(ExternalValidationFixture.ValidationProvenance), ExternalValidationFixture.ValidScopedToken, body);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    // ---- 403: empty-scope key — alwaysEnforce means empty is NOT a wildcard here (the write CONTRAST)
    [Fact]
    public async Task EmptyScopeKey_Is403_AlwaysEnforce()
    {
        await using var factory = Factory();
        using var client = factory.CreateClient();

        var response = await Post(client, Path(ExternalValidationFixture.ValidationEndpoint), ExternalValidationFixture.EmptyScopeToken, ValidBody);

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    // ---- 403: key whose non-empty scope set EXCLUDES validation:write -----------------------------
    [Fact]
    public async Task WrongScopeKey_Is403()
    {
        await using var factory = Factory();
        using var client = factory.CreateClient();

        var response = await Post(client, Path(ExternalValidationFixture.ValidationEndpoint), ExternalValidationFixture.WrongScopeToken, ValidBody);

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    // ---- 403: valid key on an org whose `external` role LACKS the validation:update grant ---------
    [Fact]
    public async Task OrgLacksGrant_Is403()
    {
        await using var factory = Factory();
        using var client = factory.CreateClient();

        var response = await Post(client, Path(Guid.NewGuid()), ExternalValidationFixture.NoGrantOrgToken, ValidBody);

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    // ---- 401: no token, JWT-shaped bearer, revoked key -------------------------------------------
    private const string JwtShapedBearer = "eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJhdHRhY2tlciJ9.c2ln";

    // FIX 7: the reject-matrix now includes an EXPIRED key and a key on a SUSPENDED org (both 401) alongside
    // the no-token / JWT-shaped / revoked cases — completing the credential-rejection coverage.
    public static TheoryData<string?> RejectedCredentials => new()
    {
        null,
        JwtShapedBearer,
        ExternalValidationFixture.RevokedToken,
        ExternalValidationFixture.ExpiredToken,
        ExternalValidationFixture.SuspendedOrgToken,
    };

    [Theory]
    [MemberData(nameof(RejectedCredentials))]
    public async Task RejectedCredential_Is401(string? token)
    {
        await using var factory = Factory();
        using var client = factory.CreateClient();
        var response = await Post(client, Path(ExternalValidationFixture.ValidationEndpoint), token, ValidBody);
        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    // ---- Cross-scheme isolation: a GENUINELY valid Supabase JWT must NOT satisfy the ApiKey-only
    // endpoint. The JWT is proven valid at /whoami (200), then the SAME token is 401 on the write. -----
    private const string JwtIssuer = "https://test-project.supabase.co/auth/v1";
    private const string JwtAudience = "authenticated";
    private const string JwtSub = "11111111-2222-3333-4444-555555555555";
    private static readonly RSA JwtSigningRsa = RSA.Create(2048);
    private static readonly RsaSecurityKey JwtSigningKey = new(JwtSigningRsa) { KeyId = "ext-write-cross-scheme-key" };

    private WebApplicationFactory<Program> JwtEnabledFactory() =>
        new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.UseSetting("Platform:DatabaseConnectionString", fixture.ConnectionString);
            builder.UseSetting("Platform:ExternalVendorWriteEnabled", "true"); // FIX 1: map the write route
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
        var request = new HttpRequestMessage(HttpMethod.Get, "/whoami");
        request.Headers.Add("Authorization", $"Bearer {MintValidJwt()}");
        var response = await client.SendAsync(request);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Contains(JwtSub, await response.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task ValidJwt_On_ExternalValidationWrite_Is401()
    {
        await using var factory = JwtEnabledFactory();
        using var client = factory.CreateClient();
        var response = await Post(client, Path(ExternalValidationFixture.ValidationEndpoint), MintValidJwt(), ValidBody);
        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }
}
