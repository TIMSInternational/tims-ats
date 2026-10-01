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

namespace Tims.IntegrationTests.CandidateConsent;

/// <summary>
/// GET /tenant/data-subject-requests over the real host + RLS-forced Postgres: candidate:update + org scope, the
/// optional closed-set status filter (parsed after the gate), tenant isolation, ordering and the dueAt value.
/// </summary>
[Collection("CandidateConsent")]
public sealed class DataSubjectRequestListTests(CandidateConsentFixture fixture)
{
    private const string Issuer = "https://test-project.supabase.co/auth/v1";
    private const string Audience = "authenticated";
    private const string List = "/tenant/data-subject-requests";

    private static readonly RSA SigningRsa = RSA.Create(2048);
    private static readonly RsaSecurityKey PrivateKey = new(SigningRsa) { KeyId = "dsr-list-test-key" };

    private readonly CandidateConsentFixture _fixture = fixture;

    private WebApplicationFactory<Program> Factory(bool enabled = true) =>
        new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.UseSetting("Platform:DatabaseConnectionString", _fixture.ConnectionString);
            builder.UseSetting("Platform:CandidateConsentEnabled", enabled ? "true" : "false");
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

    private async Task<(HttpStatusCode Status, JsonElement Body)> Get(string path, string? sub, bool enabled = true)
    {
        await using var factory = Factory(enabled);
        using var client = factory.CreateClient();
        using var request = new HttpRequestMessage(HttpMethod.Get, path);
        if (sub is not null)
        {
            request.Headers.Add("Authorization", $"Bearer {Mint(sub)}");
        }

        using var response = await client.SendAsync(request);
        var text = await response.Content.ReadAsStringAsync();
        var body = text.Length > 0 && text.TrimStart().StartsWith('{')
            ? JsonDocument.Parse(text).RootElement.Clone()
            : default;
        return (response.StatusCode, body);
    }

    private static JsonElement[] Items(JsonElement body) => body.GetProperty("items").EnumerateArray().ToArray();

    [Fact]
    public async Task Pending_ReturnsOnlyPending_WithCandidateName_AndDueAt()
    {
        var (status, body) = await Get(List + "?status=pending", CandidateConsentFixture.AdminSub);
        Assert.Equal(HttpStatusCode.OK, status);
        var items = Items(body);
        Assert.All(items, i => Assert.Equal("pending", i.GetProperty("status").GetString()));
        Assert.DoesNotContain(items, i => i.GetProperty("id").GetString() == CandidateConsentFixture.ListedCompletedRequest.ToString());

        var seeded = Assert.Single(items, i => i.GetProperty("id").GetString() == CandidateConsentFixture.ListedPendingRequest.ToString());
        Assert.Equal(
            ["candidateFirstName", "candidateId", "candidateLastName", "createdAt", "dueAt", "id", "requestType", "source", "status"],
            seeded.EnumerateObject().Select(p => p.Name).Order(StringComparer.Ordinal).ToArray());
        Assert.Equal(CandidateConsentFixture.Listed.ToString(), seeded.GetProperty("candidateId").GetString());
        Assert.Equal("Lina", seeded.GetProperty("candidateFirstName").GetString());
        Assert.Equal("Lista", seeded.GetProperty("candidateLastName").GetString());
        Assert.Equal("deletion", seeded.GetProperty("requestType").GetString());
        Assert.Equal("candidate_portal", seeded.GetProperty("source").GetString());
        Assert.Equal("2026-10-01T15:30:00.000Z", seeded.GetProperty("createdAt").GetString());
        // Thu 1 Oct 2026 + 15 business days (weekends skipped, holidays not) = Thu 22 Oct, same time of day.
        Assert.Equal("2026-10-22T15:30:00.000Z", seeded.GetProperty("dueAt").GetString());
    }

    [Fact]
    public async Task NoFilter_IncludesEveryStatus_OldestFirst_AndNeverAnotherOrg()
    {
        var (status, body) = await Get(List, CandidateConsentFixture.AdminSub);
        Assert.Equal(HttpStatusCode.OK, status);
        var items = Items(body);
        var ids = items.Select(i => i.GetProperty("id").GetString()).ToArray();
        Assert.Contains(CandidateConsentFixture.ListedCompletedRequest.ToString(), ids);
        Assert.Contains(CandidateConsentFixture.ListedPendingRequest.ToString(), ids);
        Assert.DoesNotContain(CandidateConsentFixture.OrgBPendingRequest.ToString(), ids);
        var created = items.Select(i => i.GetProperty("createdAt").GetString()!).ToArray();
        Assert.Equal(created.Order(StringComparer.Ordinal).ToArray(), created);
    }

    [Fact]
    public async Task OtherOrgAdmin_SeesOnlyItsOwnOrg()
    {
        var (status, body) = await Get(List, CandidateConsentFixture.OrgBAdminSub);
        Assert.Equal(HttpStatusCode.OK, status);
        var ids = Items(body).Select(i => i.GetProperty("id").GetString()).ToArray();
        Assert.Contains(CandidateConsentFixture.OrgBPendingRequest.ToString(), ids);
        Assert.DoesNotContain(CandidateConsentFixture.ListedPendingRequest.ToString(), ids);
        Assert.DoesNotContain(CandidateConsentFixture.ListedCompletedRequest.ToString(), ids);
    }

    [Theory]
    [InlineData(null, HttpStatusCode.Unauthorized)]
    [InlineData(CandidateConsentFixture.ReadOnlySub, HttpStatusCode.Forbidden)] // candidate:read only
    [InlineData(CandidateConsentFixture.NarrowSub, HttpStatusCode.Forbidden)]   // team scope
    public async Task Unauthenticated_NoPermission_NarrowScope(string? sub, HttpStatusCode expected)
    {
        var (status, _) = await Get(List, sub);
        Assert.Equal(expected, status);
    }

    [Theory]
    [InlineData("?status=open")]
    [InlineData("?status=Pending")]
    public async Task UnknownStatus_Is400_ButOnlyAfterTheGate(string query)
    {
        Assert.Equal(HttpStatusCode.BadRequest, (await Get(List + query, CandidateConsentFixture.AdminSub)).Status);
        Assert.Equal(HttpStatusCode.Unauthorized, (await Get(List + query, null)).Status);
        Assert.Equal(HttpStatusCode.Forbidden, (await Get(List + query, CandidateConsentFixture.ReadOnlySub)).Status);
    }

    [Fact]
    public async Task DarkFlag_IsNotMapped() =>
        Assert.Equal(HttpStatusCode.NotFound, (await Get(List, CandidateConsentFixture.AdminSub, enabled: false)).Status);
}
