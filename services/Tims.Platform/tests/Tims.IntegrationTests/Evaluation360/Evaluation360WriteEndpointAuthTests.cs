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

namespace Tims.IntegrationTests.Evaluation360;

/// <summary>
/// Phase-5 Slice 13 endpoint boot matrix (real host + real Postgres): boots <c>WebApplicationFactory</c> against the
/// write fixture DB with a locally-minted JWKS and drives the REAL HTTP pipeline for the 6 evaluation360 WRITE
/// endpoints, exercising the TWO auth patterns + the load-bearing identity bite:
///
///   STAFF (createCycle / open / close / publish / assignRaters): evaluation360:create|update + org-gate —
///   organization → 200; TEAM-scope → 403 (Codex F3); resolvable staff WITHOUT the grant → 403; illegal transition →
///   409; bounded input (after auth) → 400.
///   SELF-SERVICE (submitRatings): identity only — the OWNING rater (a NO-GRANT employee) → 200; an ORG-ADMIN
///   submitting on ANOTHER rater's assignment → 404 (the forge bite — raterUserId hard-filter, never scope); the
///   6-competency refine → 400. no/tampered/non-staff JWT → 401. Flag OFF (default) → 404 on ALL routes.
/// </summary>
[Collection("Evaluation360Write")]
public sealed class Evaluation360WriteEndpointAuthTests(Evaluation360WriteFixture fixture)
{
    private const string Issuer = "https://test-project.supabase.co/auth/v1";
    private const string Audience = "authenticated";

    private static readonly RSA SigningRsa = RSA.Create(2048);
    private static readonly RsaSecurityKey PrivateKey = new(SigningRsa) { KeyId = "evaluation360-write-test-key" };

    private readonly Evaluation360WriteFixture _fixture = fixture;

    private const string CyclesPath = "/evaluation360/cycles";
    private static string Transition(Guid cycleId, string verb) => $"/evaluation360/cycles/{cycleId}/{verb}";
    private static string Raters(Guid cycleId) => $"/evaluation360/cycles/{cycleId}/raters";
    private static string Ratings(Guid assignmentId) => $"/evaluation360/assignments/{assignmentId}/ratings";

    private WebApplicationFactory<Program> EnabledFactory() =>
        new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.UseSetting("Platform:DatabaseConnectionString", _fixture.ConnectionString);
            builder.UseSetting("Platform:Evaluation360WriteEnabled", "true");
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

    private static readonly string[] Competencies =
        { "leadership", "communication", "collaboration", "execution", "adaptability", "integrity" };

    private static object RatingsBody(int competencyCount) => new
    {
        ratings = Competencies.Take(competencyCount).Select(k => new { competencyKey = k, rating = 4 }).ToArray(),
    };

    private static object AssignBody(Guid subjectId, Guid raterId) => new
    {
        assignments = new[] { new { subjectUserId = subjectId, raterUserId = raterId, relationship = "peer" } },
    };

    // ======================= STAFF: createCycle =======================

    [Fact]
    public async Task Create_OrgAdmin_Is200_DraftShape()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Post(client, CyclesPath, new { name = "New 360 Cycle" }, Mint(Evaluation360WriteFixture.OrgAdminSub));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        Assert.Contains("\"status\":\"draft\"", body);
        Assert.Contains("\"name\":\"New 360 Cycle\"", body);
        Assert.Contains("\"id\":", body);
    }

    [Fact]
    public async Task Create_TeamLeader_Is403_OrgGate()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Post(client, CyclesPath, new { name = "x" }, Mint(Evaluation360WriteFixture.TeamLeadSub));
        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode); // leader@team → org-gate fails closed (F3)
    }

    [Fact]
    public async Task Create_NoGrantStaff_Is403()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Post(client, CyclesPath, new { name = "x" }, Mint(Evaluation360WriteFixture.RaterASub));
        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Theory]
    [InlineData("")]                 // min(1) — empty name
    public async Task Create_BadName_AfterAuth_Is400(string name)
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Post(client, CyclesPath, new { name }, Mint(Evaluation360WriteFixture.OrgAdminSub));
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Create_BadInput_Unauthenticated_Is401_NotValidatedBeforeAuth()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Post(client, CyclesPath, new { garbage = true }, token: null);
        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    // ======================= STAFF: transitions =======================

    [Fact]
    public async Task Open_OrgAdmin_Draft_Is200()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Post(
            client, Transition(Evaluation360WriteFixture.CycleEpOpen, "open"), body: null, Mint(Evaluation360WriteFixture.OrgAdminSub));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Contains("\"status\":\"open\"", await response.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task Open_OnNonDraft_Is409()
    {
        // CycleEpAssign is already open → open transition matches 0 → 409 (illegal transition).
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Post(
            client, Transition(Evaluation360WriteFixture.CycleEpAssign, "open"), body: null, Mint(Evaluation360WriteFixture.OrgAdminSub));
        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
    }

    [Fact]
    public async Task Transition_TeamLeader_Is403_OrgGate()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Post(
            client, Transition(Evaluation360WriteFixture.CycleEpAssign, "close"), body: null, Mint(Evaluation360WriteFixture.TeamLeadSub));
        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    // ======================= STAFF: assignRaters =======================

    [Fact]
    public async Task Assign_OrgAdmin_Open_Is200_Created()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Post(
            client, Raters(Evaluation360WriteFixture.CycleEpAssign),
            AssignBody(Evaluation360WriteFixture.Subject1, Evaluation360WriteFixture.RaterBId),
            Mint(Evaluation360WriteFixture.OrgAdminSub));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Contains("\"created\":1", await response.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task Assign_TeamLeader_Is403_OrgGate()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Post(
            client, Raters(Evaluation360WriteFixture.CycleEpAssign),
            AssignBody(Evaluation360WriteFixture.Subject1, Evaluation360WriteFixture.RaterBId),
            Mint(Evaluation360WriteFixture.TeamLeadSub));
        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Fact]
    public async Task Assign_EmptyAssignments_AfterAuth_Is400()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Post(
            client, Raters(Evaluation360WriteFixture.CycleEpAssign), new { assignments = Array.Empty<object>() },
            Mint(Evaluation360WriteFixture.OrgAdminSub));
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode); // min(1)
    }

    // ======================= SELF-SERVICE: submitRatings (identity) =======================

    [Fact]
    public async Task Submit_OwningRater_NoGrant_Is200_Submitted()
    {
        // RaterA holds only the employee role (no evaluation360 grant) — the self-service submit works on IDENTITY.
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Post(
            client, Ratings(Evaluation360WriteFixture.AssignEpSubmit), RatingsBody(6), Mint(Evaluation360WriteFixture.RaterASub));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Contains("\"status\":\"submitted\"", await response.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task Submit_OrgAdmin_ForAnotherRatersAssignment_Is404_NoForgedWrite()
    {
        // THE LOAD-BEARING BITE: AssignEpForge belongs to RaterA. An org-admin (organization scope) submitting on it
        // must NOT succeed — identity anchoring (raterUserId = caller) makes the pre-fetch fail → 404, no forged write.
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Post(
            client, Ratings(Evaluation360WriteFixture.AssignEpForge), RatingsBody(6), Mint(Evaluation360WriteFixture.OrgAdminSub));

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        Assert.Equal("pending", await _fixture.GetAssignmentStatusAsync(Evaluation360WriteFixture.AssignEpForge));
        Assert.Equal(0, await _fixture.CountResponsesAsync(Evaluation360WriteFixture.AssignEpForge));
    }

    [Theory]
    [InlineData(5)] // .length(6) — too few (also fails the 6-distinct refine)
    public async Task Submit_WrongCompetencyCount_AfterAuth_Is400(int competencyCount)
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Post(
            client, Ratings(Evaluation360WriteFixture.AssignEpForge), RatingsBody(competencyCount),
            Mint(Evaluation360WriteFixture.RaterASub));
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    // ======================= 401: no token / tampered / valid-but-not-staff =======================
    private const string TamperedBearer = "eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJhdHRhY2tlciJ9.c2ln";

    public static TheoryData<string?> UnauthorizedTokens => new() { null, TamperedBearer };

    [Theory]
    [MemberData(nameof(UnauthorizedTokens))]
    public async Task StaffEndpoint_RejectedCredential_Is401(string? token)
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        Assert.Equal(HttpStatusCode.Unauthorized, (await Post(client, CyclesPath, new { name = "x" }, token)).StatusCode);
    }

    [Theory]
    [MemberData(nameof(UnauthorizedTokens))]
    public async Task SelfServiceEndpoint_RejectedCredential_Is401(string? token)
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        Assert.Equal(
            HttpStatusCode.Unauthorized,
            (await Post(client, Ratings(Evaluation360WriteFixture.AssignEpForge), RatingsBody(6), token)).StatusCode);
    }

    [Fact]
    public async Task ValidJwt_ButSubNotStaffResolvable_SelfService_Is401()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Post(
            client, Ratings(Evaluation360WriteFixture.AssignEpForge), RatingsBody(6), Mint("sub-with-no-user-row"));
        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    // ======================= dark-by-default: flag OFF → 404 on ALL routes =======================
    public static TheoryData<string> AllRoutes => new()
    {
        "/evaluation360/cycles",
        "/evaluation360/cycles/00000000-0000-0000-0000-000000000001/open",
        "/evaluation360/cycles/00000000-0000-0000-0000-000000000001/close",
        "/evaluation360/cycles/00000000-0000-0000-0000-000000000001/publish",
        "/evaluation360/cycles/00000000-0000-0000-0000-000000000001/raters",
        "/evaluation360/assignments/00000000-0000-0000-0000-000000000001/ratings",
    };

    [Theory]
    [MemberData(nameof(AllRoutes))]
    public async Task Route_Is404_WhenFlagDefaultsOff(string path)
    {
        await using var factory = DarkFactory();
        using var client = factory.CreateClient();
        Assert.Equal(HttpStatusCode.NotFound, (await Post(client, path, new { }, token: null)).StatusCode);
    }

    // ---- flag ON → route mapped → an unauthenticated request is 401 (NOT 404 → the route EXISTS) ----
    [Fact]
    public async Task CreateRoute_Is401_NotNotFound_WhenFlagOn()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Post(client, CyclesPath, new { name = "x" }, token: null);
        Assert.NotEqual(HttpStatusCode.NotFound, response.StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }
}
