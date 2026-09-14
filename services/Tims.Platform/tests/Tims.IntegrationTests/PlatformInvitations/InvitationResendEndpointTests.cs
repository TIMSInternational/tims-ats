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
using Tims.Application.Email;

namespace Tims.IntegrationTests.PlatformInvitations;

[CollectionDefinition("InvitationResend")]
public sealed class InvitationResendCollection : ICollectionFixture<PlatformInvitationsReadFixture>;

[Collection("InvitationResend")]
public sealed partial class InvitationResendEndpointTests(PlatformInvitationsReadFixture fixture)
{
    private const string Issuer = "https://test-project.supabase.co/auth/v1";
    private const string Audience = "authenticated";
    private static readonly RSA Rsa = RSA.Create(2048);
    private static readonly RsaSecurityKey Key = new(Rsa) { KeyId = "resend-test" };

    private WebApplicationFactory<Program> Factory(FakeSender sender, bool enabled = true, bool reads = false, bool replaceSender = true) =>
        new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.UseSetting("Platform:DatabaseConnectionString", fixture.ConnectionString);
            builder.UseSetting("Platform:PlatformInvitationResendEnabled", enabled.ToString());
            builder.UseSetting("Platform:PlatformInvitationsReadEnabled", reads.ToString());
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

    private static Task<HttpResponseMessage> Post(HttpClient client, string id, string? sub = PlatformInvitationsReadFixture.PlatformOwnerSub)
    {
        var request = new HttpRequestMessage(HttpMethod.Post, $"/platform/invitations/{id}/resend");
        if (sub is not null) request.Headers.Add("Authorization", "Bearer " + Mint(sub));
        return client.SendAsync(request);
    }

    [Theory]
    [InlineData("pending")]
    [InlineData("sent")]
    [InlineData("expired")]
    public async Task Real_postgres_and_host_update_only_after_provider_acceptance(string status)
    {
        var row = await Seed(status);
        var sender = new FakeSender();
        await using var factory = Factory(sender);
        using var client = factory.CreateClient();
        var response = await Post(client, row.Id.ToString());
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        using var json = JsonDocument.Parse(body);
        Assert.Equal(4, json.RootElement.EnumerateObject().Count());
        Assert.Equal(row.Id.ToString(), json.RootElement.GetProperty("id").GetString());
        Assert.Equal("sent", json.RootElement.GetProperty("status").GetString());
        Assert.DoesNotContain(row.Token, body);
        Assert.DoesNotContain("recipient@example.test", body);
        var saved = await Read(row.Id);
        Assert.Equal("sent", saved.Status);
        Assert.Equal(json.RootElement.GetProperty("sentAt").GetDateTime().Ticks, saved.SentAt!.Value.Ticks);
        Assert.Equal(json.RootElement.GetProperty("expiresAt").GetDateTime().Ticks, saved.ExpiresAt.Ticks);
        Assert.Equal(1, sender.Calls);
        Assert.Contains("https://app.example.test/accept-invitation?token=" + row.Token, sender.Html);
        Assert.DoesNotContain("<script>", sender.Html);
        Assert.Contains("&lt;script&gt;", sender.Html);
        await AssertAudit(row.Id, "Sent", row.Token);
    }

    [Theory]
    [InlineData("accepted")]
    [InlineData("revoked")]
    public async Task Terminal_state_never_sends_or_changes_row(string status)
    {
        var row = await Seed(status);
        var before = await Read(row.Id);
        var sender = new FakeSender();
        await using var factory = Factory(sender);
        using var client = factory.CreateClient();
        Assert.Equal(HttpStatusCode.BadRequest, (await Post(client, row.Id.ToString())).StatusCode);
        Assert.Equal(before, await Read(row.Id));
        Assert.Equal(0, sender.Calls);
    }

    [Theory]
    [InlineData("pending")]
    [InlineData("sent")]
    [InlineData("expired")]
    public async Task Unconfirmed_delivery_preserves_original_database_state(string status)
    {
        var row = await Seed(status);
        var before = await Read(row.Id);
        var sender = new FakeSender { Handler = () => Task.FromResult(false) };
        await using var factory = Factory(sender);
        using var client = factory.CreateClient();
        Assert.Equal(HttpStatusCode.ServiceUnavailable, (await Post(client, row.Id.ToString())).StatusCode);
        Assert.Equal(before, await Read(row.Id));
        Assert.Equal(1, sender.Calls);
        await AssertAudit(row.Id, "DeliveryUnconfirmed", row.Token);
    }

    [Theory]
    [InlineData("accepted")]
    [InlineData("revoked")]
    public async Task Acceptance_or_revocation_during_delivery_cannot_be_overwritten(string status)
    {
        var row = await Seed("pending");
        var sender = new FakeSender
        {
            Handler = async () =>
        {
            await ChangeStatus(row.Id, status);
            return true;
        }
        };
        await using var factory = Factory(sender);
        using var client = factory.CreateClient();
        Assert.Equal(HttpStatusCode.Conflict, (await Post(client, row.Id.ToString())).StatusCode);
        Assert.Equal(status, (await Read(row.Id)).Status);
        Assert.Null((await Read(row.Id)).SentAt);
        await AssertAudit(row.Id, "ChangedDuringDelivery", row.Token);
    }

    [Theory]
    [InlineData(null, HttpStatusCode.Unauthorized)]
    [InlineData(PlatformInvitationsReadFixture.OrgUserSub, HttpStatusCode.Forbidden)]
    public async Task Unauthorized_callers_cannot_trigger_email_or_learn_id_validation(string? sub, HttpStatusCode expected)
    {
        var sender = new FakeSender();
        await using var factory = Factory(sender);
        using var client = factory.CreateClient();
        Assert.Equal(expected, (await Post(client, "invalid-id", sub)).StatusCode);
        Assert.Equal(expected, (await Post(client, PlatformInvitationsReadFixture.InvitationPendingOrgB.ToString(), sub)).StatusCode);
        Assert.Equal(0, sender.Calls);
    }

    [Fact]
    public async Task Owner_sees_400_for_invalid_id_and_404_for_missing_row()
    {
        var sender = new FakeSender();
        await using var factory = Factory(sender);
        using var client = factory.CreateClient();
        Assert.Equal(HttpStatusCode.BadRequest, (await Post(client, "invalid-id")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await Post(client, Guid.NewGuid().ToString())).StatusCode);
        Assert.Equal(0, sender.Calls);
    }

    [Fact]
    public async Task Enabling_reads_does_not_enable_resend()
    {
        var sender = new FakeSender();
        await using var factory = Factory(sender, enabled: false, reads: true);
        using var client = factory.CreateClient();
        client.DefaultRequestHeaders.Add("Authorization", "Bearer " + Mint(PlatformInvitationsReadFixture.PlatformOwnerSub));
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/platform/invitations/kpis")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await Post(client, Guid.NewGuid().ToString())).StatusCode);
        Assert.Equal(0, sender.Calls);
    }

    private sealed class FakeSender : IEmailSender
    {
        public int Calls { get; private set; }
        public string Html { get; private set; } = "";
        public Func<Task<bool>> Handler { get; init; } = () => Task.FromResult(true);
        public Task<bool> SendEmailAsync(string to, string subject, string html, CancellationToken ct)
        {
            Calls++; Html = html;
            return Handler();
        }
    }
}
