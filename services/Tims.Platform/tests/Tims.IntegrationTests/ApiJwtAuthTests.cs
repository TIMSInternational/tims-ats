using System.Net;
using System.Security.Claims;
using System.Security.Cryptography;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Protocols.OpenIdConnect;
using Microsoft.IdentityModel.Tokens;

namespace Tims.IntegrationTests;

/// <summary>
/// WP2.1 acceptance: boots the real host with the Supabase JWT scheme and proves it validates
/// issuer, audience, lifetime, AND signature against a locally-minted test JWKS. A valid token
/// authenticates /whoami; a tampered / expired / wrong-audience / wrong-issuer / unsigned-by-a-
/// different-key token, and no token at all, are all rejected (401) — fail-closed.
/// </summary>
public sealed class ApiJwtAuthTests
{
    private const string Issuer = "https://test-project.supabase.co/auth/v1";
    private const string Audience = "authenticated";
    private const string Sub = "11111111-2222-3333-4444-555555555555";

    private static readonly RSA SigningRsa = RSA.Create(2048);
    private static readonly RsaSecurityKey PrivateKey = new(SigningRsa) { KeyId = "test-key-1" };

    // A DIFFERENT key the server does NOT trust — used to prove a well-formed token signed by
    // an unknown key is rejected (signature/JWKS validation actually runs).
    private static readonly RsaSecurityKey UntrustedKey = new(RSA.Create(2048)) { KeyId = "attacker-key" };

    // Supabase signs end-user JWTs with ES256 (EC P-256) by default — this exercises that path.
    private static readonly ECDsa SigningEc = ECDsa.Create(ECCurve.NamedCurves.nistP256);
    private static readonly ECDsaSecurityKey EcPrivateKey = new(SigningEc) { KeyId = "test-ec-key-1" };

    private static WebApplicationFactory<Program> Factory() =>
        new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.UseSetting("Platform:DatabaseConnectionString", "Host=localhost;Port=5432;Database=x;Username=x");
            builder.UseSetting("Platform:SupabaseJwtIssuer", Issuer);
            builder.UseSetting("Platform:SupabaseJwtAudience", Audience);

            // Publish the test signing key as a JWKS entry (JsonWebKey) fed into validation —
            // no network metadata fetch, but the real kid-matched JWKS signature path runs.
            var publicJwk = JsonWebKeyConverter.ConvertFromRSASecurityKey(
                new RsaSecurityKey(SigningRsa.ExportParameters(false)) { KeyId = PrivateKey.KeyId });
            builder.ConfigureTestServices(services =>
                services.PostConfigure<JwtBearerOptions>(JwtBearerDefaults.AuthenticationScheme, options =>
                {
                    options.RequireHttpsMetadata = false;
                    options.TokenValidationParameters.IssuerSigningKeys = [publicJwk];
                }));
        });

    private static string Mint(
        SecurityKey signingKey,
        string issuer = Issuer,
        string audience = Audience,
        DateTime? expires = null)
    {
        var descriptor = new SecurityTokenDescriptor
        {
            Issuer = issuer,
            Audience = audience,
            Subject = new ClaimsIdentity([new Claim("sub", Sub)]),
            Expires = expires ?? DateTime.UtcNow.AddMinutes(10),
            SigningCredentials = new SigningCredentials(signingKey, SecurityAlgorithms.RsaSha256),
        };
        return new JsonWebTokenHandler().CreateToken(descriptor);
    }

    private static async Task<HttpStatusCode> WhoAmI(HttpClient client, string? token)
    {
        var request = new HttpRequestMessage(HttpMethod.Get, "/whoami");
        if (token is not null) request.Headers.Add("Authorization", $"Bearer {token}");
        var response = await client.SendAsync(request);
        return response.StatusCode;
    }

    [Fact]
    public async Task Valid_token_authenticates_and_echoes_sub()
    {
        await using var factory = Factory();
        using var client = factory.CreateClient();

        var response = await client.SendAsync(Authorized("/whoami", Mint(PrivateKey)));
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        Assert.Contains(Sub, body);
    }

    [Fact]
    public async Task Es256_token_authenticates_supabase_asymmetric_default()
    {
        // Supabase signs end-user JWTs with ES256 (EC), not RS256 — so ValidAlgorithms MUST include
        // ES256 or every real token 401s. Bite: reverting Program.cs to [RS256]-only makes this RED.
        // The EC public key is published as the trusted signing key (mirrors the Supabase ES256 JWKS).
        var ecPublic = new ECDsaSecurityKey(ECDsa.Create(SigningEc.ExportParameters(false)))
        {
            KeyId = EcPrivateKey.KeyId,
        };
        await using var factory = new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.UseSetting("Platform:DatabaseConnectionString", "Host=localhost;Port=5432;Database=x;Username=x");
            builder.UseSetting("Platform:SupabaseJwtIssuer", Issuer);
            builder.UseSetting("Platform:SupabaseJwtAudience", Audience);
            builder.ConfigureTestServices(services =>
                services.PostConfigure<JwtBearerOptions>(JwtBearerDefaults.AuthenticationScheme, options =>
                {
                    options.RequireHttpsMetadata = false;
                    options.TokenValidationParameters.IssuerSigningKeys = [ecPublic];
                }));
        });
        using var client = factory.CreateClient();

        var es256 = new JsonWebTokenHandler().CreateToken(new SecurityTokenDescriptor
        {
            Issuer = Issuer,
            Audience = Audience,
            Subject = new ClaimsIdentity([new Claim("sub", Sub)]),
            Expires = DateTime.UtcNow.AddMinutes(10),
            SigningCredentials = new SigningCredentials(EcPrivateKey, SecurityAlgorithms.EcdsaSha256),
        });

        var response = await client.SendAsync(Authorized("/whoami", es256));
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Contains(Sub, await response.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task No_token_is_401()
    {
        await using var factory = Factory();
        using var client = factory.CreateClient();
        Assert.Equal(HttpStatusCode.Unauthorized, await WhoAmI(client, token: null));
    }

    [Fact]
    public async Task Tampered_signature_is_401()
    {
        await using var factory = Factory();
        using var client = factory.CreateClient();

        var token = Mint(PrivateKey);
        var tampered = token[..^3] + (token[^1] == 'A' ? "BBB" : "AAA");
        Assert.Equal(HttpStatusCode.Unauthorized, await WhoAmI(client, tampered));
    }

    [Fact]
    public async Task Token_signed_by_untrusted_key_is_401()
    {
        await using var factory = Factory();
        using var client = factory.CreateClient();
        Assert.Equal(HttpStatusCode.Unauthorized, await WhoAmI(client, Mint(UntrustedKey)));
    }

    [Fact]
    public async Task Expired_token_is_401()
    {
        await using var factory = Factory();
        using var client = factory.CreateClient();
        Assert.Equal(HttpStatusCode.Unauthorized,
            await WhoAmI(client, Mint(PrivateKey, expires: DateTime.UtcNow.AddMinutes(-5))));
    }

    [Fact]
    public async Task Wrong_audience_is_401()
    {
        await using var factory = Factory();
        using var client = factory.CreateClient();
        Assert.Equal(HttpStatusCode.Unauthorized, await WhoAmI(client, Mint(PrivateKey, audience: "anon")));
    }

    [Fact]
    public async Task Wrong_issuer_is_401()
    {
        await using var factory = Factory();
        using var client = factory.CreateClient();
        Assert.Equal(HttpStatusCode.Unauthorized,
            await WhoAmI(client, Mint(PrivateKey, issuer: "https://evil.example.com/auth/v1")));
    }

    [Fact]
    public async Task Hs256_token_is_rejected_alg_confusion()
    {
        await using var factory = Factory();
        using var client = factory.CreateClient();

        // A token forged with a symmetric HS256 signature must never be accepted — the scheme pins
        // ValidAlgorithms to ASYMMETRIC only [ES256, RS256]. (Even absent the pin there is no HMAC key configured.)
        var hmacKey = new SymmetricSecurityKey(RandomNumberGenerator.GetBytes(64));
        var descriptor = new SecurityTokenDescriptor
        {
            Issuer = Issuer,
            Audience = Audience,
            Subject = new ClaimsIdentity([new Claim("sub", Sub)]),
            Expires = DateTime.UtcNow.AddMinutes(10),
            SigningCredentials = new SigningCredentials(hmacKey, SecurityAlgorithms.HmacSha256),
        };
        var hs256 = new JsonWebTokenHandler().CreateToken(descriptor);

        Assert.Equal(HttpStatusCode.Unauthorized, await WhoAmI(client, hs256));
    }

    [Fact]
    public async Task Token_without_sub_claim_is_401()
    {
        await using var factory = Factory();
        using var client = factory.CreateClient();

        // Valid iss/aud/exp/signature but NO `sub` — must fail closed (the plane resolves the
        // TIMS principal from `sub`). Mint a token whose subject carries a non-sub claim only.
        var descriptor = new SecurityTokenDescriptor
        {
            Issuer = Issuer,
            Audience = Audience,
            Subject = new ClaimsIdentity([new Claim("role", "authenticated")]),
            Expires = DateTime.UtcNow.AddMinutes(10),
            SigningCredentials = new SigningCredentials(PrivateKey, SecurityAlgorithms.RsaSha256),
        };
        var noSub = new JsonWebTokenHandler().CreateToken(descriptor);

        Assert.Equal(HttpStatusCode.Unauthorized, await WhoAmI(client, noSub));
    }

    [Fact]
    public async Task Valid_looking_token_is_401_when_scheme_is_misconfigured()
    {
        // Locks the fail-closed-on-misconfiguration property the wiring comment promises: a host
        // with NO issuer and NO signing keys configured rejects even a well-formed token.
        await using var factory = new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
            builder.UseSetting("Platform:DatabaseConnectionString", "Host=localhost;Port=5432;Database=x;Username=x"));
        using var client = factory.CreateClient();

        Assert.Equal(HttpStatusCode.Unauthorized, await WhoAmI(client, Mint(PrivateKey)));
    }

    private static HttpRequestMessage Authorized(string path, string token)
    {
        var request = new HttpRequestMessage(HttpMethod.Get, path);
        request.Headers.Add("Authorization", $"Bearer {token}");
        return request;
    }
}
