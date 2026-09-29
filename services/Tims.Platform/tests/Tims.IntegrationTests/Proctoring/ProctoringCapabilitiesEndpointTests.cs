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

namespace Tims.IntegrationTests.Proctoring;

/// <summary>The browser can check the live deploy flag before requesting media access.</summary>
public sealed class ProctoringCapabilitiesEndpointTests
{
    private const string Issuer = "https://test-project.supabase.co/auth/v1";
    private const string Audience = "authenticated";
    private static readonly RSA SigningRsa = RSA.Create(2048);
    private static readonly RsaSecurityKey PrivateKey = new(SigningRsa) { KeyId = "proctoring-capabilities-test" };

    private static WebApplicationFactory<Program> Factory(bool enabled) =>
        new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.UseSetting("Platform:DatabaseConnectionString",
                "Host=127.0.0.1;Port=1;Database=x;Username=x;Timeout=1");
            builder.UseSetting("Platform:ProctoringEnabled", enabled.ToString());
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

    private static string Mint()
    {
        var descriptor = new SecurityTokenDescriptor
        {
            Issuer = Issuer,
            Audience = Audience,
            Subject = new ClaimsIdentity([
                new Claim("sub", "candidate-capabilities-test"),
                new Claim("email", "candidate@test.local"),
            ]),
            Expires = DateTime.UtcNow.AddMinutes(10),
            SigningCredentials = new SigningCredentials(PrivateKey, SecurityAlgorithms.RsaSha256),
        };
        return new JsonWebTokenHandler().CreateToken(descriptor);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task Authenticated_client_reads_live_flag_even_when_write_routes_are_dark(bool enabled)
    {
        await using var factory = Factory(enabled);
        using var client = factory.CreateClient();
        using var request = new HttpRequestMessage(HttpMethod.Get, "/proctoring/capabilities");
        request.Headers.Add("Authorization", $"Bearer {Mint()}");

        using var response = await client.SendAsync(request);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.Equal(enabled, json.RootElement.GetProperty("enabled").GetBoolean());
    }

    [Fact]
    public async Task Anonymous_client_is_rejected()
    {
        await using var factory = Factory(false);
        using var client = factory.CreateClient();

        using var response = await client.GetAsync("/proctoring/capabilities");

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }
}
