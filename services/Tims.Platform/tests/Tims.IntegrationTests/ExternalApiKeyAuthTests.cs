using System.Net;
using Microsoft.AspNetCore.Mvc.Testing;
using Tims.Application.Identity;
using Tims.Domain.Identity;
using Tims.Infrastructure.Identity;

namespace Tims.IntegrationTests;

/// <summary>
/// WP2.3 acceptance (real Postgres). Two layers over the same seeded container:
///   (A) drives <see cref="ApiKeyResolver"/> directly through the EF-backed
///       <see cref="ApiKeyRepository"/> — proving the fail-closed active-key + suspended-org logic
///       and scope parsing; and
///   (B) boots the real host (WebApplicationFactory) and hits /external-whoami through the actual
///       <c>ApiKey</c> AuthenticationHandler — proving a valid key → 200 and every rejected
///       condition → 401.
/// Read-only over the Prisma-owned tables; no writes, no RLS scope.
/// </summary>
public sealed class ExternalApiKeyAuthTests(ApiKeyFixture fixture) : IClassFixture<ApiKeyFixture>
{
    private static string Bearer(string token) => $"Bearer {token}";

    private ApiKeyResolver NewResolver(IdentityDbContext db) => new(new ApiKeyRepository(db));

    private async Task<TenantContext?> Resolve(string? header)
    {
        await using var db = new IdentityDbContext(ApiKeyFixture.BuildOptions(fixture.ConnectionString));
        return await NewResolver(db).ResolveAsync(header, DateTime.UtcNow, CancellationToken.None);
    }

    // ============================ (A) Resolver-level =================================

    [Fact]
    public async Task ValidActiveKey_ResolvesToExternalApiKey_WithParsedScopes()
    {
        var ctx = await Resolve(Bearer(ApiKeyFixture.ValidToken));

        Assert.NotNull(ctx);
        Assert.Equal(PrincipalType.ExternalApiKey, ctx.PrincipalType);
        Assert.Equal(ApiKeyFixture.ActiveOrg.ToString(), ctx.OrganizationId);
        Assert.Equal(ApiKeyFixture.ValidKeyId.ToString(), ctx.UserId);
        Assert.Equal(new[] { "external" }, ctx.Roles);
        Assert.Equal(ApiKeyFixture.ValidScopes, ctx.ApiKeyScopes);
    }

    [Fact]
    public async Task EmptyScopeKey_Resolves_WithEmptyScopes()
    {
        var ctx = await Resolve(Bearer(ApiKeyFixture.EmptyScopeToken));

        Assert.NotNull(ctx);
        Assert.Equal(ApiKeyFixture.EmptyScopeKeyId.ToString(), ctx.UserId);
        Assert.NotNull(ctx.ApiKeyScopes);
        Assert.Empty(ctx.ApiKeyScopes);
    }

    [Fact]
    public async Task RevokedKey_FailsClosed() =>
        Assert.Null(await Resolve(Bearer(ApiKeyFixture.RevokedToken)));

    [Fact]
    public async Task ExpiredKey_FailsClosed() =>
        Assert.Null(await Resolve(Bearer(ApiKeyFixture.ExpiredToken)));

    [Fact]
    public async Task KeyOnSuspendedOrg_FailsClosed() =>
        Assert.Null(await Resolve(Bearer(ApiKeyFixture.SuspendedOrgToken)));

    [Fact]
    public async Task KeyOnSoftDeletedOrg_FailsClosed() =>
        Assert.Null(await Resolve(Bearer(ApiKeyFixture.DeletedOrgToken)));

    [Fact]
    public async Task MalformedScopes_FailClosed() =>
        Assert.Null(await Resolve(Bearer(ApiKeyFixture.MalformedScopeToken)));

    [Fact]
    public async Task UnknownHash_FailsClosed() =>
        Assert.Null(await Resolve(Bearer(ApiKeyFixture.UnknownToken)));

    [Theory]
    [InlineData(null)] // no header
    [InlineData("")] // empty header
    [InlineData("Basic abc")] // wrong scheme
    [InlineData("Bearer   ")] // scheme, empty token
    public async Task MissingOrMalformedHeader_FailsClosed(string? header) =>
        Assert.Null(await Resolve(header));

    // ============================ (B) HTTP /external-whoami ==========================

    private WebApplicationFactory<Program> Factory() =>
        new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
            builder.UseSetting("Platform:DatabaseConnectionString", fixture.ConnectionString));

    private static async Task<HttpResponseMessage> ExternalWhoAmI(HttpClient client, string? token)
    {
        var request = new HttpRequestMessage(HttpMethod.Get, "/external-whoami");
        if (token is not null)
        {
            request.Headers.Add("Authorization", Bearer(token));
        }

        return await client.SendAsync(request);
    }

    [Fact]
    public async Task ValidKey_Returns200_WithOrgAndScopes()
    {
        await using var factory = Factory();
        using var client = factory.CreateClient();

        var response = await ExternalWhoAmI(client, ApiKeyFixture.ValidToken);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        Assert.Contains(ApiKeyFixture.ActiveOrg.ToString(), body);
        Assert.Contains("read:candidates", body);
        Assert.Contains("read:validations", body);
    }

    [Fact]
    public async Task NoToken_Is401()
    {
        await using var factory = Factory();
        using var client = factory.CreateClient();
        Assert.Equal(HttpStatusCode.Unauthorized, (await ExternalWhoAmI(client, token: null)).StatusCode);
    }

    [Theory]
    [InlineData(ApiKeyFixture.RevokedToken)]
    [InlineData(ApiKeyFixture.ExpiredToken)]
    [InlineData(ApiKeyFixture.SuspendedOrgToken)]
    [InlineData(ApiKeyFixture.DeletedOrgToken)]
    [InlineData(ApiKeyFixture.MalformedScopeToken)]
    [InlineData(ApiKeyFixture.UnknownToken)]
    public async Task RejectedCredential_Is401(string token)
    {
        await using var factory = Factory();
        using var client = factory.CreateClient();
        Assert.Equal(HttpStatusCode.Unauthorized, (await ExternalWhoAmI(client, token)).StatusCode);
    }

    [Fact]
    public async Task WrongScheme_Is401()
    {
        // A Basic credential (not a Bearer) must not authenticate the ApiKey scheme.
        await using var factory = Factory();
        using var client = factory.CreateClient();

        var request = new HttpRequestMessage(HttpMethod.Get, "/external-whoami");
        request.Headers.Add("Authorization", "Basic dGltczphYmM=");
        var response = await client.SendAsync(request);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    // ============================ Cross-scheme isolation =============================
    // The two schemes are strictly isolated: a credential valid for one endpoint must be
    // rejected by the other. These are non-vacuous — the same ValidToken returns 200 on
    // /external-whoami (above), yet 401 on the JWT-only /whoami.

    [Fact]
    public async Task ValidApiKey_On_JwtWhoami_Is401()
    {
        await using var factory = Factory();
        using var client = factory.CreateClient();

        var request = new HttpRequestMessage(HttpMethod.Get, "/whoami");
        request.Headers.Add("Authorization", Bearer(ApiKeyFixture.ValidToken));
        var response = await client.SendAsync(request);

        // /whoami runs the default JWT scheme only; a tims_ key is not a valid JWT → 401.
        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task JwtShapedBearer_On_ExternalWhoami_Is401()
    {
        await using var factory = Factory();
        using var client = factory.CreateClient();

        // A JWT-shaped bearer presented to the ApiKey-only endpoint hashes to no api_keys row
        // (real DB path) → NoResult → 401. The ApiKey scheme never accepts a non-key bearer.
        const string jwtShaped = "eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJhdHRhY2tlciJ9.c2ln";
        var response = await ExternalWhoAmI(client, jwtShaped);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }
}
