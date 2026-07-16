using System.Net;
using System.Security.Claims;
using System.Security.Cryptography;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;
using StackExchange.Redis;

namespace Tims.IntegrationTests.RateLimiting;

/// <summary>
/// LIVE cross-stack rate-limit-key proof (Codex High#1/#2 + opus M1). Boots the REAL host with the
/// Supabase JWT scheme, the seeded identity/api-key Postgres, and a live Redis, drives requests
/// through the actual pipeline (UseAuthentication → PrincipalResolutionMiddleware → RateLimitMiddleware),
/// and inspects the EXACT Redis bucket keys — the value a TS <c>@upstash/ratelimit</c> reader would
/// also see. Proves the LIVE identifier matches TS:
///   • JWT staff → keyed on the TIMS <c>users.id</c>, NOT the Supabase <c>sub</c> (regression bite);
///   • AI-category staff → <c>org:{orgId}</c>;
///   • external API key → a per-key <c>apikey:{id}</c> bucket (enforced post-auth);
///   • anonymous → <c>ip:{last-xff-hop}</c>.
/// </summary>
[Collection(IdentityRedisCollection.Name)]
public sealed class LiveRateLimitKeyTests(IdentitySchemaFixture identity, RedisRateLimitFixture redis)
{
    private const string Issuer = "https://test-project.supabase.co/auth/v1";
    private const string Audience = "authenticated";

    private static readonly RSA SigningRsa = RSA.Create(2048);
    private static readonly RsaSecurityKey PrivateKey = new(SigningRsa) { KeyId = "test-key-1" };

    private readonly IdentitySchemaFixture _identity = identity;
    private readonly IConnectionMultiplexer _redis = redis.Connection;
    private readonly string _redisConnectionString = redis.ConnectionString;

    // A host on the identity DB (staff/ai/anon) with JWT + Redis wired.
    private WebApplicationFactory<Program> IdentityHost() => Host(_identity.IdentityConnectionString);

    // A host on the api-key DB (external-whoami) with Redis wired.
    private WebApplicationFactory<Program> ApiKeyHost() => Host(_identity.ApiKeyConnectionString);

    private WebApplicationFactory<Program> Host(string databaseConnectionString) =>
        new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.UseSetting("Platform:DatabaseConnectionString", databaseConnectionString);
            builder.UseSetting("Platform:RedisConnectionString", _redisConnectionString);
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

    // Count Redis keys matching a glob pattern (bucket-agnostic: the live host uses the wall clock,
    // so we assert on the {category}:{identifier} shape across any window).
    private int KeysMatching(string pattern)
    {
        var server = _redis.GetServer(_redis.GetEndPoints()[0]);
        return server.Keys(pattern: pattern).Count();
    }

    // ---- JWT staff → keyed on the TIMS users.id, NEVER the Supabase `sub` --------------------
    [Fact]
    public async Task StaffJwt_KeysOnTimsUserId_NotSupabaseSub()
    {
        await using var factory = IdentityHost();
        using var client = factory.CreateClient();

        var request = new HttpRequestMessage(HttpMethod.Get, "/candidate/list");
        request.Headers.Add("Authorization", $"Bearer {Mint(IdentityFixture.ActiveStaffSub)}");
        await client.SendAsync(request);

        var userId = IdentityFixture.ActiveStaffUserId.ToString();
        // The bucket is keyed on the resolved TIMS users.id (TS `ctx.user.id`)...
        Assert.True(KeysMatching($"tims:ratelimit:query:{userId}:*") >= 1, "expected a bucket keyed on the TIMS users.id");
        // ...and NEVER on the raw Supabase `sub` — a regression that keyed on `sub` makes this bite.
        Assert.Equal(0, KeysMatching($"tims:ratelimit:query:{IdentityFixture.ActiveStaffSub}:*"));
    }

    // ---- AI-category staff → org:{orgId} (cost-controlled per org) ----------------------------
    [Fact]
    public async Task StaffJwt_AiCategory_KeysOnOrg()
    {
        await using var factory = IdentityHost();
        using var client = factory.CreateClient();

        // "generate" is an AI keyword → ai category.
        var request = new HttpRequestMessage(HttpMethod.Get, "/generate/report");
        request.Headers.Add("Authorization", $"Bearer {Mint(IdentityFixture.ActiveStaffSub)}");
        await client.SendAsync(request);

        var orgId = IdentityFixture.OrgA.ToString();
        Assert.True(KeysMatching($"tims:ratelimit:ai:org:{orgId}:*") >= 1, "expected an AI bucket keyed on org:{orgId}");
        // AI is NOT keyed per-user, and never on the raw `sub`.
        Assert.Equal(0, KeysMatching($"tims:ratelimit:ai:{IdentityFixture.ActiveStaffUserId}:*"));
        Assert.Equal(0, KeysMatching($"tims:ratelimit:ai:{IdentityFixture.ActiveStaffSub}:*"));
    }

    // ---- Anonymous → ip:{last-xff-hop} (never the client-controlled first hop) ---------------
    [Fact]
    public async Task Anonymous_KeysOnLastXffHop()
    {
        await using var factory = IdentityHost();
        using var client = factory.CreateClient();

        var request = new HttpRequestMessage(HttpMethod.Get, "/candidate/list");
        // Two hops: the trusted proxy appends the LAST; the client-spoofable first must be ignored.
        request.Headers.Add("x-forwarded-for", "203.0.113.9, 198.51.100.23");
        await client.SendAsync(request);

        Assert.True(KeysMatching("tims:ratelimit:query:ip:198.51.100.23:*") >= 1, "expected a bucket keyed on the last XFF hop");
        Assert.Equal(0, KeysMatching("tims:ratelimit:query:ip:203.0.113.9:*")); // never the first (spoofable) hop
    }

    // ---- External API key → per-key apikey:{id} bucket, enforced AFTER auth ------------------
    [Fact]
    public async Task ExternalApiKey_KeysPerKey_AfterAuth()
    {
        await using var factory = ApiKeyHost();
        using var client = factory.CreateClient();

        var request = new HttpRequestMessage(HttpMethod.Get, "/external-whoami");
        request.Headers.Add("Authorization", $"Bearer {ApiKeyFixture.ValidToken}");
        var response = await client.SendAsync(request);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode); // auth still succeeds; per-key limit not exhausted
        var keyId = ApiKeyFixture.ValidKeyId.ToString();
        Assert.True(KeysMatching($"tims:ratelimit:query:apikey:{keyId}:*") >= 1, "expected a per-key apikey:{id} bucket");
    }
}
