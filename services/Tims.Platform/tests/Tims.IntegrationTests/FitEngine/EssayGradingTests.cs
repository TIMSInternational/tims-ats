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
using Tims.Domain.FitEngine;
using Tims.Infrastructure.FitEngine;

namespace Tims.IntegrationTests.FitEngine;

/// <summary>
/// Owner default D5: minimal essay grading against real Postgres (RLS on) and the real host. Lists the pending essays;
/// a grade writes the response, removes the essay from pendingManual, records the grader and recomputes the scores
/// (TS computeResult); a second grade of the same essay is 409, also when two arrive at once (row lock); out-of-range
/// points are 400; once nothing is pending the FIT v2 adapter reads the result as valid. Authorization:
/// assessment:read / assessment:update plus the assignment's vacancy scope. Mapped only with the v2 flag.
/// Rows: AsgGrade on VacFitReq (reset by every test).
/// </summary>
[Collection("FitEngine")]
public sealed class EssayGradingTests(FitEngineFixture fixture)
{
    private const string Issuer = "https://test-project.supabase.co/auth/v1";
    private const string Audience = "authenticated";

    private static readonly RSA SigningRsa = RSA.Create(2048);
    private static readonly RsaSecurityKey PrivateKey = new(SigningRsa) { KeyId = "essay-grading-test-key" };

    private readonly FitEngineFixture _fixture = fixture;

    [Fact]
    public async Task Grading_BothEssays_CompletesTheResult_AndFitV2ReadsItAsValid()
    {
        await _fixture.ResetGradingAsync();

        var (listStatus, list) = await SendAsync(HttpMethod.Get, $"/fit-engine/assignments/{FitEngineFixture.AsgGrade}/essays");
        Assert.Equal(HttpStatusCode.OK, listStatus);
        Assert.Equal(
            ["Explain A:Answer A:2", "Explain B:Answer B:3"],
            list!["essays"]!.AsArray().Select(e => $"{e!["prompt"]}:{e["answer"]}:{e["maxPoints"]}").ToArray());

        var (first, firstBody) = await GradeAsync(FitEngineFixture.QEssay2, "1");
        Assert.Equal(HttpStatusCode.OK, first);
        Assert.Equal(1, firstBody!["remainingPending"]!.GetValue<int>());
        Assert.Equal(200.0 / 3, firstBody["normalizedScore"]!.GetValue<double>(), 6); // (1 + 1) / (1 + 2)

        Assert.Equal(HttpStatusCode.Conflict, (await GradeAsync(FitEngineFixture.QEssay2, "2")).Status);
        Assert.Equal(HttpStatusCode.BadRequest, (await GradeAsync(FitEngineFixture.QEssay3, "4")).Status);
        Assert.Equal(HttpStatusCode.BadRequest, (await GradeAsync(FitEngineFixture.QEssay3, "-1")).Status);

        var (last, lastBody) = await GradeAsync(FitEngineFixture.QEssay3, "3");
        Assert.Equal(HttpStatusCode.OK, last);
        Assert.Equal(0, lastBody!["remainingPending"]!.GetValue<int>());
        Assert.Equal(500.0 / 6, lastBody["normalizedScore"]!.GetValue<double>(), 6); // (1 + 1 + 3) / 6

        var breakdown = JsonNode.Parse((string)(await _fixture.ExecuteScalarAsync(
            "SELECT breakdown::text FROM assessment_results WHERE assignment_id = @a", ("a", FitEngineFixture.AsgGrade)))!)!;
        Assert.Empty(breakdown["pendingManual"]!.AsArray());
        Assert.Equal(
            FitEngineFixture.OrgAdminId.ToString(),
            breakdown["manualGrades"]![FitEngineFixture.QEssay3.ToString()]!["gradedBy"]!.GetValue<string>());

        await using var db = _fixture.NewWriteContext();
        var results = await new AtsAssessmentResultSource(db).GetResultsAsync(
            FitEngineFixture.OrgA, FitEngineFixture.CandV2None, FitEngineFixture.VacFitReq, CancellationToken.None);
        Assert.Equal(ResultIntegrity.Valid, Assert.Single(results).Integrity);
    }

    [Fact]
    public async Task TwoGradesOfTheSameEssayAtOnce_ExactlyOneLands()
    {
        await _fixture.ResetGradingAsync();

        var attempts = await Task.WhenAll(Enumerable.Range(0, 4).Select(i => GradeAsync(FitEngineFixture.QEssay2, $"{i % 3}")));

        Assert.Single(attempts, a => a.Status == HttpStatusCode.OK);
        Assert.Equal(3, attempts.Count(a => a.Status == HttpStatusCode.Conflict));
        var pending = (string)(await _fixture.ExecuteScalarAsync(
            "SELECT (breakdown -> 'pendingManual')::text FROM assessment_results WHERE assignment_id = @a",
            ("a", FitEngineFixture.AsgGrade)))!;
        Assert.Equal($"[\"{FitEngineFixture.QEssay3}\"]", pending);
    }

    [Theory]
    [InlineData(FitEngineFixture.ReaderOnlySub, HttpStatusCode.Forbidden)] // no assessment grant
    [InlineData(FitEngineFixture.TeamLeadSub, HttpStatusCode.NotFound)]   // assessment:update @ team; vacancy has no team
    [InlineData(FitEngineFixture.OrgBAdminSub, HttpStatusCode.Forbidden)] // OrgB holds no assessment grant
    public async Task Authorization(string sub, HttpStatusCode expected)
    {
        await _fixture.ResetGradingAsync();

        Assert.Equal(expected, (await GradeAsync(FitEngineFixture.QEssay2, "1", sub)).Status);
        Assert.Equal(expected, (await SendAsync(HttpMethod.Get, $"/fit-engine/assignments/{FitEngineFixture.AsgGrade}/essays", null, sub)).Status);
    }

    [Fact]
    public async Task WithoutTheV2Flag_TheRoutesAreAbsent()
    {
        await using var factory = Factory(v2: false);
        using var client = factory.CreateClient();
        var request = new HttpRequestMessage(HttpMethod.Get, $"/fit-engine/assignments/{FitEngineFixture.AsgGrade}/essays");
        request.Headers.Add("Authorization", $"Bearer {Mint(FitEngineFixture.OrgAdminSub)}");

        var response = await client.SendAsync(request);

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        Assert.Equal(string.Empty, await response.Content.ReadAsStringAsync());
    }

    private Task<(HttpStatusCode Status, JsonNode? Body)> GradeAsync(
        Guid questionId, string points, string sub = FitEngineFixture.OrgAdminSub) =>
        SendAsync(
            HttpMethod.Post, $"/fit-engine/assignments/{FitEngineFixture.AsgGrade}/essays/{questionId}/grade",
            $$"""{"points":{{points}}}""", sub);

    private async Task<(HttpStatusCode Status, JsonNode? Body)> SendAsync(
        HttpMethod method, string path, string? json = null, string sub = FitEngineFixture.OrgAdminSub)
    {
        await using var factory = Factory();
        using var client = factory.CreateClient();
        var request = new HttpRequestMessage(method, path);
        if (json is not null)
        {
            request.Content = new StringContent(json, Encoding.UTF8, "application/json");
        }

        request.Headers.Add("Authorization", $"Bearer {Mint(sub)}");
        var response = await client.SendAsync(request);
        var text = await response.Content.ReadAsStringAsync();
        return (response.StatusCode, text.Length == 0 ? null : JsonNode.Parse(text));
    }

    private WebApplicationFactory<Program> Factory(bool v2 = true) =>
        new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.UseSetting("Platform:DatabaseConnectionString", _fixture.ConnectionString);
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
