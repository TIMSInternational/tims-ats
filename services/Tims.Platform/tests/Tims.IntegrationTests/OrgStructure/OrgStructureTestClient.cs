using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;

namespace Tims.IntegrationTests.OrgStructure;

/// <summary>Minimal JWT-authenticated client against the real Program with the org-structure flags set.</summary>
public static class OrgStructureTestClient
{
    private const string Issuer = "https://test-project.supabase.co/auth/v1";
    private const string Audience = "authenticated";
    private static readonly RSA SigningRsa = RSA.Create(2048);
    private static readonly RsaSecurityKey PrivateKey = new(SigningRsa) { KeyId = "org-structure-test-key" };

    public static async Task<HttpResponseMessage> SendAsync(
        string connectionString, HttpMethod method, string path, Guid? user, string? json = null, bool enabled = true)
    {
        await using var factory = new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.UseSetting("Platform:DatabaseConnectionString", connectionString);
            builder.UseSetting("Platform:TenantOrgStructureEnabled", enabled ? "true" : "false");
            builder.UseSetting("Platform:TenantPeopleDirectoryEnabled", "true");
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
        using var client = factory.CreateClient();
        using var request = new HttpRequestMessage(method, path);
        if (user is { } id) request.Headers.Add("Authorization", $"Bearer {Mint(OrgStructureFixture.Sub(id))}");
        if (json is not null) request.Content = new StringContent(json, Encoding.UTF8, "application/json");
        return await client.SendAsync(request);
    }

    public static async Task<JsonElement> JsonAsync(HttpResponseMessage response)
    {
        using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        return document.RootElement.Clone();
    }

    private static string Mint(string sub) => new JsonWebTokenHandler().CreateToken(new SecurityTokenDescriptor
    {
        Issuer = Issuer,
        Audience = Audience,
        Subject = new ClaimsIdentity([new Claim("sub", sub)]),
        Expires = DateTime.UtcNow.AddMinutes(10),
        SigningCredentials = new SigningCredentials(PrivateKey, SecurityAlgorithms.RsaSha256),
    });
}
