using System.Net;
using System.Net.Http.Json;
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
/// Phase-5 Slice 24 WRITE endpoint boot matrix (real host + real Postgres):
///   computeForVacancy — <c>fit_engine:create</c> + assertScoped('vacancy'); org admin 200 {computed:3} with
///     the STORED rows asserted against the TS-oracle kernel values (CandFull 86 via the Engineering profile;
///     CandEmpty/CandGhost 0+partial — the soft-deleted GHOST candidate still gets a row, TS parity; the
///     rejected application is excluded); a second compute takes the UPDATE path (id + created_at stable,
///     org untouched); zero active applications → {computed:0}, NO Default bootstrap; OrgB (no Default
///     profile) → the bootstrap creates it with the verbatim 0.2 weights;
///   upsertRoleFamilyWeightProfile — <c>fit_engine:update</c>, grant-only; create + update (id stable) paths;
///     the 400 matrix runs AFTER auth;
///   the action-parameterization bite: ReaderOnly (read@org) is 403 on BOTH writes, and TeamLead
///     (read+create@team) is 403 on the update-gated upsert — a read/create grant must not open update;
///   auth matrix: no JWT → 401; dark-by-default (flag off) → 404.
/// </summary>
[Collection("FitEngine")]
public sealed class FitEngineWriteEndpointAuthTests(FitEngineFixture fixture)
{
    private const string Issuer = "https://test-project.supabase.co/auth/v1";
    private const string Audience = "authenticated";

    private static readonly RSA SigningRsa = RSA.Create(2048);
    private static readonly RsaSecurityKey PrivateKey = new(SigningRsa) { KeyId = "fit-write-test-key" };

    private readonly FitEngineFixture _fixture = fixture;

    private static string Compute(Guid vacancyId) => $"/fit-engine/vacancies/{vacancyId}/compute";
    private const string Profiles = "/fit-engine/weight-profiles";

    private const string EngineeringWeightsJson =
        """{"assessment":0.5,"interview":0.3,"experience":0.1,"education":0.05,"languages":0.05}""";

    private WebApplicationFactory<Program> EnabledFactory() =>
        new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.UseSetting("Platform:DatabaseConnectionString", _fixture.ConnectionString);
            builder.UseSetting("Platform:FitEngineWriteEnabled", "true");
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
        var request = new HttpRequestMessage(HttpMethod.Post, path);
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

    private static object ProfileBody(
        string name = "Sales", double a = 0.3, double i = 0.3, double e = 0.2, double ed = 0.1, double l = 0.1) =>
        new
        {
            name,
            weights = new { assessment = a, interview = i, experience = e, education = ed, languages = l },
        };

    // ══ computeForVacancy ══
    [Fact]
    public async Task Compute_OrgAdmin_Is200_StoresOracleValues_IncludingGhost_ExcludingInactive()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Post(
            client, Compute(FitEngineFixture.VacInTeam), null, Mint(FitEngineFixture.OrgAdminSub));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("{\"computed\":3}", await response.Content.ReadAsStringAsync());

        // CandFull — TS-oracle kernel over the Engineering profile: assessment 90 (latest completed-with-result;
        // the newer result-less assignment excluded), interview 88 (newest non-null fitScore), experience 50
        // (2y vs min 4), education 100 (Licenciatura ≥ bachelor), languages 100 ("(B2)" stripped) → 86, full.
        var full = await _fixture.GetFitScoreAsync(FitEngineFixture.CandFull, FitEngineFixture.VacInTeam);
        Assert.NotNull(full);
        Assert.Equal(86, full.OverallScore);
        Assert.False(full.IsPartial);
        Assert.Equal(FitEngineFixture.OrgA, full.OrganizationId);
        var breakdown = JsonNode.Parse(full.Breakdown)!.AsObject();
        Assert.Equal(90, breakdown["assessment"]!.GetValue<double>());
        Assert.Equal(88, breakdown["interview"]!.GetValue<double>());
        Assert.Equal(50, breakdown["experience"]!.GetValue<double>());
        Assert.Equal(100, breakdown["education"]!.GetValue<double>());
        Assert.Equal(100, breakdown["languages"]!.GetValue<double>());
        Assert.True(breakdown.ContainsKey("llmJudgment"));
        Assert.Null(breakdown["llmJudgment"]);
        // weights = the Engineering profile jsonb AS-IS (roleFamily hit — not Default, not a rebuild).
        Assert.True(
            JsonNode.DeepEquals(JsonNode.Parse(full.Weights), JsonNode.Parse(EngineeringWeightsJson)),
            $"weights not the Engineering profile: {full.Weights}");

        // CandEmpty — no data anywhere → {0, partial}, breakdown all-null with every key present.
        var empty = await _fixture.GetFitScoreAsync(FitEngineFixture.CandEmpty, FitEngineFixture.VacInTeam);
        Assert.NotNull(empty);
        Assert.Equal(0, empty.OverallScore);
        Assert.True(empty.IsPartial);
        // Postgres jsonb CANONICALIZES key order in storage (identically for both stacks), so the stored row
        // pins the key SET; the TS-literal insertion order is pinned pre-storage in FitEngineUseCaseTests.
        var emptyBreakdown = JsonNode.Parse(empty.Breakdown)!.AsObject();
        Assert.Equal(
            ["assessment", "education", "experience", "interview", "languages", "llmJudgment"],
            emptyBreakdown.Select(p => p.Key).Order(StringComparer.Ordinal).ToArray());
        Assert.All(emptyBreakdown, p => Assert.Null(p.Value));

        // CandGhost — SOFT-DELETED but its application is active: the row is still written (TS parity: the
        // candidate fetch carries deletedAt:null and returns null, the pipeline id list does not).
        var ghost = await _fixture.GetFitScoreAsync(FitEngineFixture.CandGhost, FitEngineFixture.VacInTeam);
        Assert.NotNull(ghost);
        Assert.Equal(0, ghost.OverallScore);
        Assert.True(ghost.IsPartial);

        // CandInactive — application status 'rejected' → NOT computed.
        Assert.Null(await _fixture.GetFitScoreAsync(FitEngineFixture.CandInactive, FitEngineFixture.VacInTeam));
    }

    [Fact]
    public async Task Compute_Twice_TakesUpdatePath_IdAndCreatedAtStable_OrgUntouched()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var token = Mint(FitEngineFixture.OrgAdminSub);

        var first = await Post(client, Compute(FitEngineFixture.VacInTeam), null, token);
        Assert.Equal(HttpStatusCode.OK, first.StatusCode);
        var before = await _fixture.GetFitScoreAsync(FitEngineFixture.CandFull, FitEngineFixture.VacInTeam);
        Assert.NotNull(before);

        // Timestamps are ms-truncated; without this gap the strict > below would be timing-flaky, and
        // with >= instead a dropped `calculated_at = EXCLUDED.calculated_at` would pass vacuously.
        await Task.Delay(20);

        var second = await Post(client, Compute(FitEngineFixture.VacInTeam), null, token);
        Assert.Equal(HttpStatusCode.OK, second.StatusCode);
        var after = await _fixture.GetFitScoreAsync(FitEngineFixture.CandFull, FitEngineFixture.VacInTeam);
        Assert.NotNull(after);

        // ON CONFLICT DO UPDATE: same row (id + created_at stable, org untouched), STRICTLY fresher
        // stamps (TS sets calculatedAt: new Date() + @updatedAt on the update path).
        Assert.Equal(before.Id, after.Id);
        Assert.Equal(before.CreatedAt, after.CreatedAt);
        Assert.Equal(FitEngineFixture.OrgA, after.OrganizationId);
        Assert.True(after.CalculatedAt > before.CalculatedAt, "calculated_at must move on the update path");
        Assert.True(after.UpdatedAt > before.UpdatedAt, "updated_at must move on the update path");
        Assert.Equal(86, after.OverallScore);
    }

    [Fact]
    public async Task Compute_NoActiveApplications_IsComputedZero_NoRows_NoDefaultBootstrap()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var profilesBefore = await _fixture.CountWeightProfilesAsync(FitEngineFixture.OrgA);

        var response = await Post(
            client, Compute(FitEngineFixture.VacNoApps), null, Mint(FitEngineFixture.OrgAdminSub));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("{\"computed\":0}", await response.Content.ReadAsStringAsync());
        Assert.Equal(0, await _fixture.CountFitScoresForVacancyAsync(FitEngineFixture.VacNoApps));
        Assert.Equal(profilesBefore, await _fixture.CountWeightProfilesAsync(FitEngineFixture.OrgA));
    }

    [Fact]
    public async Task Compute_OrgB_BootstrapsDefaultProfile_WithVerbatimFifths()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        Assert.Null(await _fixture.GetWeightProfileAsync(FitEngineFixture.OrgB, "Default"));

        var response = await Post(
            client, Compute(FitEngineFixture.VacOrgB), null, Mint(FitEngineFixture.OrgBAdminSub));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("{\"computed\":1}", await response.Content.ReadAsStringAsync());

        var created = await _fixture.GetWeightProfileAsync(FitEngineFixture.OrgB, "Default");
        Assert.NotNull(created);
        Assert.True(JsonNode.DeepEquals(
            JsonNode.Parse(created.Value.Weights),
            JsonNode.Parse("""{"assessment":0.2,"interview":0.2,"experience":0.2,"education":0.2,"languages":0.2}""")));

        // VacOrgB has no job_profile → requirements {} → every person dim null; no assessments/interviews → {0, partial}.
        var row = await _fixture.GetFitScoreAsync(FitEngineFixture.CandOrgB, FitEngineFixture.VacOrgB);
        Assert.NotNull(row);
        Assert.Equal(0, row.OverallScore);
        Assert.True(row.IsPartial);
    }

    [Fact]
    public async Task Compute_TeamLead_OutOfTeamVacancy_Is404_IdorProbe()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Post(
            client, Compute(FitEngineFixture.VacOutTeam), null, Mint(FitEngineFixture.TeamLeadSub));

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        Assert.Contains("Vacante no encontrada", await response.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task Compute_ReaderOnly_Is403_ReadGrantDoesNotOpenCreate()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Post(
            client, Compute(FitEngineFixture.VacInTeam), null, Mint(FitEngineFixture.ReaderOnlySub));
        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Fact]
    public async Task Compute_NoGrant_Is403()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Post(
            client, Compute(FitEngineFixture.VacInTeam), null, Mint(FitEngineFixture.NoGrantSub));
        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Fact]
    public async Task Compute_NoToken_Is401()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Post(client, Compute(FitEngineFixture.VacInTeam), null, null);
        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task Compute_FlagOff_Is404_DarkByDefault()
    {
        await using var factory = DarkFactory();
        using var client = factory.CreateClient();
        var response = await Post(client, Compute(FitEngineFixture.VacInTeam), null, null);
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    // ══ upsertRoleFamilyWeightProfile ══
    [Fact]
    public async Task UpsertProfile_OrgAdmin_CreatePath_Is200_RowStored()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Post(client, Profiles, ProfileBody("Sales"), Mint(FitEngineFixture.OrgAdminSub));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = JsonNode.Parse(await response.Content.ReadAsStringAsync())!.AsObject();
        Assert.Equal("Sales", body["name"]!.GetValue<string>());
        Assert.Equal(0.3, body["weights"]!["assessment"]!.GetValue<double>());
        Assert.Equal(0.1, body["weights"]!["languages"]!.GetValue<double>());

        var stored = await _fixture.GetWeightProfileAsync(FitEngineFixture.OrgA, "Sales");
        Assert.NotNull(stored);
        Assert.Equal(stored.Value.Id.ToString(), body["id"]!.GetValue<string>());
    }

    [Fact]
    public async Task UpsertProfile_OrgAdmin_UpdatePath_Is200_IdStable_WeightsReplaced()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Post(
            client, Profiles, ProfileBody("Marketing", a: 0.6, i: 0.1, e: 0.1, ed: 0.1, l: 0.1),
            Mint(FitEngineFixture.OrgAdminSub));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = JsonNode.Parse(await response.Content.ReadAsStringAsync())!.AsObject();
        // The seeded Marketing row is UPDATED, not replaced — the (org, name) upsert keeps the id.
        Assert.Equal(FitEngineFixture.WpMarketing.ToString(), body["id"]!.GetValue<string>());
        Assert.Equal(0.6, body["weights"]!["assessment"]!.GetValue<double>());

        var stored = await _fixture.GetWeightProfileAsync(FitEngineFixture.OrgA, "Marketing");
        Assert.NotNull(stored);
        Assert.Equal(FitEngineFixture.WpMarketing, stored.Value.Id);
        Assert.Equal(0.6, JsonNode.Parse(stored.Value.Weights)!["assessment"]!.GetValue<double>());
    }

    public static TheoryData<object> BadProfileBodies => new()
    {
        new { weights = new { assessment = 0.2, interview = 0.2, experience = 0.2, education = 0.2, languages = 0.2 } }, // missing name
        new { name = "", weights = new { assessment = 0.2, interview = 0.2, experience = 0.2, education = 0.2, languages = 0.2 } }, // empty name
        new { name = new string('x', 101), weights = new { assessment = 0.2, interview = 0.2, experience = 0.2, education = 0.2, languages = 0.2 } }, // name > 100
        new { name = "X" }, // missing weights
        new { name = "X", weights = new { assessment = 0.5, interview = 0.5, experience = 0.0, education = 0.0 } }, // missing languages key
        new { name = "X", weights = new { assessment = 1.5, interview = 0.0, experience = 0.0, education = 0.0, languages = -0.5 } }, // out of [0,1]
        new { name = "X", weights = new { assessment = 0.1, interview = 0.1, experience = 0.1, education = 0.1, languages = 0.1 } }, // sum 0.5
        new { name = "X", weights = new { assessment = "0.2", interview = "0.2", experience = "0.2", education = "0.2", languages = "0.2" } }, // string weights
    };

    [Theory]
    [MemberData(nameof(BadProfileBodies))]
    public async Task UpsertProfile_BadInput_AfterAuth_Is400(object body)
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Post(client, Profiles, body, Mint(FitEngineFixture.OrgAdminSub));
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task UpsertProfile_EmptyBody_Is400()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var request = new HttpRequestMessage(HttpMethod.Post, Profiles);
        request.Headers.Add("Authorization", $"Bearer {Mint(FitEngineFixture.OrgAdminSub)}");
        var response = await client.SendAsync(request);
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task UpsertProfile_BadInput_Unauthenticated_Is401_NotValidatedBeforeAuth()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Post(client, Profiles, new { nope = true }, null);
        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task UpsertProfile_ReaderOnly_Is403_ReadGrantDoesNotOpenUpdate()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Post(client, Profiles, ProfileBody(), Mint(FitEngineFixture.ReaderOnlySub));
        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Fact]
    public async Task UpsertProfile_TeamLead_Is403_CreateGrantDoesNotOpenUpdate()
    {
        // TeamLead holds fit_engine read+create @team — update is a DIFFERENT action and must still deny.
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var response = await Post(client, Profiles, ProfileBody(), Mint(FitEngineFixture.TeamLeadSub));
        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Fact]
    public async Task UpsertProfile_FlagOff_Is404_DarkByDefault()
    {
        await using var factory = DarkFactory();
        using var client = factory.CreateClient();
        var response = await Post(client, Profiles, ProfileBody(), null);
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }
}
