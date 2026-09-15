using System.Net;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text.Json;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;
using Npgsql;
using Tims.IntegrationTests.PlatformOrganizations;
using Tims.Application.Email;

namespace Tims.IntegrationTests.PlatformInvitations;

[CollectionDefinition("BulkInvitation")]
public sealed class BulkInvitationCollection : ICollectionFixture<OrganizationInvitationFixture>;

[Collection("BulkInvitation")]
public sealed partial class BulkInvitationEndpointTests(OrganizationInvitationFixture fixture)
{
    private const string Issuer = "https://test-project.supabase.co/auth/v1";
    private const string Audience = "authenticated";
    private static readonly RSA Rsa = RSA.Create(2048);
    private static readonly RsaSecurityKey Key = new(Rsa) { KeyId = "resend-test" };

    private WebApplicationFactory<Program> Factory(FakeSender sender, bool enabled = true, bool replaceSender = true, string? connection = null) =>
        new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.UseSetting("Platform:DatabaseConnectionString", connection ?? fixture.ConnectionString);
            builder.UseSetting("Platform:PlatformBulkInvitationEnabled", enabled.ToString());
            builder.UseSetting("Platform:SupabaseJwtIssuer", Issuer);
            builder.UseSetting("Platform:SupabaseJwtAudience", Audience);
            builder.UseSetting("Invitations:AppOrigin", "https://app.example.test");
            builder.ConfigureTestServices(services =>
            {
                if (replaceSender) services.AddSingleton<IEmailSender>(sender);
                services.PostConfigure<JwtBearerOptions>(JwtBearerDefaults.AuthenticationScheme, options =>
                {
                    options.RequireHttpsMetadata = false;
                    options.TokenValidationParameters.IssuerSigningKeys = [
                        JsonWebKeyConverter.ConvertFromRSASecurityKey(new RsaSecurityKey(Rsa.ExportParameters(false)) { KeyId = Key.KeyId })];
                });
            });
        });

    private static string Mint(string sub) => new JsonWebTokenHandler().CreateToken(new SecurityTokenDescriptor
    {
        Issuer = Issuer,
        Audience = Audience,
        Subject = new ClaimsIdentity([new Claim("sub", sub)]),
        Expires = DateTime.UtcNow.AddMinutes(10),
        SigningCredentials = new SigningCredentials(Key, SecurityAlgorithms.RsaSha256),
    });

    private static Task<HttpResponseMessage> Post(HttpClient client, string body, string? sub = PlatformOrganizationsCreateFixture.PlatformOwnerSub)
    {
        var request = new HttpRequestMessage(HttpMethod.Post, "/platform/invitations/bulk")
        { Content = new StringContent(body, System.Text.Encoding.UTF8, "application/json") };
        if (sub is not null) request.Headers.Add("Authorization", "Bearer " + Mint(sub));
        return client.SendAsync(request);
    }

    private static string Input(params string[] emails) => JsonSerializer.Serialize(new
    {
        organizationId = PlatformOrganizationsCreateFixture.OtherOrg,
        users = emails.Select(email => new { email }).ToArray(),
    });
    private static string Email() => Guid.NewGuid().ToString("N") + "@example.test";

    private sealed class FakeSender : IEmailSender
    {
        private int calls;
        public int Calls => calls;
        public string Html { get; private set; } = "";
        public Func<Task<bool>> Handler { get; init; } = () => Task.FromResult(true);
        public Task<bool> SendEmailAsync(string to, string subject, string html, CancellationToken ct)
        { Interlocked.Increment(ref calls); Html = html; return Handler(); }
    }
}
