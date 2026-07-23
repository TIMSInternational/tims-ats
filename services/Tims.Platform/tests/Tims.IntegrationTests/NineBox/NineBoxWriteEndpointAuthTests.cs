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

namespace Tims.IntegrationTests.NineBox;

/// <summary>
/// Phase-5 Slice 15 endpoint boot matrix (real host + real Postgres): boots <c>WebApplicationFactory</c> against the
/// write fixture DB with a locally-minted JWKS and drives the REAL HTTP pipeline for the 5 nine-box calibration WRITE
/// endpoints through the Supabase JWT scheme + PrincipalResolver + PermissionService <c>ninebox:create/update</c>
/// grants + each endpoint's DIFFERENT scope mechanic:
///   createCalibration — requireOrgScope (org admin 200 / narrow committee 403, INV-8); memberIds cross-org → 400
///     (INV-4); bad/explicit-null/malformed body → 400 (a narrow committee's malformed body 400s BEFORE the org-gate, F2);
///   submitCalibrationVote — MEMBERSHIP+IDENTITY (a member votes 200; a non-member org-admin → 403, INV-1 HTTP); no
///     requireOrgScope; cross-org session → 404;
///   addCalibrationMember — requireOrgScope (narrow → 403); dup → 409 (INV-5); cross-org user → 404;
///   removeCalibrationMember — requireOrgScope; a non-member → 404;
///   finalizeCalibration — requireOrgScope; a nonexistent session → 404;
///   auth matrix: no/tampered/non-staff JWT → 401; dark-by-default (flag off) → 404.
/// </summary>
[Collection("NineBoxWrite")]
public sealed class NineBoxWriteEndpointAuthTests(NineBoxWriteFixture fixture)
{
    private const string Issuer = "https://test-project.supabase.co/auth/v1";
    private const string Audience = "authenticated";

    private static readonly RSA SigningRsa = RSA.Create(2048);
    private static readonly RsaSecurityKey PrivateKey = new(SigningRsa) { KeyId = "ninebox-write-test-key" };

    private readonly NineBoxWriteFixture _fixture = fixture;

    private const string Calibrations = "/ninebox/calibrations";
    private static string Votes(Guid sessionId) => $"/ninebox/calibrations/{sessionId}/votes";
    private static string Members(Guid sessionId) => $"/ninebox/calibrations/{sessionId}/members";
    private static string Member(Guid sessionId, Guid userId) => $"/ninebox/calibrations/{sessionId}/members/{userId}";
    private static string Finalize(Guid sessionId) => $"/ninebox/calibrations/{sessionId}/finalize";

    private WebApplicationFactory<Program> EnabledFactory() =>
        new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.UseSetting("Platform:DatabaseConnectionString", _fixture.ConnectionString);
            builder.UseSetting("Platform:NineBoxWriteEnabled", "true");
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

    private static async Task<HttpResponseMessage> Send(
        HttpClient client, HttpMethod method, string path, object? body, string? token)
    {
        var request = new HttpRequestMessage(method, path);
        if (body is not null)
        {
            request.Content = JsonContent.Create(body);
        }

        if (token is not null)
        {
            request.Headers.Add("Authorization", $"Bearer {token}");
        }

        return await client.SendAsync(request);
    }

    private static Task<HttpResponseMessage> Post(HttpClient client, string path, object? body, string? token) =>
        Send(client, HttpMethod.Post, path, body ?? new { }, token);

    private static object CalibrationBody(string period = "2026Q1") => new { period };

    private static object VoteBody(Guid evaluatedUserId, string quadrant = "star") => new { evaluatedUserId, quadrant };

    private static object MemberBody(Guid userId) => new { userId };

    // ══ createCalibration — requireOrgScope ══
    [Fact]
    public async Task CreateCalibration_OrgAdmin_Is200_FullRow()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Post(
            client, Calibrations,
            new { period = "2026Q3", memberIds = new[] { NineBoxWriteFixture.M1Id } },
            Mint(NineBoxWriteFixture.OrgAdminSub));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        Assert.Contains("\"period\":\"2026Q3\"", body);
        Assert.Contains("\"status\":\"draft\"", body);
        Assert.Contains("\"members\":[", body);
        Assert.Contains($"\"createdById\":\"{NineBoxWriteFixture.OrgAdminId}\"", body);
    }

    [Fact]
    public async Task CreateCalibration_NarrowCommittee_Is403_RequireOrgScope()
    {
        // Committee holds ninebox:create @ TEAM — org governance requires org/company scope → 403 (no INSERT).
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Post(client, Calibrations, CalibrationBody(), Mint(NineBoxWriteFixture.CommitteeSub));
        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Fact]
    public async Task CreateCalibration_NoGrant_Is403()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Post(client, Calibrations, CalibrationBody(), Mint(NineBoxWriteFixture.NoGrantSub));
        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    public static TheoryData<object> BadCalibrationBodies => new()
    {
        new { }, // missing period
        new { period = new string('x', 101) }, // period > 100
        new { period = "Q", memberIds = "not-an-array" }, // memberIds wrong type
        new { period = "Q", memberIds = new[] { "not-a-uuid" } }, // bad uuid element
        new { period = "Q", scheduledAt = "not-a-date" }, // bad datetime
        new { period = "Q", scheduledAt = "2026-06-15T12:00:00" }, // zone-less (no Z) — Zod .datetime() rejects (F2)
    };

    [Theory]
    [MemberData(nameof(BadCalibrationBodies))]
    public async Task CreateCalibration_BadInput_AfterAuth_Is400(object body)
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Post(client, Calibrations, body, Mint(NineBoxWriteFixture.OrgAdminSub));
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    // ── Codex F2: a NARROW committee with a MALFORMED body → 400 (body validated BEFORE requireOrgScope), not 403 ──
    [Fact]
    public async Task CreateCalibration_NarrowCommittee_MalformedBody_Is400_NotForbidden()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Post(client, Calibrations, new { }, Mint(NineBoxWriteFixture.CommitteeSub)); // missing period
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    // ── INV-4 (H1-class): a cross-org memberId → 400, nothing written ──
    [Fact]
    public async Task CreateCalibration_CrossOrgMember_Is400()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Post(
            client, Calibrations,
            new { period = "2026Q4", memberIds = new[] { NineBoxWriteFixture.M1Id, NineBoxWriteFixture.MbId } },
            Mint(NineBoxWriteFixture.OrgAdminSub));
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    // ── Codex F1: an EXPLICIT null on a Zod .optional() field → 400 (not treated as absent) ──
    [Fact]
    public async Task CreateCalibration_ExplicitNullOptional_Is400()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Post(
            client, Calibrations,
            new { period = "Q", memberIds = (int[]?)null },
            Mint(NineBoxWriteFixture.OrgAdminSub));
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    // ══ submitCalibrationVote — MEMBERSHIP + IDENTITY (no requireOrgScope) ══
    [Fact]
    public async Task SubmitVote_CommitteeMember_Is200()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Post(
            client, Votes(NineBoxWriteFixture.SessVoteEp), VoteBody(NineBoxWriteFixture.E1Id),
            Mint(NineBoxWriteFixture.CommitteeSub));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        // voter_id is the caller (Committee), never input.
        Assert.Contains($"\"voterId\":\"{NineBoxWriteFixture.CommitteeId}\"", body);
        Assert.Contains($"\"evaluatedUserId\":\"{NineBoxWriteFixture.E1Id}\"", body);
    }

    // ── INV-1 (HTTP): a non-member org-admin → 403 "Solo un miembro del comite puede votar" ──
    [Fact]
    public async Task SubmitVote_OrgAdmin_NonMember_Is403()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Post(
            client, Votes(NineBoxWriteFixture.SessVoteEp), VoteBody(NineBoxWriteFixture.E1Id),
            Mint(NineBoxWriteFixture.OrgAdminSub));
        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Fact]
    public async Task SubmitVote_NoGrant_Is403()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Post(
            client, Votes(NineBoxWriteFixture.SessVoteEp), VoteBody(NineBoxWriteFixture.E1Id),
            Mint(NineBoxWriteFixture.NoGrantSub));
        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Fact]
    public async Task SubmitVote_CrossOrgSession_Is404()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Post(
            client, Votes(NineBoxWriteFixture.SessOrgB), VoteBody(NineBoxWriteFixture.E1Id),
            Mint(NineBoxWriteFixture.CommitteeSub));
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task SubmitVote_BadInput_AfterAuth_Is400()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Post(
            client, Votes(NineBoxWriteFixture.SessVoteEp), new { evaluatedUserId = "not-a-uuid", quadrant = "star" },
            Mint(NineBoxWriteFixture.CommitteeSub));
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    // ══ addCalibrationMember — requireOrgScope ══
    [Fact]
    public async Task AddMember_OrgAdmin_Is200_WithId()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Post(
            client, Members(NineBoxWriteFixture.SessAddEp), MemberBody(NineBoxWriteFixture.M2Id),
            Mint(NineBoxWriteFixture.OrgAdminSub));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Contains("\"id\":", await response.Content.ReadAsStringAsync());
        Assert.True(await _fixture.MemberExistsAsync(NineBoxWriteFixture.SessAddEp, NineBoxWriteFixture.M2Id));
    }

    [Fact]
    public async Task AddMember_NarrowCommittee_Is403_RequireOrgScope()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Post(
            client, Members(NineBoxWriteFixture.SessAddEp), MemberBody(NineBoxWriteFixture.M1Id),
            Mint(NineBoxWriteFixture.CommitteeSub));
        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    // ── INV-5 (HTTP): a duplicate member → 409 ──
    [Fact]
    public async Task AddMember_Duplicate_Is409()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Post(
            client, Members(NineBoxWriteFixture.SessAddEpDup), MemberBody(NineBoxWriteFixture.M1Id),
            Mint(NineBoxWriteFixture.OrgAdminSub));
        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
    }

    [Fact]
    public async Task AddMember_CrossOrgUser_Is404()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Post(
            client, Members(NineBoxWriteFixture.SessAddEp), MemberBody(NineBoxWriteFixture.MbId),
            Mint(NineBoxWriteFixture.OrgAdminSub));
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    // ══ removeCalibrationMember — requireOrgScope ══
    [Fact]
    public async Task RemoveMember_OrgAdmin_Is200_AndDeletes()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Send(
            client, HttpMethod.Delete, Member(NineBoxWriteFixture.SessRemoveEp, NineBoxWriteFixture.M1Id), null,
            Mint(NineBoxWriteFixture.OrgAdminSub));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Contains("\"success\":true", await response.Content.ReadAsStringAsync());
        Assert.False(await _fixture.MemberExistsAsync(NineBoxWriteFixture.SessRemoveEp, NineBoxWriteFixture.M1Id));
    }

    [Fact]
    public async Task RemoveMember_NarrowCommittee_Is403_RequireOrgScope()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Send(
            client, HttpMethod.Delete, Member(NineBoxWriteFixture.SessRemoveEp, NineBoxWriteFixture.M1Id), null,
            Mint(NineBoxWriteFixture.CommitteeSub));
        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Fact]
    public async Task RemoveMember_NonMember_Is404()
    {
        // M2 is NOT a member of SessRemoveEp → count 0 → 404.
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Send(
            client, HttpMethod.Delete, Member(NineBoxWriteFixture.SessRemoveEp, NineBoxWriteFixture.M2Id), null,
            Mint(NineBoxWriteFixture.OrgAdminSub));
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    // ══ finalizeCalibration — requireOrgScope ══
    [Fact]
    public async Task Finalize_OrgAdmin_Is200_Finalized()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Post(client, Finalize(NineBoxWriteFixture.SessFinalizeEp), null, Mint(NineBoxWriteFixture.OrgAdminSub));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Contains("\"status\":\"finalized\"", await response.Content.ReadAsStringAsync());
        Assert.Equal("finalized", await _fixture.GetSessionStatusAsync(NineBoxWriteFixture.SessFinalizeEp));
    }

    [Fact]
    public async Task Finalize_NarrowCommittee_Is403_RequireOrgScope()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Post(client, Finalize(NineBoxWriteFixture.SessFinalizeEp), null, Mint(NineBoxWriteFixture.CommitteeSub));
        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Fact]
    public async Task Finalize_MissingSession_Is404()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Post(client, Finalize(NineBoxWriteFixture.MissingSessionId), null, Mint(NineBoxWriteFixture.OrgAdminSub));
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    // ══ auth matrix ══
    private const string TamperedBearer = "eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJhdHRhY2tlciJ9.c2ln";

    [Theory]
    [InlineData(null)]
    [InlineData(TamperedBearer)]
    public async Task RejectedCredential_Is401(string? token)
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        Assert.Equal(HttpStatusCode.Unauthorized, (await Post(client, Calibrations, CalibrationBody(), token)).StatusCode);
    }

    [Fact]
    public async Task ValidJwt_ButSubNotStaffResolvable_Is401()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Post(client, Calibrations, CalibrationBody(), Mint("sub-with-no-user-row"));
        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    // ══ dark-by-default: flag OFF (default) → routes NOT mapped → 404 ══
    [Fact]
    public async Task CreateCalibrationRoute_Is404_WhenFlagDefaultsOff()
    {
        await using var factory = DarkFactory();
        using var client = factory.CreateClient();
        var response = await Post(client, Calibrations, CalibrationBody(), token: null);
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task FinalizeRoute_Is404_WhenFlagDefaultsOff()
    {
        await using var factory = DarkFactory();
        using var client = factory.CreateClient();
        var response = await Post(client, Finalize(NineBoxWriteFixture.SessFinalizeEp), null, token: null);
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    // ══ flag ON → route mapped → an unauthenticated request is 401 (NOT 404 → the route EXISTS) ══
    [Fact]
    public async Task CreateCalibrationRoute_Is401_NotNotFound_WhenFlagOn()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Post(client, Calibrations, CalibrationBody(), token: null);
        Assert.NotEqual(HttpStatusCode.NotFound, response.StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }
}
