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

namespace Tims.IntegrationTests.Succession;

/// <summary>
/// Phase-5 Slice 14 endpoint boot matrix (real host + real Postgres): boots <c>WebApplicationFactory</c> against the
/// write fixture DB with a locally-minted JWKS and drives the REAL HTTP pipeline for the 5 succession WRITE
/// endpoints through the Supabase JWT scheme + PrincipalResolver + PermissionService
/// <c>succession:create/update/delete</c> grants + each endpoint's DIFFERENT scope mechanic:
///   addCriticalRole — requireOrgScope (org admin 200 / narrow leader 403 — INV-1); full-row body; bad input → 400;
///   addSuccessor — assertScoped('criticalRole') (leader OUT role → 404, INV-2) THEN assertSubjectInScope (leader,
///     in-scope role but out-of-set user → 403, INV-3); dedup → 409 (INV-5); nested user body;
///   removeSuccessor / updateSuccessorReadiness — assertScoped('successor') (leader out-of-scope → 404, INV-6);
///   updateCriticalRoleBand — narrow {id,targetBandLevel} body + null clears (INV-7); leader out-of-scope role → 404;
///   auth matrix: no/tampered/non-staff JWT → 401; dark-by-default (flag off) → 404.
/// </summary>
[Collection("SuccessionWrite")]
public sealed class SuccessionWriteEndpointAuthTests(SuccessionWriteFixture fixture)
{
    private const string Issuer = "https://test-project.supabase.co/auth/v1";
    private const string Audience = "authenticated";

    private static readonly RSA SigningRsa = RSA.Create(2048);
    private static readonly RsaSecurityKey PrivateKey = new(SigningRsa) { KeyId = "succ-write-test-key" };

    private readonly SuccessionWriteFixture _fixture = fixture;

    private const string CriticalRoles = "/succession/critical-roles";
    private static string Successors(Guid roleId) => $"/succession/critical-roles/{roleId}/successors";
    private static string Successor(Guid id) => $"/succession/successors/{id}";
    private static string Readiness(Guid id) => $"/succession/successors/{id}/readiness";
    private static string Band(Guid roleId) => $"/succession/critical-roles/{roleId}/band";

    private WebApplicationFactory<Program> EnabledFactory() =>
        new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.UseSetting("Platform:DatabaseConnectionString", _fixture.ConnectionString);
            builder.UseSetting("Platform:SuccessionWriteEnabled", "true");
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

    private static object RoleBody(string title = "New Role", string criticality = "high") =>
        new { title, criticality, flightRisk = 0.5 };

    private static object SuccessorBody(Guid userId, string readiness = "ready_now", string type = "internal") =>
        new { userId, readiness, type };

    // ══ addCriticalRole — requireOrgScope ══
    [Fact]
    public async Task AddCriticalRole_OrgAdmin_Is200_FullRow()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Post(client, CriticalRoles, RoleBody(), Mint(SuccessionWriteFixture.OrgAdminSub));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        Assert.Contains("\"title\":\"New Role\"", body);
        Assert.Contains("\"criticality\":\"high\"", body);
        Assert.Contains("\"targetBandLevel\":null", body); // never set on create
        Assert.Contains("\"id\":", body);
    }

    [Fact]
    public async Task AddCriticalRole_NarrowLeader_Is403_RequireOrgScope()
    {
        // The leader holds succession:create @ TEAM — org governance requires org/company scope → 403 (no INSERT).
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Post(client, CriticalRoles, RoleBody(), Mint(SuccessionWriteFixture.TeamLeadSub));
        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Fact]
    public async Task AddCriticalRole_NoGrant_Is403()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Post(client, CriticalRoles, RoleBody(), Mint(SuccessionWriteFixture.NoGrantSub));
        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    public static TheoryData<object> BadRoleBodies => new()
    {
        new { criticality = "high" }, // missing title
        new { title = "", criticality = "high" }, // empty title
        new { title = "X", criticality = "supercritical" }, // bad enum
        new { title = "X", criticality = "high", flightRisk = 1.5 }, // flightRisk out of 0..1
        new { title = "X", criticality = "high", companyId = "not-a-uuid" }, // malformed uuid
    };

    [Theory]
    [MemberData(nameof(BadRoleBodies))]
    public async Task AddCriticalRole_BadInput_AfterAuth_Is400(object body)
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Post(client, CriticalRoles, body, Mint(SuccessionWriteFixture.OrgAdminSub));
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task AddCriticalRole_BadInput_Unauthenticated_Is401_NotValidatedBeforeAuth()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Post(client, CriticalRoles, new { garbage = true }, token: null);
        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    // ── Codex F2: a NARROW leader with a MALFORMED body → 400 (body validated BEFORE requireOrgScope), not 403 ──
    [Fact]
    public async Task AddCriticalRole_NarrowLeader_MalformedBody_Is400_NotForbidden()
    {
        // The leader would 403 on requireOrgScope with a VALID body; a malformed body must 400 first (tRPC order).
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Post(
            client, CriticalRoles, new { criticality = "high" }, Mint(SuccessionWriteFixture.TeamLeadSub)); // missing title
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    // ── Codex H2: addCriticalRole with an all-in-org optional FK set → 200 (valid refs pass the org-membership check) ──
    [Fact]
    public async Task AddCriticalRole_InOrgRefs_Is200()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Post(
            client, CriticalRoles,
            new { title = "Anchored", criticality = "high", currentHolderId = SuccessionWriteFixture.M1Id, companyId = SuccessionWriteFixture.CompanyA, unitId = SuccessionWriteFixture.UnitA },
            Mint(SuccessionWriteFixture.OrgAdminSub));
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    // ── Codex H2: addCriticalRole with a cross-org currentHolderId / companyId / unitId → 400, no cross-tenant row ──
    public static TheoryData<object> CrossOrgRoleRefs => new()
    {
        new { title = "X", criticality = "high", currentHolderId = "d0000000-0000-0000-0000-0000000000b1" }, // OrgB user (Mb1)
        new { title = "X", criticality = "high", companyId = "c0c00000-0000-0000-0000-0000000000b0" },       // OrgB company
        new { title = "X", criticality = "high", unitId = "b0b00000-0000-0000-0000-0000000000b0" },          // OrgB business unit
    };

    [Theory]
    [MemberData(nameof(CrossOrgRoleRefs))]
    public async Task AddCriticalRole_CrossOrgReference_Is400(object body)
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Post(client, CriticalRoles, body, Mint(SuccessionWriteFixture.OrgAdminSub));
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    // ── Codex Low (strict-uuid parity): a non-canonical UUID form (braces) Zod .uuid() rejects → 400 ──
    [Fact]
    public async Task AddCriticalRole_NonCanonicalUuid_Is400()
    {
        // Guid.TryParse would accept the brace-wrapped form; TryParseExact(…, "D") rejects it (Zod .uuid() parity).
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Post(
            client, CriticalRoles,
            new { title = "X", criticality = "high", currentHolderId = "{d0000000-0000-0000-0000-000000000001}" },
            Mint(SuccessionWriteFixture.OrgAdminSub));
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    // ── Codex F1: an EXPLICIT null on a Zod .optional() (non-nullable) POST field → 400 (not treated as absent) ──
    [Fact]
    public async Task AddCriticalRole_ExplicitNullOptional_Is400()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Post(
            client, CriticalRoles,
            new { title = "X", criticality = "high", currentHolderId = (string?)null },
            Mint(SuccessionWriteFixture.OrgAdminSub));
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    // ══ addSuccessor — assertScoped(criticalRole) THEN assertSubjectInScope(userId) ══
    [Fact]
    public async Task AddSuccessor_OrgAdmin_Is200_WithNestedUser()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Post(
            client, Successors(SuccessionWriteFixture.CrEpAdd), SuccessorBody(SuccessionWriteFixture.M2Id),
            Mint(SuccessionWriteFixture.OrgAdminSub));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        Assert.Contains("\"firstName\":\"Max\"", body); // nested user projection (M2 = Max Two)
        Assert.Contains($"\"addedById\":\"{SuccessionWriteFixture.OrgAdminId}\"", body); // provenance = caller
    }

    [Fact]
    public async Task AddSuccessor_Leader_ParentRoleOutOfScope_Is404_Probe()
    {
        // CrOutTeam holder is M3 (out of TeamLead's team) → assertScoped('criticalRole') → 404 (INV-2).
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Post(
            client, Successors(SuccessionWriteFixture.CrOutTeam), SuccessorBody(SuccessionWriteFixture.M1Id),
            Mint(SuccessionWriteFixture.TeamLeadSub));
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task AddSuccessor_Leader_SubjectOutOfSet_Is403()
    {
        // CrEpSubj holder is M1 (in scope → parent probe passes), but the target user M3 is OUT of the leader's
        // subject set → assertSubjectInScope → 403 "No puedes agregar este sucesor" (INV-3). No row created.
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Post(
            client, Successors(SuccessionWriteFixture.CrEpSubj), SuccessorBody(SuccessionWriteFixture.M3Id),
            Mint(SuccessionWriteFixture.TeamLeadSub));
        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
        Assert.Equal(0, await _fixture.CountSuccessorsAsync(SuccessionWriteFixture.CrEpSubj, SuccessionWriteFixture.M3Id));
    }

    [Fact]
    public async Task AddSuccessor_Duplicate_Is409()
    {
        // CrEpDup already has M1 (SuccEpDup) → re-adding the same pair → 409 (the documented port improvement).
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Post(
            client, Successors(SuccessionWriteFixture.CrEpDup), SuccessorBody(SuccessionWriteFixture.M1Id),
            Mint(SuccessionWriteFixture.OrgAdminSub));
        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
        Assert.Equal(1, await _fixture.CountSuccessorsAsync(SuccessionWriteFixture.CrEpDup, SuccessionWriteFixture.M1Id));
    }

    [Fact]
    public async Task AddSuccessor_BadEnum_AfterAuth_Is400()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Post(
            client, Successors(SuccessionWriteFixture.CrEpAdd),
            new { userId = SuccessionWriteFixture.M2Id, readiness = "someday", type = "internal" },
            Mint(SuccessionWriteFixture.OrgAdminSub));
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task AddSuccessor_NoGrant_Is403()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Post(
            client, Successors(SuccessionWriteFixture.CrEpAdd), SuccessorBody(SuccessionWriteFixture.M2Id),
            Mint(SuccessionWriteFixture.NoGrantSub));
        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    // ── Codex H1: an ORG-scoped admin cannot add a cross-org user as successor → 403, no cross-tenant row ──
    [Fact]
    public async Task AddSuccessor_OrgAdmin_CrossOrgUser_Is403_NoInsert()
    {
        // CrEpAdd is an OrgA role (assertScoped passes for the org admin) and Mb1 is an OrgB user. The org-scope
        // assertSubjectInScope no-op would otherwise allow this; the org-membership backstop rejects it → 403.
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Post(
            client, Successors(SuccessionWriteFixture.CrEpAdd), SuccessorBody(SuccessionWriteFixture.Mb1Id),
            Mint(SuccessionWriteFixture.OrgAdminSub));
        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
        Assert.Equal(0, await _fixture.CountSuccessorsAsync(SuccessionWriteFixture.CrEpAdd, SuccessionWriteFixture.Mb1Id));
    }

    // ── Codex F1: an EXPLICIT null developmentPlan (Zod .optional()) → 400 (not treated as absent) ──
    [Fact]
    public async Task AddSuccessor_ExplicitNullDevelopmentPlan_Is400()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Post(
            client, Successors(SuccessionWriteFixture.CrEpAdd),
            new { userId = SuccessionWriteFixture.M2Id, readiness = "ready_now", type = "internal", developmentPlan = (string?)null },
            Mint(SuccessionWriteFixture.OrgAdminSub));
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    // ══ removeSuccessor — assertScoped(successor) ══
    [Fact]
    public async Task RemoveSuccessor_OrgAdmin_Is200_AndDeletes()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Send(
            client, HttpMethod.Delete, Successor(SuccessionWriteFixture.SuccEpRemove), null, Mint(SuccessionWriteFixture.OrgAdminSub));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.False(await _fixture.SuccessorExistsAsync(SuccessionWriteFixture.SuccEpRemove));
    }

    [Fact]
    public async Task RemoveSuccessor_Leader_OutOfScope_Is404()
    {
        // SuccEpRemoveOut's subject is M3 (out of the leader's team) → assertScoped('successor') → 404 (INV-6).
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Send(
            client, HttpMethod.Delete, Successor(SuccessionWriteFixture.SuccEpRemoveOut), null, Mint(SuccessionWriteFixture.TeamLeadSub));
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        Assert.True(await _fixture.SuccessorExistsAsync(SuccessionWriteFixture.SuccEpRemoveOut)); // untouched
    }

    [Fact]
    public async Task RemoveSuccessor_NoGrant_Is403()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Send(
            client, HttpMethod.Delete, Successor(SuccessionWriteFixture.SuccEpRemove), null, Mint(SuccessionWriteFixture.NoGrantSub));
        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    // ══ updateSuccessorReadiness — assertScoped(successor) ══
    [Fact]
    public async Task UpdateReadiness_OrgAdmin_Is200()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Send(
            client, HttpMethod.Patch, Readiness(SuccessionWriteFixture.SuccEpUpdate),
            new { readiness = "ready_now" }, Mint(SuccessionWriteFixture.OrgAdminSub));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("ready_now", await _fixture.GetSuccessorReadinessAsync(SuccessionWriteFixture.SuccEpUpdate));
    }

    [Fact]
    public async Task UpdateReadiness_Leader_OutOfScope_Is404()
    {
        // SuccEpUpdateOut's subject is M4 (out of the leader's team) → assertScoped('successor') → 404 (INV-6).
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Send(
            client, HttpMethod.Patch, Readiness(SuccessionWriteFixture.SuccEpUpdateOut),
            new { readiness = "ready_now" }, Mint(SuccessionWriteFixture.TeamLeadSub));
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task UpdateReadiness_BadEnum_AfterAuth_Is400()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Send(
            client, HttpMethod.Patch, Readiness(SuccessionWriteFixture.SuccEpUpdate),
            new { readiness = "eventually" }, Mint(SuccessionWriteFixture.OrgAdminSub));
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    // ══ updateCriticalRoleBand — assertScoped(criticalRole) + narrow shape (INV-7) ══
    [Fact]
    public async Task UpdateBand_OrgAdmin_SetsThenClears_NarrowShape()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();

        var set = await Send(
            client, HttpMethod.Patch, Band(SuccessionWriteFixture.CrEpBand),
            new { targetBandLevel = "L9" }, Mint(SuccessionWriteFixture.OrgAdminSub));
        Assert.Equal(HttpStatusCode.OK, set.StatusCode);
        var setBody = await set.Content.ReadAsStringAsync();
        Assert.Contains("\"targetBandLevel\":\"L9\"", setBody);
        Assert.DoesNotContain("\"title\"", setBody); // narrow select { id, targetBandLevel }
        Assert.DoesNotContain("\"criticality\"", setBody);
        Assert.Equal("L9", await _fixture.GetRoleBandAsync(SuccessionWriteFixture.CrEpBand));

        var cleared = await Send(
            client, HttpMethod.Patch, Band(SuccessionWriteFixture.CrEpBand),
            new { targetBandLevel = (string?)null }, Mint(SuccessionWriteFixture.OrgAdminSub));
        Assert.Equal(HttpStatusCode.OK, cleared.StatusCode);
        Assert.Contains("\"targetBandLevel\":null", await cleared.Content.ReadAsStringAsync());
        Assert.Null(await _fixture.GetRoleBandAsync(SuccessionWriteFixture.CrEpBand));
    }

    [Fact]
    public async Task UpdateBand_Leader_OutOfScopeRole_Is404()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Send(
            client, HttpMethod.Patch, Band(SuccessionWriteFixture.CrOutTeam),
            new { targetBandLevel = "L5" }, Mint(SuccessionWriteFixture.TeamLeadSub));
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task UpdateBand_MissingTargetBandLevel_Is400()
    {
        // targetBandLevel is REQUIRED-but-nullable (Zod .nullable(), not .optional()) — an absent key → 400.
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Send(
            client, HttpMethod.Patch, Band(SuccessionWriteFixture.CrEpBand), new { }, Mint(SuccessionWriteFixture.OrgAdminSub));
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
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
        Assert.Equal(HttpStatusCode.Unauthorized, (await Post(client, CriticalRoles, RoleBody(), token)).StatusCode);
    }

    [Fact]
    public async Task ValidJwt_ButSubNotStaffResolvable_Is401()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Post(client, CriticalRoles, RoleBody(), Mint("sub-with-no-user-row"));
        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    // ══ dark-by-default: flag OFF (default) → routes NOT mapped → 404 ══
    [Fact]
    public async Task AddCriticalRoleRoute_Is404_WhenFlagDefaultsOff()
    {
        await using var factory = DarkFactory();
        using var client = factory.CreateClient();
        var response = await Post(client, CriticalRoles, RoleBody(), token: null);
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task RemoveSuccessorRoute_Is404_WhenFlagDefaultsOff()
    {
        await using var factory = DarkFactory();
        using var client = factory.CreateClient();
        var response = await Send(
            client, HttpMethod.Delete, Successor(SuccessionWriteFixture.SuccEpRemove), null, token: null);
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    // ══ flag ON → route mapped → an unauthenticated request is 401 (NOT 404 → the route EXISTS) ══
    [Fact]
    public async Task AddCriticalRoleRoute_Is401_NotNotFound_WhenFlagOn()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Post(client, CriticalRoles, RoleBody(), token: null);
        Assert.NotEqual(HttpStatusCode.NotFound, response.StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }
}
