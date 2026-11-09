using System.Net;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;

namespace Tims.IntegrationTests.FitEngine;

/// <summary>
/// The vacancy assessments editor, GET/PUT /fit-engine/vacancies/{id}/requirements/assessments, against real Postgres
/// (RLS on, app_tenant, the shipped fit_v2_integrity triggers) and the real host: the read's version token, the
/// conditional replace of <c>assessments[]</c> ONLY (the v1 keys stay), 409 on a stale version or a lost concurrent
/// write (one winner, enforced by the database), the strict body (a missing reason refuses everything), the profile
/// insert when the vacancy has none, the TS authorization (vacancy:read / vacancy:update + the vacancy scope probe), and
/// the dark flags. Each test owns a fresh vacancy.
/// </summary>
[Collection("FitEngine")]
public sealed class FitAssessmentRequirementsEndpointTests(FitEngineFixture fixture)
{
    private const string Issuer = "https://test-project.supabase.co/auth/v1";
    private const string Audience = "authenticated";
    private const string AbsentVersion = "37a6259cc0c1dae299a7866489dff0bd"; // md5('null')

    private const string English =
        """[{"instrument":"english","use":"gate","min":{"cefr":"B2"},"reason":"Atención a clientes en inglés"}]""";

    private static readonly RSA SigningRsa = RSA.Create(2048);
    private static readonly RsaSecurityKey PrivateKey = new(SigningRsa) { KeyId = "fit-assessments-editor-test-key" };

    private readonly FitEngineFixture _fixture = fixture;

    [Fact]
    public async Task Read_then_save_replaces_only_the_array_and_returns_a_new_version()
    {
        var vacancy = await VacancyAsync(
            """{"minYearsExperience":3,"requiredLanguages":["Spanish"],"assessments":[{"instrument":"lia","use":"gate","min":{"globalPercentile":40},"reason":"Análisis"}]}""");

        var read = await SendAsync(HttpMethod.Get, vacancy, null);
        Assert.Equal(HttpStatusCode.OK, read.Status);
        Assert.Equal("lia", read.Body!["assessments"]![0]!["instrument"]!.GetValue<string>());
        var version = read.Body["version"]!.GetValue<string>();

        var saved = await SendAsync(HttpMethod.Put, vacancy, Body(English, version));

        Assert.Equal(HttpStatusCode.OK, saved.Status);
        Assert.NotEqual(version, saved.Body!["version"]!.GetValue<string>());
        var stored = JsonNode.Parse((await _fixture.GetFitRequirementsAsync(vacancy))!)!;
        Assert.Equal(3, stored["minYearsExperience"]!.GetValue<double>()); // the card's keys are untouched
        Assert.Equal("Spanish", stored["requiredLanguages"]![0]!.GetValue<string>());
        Assert.True(JsonNode.DeepEquals(JsonNode.Parse(English), stored["assessments"]), stored.ToJsonString());
        Assert.Equal(saved.Body["version"]!.GetValue<string>(), (await SendAsync(HttpMethod.Get, vacancy, null)).Body!["version"]!.GetValue<string>());
    }

    [Fact]
    public async Task A_save_from_a_stale_version_is_a_409_with_what_is_stored_and_writes_nothing()
    {
        var vacancy = await VacancyAsync("""{"assessments":[]}""");
        var version = (await SendAsync(HttpMethod.Get, vacancy, null)).Body!["version"]!.GetValue<string>();
        Assert.Equal(HttpStatusCode.OK, (await SendAsync(HttpMethod.Put, vacancy, Body(English, version))).Status);
        var before = await _fixture.GetFitRequirementsAsync(vacancy);

        var stale = await SendAsync(HttpMethod.Put, vacancy, Body("[]", version));

        Assert.Equal(HttpStatusCode.Conflict, stale.Status);
        Assert.Equal("requirements_changed", stale.Body!["error"]!.GetValue<string>());
        Assert.Equal("english", stale.Body["current"]!["assessments"]![0]!["instrument"]!.GetValue<string>());
        Assert.Equal(before, await _fixture.GetFitRequirementsAsync(vacancy));
    }

    // Two editors saving from the same version at once: the row lock and the version check make exactly one win.
    [Fact]
    public async Task Concurrent_saves_from_one_version_have_exactly_one_winner()
    {
        var vacancy = await VacancyAsync("""{"assessments":[]}""");
        var version = (await SendAsync(HttpMethod.Get, vacancy, null)).Body!["version"]!.GetValue<string>();
        const string Lia = """[{"instrument":"lia","use":"gate","min":{"globalPercentile":50},"reason":"Análisis"}]""";

        await using var factory = Factory(write: true, v2: true);
        using var client = factory.CreateClient();
        var results = await Task.WhenAll(
            Enumerable.Range(0, 6).Select(i => SendAsync(client, HttpMethod.Put, vacancy, Body(i % 2 == 0 ? English : Lia, version))));

        Assert.Equal(1, results.Count(r => r.Status == HttpStatusCode.OK));
        Assert.Equal(5, results.Count(r => r.Status == HttpStatusCode.Conflict));
    }

    [Fact]
    public async Task A_vacancy_without_a_profile_reads_absent_and_gets_one_on_save_and_a_concurrent_insert_loses()
    {
        var vacancy = await VacancyAsync(null);

        var read = await SendAsync(HttpMethod.Get, vacancy, null);
        Assert.Empty(read.Body!["assessments"]!.AsArray());
        Assert.Equal(AbsentVersion, read.Body["version"]!.GetValue<string>());

        await using var factory = Factory(write: true, v2: true);
        using var client = factory.CreateClient();
        var results = await Task.WhenAll(
            Enumerable.Range(0, 4).Select(_ => SendAsync(client, HttpMethod.Put, vacancy, Body(English, AbsentVersion))));

        Assert.Equal(1, results.Count(r => r.Status == HttpStatusCode.OK));
        Assert.Equal(3, results.Count(r => r.Status == HttpStatusCode.Conflict));
        Assert.Equal(FitEngineFixture.OrgA.ToString(), (await _fixture.ExecuteScalarAsync(
            "SELECT organization_id::text FROM job_profiles WHERE vacancy_id = @v", ("v", vacancy)))!.ToString());
    }

    [Fact]
    public async Task An_entry_without_a_reason_refuses_the_whole_write()
    {
        var vacancy = await VacancyAsync("""{"assessments":[]}""");
        var before = await _fixture.GetFitRequirementsAsync(vacancy);
        var version = (await SendAsync(HttpMethod.Get, vacancy, null)).Body!["version"]!.GetValue<string>();

        var refused = await SendAsync(HttpMethod.Put, vacancy, Body(
            """[{"instrument":"english","use":"gate","min":{"cefr":"B2"},"reason":"Clientes"},{"instrument":"personality"}]""", version));

        Assert.Equal(HttpStatusCode.BadRequest, refused.Status);
        Assert.Equal("invalid_assessments", refused.Body!["error"]!.GetValue<string>());
        Assert.Equal("1:reason_required", $"{refused.Body["issues"]![0]!["index"]}:{refused.Body["issues"]![0]!["code"]}");
        Assert.Equal(before, await _fixture.GetFitRequirementsAsync(vacancy));
    }

    [Theory]
    [InlineData("GET", FitEngineFixture.NoGrantSub, HttpStatusCode.Forbidden)]
    [InlineData("GET", FitEngineFixture.TeamLeadSub, HttpStatusCode.NotFound)] // vacancy:read @ team; the vacancy has no team
    [InlineData("GET", FitEngineFixture.OrgBAdminSub, HttpStatusCode.NotFound)] // another organization's vacancy
    [InlineData("PUT", FitEngineFixture.ReaderOnlySub, HttpStatusCode.Forbidden)] // no vacancy:update
    [InlineData("PUT", FitEngineFixture.TeamLeadSub, HttpStatusCode.NotFound)]
    [InlineData("PUT", FitEngineFixture.OrgBAdminSub, HttpStatusCode.NotFound)]
    public async Task Authorization_matches_the_vacancy_grants_and_writes_nothing(string method, string sub, HttpStatusCode expected)
    {
        var vacancy = await VacancyAsync("""{"assessments":[]}""");
        var before = await _fixture.GetFitRequirementsAsync(vacancy);

        var response = await SendAsync(new HttpMethod(method), vacancy, method == "PUT" ? Body(English, AbsentVersion) : null, sub);

        Assert.Equal(expected, response.Status);
        Assert.Equal(before, await _fixture.GetFitRequirementsAsync(vacancy));
    }

    [Theory]
    [InlineData(true, false)]
    [InlineData(false, true)]
    public async Task The_routes_are_mapped_only_with_both_flags(bool write, bool v2)
    {
        await using var factory = Factory(write, v2);
        using var client = factory.CreateClient();

        var response = await client.SendAsync(Request(HttpMethod.Get, FitEngineFixture.VacFitReq, null, FitEngineFixture.OrgAdminSub));

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        Assert.Equal(string.Empty, await response.Content.ReadAsStringAsync());
    }

    private static string Body(string assessments, string version) =>
        $$"""{"assessments":{{assessments}},"expectedVersion":"{{version}}"}""";

    /// <summary>A fresh OrgA vacancy (no team: a team-scoped reader cannot reach it) and, unless null, its profile.</summary>
    private async Task<Guid> VacancyAsync(string? fitRequirements)
    {
        // vacancy:read for hr_admin (organization) and the leader (team), as the editor's read needs.
        await _fixture.ExecuteScalarAsync(
            """
            INSERT INTO permissions (id, module, action) VALUES ('b0000000-0000-0000-0000-0000000000e1', 'vacancy', 'read')
              ON CONFLICT (id) DO NOTHING;
            INSERT INTO role_permissions (id, role_id, permission_id, scope) VALUES
              ('90000000-0000-0000-0000-0000000000e1', 'a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-0000000000e1', 'organization'),
              ('90000000-0000-0000-0000-0000000000e2', 'a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-0000000000e1', 'team'),
              ('90000000-0000-0000-0000-0000000000e3', 'a0000000-0000-0000-0000-0000000000b1', 'b0000000-0000-0000-0000-0000000000e1', 'organization')
              ON CONFLICT (id) DO NOTHING;
            """);
        var vacancy = Guid.NewGuid();
        await _fixture.ExecuteScalarAsync(
            "INSERT INTO vacancies (id, organization_id, title, created_by, status, created_at, updated_at) "
            + "VALUES (@v, @o, 'Editor', 'c0000000-0000-0000-0000-000000000001', 'open', now(), now())",
            ("v", vacancy), ("o", FitEngineFixture.OrgA));
        if (fitRequirements is not null)
        {
            await _fixture.ExecuteScalarAsync(
                "INSERT INTO job_profiles (id, organization_id, vacancy_id, fit_requirements) VALUES (gen_random_uuid(), @o, @v, @f::jsonb)",
                ("o", FitEngineFixture.OrgA), ("v", vacancy), ("f", fitRequirements));
        }

        return vacancy;
    }

    private async Task<(HttpStatusCode Status, JsonNode? Body)> SendAsync(
        HttpMethod method, Guid vacancyId, string? json, string sub = FitEngineFixture.OrgAdminSub)
    {
        await using var factory = Factory(write: true, v2: true);
        using var client = factory.CreateClient();
        return await SendAsync(client, method, vacancyId, json, sub);
    }

    private static async Task<(HttpStatusCode Status, JsonNode? Body)> SendAsync(
        HttpClient client, HttpMethod method, Guid vacancyId, string? json, string sub = FitEngineFixture.OrgAdminSub)
    {
        var response = await client.SendAsync(Request(method, vacancyId, json, sub));
        var text = await response.Content.ReadAsStringAsync();
        return (response.StatusCode, text.Length == 0 ? null : JsonNode.Parse(text));
    }

    private static HttpRequestMessage Request(HttpMethod method, Guid vacancyId, string? json, string sub)
    {
        var request = new HttpRequestMessage(method, $"/fit-engine/vacancies/{vacancyId}/requirements/assessments");
        if (json is not null)
        {
            request.Content = new StringContent(json, Encoding.UTF8, "application/json");
        }

        request.Headers.Add("Authorization", $"Bearer {Mint(sub)}");
        return request;
    }

    private WebApplicationFactory<Program> Factory(bool write, bool v2) =>
        new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.UseSetting("Platform:DatabaseConnectionString", _fixture.ConnectionString);
            builder.UseSetting("Platform:FitEngineWriteEnabled", write ? "true" : "false");
            builder.UseSetting("Platform:FitEngineV2Enabled", v2 ? "true" : "false");
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
}
