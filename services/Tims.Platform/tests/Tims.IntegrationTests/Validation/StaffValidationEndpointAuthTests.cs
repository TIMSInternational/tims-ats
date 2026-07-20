using System.Net;
using System.Net.Http.Json;
using System.Security.Claims;
using System.Security.Cryptography;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;

namespace Tims.IntegrationTests.Validation;

/// <summary>
/// Phase-5 staff-validation-write endpoint boot matrix (real host + real Postgres): drives the REAL HTTP
/// pipeline for <c>PATCH /validations/{id}</c> through the Supabase JWT scheme + PrincipalResolver +
/// PermissionService <c>offer:update</c> grant + the FIRST live <c>ScopedProbe</c> (offer IDOR) wiring:
///
///   organization-scope staff → 200 on any org offer's validation;
///   TEAM-scope staff → 200 on their team's offer (O1/V1) but 404 on an OUT-OF-SCOPE offer's validation
///     (O2/V2) — the IDOR probe bite (a narrow caller cannot reach it by id, and NOT_FOUND never confirms it);
///   resolvable staff WITHOUT the grant → 403; unknown validation → 404; no/tampered/non-staff JWT → 401;
///   authorized but invalid body → 400; flag OFF (the default) → 404 (dark — TS stays the sole active writer).
/// </summary>
[Collection("StaffValidation")]
public sealed class StaffValidationEndpointAuthTests(StaffValidationFixture fixture)
{
    private const string Issuer = "https://test-project.supabase.co/auth/v1";
    private const string Audience = "authenticated";

    private static readonly RSA SigningRsa = RSA.Create(2048);
    private static readonly RsaSecurityKey PrivateKey = new(SigningRsa) { KeyId = "staff-validation-test-key" };

    private readonly StaffValidationFixture _fixture = fixture;

    private static string Path(Guid validationId) => $"/validations/{validationId}";

    private WebApplicationFactory<Program> EnabledFactory() =>
        new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.UseSetting("Platform:DatabaseConnectionString", _fixture.ConnectionString);
            builder.UseSetting("Platform:ValidationStaffWriteEnabled", "true");
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

    private static async Task<HttpResponseMessage> Patch(HttpClient client, Guid id, string? token, object body)
    {
        var request = new HttpRequestMessage(HttpMethod.Patch, Path(id)) { Content = JsonContent.Create(body) };
        if (token is not null)
        {
            request.Headers.Add("Authorization", $"Bearer {token}");
        }

        return await client.SendAsync(request);
    }

    private static readonly object PassedBody = new { status = "passed" };

    // ---- 200: organization-scope staff updates any org offer's validation ---------------------------
    [Fact]
    public async Task OrgScopeStaff_UpdatesInAndOutOfTeamOffers_Is200()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();

        var r1 = await Patch(client, StaffValidationFixture.PvOrgAdminO1, Mint(StaffValidationFixture.OrgAdminSub), PassedBody);
        Assert.Equal(HttpStatusCode.OK, r1.StatusCode);
        var body = await r1.Content.ReadAsStringAsync();
        Assert.Contains("\"status\":\"passed\"", body);
        Assert.Contains(StaffValidationFixture.OrgAdminId.ToString(), body); // completedById
        Assert.DoesNotContain("schemaVersion", body); // INTERNAL raw row

        var r2 = await Patch(client, StaffValidationFixture.PvOrgAdminO2, Mint(StaffValidationFixture.OrgAdminSub), PassedBody);
        Assert.Equal(HttpStatusCode.OK, r2.StatusCode);
    }

    // ---- team-scope: 200 in-scope, 404 out-of-scope (the offer IDOR probe bite) ---------------------
    [Fact]
    public async Task TeamScopeStaff_InScopeOffer_Is200()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();

        var response = await Patch(client, StaffValidationFixture.PvTeamLeadO1, Mint(StaffValidationFixture.TeamLeadSub), PassedBody);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Fact]
    public async Task TeamScopeStaff_OutOfScopeOffer_Is404_IdorProbe()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();

        // O2 → V2 (team T2, NOT led by the team-lead) → the scope probe fails closed → NOT_FOUND.
        var response = await Patch(client, StaffValidationFixture.PvIdorO2, Mint(StaffValidationFixture.TeamLeadSub), PassedBody);

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    // ---- 403 no grant / 404 unknown / 400 bad body / 401 rejected credentials -----------------------
    [Fact]
    public async Task NoGrantStaff_Is403()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Patch(client, StaffValidationFixture.PvReadOnlyO1, Mint(StaffValidationFixture.NoGrantSub), PassedBody);
        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Fact]
    public async Task UnknownValidation_Is404()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Patch(client, Guid.NewGuid(), Mint(StaffValidationFixture.OrgAdminSub), PassedBody);
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task AuthorizedButInvalidBody_Is400()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Patch(client, StaffValidationFixture.PvReadOnlyO1, Mint(StaffValidationFixture.OrgAdminSub), new { status = "approved" });
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    private const string TamperedBearer = "eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJhdHRhY2tlciJ9.c2ln";

    public static TheoryData<string?> UnauthorizedTokens => new() { null, TamperedBearer };

    [Theory]
    [MemberData(nameof(UnauthorizedTokens))]
    public async Task RejectedCredential_Is401(string? token)
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        Assert.Equal(HttpStatusCode.Unauthorized, (await Patch(client, StaffValidationFixture.PvReadOnlyO1, token, PassedBody)).StatusCode);
    }

    [Fact]
    public async Task ValidJwt_ButSubNotStaffResolvable_Is401()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Patch(client, StaffValidationFixture.PvReadOnlyO1, Mint("sub-with-no-user-row"), PassedBody);
        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    // ---- dark-by-default: flag OFF (default) → route NOT mapped → 404 -------------------------------
    [Fact]
    public async Task Route_Is404_WhenFlagDefaultsOff()
    {
        await using var factory = DarkFactory();
        using var client = factory.CreateClient();
        var response = await client.PatchAsync(Path(StaffValidationFixture.PvReadOnlyO1), JsonContent.Create(PassedBody));
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    // ---- flag ON → route mapped → an unauthenticated request is 401 (NOT 404 → the route EXISTS) ----
    [Fact]
    public async Task Route_Is401_NotNotFound_WhenFlagOn()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await client.PatchAsync(Path(StaffValidationFixture.PvReadOnlyO1), JsonContent.Create(PassedBody));
        Assert.NotEqual(HttpStatusCode.NotFound, response.StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }
}
