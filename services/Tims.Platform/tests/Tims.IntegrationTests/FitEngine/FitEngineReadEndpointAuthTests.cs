using System.Net;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;

namespace Tims.IntegrationTests.FitEngine;

/// <summary>
/// Phase-5 Slice 24 READ endpoint boot matrix (real host + real Postgres): boots
/// <c>WebApplicationFactory</c> against the fixture DB with a locally-minted JWKS and drives the REAL HTTP
/// pipeline for the 4 FIT-engine READ endpoints through the Supabase JWT scheme + PrincipalResolver +
/// PermissionService <c>fit_engine:read</c> grants + the <c>assertScoped('vacancy')</c> by-id IDOR probe:
///   ranking — org admin/reader/leader-in-team 200 (Node-ISO calculatedAt + breakdown passthrough pinned);
///     leader out-of-team / soft-deleted / cross-org → 404 "Vacante no encontrada"; no-grant → 403;
///   simulateWeights — weights validated AFTER auth (bad weights + no token → 401, the tRPC ordering pin) and
///     BEFORE the probe (bad weights + out-of-team → 400, Zod-before-assertScoped parity); kernel + stable
///     sort over stored breakdowns;
///   listWeightProfiles — grant-only, name ASC, weights jsonb passthrough;
///   explainFit — probe → fetch → missing score 404 (TS NOT_FOUND) → 501 honest stub with the score present;
///   auth matrix: no/tampered JWT → 401; dark-by-default (flag off) → 404.
/// </summary>
[Collection("FitEngine")]
public sealed class FitEngineReadEndpointAuthTests(FitEngineFixture fixture)
{
    private const string Issuer = "https://test-project.supabase.co/auth/v1";
    private const string Audience = "authenticated";

    private static readonly RSA SigningRsa = RSA.Create(2048);
    private static readonly RsaSecurityKey PrivateKey = new(SigningRsa) { KeyId = "fit-read-test-key" };

    private readonly FitEngineFixture _fixture = fixture;

    private static string Ranking(Guid vacancyId) => $"/fit-engine/vacancies/{vacancyId}/ranking";

    private static string Simulate(
        Guid vacancyId, string a = "0.2", string i = "0.2", string e = "0.2", string ed = "0.2", string l = "0.2") =>
        $"/fit-engine/vacancies/{vacancyId}/simulate-weights?assessment={a}&interview={i}&experience={e}&education={ed}&languages={l}";

    private const string Profiles = "/fit-engine/weight-profiles";

    private static string Explain(Guid vacancyId, Guid candidateId) =>
        $"/fit-engine/vacancies/{vacancyId}/candidates/{candidateId}/explain-fit";

    private WebApplicationFactory<Program> EnabledFactory() =>
        new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.UseSetting("Platform:DatabaseConnectionString", _fixture.ConnectionString);
            builder.UseSetting("Platform:FitEngineReadEnabled", "true");
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

    private static async Task<HttpResponseMessage> Get(HttpClient client, string path, string? token)
    {
        var request = new HttpRequestMessage(HttpMethod.Get, path);
        if (token is not null)
        {
            request.Headers.Add("Authorization", $"Bearer {token}");
        }

        return await client.SendAsync(request);
    }

    // ══ getRankingForVacancy ══
    [Fact]
    public async Task Ranking_OrgAdmin_Is200_DescOrder_NodeIsoDates_BreakdownPassthrough()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Get(client, Ranking(FitEngineFixture.VacRead), Mint(FitEngineFixture.OrgAdminSub));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var rows = JsonNode.Parse(await response.Content.ReadAsStringAsync())!.AsArray();
        Assert.Equal(2, rows.Count);

        // overallScore DESC: CandFull 85 then CandEmpty 40.
        Assert.Equal(85, rows[0]!["overallScore"]!.GetValue<double>());
        Assert.Equal(40, rows[1]!["overallScore"]!.GetValue<double>());
        Assert.Equal(FitEngineFixture.FsCandFull.ToString(), rows[0]!["fitScoreId"]!.GetValue<string>());
        Assert.Equal(FitEngineFixture.CandFull.ToString(), rows[0]!["candidateId"]!.GetValue<string>());
        Assert.Equal("Carla", rows[0]!["firstName"]!.GetValue<string>());
        Assert.Equal("Fuentes", rows[0]!["lastName"]!.GetValue<string>());
        Assert.False(rows[0]!["isPartial"]!.GetValue<bool>());
        Assert.True(rows[1]!["isPartial"]!.GetValue<bool>());

        // TRAP 6 pin: the Node-ISO wire (3-digit ms + Z), not STJ's default.
        Assert.Equal("2026-03-01T10:00:00.000Z", rows[0]!["calculatedAt"]!.GetValue<string>());

        // breakdown is the stored jsonb passed through — llmJudgment present AND null.
        var breakdown = rows[0]!["breakdown"]!.AsObject();
        Assert.Equal(90, breakdown["assessment"]!.GetValue<double>());
        Assert.True(breakdown.ContainsKey("llmJudgment"));
        Assert.Null(breakdown["llmJudgment"]);
    }

    [Fact]
    public async Task Ranking_ReaderOnly_Is200()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Get(client, Ranking(FitEngineFixture.VacRead), Mint(FitEngineFixture.ReaderOnlySub));
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Fact]
    public async Task Ranking_TeamLead_InTeamVacancy_Is200()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Get(client, Ranking(FitEngineFixture.VacRead), Mint(FitEngineFixture.TeamLeadSub));
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Fact]
    public async Task Ranking_TeamLead_OutOfTeamVacancy_Is404_IdorProbe()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Get(client, Ranking(FitEngineFixture.VacOutTeam), Mint(FitEngineFixture.TeamLeadSub));

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        Assert.Contains("Vacante no encontrada", await response.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task Ranking_SoftDeletedVacancy_Is404_EvenForOrgAdmin()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Get(client, Ranking(FitEngineFixture.VacDeleted), Mint(FitEngineFixture.OrgAdminSub));
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task Ranking_CrossOrgVacancy_Is404()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Get(client, Ranking(FitEngineFixture.VacOrgB), Mint(FitEngineFixture.OrgAdminSub));
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task Ranking_NoGrant_Is403()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Get(client, Ranking(FitEngineFixture.VacRead), Mint(FitEngineFixture.NoGrantSub));
        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Fact]
    public async Task Ranking_NoToken_Is401()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Get(client, Ranking(FitEngineFixture.VacRead), null);
        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task Ranking_TamperedToken_Is401()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Get(
            client, Ranking(FitEngineFixture.VacRead), Mint(FitEngineFixture.OrgAdminSub) + "tampered");
        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task Ranking_FlagOff_Is404_DarkByDefault()
    {
        await using var factory = DarkFactory();
        using var client = factory.CreateClient();
        var response = await Get(client, Ranking(FitEngineFixture.VacRead), null);
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task ReadFlagAlone_DoesNotMapTheWriteRoutes()
    {
        // Mirror of the write suite's guard: EnabledFactory() sets only the READ flag, so POST /compute must
        // 404. If the two Program.cs guards were ever merged, flipping the READ flag at canary would
        // silently activate the C# WRITER against fit_scores — the exact thing the write flag exists to gate.
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var request = new HttpRequestMessage(
            HttpMethod.Post, $"/fit-engine/vacancies/{FitEngineFixture.VacInTeam}/compute");
        request.Headers.Add("Authorization", $"Bearer {Mint(FitEngineFixture.OrgAdminSub)}");
        var response = await client.SendAsync(request);
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    // ══ simulateWeights ══
    [Fact]
    public async Task Simulate_AssessmentOnly_Is200_KernelOverStoredBreakdowns_Desc()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Get(
            client, Simulate(FitEngineFixture.VacRead, a: "1", i: "0", e: "0", ed: "0", l: "0"),
            Mint(FitEngineFixture.OrgAdminSub));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var rows = JsonNode.Parse(await response.Content.ReadAsStringAsync())!.AsArray();
        Assert.Equal(2, rows.Count);
        // CandFull breakdown.assessment 90 → 90; CandEmpty assessment 40 → 40. Both partial=false? CandFull has
        // all five dims present → false; CandEmpty has only assessment → partial TRUE.
        Assert.Equal(90, rows[0]!["simulatedScore"]!.GetValue<double>());
        Assert.False(rows[0]!["isPartial"]!.GetValue<bool>());
        Assert.Equal(40, rows[1]!["simulatedScore"]!.GetValue<double>());
        Assert.True(rows[1]!["isPartial"]!.GetValue<bool>());
    }

    [Fact]
    public async Task Simulate_InterviewOnly_MissingDimensionScoresZeroPartial()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Get(
            client, Simulate(FitEngineFixture.VacRead, a: "0", i: "1", e: "0", ed: "0", l: "0"),
            Mint(FitEngineFixture.OrgAdminSub));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var rows = JsonNode.Parse(await response.Content.ReadAsStringAsync())!.AsArray();
        // CandFull interview 88 → 88; CandEmpty interview null + every weighted dim missing → {0, partial}.
        Assert.Equal(88, rows[0]!["simulatedScore"]!.GetValue<double>());
        Assert.Equal(0, rows[1]!["simulatedScore"]!.GetValue<double>());
        Assert.True(rows[1]!["isPartial"]!.GetValue<bool>());
    }

    [Theory]
    [InlineData("?interview=0.2&experience=0.2&education=0.2&languages=0.2")] // missing assessment
    [InlineData("?assessment=1.5&interview=0&experience=0&education=0&languages=-0.5")] // out of [0,1]
    [InlineData("?assessment=0.1&interview=0.1&experience=0.1&education=0.1&languages=0.1")] // sum 0.5 ≠ 1
    [InlineData("?assessment=abc&interview=0.2&experience=0.2&education=0.2&languages=0.2")] // non-numeric
    public async Task Simulate_BadWeights_AfterAuth_Is400(string query)
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Get(
            client, $"/fit-engine/vacancies/{FitEngineFixture.VacRead}/simulate-weights{query}",
            Mint(FitEngineFixture.OrgAdminSub));
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Simulate_BadWeights_Unauthenticated_Is401_NotValidatedBeforeAuth()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Get(
            client, Simulate(FitEngineFixture.VacRead, a: "9", i: "9", e: "9", ed: "9", l: "9"), null);
        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task Simulate_BadWeights_OutOfScopeVacancy_Is400_ValidationBeforeProbe()
    {
        // tRPC parity: Zod input parse runs BEFORE the handler's assertScoped — a narrow caller sending bad
        // weights at an out-of-scope vacancy gets 400, not 404.
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Get(
            client, Simulate(FitEngineFixture.VacOutTeam, a: "9", i: "0", e: "0", ed: "0", l: "0"),
            Mint(FitEngineFixture.TeamLeadSub));
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Simulate_TeamLead_OutOfTeamVacancy_ValidWeights_Is404()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Get(
            client, Simulate(FitEngineFixture.VacOutTeam), Mint(FitEngineFixture.TeamLeadSub));
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    // ══ listRoleFamilyWeightProfiles ══
    [Fact]
    public async Task Profiles_OrgAdmin_Is200_NameAsc_WeightsPassthrough()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Get(client, Profiles, Mint(FitEngineFixture.OrgAdminSub));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var rows = JsonNode.Parse(await response.Content.ReadAsStringAsync())!.AsArray();

        // Other tests in the collection may create profiles; assert the SEEDED two exist in relative
        // name-ASC order with their jsonb passed through.
        var names = rows.Select(r => r!["name"]!.GetValue<string>()).ToList();
        var defaultIdx = names.IndexOf("Default");
        var engineeringIdx = names.IndexOf("Engineering");
        Assert.True(defaultIdx >= 0 && engineeringIdx >= 0, $"seeded profiles missing from [{string.Join(", ", names)}]");
        Assert.True(defaultIdx < engineeringIdx, "name ASC: Default must precede Engineering");
        Assert.Equal(names.OrderBy(n => n, StringComparer.Ordinal).ToList(), names);

        var engineering = rows[engineeringIdx]!.AsObject();
        Assert.Equal(FitEngineFixture.WpEngineering.ToString(), engineering["id"]!.GetValue<string>());
        Assert.Equal(0.5, engineering["weights"]!["assessment"]!.GetValue<double>());
        Assert.Equal(0.05, engineering["weights"]!["languages"]!.GetValue<double>());
    }

    [Fact]
    public async Task Profiles_NoGrant_Is403()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Get(client, Profiles, Mint(FitEngineFixture.NoGrantSub));
        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Fact]
    public async Task Profiles_NoToken_Is401()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Get(client, Profiles, null);
        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    // ══ explainFit ══
    [Fact]
    public async Task Explain_ScoreExists_Is501_HonestStub_AfterProbeAndFetch()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Get(
            client, Explain(FitEngineFixture.VacRead, FitEngineFixture.CandFull),
            Mint(FitEngineFixture.OrgAdminSub));

        Assert.Equal(HttpStatusCode.NotImplemented, response.StatusCode);
        Assert.Contains("Bedrock", await response.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task Explain_NoScore_Is404_TsNotFoundParity()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Get(
            client, Explain(FitEngineFixture.VacRead, FitEngineFixture.CandOrder),
            Mint(FitEngineFixture.OrgAdminSub));

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        Assert.Contains("No hay FIT score calculado para este candidato", await response.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task Explain_TeamLead_OutOfTeamVacancy_Is404_ProbeBeforeFetch()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Get(
            client, Explain(FitEngineFixture.VacOutTeam, FitEngineFixture.CandFull),
            Mint(FitEngineFixture.TeamLeadSub));

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        Assert.Contains("Vacante no encontrada", await response.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task Explain_NoGrant_Is403()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Get(
            client, Explain(FitEngineFixture.VacRead, FitEngineFixture.CandFull),
            Mint(FitEngineFixture.NoGrantSub));
        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }
}
