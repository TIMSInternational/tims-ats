using System.Net;
using System.Net.Http.Json;
using System.Security.Claims;
using System.Security.Cryptography;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;
using Tims.Application.PlatformInvitations;

namespace Tims.IntegrationTests.PlatformInvitations;

public sealed class InvitationOnboardingEndpointTests
{
    private static readonly string Token = Guid.NewGuid().ToString();
    private const string Issuer = "https://project.supabase.co/auth/v1";
    private static readonly RSA SigningRsa = RSA.Create(2048);
    private static readonly RsaSecurityKey SigningKey = new(SigningRsa) { KeyId = "invitation-setup-test" };

    private sealed class Repository : IInvitationOnboardingRepository
    {
        public Task<InvitationSetup?> PreviewAsync(string token, CancellationToken ct) => Task.FromResult<InvitationSetup?>(
            new(Guid.NewGuid(), "invitee@example.test", Guid.NewGuid(), "Test organization", "recruiter", "sent",
                DateTime.UtcNow.AddDays(1), false));
        public Task<bool> CompleteAsync(string token, SetupIdentity identity, SetupProfile profile, CancellationToken ct) =>
            Task.FromResult(true);
    }

    private sealed class Identity : IInvitationIdentityProvider
    {
        public Task<bool> CreateAsync(string email, string password, CancellationToken ct) => Task.FromResult(true);
        public Task<SetupIdentity?> VerifyAsync(string accessToken, CancellationToken ct) =>
            Task.FromResult<SetupIdentity?>(new(Guid.NewGuid().ToString(), "invitee@example.test"));
    }

    private static WebApplicationFactory<Program> Factory(bool enabled) =>
        new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.UseSetting("Platform:DatabaseConnectionString", "Host=localhost;Port=5432;Database=x;Username=x");
            builder.UseSetting("Invitations:SetupEnabled", enabled.ToString());
            if (enabled)
            {
                builder.UseSetting("Invitations:SupabaseUrl", "https://project.supabase.co");
                builder.UseSetting("Invitations:SupabaseServiceKey", "test-service-key");
                builder.UseSetting("Platform:SupabaseJwtIssuer", Issuer);
                builder.UseSetting("Platform:SupabaseJwtAudience", "authenticated");
            }
            builder.ConfigureTestServices(services =>
            {
                services.RemoveAll<IInvitationOnboardingRepository>();
                services.RemoveAll<IInvitationIdentityProvider>();
                services.AddSingleton<IInvitationOnboardingRepository, Repository>();
                services.AddSingleton<IInvitationIdentityProvider, Identity>();
                var publicJwk = JsonWebKeyConverter.ConvertFromRSASecurityKey(
                    new RsaSecurityKey(SigningRsa.ExportParameters(false)) { KeyId = SigningKey.KeyId });
                services.PostConfigure<Microsoft.AspNetCore.Authentication.JwtBearer.JwtBearerOptions>(
                    JwtBearerDefaults.AuthenticationScheme, options =>
                    {
                        options.RequireHttpsMetadata = false;
                        options.TokenValidationParameters.IssuerSigningKeys = [publicJwk];
                    });
            });
        });

    private static string Mint()
    {
        var descriptor = new SecurityTokenDescriptor
        {
            Issuer = Issuer,
            Audience = "authenticated",
            Subject = new ClaimsIdentity([
                new Claim("sub", Guid.NewGuid().ToString()),
                new Claim("email", "invitee@example.test"),
            ]),
            Expires = DateTime.UtcNow.AddMinutes(5),
            SigningCredentials = new SigningCredentials(SigningKey, SecurityAlgorithms.RsaSha256),
        };
        return new JsonWebTokenHandler().CreateToken(descriptor);
    }

    [Fact]
    public async Task Preview_is_public_bounded_and_never_cacheable()
    {
        await using var factory = Factory(true);
        using var client = factory.CreateClient();
        var response = await client.PostAsJsonAsync("/invitations/setup/preview", new { token = Token });
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Contains("no-store", response.Headers.CacheControl!.ToString());

        var duplicate = new StringContent($"{{\"token\":\"{Token}\",\"token\":\"{Token}\"}}",
            System.Text.Encoding.UTF8, "application/json");
        Assert.Equal(HttpStatusCode.BadRequest,
            (await client.PostAsync("/invitations/setup/preview", duplicate)).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest,
            (await client.PostAsJsonAsync("/invitations/setup/preview", new { token = Token, admin = true })).StatusCode);
        using var oversized = new ByteArrayContent(new byte[8193]);
        oversized.Headers.ContentType = new("application/json");
        Assert.Equal(HttpStatusCode.BadRequest,
            (await client.PostAsync("/invitations/setup/preview", oversized)).StatusCode);
    }

    [Fact]
    public async Task Register_is_public_but_completion_requires_a_valid_bearer()
    {
        await using var factory = Factory(true);
        using var client = factory.CreateClient();
        Assert.Equal(HttpStatusCode.OK, (await client.PostAsJsonAsync("/invitations/setup/register",
            new { token = Token, password = "a-long-private-credential" })).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.PostAsJsonAsync("/invitations/setup/complete",
            new { token = Token, firstName = "Test", lastName = "Recipient" })).StatusCode);
    }

    [Fact]
    public async Task Valid_supabase_bearer_reaches_authenticated_completion()
    {
        await using var factory = Factory(true);
        using var client = factory.CreateClient();
        using var request = new HttpRequestMessage(HttpMethod.Post, "/invitations/setup/complete")
        {
            Content = JsonContent.Create(new { token = Token, firstName = "Test", lastName = "Recipient" }),
        };
        request.Headers.Authorization = new("Bearer", Mint());
        var response = await client.SendAsync(request);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Contains("\"outcome\":\"complete\"", await response.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task Setup_routes_are_dark_by_default()
    {
        await using var factory = Factory(false);
        using var client = factory.CreateClient();
        Assert.Equal(HttpStatusCode.NotFound,
            (await client.PostAsJsonAsync("/invitations/setup/preview", new { token = Token })).StatusCode);
    }
}
