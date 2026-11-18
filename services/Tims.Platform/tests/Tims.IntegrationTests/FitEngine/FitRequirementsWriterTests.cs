using System.Net;
using System.Net.Http.Json;
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
/// The C#-owned fit_requirements writer, PUT /fit-engine/vacancies/{id}/requirements, against real Postgres (RLS on,
/// app_tenant) and the real host: it MERGES assessments[] (a body without the key keeps the stored array, in one
/// statement), replaces it when sent, removes it on null, inserts a profile when the vacancy has none, reports every
/// dropped or changed entry, refuses a non-empty array with no valid entry (nothing written), and keeps the TS
/// authorization (vacancy:update + the vacancy scope probe). It is mapped only with both C# FIT flags on.
/// Rows: VacFitReq / VacFitReqNew only.
/// </summary>
[Collection("FitEngine")]
public sealed class FitRequirementsWriterTests(FitEngineFixture fixture)
{
    private const string Issuer = "https://test-project.supabase.co/auth/v1";
    private const string Audience = "authenticated";

    private static readonly RSA SigningRsa = RSA.Create(2048);
    private static readonly RsaSecurityKey PrivateKey = new(SigningRsa) { KeyId = "fit-req-test-key" };

    private readonly FitEngineFixture _fixture = fixture;

    [Fact]
    public async Task Merge_ReplaceAndRemove_TheAssessmentsArray()
    {
        await ResetAsync();

        // 1. The card's save (no assessments key): v1 keys replaced, the stored array KEPT.
        var kept = await PutAsync(FitEngineFixture.VacFitReq, """{"requiredLanguages":["Spanish"]}""");
        Assert.Equal(HttpStatusCode.OK, kept.Status);
        var stored = JsonNode.Parse((await _fixture.GetFitRequirementsAsync(FitEngineFixture.VacFitReq))!)!;
        Assert.Null(stored["minYearsExperience"]); // TS parity: an absent v1 key is not stored
        Assert.Equal("Spanish", stored["requiredLanguages"]![0]!.GetValue<string>());
        Assert.Equal("lia", stored["assessments"]![0]!["instrument"]!.GetValue<string>());
        Assert.Empty(kept.Body!["issues"]!.AsArray());

        // 2. An array: replaced by its valid entries, normalized; dropped and changed entries reported.
        var replaced = await PutAsync(FitEngineFixture.VacFitReq, """
            {"minYearsExperience":2,"assessments":[
              {"instrument":"Native_Quiz","weight":3},
              {"instrument":"native-quiz"},
              {"instrument":"english","use":"scored","min":{"cefr":"b2"},"weight":5},
              {"instrument":"personality","use":"gate"},
              {"instrument":"lia","use":"gate"},
              {"instrument":"native_quiz"}]}
            """);
        Assert.Equal(HttpStatusCode.OK, replaced.Status);
        stored = JsonNode.Parse((await _fixture.GetFitRequirementsAsync(FitEngineFixture.VacFitReq))!)!;
        Assert.Equal(2, stored["minYearsExperience"]!.GetValue<double>());
        Assert.Null(stored["requiredLanguages"]);
        AssertJson(
            """[{"instrument":"native_quiz","use":"scored","min":null,"weight":3},{"instrument":"english","use":"scored","min":{"cefr":"B2"}},{"instrument":"personality","use":"advisory","min":null}]""",
            stored["assessments"]);
        Assert.Equal(
            ["1:unknown_instrument:True", "2:weight_ignored:False", "3:use_coerced_to_advisory:False", "4:invalid_minimum:True", "5:duplicate_instrument:True"],
            replaced.Body!["issues"]!.AsArray()
                .Select(i => $"{i!["index"]}:{i["code"]}:{i["dropped"]!.GetValue<bool>()}").ToArray());

        // 3. A non-empty array with nothing valid: 400, nothing written.
        var before = await _fixture.GetFitRequirementsAsync(FitEngineFixture.VacFitReq);
        var refused = await PutAsync(FitEngineFixture.VacFitReq, """{"assessments":[{"instrument":"iq"}]}""");
        Assert.Equal(HttpStatusCode.BadRequest, refused.Status);
        Assert.Equal("no_valid_assessment", refused.Body!["error"]!.GetValue<string>());
        Assert.Equal(before, await _fixture.GetFitRequirementsAsync(FitEngineFixture.VacFitReq));

        // 4. null: the array is removed (v1 scoring again).
        var removed = await PutAsync(FitEngineFixture.VacFitReq, """{"assessments":null}""");
        Assert.Equal(HttpStatusCode.OK, removed.Status);
        stored = JsonNode.Parse((await _fixture.GetFitRequirementsAsync(FitEngineFixture.VacFitReq))!)!;
        Assert.Null(stored["assessments"]);
    }

    [Fact]
    public async Task NoProfileYet_InsertsOne()
    {
        await _fixture.ExecuteScalarAsync(
            "DELETE FROM job_profiles WHERE vacancy_id = @v", ("v", FitEngineFixture.VacFitReqNew));

        var created = await PutAsync(
            FitEngineFixture.VacFitReqNew, """{"assessments":[{"instrument":"itcia","min":{"level":3}}]}""");

        Assert.Equal(HttpStatusCode.OK, created.Status);
        var stored = JsonNode.Parse((await _fixture.GetFitRequirementsAsync(FitEngineFixture.VacFitReqNew))!)!;
        AssertJson("""[{"instrument":"itcia","use":"scored","min":{"level":3}}]""", stored["assessments"]);
        Assert.Equal(FitEngineFixture.OrgA.ToString(), (await _fixture.ExecuteScalarAsync(
            "SELECT organization_id::text FROM job_profiles WHERE vacancy_id = @v", ("v", FitEngineFixture.VacFitReqNew)))!.ToString());
    }

    [Theory]
    [InlineData(FitEngineFixture.ReaderOnlySub, HttpStatusCode.Forbidden)] // fit_engine:read only, no vacancy:update
    [InlineData(FitEngineFixture.NoGrantSub, HttpStatusCode.Forbidden)]
    [InlineData(FitEngineFixture.TeamLeadSub, HttpStatusCode.NotFound)]   // vacancy:update @ team; VacFitReq has no team
    [InlineData(FitEngineFixture.OrgBAdminSub, HttpStatusCode.NotFound)]  // another organization's vacancy
    public async Task Authorization_MatchesTheTsMutation_AndWritesNothing(string sub, HttpStatusCode expected)
    {
        await ResetAsync();
        var before = await _fixture.GetFitRequirementsAsync(FitEngineFixture.VacFitReq);

        var response = await PutAsync(FitEngineFixture.VacFitReq, """{"assessments":null}""", sub);

        Assert.Equal(expected, response.Status);
        Assert.Equal(before, await _fixture.GetFitRequirementsAsync(FitEngineFixture.VacFitReq));
    }

    [Theory]
    [InlineData(true, false)]
    [InlineData(false, true)]
    public async Task RouteIsMappedOnlyWithBothFlags(bool write, bool v2)
    {
        await using var factory = Factory(write, v2);
        using var client = factory.CreateClient();
        var request = Request(FitEngineFixture.VacFitReq, "{}", FitEngineFixture.OrgAdminSub);

        var response = await client.SendAsync(request);

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        Assert.Equal(string.Empty, await response.Content.ReadAsStringAsync()); // no handler: the route is absent
    }

    // jsonb stores keys in its own order, so compare structurally.
    private static void AssertJson(string expected, JsonNode? actual) =>
        Assert.True(
            JsonNode.DeepEquals(JsonNode.Parse(expected), actual),
            $"expected {expected} got {actual?.ToJsonString()}");

    private Task ResetAsync() => _fixture.ExecuteScalarAsync(
        "UPDATE job_profiles SET fit_requirements = '{\"minYearsExperience\":3,\"assessments\":[{\"instrument\":\"lia\",\"use\":\"scored\",\"min\":{\"globalPercentile\":40}}]}' WHERE vacancy_id = @v",
        ("v", FitEngineFixture.VacFitReq));

    private async Task<(HttpStatusCode Status, JsonNode? Body)> PutAsync(
        Guid vacancyId, string json, string sub = FitEngineFixture.OrgAdminSub)
    {
        await using var factory = Factory(write: true, v2: true);
        using var client = factory.CreateClient();
        var response = await client.SendAsync(Request(vacancyId, json, sub));
        var text = await response.Content.ReadAsStringAsync();
        return (response.StatusCode, text.Length == 0 ? null : JsonNode.Parse(text));
    }

    private static HttpRequestMessage Request(Guid vacancyId, string json, string sub)
    {
        var request = new HttpRequestMessage(HttpMethod.Put, $"/fit-engine/vacancies/{vacancyId}/requirements")
        {
            Content = new StringContent(json, Encoding.UTF8, "application/json"),
        };
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
}
