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
/// POST /fit-engine/scores/review-state against real Postgres and the real host: reviewPending per fit_scores id,
/// true only for a breakdown with reviewPending: true; ids the caller cannot reach (out of the leader's scope,
/// another org, unknown) are omitted; fit_engine:read is required; the body is bounded.
/// Rows: two fit_scores rows for CandV2None on VacFitReq (pending) and VacFitReqNew (not), inserted here.
/// </summary>
[Collection("FitEngine")]
public sealed class FitReviewStateTests(FitEngineFixture fixture)
{
    private const string Issuer = "https://test-project.supabase.co/auth/v1";
    private const string Audience = "authenticated";

    private static readonly RSA SigningRsa = RSA.Create(2048);
    private static readonly RsaSecurityKey PrivateKey = new(SigningRsa) { KeyId = "fit-review-test-key" };

    private static readonly Guid Pending = Guid.Parse("f5000000-0000-0000-0000-0000000000e1");
    private static readonly Guid Clean = Guid.Parse("f5000000-0000-0000-0000-0000000000e2");

    private readonly FitEngineFixture _fixture = fixture;

    [Theory]
    [InlineData(FitEngineFixture.OrgAdminSub, "e1:True,e2:False")]
    [InlineData(FitEngineFixture.ReaderOnlySub, "e1:True,e2:False")]
    [InlineData(FitEngineFixture.TeamLeadSub, "")]  // both vacancies are outside the leader's team
    [InlineData(FitEngineFixture.OrgBAdminSub, "")] // another organization's rows
    public async Task ReturnsTheMarker_OnlyForReachableRows(string sub, string expected)
    {
        await SeedAsync();
        var unknown = Guid.NewGuid();

        var (status, body) = await PostAsync($$"""{"fitScoreIds":["{{Pending}}","{{Clean}}","{{unknown}}"]}""", sub);

        Assert.Equal(HttpStatusCode.OK, status);
        var items = body!["items"]!.AsArray()
            .Select(i => $"{i!["fitScoreId"]!.GetValue<string>()[^2..]}:{i["reviewPending"]!.GetValue<bool>()}")
            .Order(StringComparer.Ordinal);
        Assert.Equal(expected, string.Join(",", items));
    }

    [Fact]
    public async Task NoGrant_Is403()
    {
        var (status, _) = await PostAsync($$"""{"fitScoreIds":["{{Pending}}"]}""", FitEngineFixture.NoGrantSub);
        Assert.Equal(HttpStatusCode.Forbidden, status);
    }

    [Theory]
    [InlineData("""{"fitScoreIds":[]}""")]
    [InlineData("""{"fitScoreIds":["not-a-uuid"]}""")]
    [InlineData("""{}""")]
    public async Task BadBodies_Are400(string json)
    {
        var (status, _) = await PostAsync(json, FitEngineFixture.OrgAdminSub);
        Assert.Equal(HttpStatusCode.BadRequest, status);
    }

    [Fact]
    public async Task MoreThan100Ids_Is400()
    {
        var ids = string.Join(",", Enumerable.Range(0, 101).Select(_ => $"\"{Guid.NewGuid()}\""));
        var (status, _) = await PostAsync($$"""{"fitScoreIds":[{{ids}}]}""", FitEngineFixture.OrgAdminSub);
        Assert.Equal(HttpStatusCode.BadRequest, status);
    }

    private async Task SeedAsync()
    {
        const string sql =
            "INSERT INTO fit_scores (id, organization_id, candidate_id, vacancy_id, overall_score, breakdown, weights, "
            + "is_partial, calculated_at, created_at, updated_at) VALUES "
            + "(@p, '11111111-1111-1111-1111-111111111111', @c, @v1, 70, '{\"fitVersion\":2,\"reviewPending\":true}', '{}', true, now(), now(), now()), "
            + "(@k, '11111111-1111-1111-1111-111111111111', @c, @v2, 80, '{\"fitVersion\":2,\"reviewPending\":false}', '{}', false, now(), now(), now()) "
            + "ON CONFLICT (id) DO NOTHING";
        await _fixture.ExecuteScalarAsync(
            sql, ("p", Pending), ("k", Clean), ("c", FitEngineFixture.CandV2None),
            ("v1", FitEngineFixture.VacFitReq), ("v2", FitEngineFixture.VacFitReqNew));
    }

    private async Task<(HttpStatusCode Status, JsonNode? Body)> PostAsync(string json, string sub)
    {
        await using var factory = Factory();
        using var client = factory.CreateClient();
        var request = new HttpRequestMessage(HttpMethod.Post, "/fit-engine/scores/review-state")
        {
            Content = new StringContent(json, Encoding.UTF8, "application/json"),
        };
        request.Headers.Add("Authorization", $"Bearer {Mint(sub)}");
        var response = await client.SendAsync(request);
        var text = await response.Content.ReadAsStringAsync();
        return (response.StatusCode, text.Length == 0 ? null : JsonNode.Parse(text));
    }

    private WebApplicationFactory<Program> Factory() =>
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
