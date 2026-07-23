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

namespace Tims.IntegrationTests.Compensation;

/// <summary>
/// Phase-5 Slice 12 endpoint boot matrix (real host + real Postgres): boots <c>WebApplicationFactory</c> against
/// the write fixture DB with a locally-minted JWKS and drives the REAL HTTP pipeline for the two compensation
/// WRITE endpoints through the Supabase JWT scheme + PrincipalResolver + PermissionService
/// <c>compensation:create</c> / <c>compensation:approve</c> grants + each endpoint's mechanic:
///
///   createAdjustment — assertSubjectInScope on the TARGET userId (leader: M1 in team → 200; Emp out → 403);
///   §21 create response is {id,status} only; bounded input → 400 (after auth); no grant → 403;
///   approveAdjustment — assertScoped('salaryAdjustment') by-id probe (leader: Emp's adj → 404); the pending-only
///   load (already-processed → 404); §21 approve response is {id,status} only;
///   auth matrix: no/tampered/non-staff JWT → 401; dark-by-default (flag off) → 404.
/// </summary>
[Collection("CompensationWrite")]
public sealed class CompensationWriteEndpointAuthTests(CompensationWriteFixture fixture)
{
    private const string Issuer = "https://test-project.supabase.co/auth/v1";
    private const string Audience = "authenticated";

    private static readonly RSA SigningRsa = RSA.Create(2048);
    private static readonly RsaSecurityKey PrivateKey = new(SigningRsa) { KeyId = "comp-write-test-key" };

    private readonly CompensationWriteFixture _fixture = fixture;

    private const string Adjustments = "/compensation/adjustments";
    private static string Approve(Guid id) => $"/compensation/adjustments/{id}/approve";

    private WebApplicationFactory<Program> EnabledFactory() =>
        new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.UseSetting("Platform:DatabaseConnectionString", _fixture.ConnectionString);
            builder.UseSetting("Platform:CompensationWriteEnabled", "true");
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

    private static async Task<HttpResponseMessage> Post(HttpClient client, string path, object? body, string? token)
    {
        var request = new HttpRequestMessage(HttpMethod.Post, path) { Content = JsonContent.Create(body ?? new { }) };
        if (token is not null)
        {
            request.Headers.Add("Authorization", $"Bearer {token}");
        }

        return await client.SendAsync(request);
    }

    private static object CreateBody(Guid userId, string type = "merit", double previous = 80000, double next = 90000) =>
        new { userId, type, previousSalary = previous, newSalary = next, effectiveDate = "2026-07-01T00:00:00.000Z" };

    // ── createAdjustment: subject-scope on the TARGET userId ──
    [Fact]
    public async Task Create_OrgScope_ForAnyUser_Is200_MinimalBody()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Post(client, Adjustments, CreateBody(CompensationWriteFixture.M2Id), Mint(CompensationWriteFixture.OrgHrSub));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        Assert.Contains("\"status\":\"pending\"", body);
        Assert.Contains("\"id\":", body);
        // §21: a write response never echoes the restricted figures.
        Assert.DoesNotContain("previousSalary", body);
        Assert.DoesNotContain("newSalary", body);
        Assert.DoesNotContain("reason", body);
    }

    [Fact]
    public async Task Create_TeamLeader_ForTeamMember_Is200()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Post(client, Adjustments, CreateBody(CompensationWriteFixture.M1Id), Mint(CompensationWriteFixture.TeamLeadSub));
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Fact]
    public async Task Create_TeamLeader_ForOutOfScopeUser_Is403()
    {
        // Emp is NOT in TeamLead's team → assertSubjectInScope → 403 (no row is created).
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Post(client, Adjustments, CreateBody(CompensationWriteFixture.EmpId), Mint(CompensationWriteFixture.TeamLeadSub));
        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Fact]
    public async Task Create_NoGrantStaff_Is403()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Post(client, Adjustments, CreateBody(CompensationWriteFixture.M1Id), Mint(CompensationWriteFixture.NoGrantSub));
        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    // ── bounded input → 400 AFTER auth ──
    public static TheoryData<object> BadCreateBodies => new()
    {
        new { type = "merit", previousSalary = 80000, newSalary = 90000, effectiveDate = "2026-07-01T00:00:00Z" }, // missing userId
        new { userId = CompensationWriteFixture.M1Id, type = "bogus", previousSalary = 80000, newSalary = 90000, effectiveDate = "2026-07-01T00:00:00Z" }, // bad enum
        new { userId = CompensationWriteFixture.M1Id, type = "merit", previousSalary = 80000, newSalary = -5, effectiveDate = "2026-07-01T00:00:00Z" }, // non-positive
        new { userId = CompensationWriteFixture.M1Id, type = "merit", previousSalary = 80000, newSalary = 90000, currency = "US", effectiveDate = "2026-07-01T00:00:00Z" }, // 2-char currency
        new { userId = CompensationWriteFixture.M1Id, type = "merit", previousSalary = 80000, newSalary = 90000 }, // missing effectiveDate
        // effectiveDate Zod `.datetime()` parity (Slice-12 review fix): zod REJECTS these; DateTimeOffset.TryParse
        // would have ACCEPTED them (silent write-path divergence). Each must now be a 400.
        new { userId = CompensationWriteFixture.M1Id, type = "merit", previousSalary = 80000, newSalary = 90000, effectiveDate = "2026-07-01" }, // date-only
        new { userId = CompensationWriteFixture.M1Id, type = "merit", previousSalary = 80000, newSalary = 90000, effectiveDate = "2026-07-01T00:00:00" }, // no zone
        new { userId = CompensationWriteFixture.M1Id, type = "merit", previousSalary = 80000, newSalary = 90000, effectiveDate = "2026-07-01T10:00:00+06:00" }, // numeric offset (not Z)
    };

    [Theory]
    [MemberData(nameof(BadCreateBodies))]
    public async Task Create_BadInput_AfterAuth_Is400(object body)
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Post(client, Adjustments, body, Mint(CompensationWriteFixture.OrgHrSub));
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Create_BadInput_Unauthenticated_Is401_NotValidatedBeforeAuth()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Post(client, Adjustments, new { garbage = true }, token: null);
        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    // ── approveAdjustment: probe + pending-load ──
    [Fact]
    public async Task Approve_OrgScope_Pending_Is200_ApprovedStatus_MinimalBody()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Post(
            client, Approve(CompensationWriteFixture.AdjApprove), new { approved = true }, Mint(CompensationWriteFixture.OrgHrSub));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        Assert.Contains("\"status\":\"approved\"", body);
        Assert.DoesNotContain("newSalary", body); // §21
        Assert.DoesNotContain("90000", body);
    }

    [Fact]
    public async Task Approve_TeamLeader_InScope_Reject_Is200_RejectedStatus()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Post(
            client, Approve(CompensationWriteFixture.AdjRejectEp), new { approved = false }, Mint(CompensationWriteFixture.TeamLeadSub));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Contains("\"status\":\"rejected\"", await response.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task Approve_TeamLeader_OutOfScope_Is404_Probe()
    {
        // AdjOutScope targets Emp (out of TeamLead's team) → assertScoped → 404 (never confirms the id).
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Post(
            client, Approve(CompensationWriteFixture.AdjOutScope), new { approved = true }, Mint(CompensationWriteFixture.TeamLeadSub));
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task Approve_AlreadyProcessed_Is404()
    {
        // AdjAlready is 'approved' → probe passes (M1 in… org scope), but findFirst(pending) null → 404.
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Post(
            client, Approve(CompensationWriteFixture.AdjAlready), new { approved = true }, Mint(CompensationWriteFixture.OrgHrSub));
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task Approve_MissingApprovedField_Is400()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Post(
            client, Approve(CompensationWriteFixture.AdjApprove), new { comment = "no approved field" }, Mint(CompensationWriteFixture.OrgHrSub));
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Approve_OverLongComment_Is400()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Post(
            client, Approve(CompensationWriteFixture.AdjApprove), new { approved = true, comment = new string('x', 501) },
            Mint(CompensationWriteFixture.OrgHrSub));
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Approve_NoGrantStaff_Is403()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Post(
            client, Approve(CompensationWriteFixture.AdjApprove), new { approved = true }, Mint(CompensationWriteFixture.NoGrantSub));
        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    // ── 401: no token / tampered JWT / valid-signature-but-sub-not-staff ──
    private const string TamperedBearer = "eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJhdHRhY2tlciJ9.c2ln";

    [Theory]
    [InlineData(null)]
    [InlineData(TamperedBearer)]
    public async Task RejectedCredential_Is401(string? token)
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        Assert.Equal(HttpStatusCode.Unauthorized, (await Post(client, Adjustments, CreateBody(CompensationWriteFixture.M1Id), token)).StatusCode);
    }

    [Fact]
    public async Task ValidJwt_ButSubNotStaffResolvable_Is401()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Post(client, Adjustments, CreateBody(CompensationWriteFixture.M1Id), Mint("sub-with-no-user-row"));
        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    // ── dark-by-default: flag OFF (default) → routes NOT mapped → 404 ──
    [Fact]
    public async Task CreateRoute_Is404_WhenFlagDefaultsOff()
    {
        await using var factory = DarkFactory();
        using var client = factory.CreateClient();
        var response = await Post(client, Adjustments, CreateBody(CompensationWriteFixture.M1Id), token: null);
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task ApproveRoute_Is404_WhenFlagDefaultsOff()
    {
        await using var factory = DarkFactory();
        using var client = factory.CreateClient();
        var response = await Post(client, Approve(CompensationWriteFixture.AdjApprove), new { approved = true }, token: null);
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    // ── flag ON → route mapped → an unauthenticated request is 401 (NOT 404 → the route EXISTS) ──
    [Fact]
    public async Task CreateRoute_Is401_NotNotFound_WhenFlagOn()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Post(client, Adjustments, CreateBody(CompensationWriteFixture.M1Id), token: null);
        Assert.NotEqual(HttpStatusCode.NotFound, response.StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }
}
