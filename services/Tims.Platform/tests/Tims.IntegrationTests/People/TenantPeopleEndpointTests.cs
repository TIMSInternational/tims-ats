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

namespace Tims.IntegrationTests.People;

[Collection("TenantPeople")]
public sealed class TenantPeopleEndpointTests(TenantPeopleFixture fixture)
{
    private const string Issuer = "https://test-project.supabase.co/auth/v1";
    private const string Audience = "authenticated";
    private const string Path = "/tenant/people/assignable";

    private static readonly RSA SigningRsa = RSA.Create(2048);
    private static readonly RsaSecurityKey PrivateKey = new(SigningRsa) { KeyId = "people-test-key" };

    private WebApplicationFactory<Program> EnabledFactory() =>
        new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.UseSetting("Platform:DatabaseConnectionString", fixture.ConnectionString);
            builder.UseSetting("Platform:TenantPeopleDirectoryEnabled", "true");
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

    private static string Mint(string sub) => new JsonWebTokenHandler().CreateToken(new SecurityTokenDescriptor
    {
        Issuer = Issuer,
        Audience = Audience,
        Subject = new ClaimsIdentity([new Claim("sub", sub)]),
        Expires = DateTime.UtcNow.AddMinutes(10),
        SigningCredentials = new SigningCredentials(PrivateKey, SecurityAlgorithms.RsaSha256),
    });

    private async Task<HttpResponseMessage> Get(string query, string? sub)
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        using var request = new HttpRequestMessage(HttpMethod.Get, Path + query);
        if (sub is not null) request.Headers.Add("Authorization", $"Bearer {Mint(sub)}");
        return await client.SendAsync(request);
    }

    private async Task<List<JsonElement>> People(string query, string sub = TenantPeopleFixture.RecruiterSub)
    {
        var response = await Get(query, sub);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.Equal(["people"], json.RootElement.EnumerateObject().Select(p => p.Name));
        return json.RootElement.GetProperty("people").EnumerateArray().Select(e => e.Clone()).ToList();
    }

    private static Guid[] Ids(IEnumerable<JsonElement> people) =>
        people.Select(p => p.GetProperty("id").GetGuid()).Order().ToArray();

    [Fact]
    public async Task Recruiter_ListsEveryActiveMemberOfOwnTenantAsEvaluators()
    {
        var people = await People("?purpose=interview_evaluator");
        Assert.Equal(new[]
        {
            TenantPeopleFixture.Recruiter, TenantPeopleFixture.Admin, TenantPeopleFixture.HrAdmin,
            TenantPeopleFixture.Leader, TenantPeopleFixture.Employee, TenantPeopleFixture.ExternalOnly,
            TenantPeopleFixture.Underscore, TenantPeopleFixture.Hrbp, TenantPeopleFixture.Committee,
        }.Order().ToArray(), Ids(people));
    }

    [Fact]
    public async Task Response_IsTheMinimalPickerProjection_WithoutRoleComposition()
    {
        var people = await People("?purpose=interview_evaluator&search=ada");
        var ada = Assert.Single(people);
        Assert.Equal(["id", "firstName", "lastName", "email", "avatarUrl"],
            ada.EnumerateObject().Select(p => p.Name));
        Assert.Equal("https://cdn.test/ada.png", ada.GetProperty("avatarUrl").GetString());

        // avatarUrl is required + nullable in the contract, so an absent avatar is an explicit null.
        var rita = Assert.Single(await People("?purpose=interview_evaluator&search=rita"));
        Assert.Equal(JsonValueKind.Null, rita.GetProperty("avatarUrl").ValueKind);
        Assert.False(rita.TryGetProperty("phone", out _));
        Assert.False(rita.TryGetProperty("roleSlugs", out _));
    }

    [Fact]
    public async Task VacancyApprovers_AreOnlyStaffHoldingVacancyApproveOrSuperAdmin()
    {
        var people = await People("?purpose=vacancy_approver");
        // Excluded: recruiter/employee/hrbp/committee (no grant), the inactive and deleted hr_admins, the
        // external-role holder (non-staff principal), Uma (grant only via a DRIFTED foreign-tenant role) and Globex.
        Assert.Equal(new[] { TenantPeopleFixture.Admin, TenantPeopleFixture.HrAdmin, TenantPeopleFixture.Leader }
            .Order().ToArray(), Ids(people));
    }

    [Fact]
    public async Task OfferApprovers_AreOnlyStaffHoldingOfferApproveOrSuperAdmin()
    {
        // seed-access-matrix.ts grants the leader offer:approve at team scope, so the leader IS listed (the
        // directory is permission-based; offer.submitForApproval re-checks the approver's scope per offer).
        var people = await People("?purpose=offer_approver");
        Assert.Equal(new[] { TenantPeopleFixture.Admin, TenantPeopleFixture.HrAdmin, TenantPeopleFixture.Leader }
            .Order().ToArray(), Ids(people));
    }

    [Fact]
    public async Task OtherTenant_SeesOnlyItsOwnPeople_AndADeactivatedRoleGrantsNothing()
    {
        var evaluators = await People("?purpose=interview_evaluator", TenantPeopleFixture.OrgBRecruiterSub);
        Assert.Equal(new[]
        {
            TenantPeopleFixture.OrgBHrAdmin, TenantPeopleFixture.OrgBRecruiter, TenantPeopleFixture.OrgBInactiveRoleLeader,
        }.Order().ToArray(), Ids(evaluators));
        // Gil's only approve grants ride Globex's DEACTIVATED leader role.
        Assert.Equal([TenantPeopleFixture.OrgBHrAdmin],
            Ids(await People("?purpose=offer_approver", TenantPeopleFixture.OrgBRecruiterSub)));
        Assert.Equal([TenantPeopleFixture.OrgBHrAdmin],
            Ids(await People("?purpose=vacancy_approver", TenantPeopleFixture.OrgBRecruiterSub)));
    }

    [Fact]
    public async Task Search_IsCaseInsensitiveLiteralText()
    {
        Assert.Equal([TenantPeopleFixture.HrAdmin], Ids(await People("?purpose=interview_evaluator&search=HUGO%40ACME")));
        // `_` is a LIKE wildcard; unescaped it would match every name with at least one character.
        Assert.Equal([TenantPeopleFixture.Underscore], Ids(await People("?purpose=interview_evaluator&search=_")));
        Assert.Empty(await People("?purpose=interview_evaluator&search=%25"));
        Assert.Empty(await People("?purpose=interview_evaluator&search=fiona"));
    }

    [Fact]
    public async Task EmptyResult_IsAnEmptyList_NotAnError()
    {
        Assert.Empty(await People("?purpose=offer_approver&search=nobody-matches-this"));
        Assert.Empty(await People("?purpose=vacancy_approver&search=rita")); // exists, but not an approver
    }

    [Fact]
    public async Task Limit_BoundsTheResultInStableNameOrder()
    {
        var people = await People("?purpose=interview_evaluator&limit=2");
        Assert.Equal(["Ada", "Eli"], people.Select(p => p.GetProperty("firstName").GetString()));
    }

    // Caller authorization follows the mutation each picker feeds (AssignablePurposes.RuleFor) with the grants of
    // seed-access-matrix.ts, and the unfiltered evaluator directory additionally needs org-wide scope.
    [Theory]
    [InlineData(TenantPeopleFixture.RecruiterSub, "interview_evaluator")]
    [InlineData(TenantPeopleFixture.RecruiterSub, "vacancy_approver")]
    [InlineData(TenantPeopleFixture.RecruiterSub, "offer_approver")]
    [InlineData(TenantPeopleFixture.HrAdminSub, "interview_evaluator")]
    [InlineData(TenantPeopleFixture.HrAdminSub, "vacancy_approver")]
    [InlineData(TenantPeopleFixture.HrAdminSub, "offer_approver")]
    // hrbp holds vacancy:update at UNIT scope: an approver list (permission-filtered) is allowed at any scope.
    [InlineData(TenantPeopleFixture.HrbpSub, "vacancy_approver")]
    public async Task CallerHoldingThePickerMutationPermission_Is200(string sub, string purpose)
    {
        var response = await Get($"?purpose={purpose}", sub);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Theory]
    [InlineData(TenantPeopleFixture.EmployeeSub, "interview_evaluator")]
    [InlineData(TenantPeopleFixture.EmployeeSub, "vacancy_approver")]
    [InlineData(TenantPeopleFixture.EmployeeSub, "offer_approver")]
    // No grant at all for the picker's mutation.
    [InlineData(TenantPeopleFixture.LeaderSub, "offer_approver")] // offer:read/approve only
    [InlineData(TenantPeopleFixture.LeaderSub, "vacancy_approver")] // vacancy:create, not vacancy:update
    [InlineData(TenantPeopleFixture.HrbpSub, "offer_approver")] // offer:read only
    [InlineData(TenantPeopleFixture.CommitteeSub, "vacancy_approver")]
    [InlineData(TenantPeopleFixture.CommitteeSub, "offer_approver")]
    // interview:create IS granted, but at team/unit scope: the whole staff directory needs org-wide scope.
    [InlineData(TenantPeopleFixture.LeaderSub, "interview_evaluator")]
    [InlineData(TenantPeopleFixture.CommitteeSub, "interview_evaluator")]
    [InlineData(TenantPeopleFixture.HrbpSub, "interview_evaluator")]
    public async Task CallerWithoutThePickerPermissionOrScope_Is403(string sub, string purpose)
    {
        var response = await Get($"?purpose={purpose}", sub);
        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Theory]
    [InlineData("")]
    [InlineData("?purpose=user_read")]
    [InlineData("?purpose=Interview_Evaluator")]
    [InlineData("?purpose=interview_evaluator&limit=0")]
    [InlineData("?purpose=interview_evaluator&limit=51")]
    [InlineData("?purpose=interview_evaluator&limit=abc")]
    public async Task InvalidInput_Is400(string query)
    {
        var response = await Get(query, TenantPeopleFixture.RecruiterSub);
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task OverlongSearch_Is400()
    {
        var response = await Get("?purpose=interview_evaluator&search=" + new string('a', 101), TenantPeopleFixture.RecruiterSub);
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Unauthenticated_Is401_AndOrglessPlatformOwner_Is400()
    {
        Assert.Equal(HttpStatusCode.Unauthorized, (await Get("?purpose=interview_evaluator", null)).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest,
            (await Get("?purpose=interview_evaluator", TenantPeopleFixture.PlatformOwnerSub)).StatusCode);
    }

    [Fact]
    public async Task FlagOff_Is404()
    {
        await using var factory = new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
            builder.UseSetting("Platform:DatabaseConnectionString", "Host=localhost;Port=5432;Database=x;Username=x"));
        using var client = factory.CreateClient();
        var response = await client.GetAsync(Path + "?purpose=interview_evaluator");
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }
}
