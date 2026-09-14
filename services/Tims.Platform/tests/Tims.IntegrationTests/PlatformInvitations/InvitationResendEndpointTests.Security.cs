using System.Net;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Tims.Application.PlatformInvitations;
using Tims.Domain.Identity;
using Tims.Infrastructure.PlatformInvitations;

namespace Tims.IntegrationTests.PlatformInvitations;

public sealed partial class InvitationResendEndpointTests
{
    [Fact]
    public async Task A_real_signed_impersonation_cookie_denies_the_owner_before_sending()
    {
        var secret = Convert.ToBase64String(System.Security.Cryptography.RandomNumberGenerator.GetBytes(32));
        var sender = new FakeSender();
        await using var factory = Factory(sender).WithWebHostBuilder(builder => builder.UseSetting("Platform:ImpersonationSecret", secret));
        using var client = factory.CreateClient();
        var cookie = ImpersonationCookie.SignImpersonationToken(secret,
            PlatformInvitationsReadFixture.PlatformOwnerId.ToString(), PlatformInvitationsReadFixture.OrgUserId.ToString(),
            DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
        client.DefaultRequestHeaders.Add("Cookie", $"{ImpersonationCookie.CookieName}={cookie}");
        Assert.Equal(HttpStatusCode.Forbidden, (await Post(client, "invalid-id")).StatusCode);
        Assert.Equal(0, sender.Calls);
    }

    [Fact]
    public async Task Mfa_enforcement_blocks_an_owner_without_step_up()
    {
        var sender = new FakeSender();
        await using var factory = Factory(sender).WithWebHostBuilder(builder => builder.UseSetting("Platform:MfaEnforced", "true"));
        using var client = factory.CreateClient();
        Assert.Equal(HttpStatusCode.Forbidden, (await Post(client, "invalid-id")).StatusCode);
        Assert.Equal(0, sender.Calls);
    }

    [Fact]
    public async Task Enabled_route_with_real_disabled_sender_fails_without_mutating()
    {
        var row = await Seed("pending");
        var before = await Read(row.Id);
        await using var factory = Factory(new FakeSender(), replaceSender: false);
        using var client = factory.CreateClient();
        Assert.Equal(HttpStatusCode.ServiceUnavailable, (await Post(client, row.Id.ToString())).StatusCode);
        Assert.Equal(before, await Read(row.Id));
    }

    [Fact]
    public async Task Post_acceptance_database_uncertainty_is_audited_and_not_reported_as_delivery_failure()
    {
        var row = await Seed("pending");
        var sender = new FakeSender();
        await using var factory = Factory(sender).WithWebHostBuilder(builder => builder.ConfigureTestServices(services =>
            services.AddScoped<IInvitationResendRepository>(sp => new FailedCommitRepository(
                new InvitationResendRepository(sp.GetRequiredService<InvitationResendDbContext>())))));
        using var client = factory.CreateClient();
        var response = await Post(client, row.Id.ToString());
        Assert.Equal(HttpStatusCode.ServiceUnavailable, response.StatusCode);
        Assert.Contains("Email accepted", await response.Content.ReadAsStringAsync());
        Assert.Equal(1, sender.Calls);
        await AssertAudit(row.Id, "StateUnconfirmed", row.Token);
    }

    [Fact]
    public async Task Forged_jwt_cannot_reach_the_sender()
    {
        var sender = new FakeSender();
        await using var factory = Factory(sender);
        using var client = factory.CreateClient();
        client.DefaultRequestHeaders.Add("Authorization", "Bearer forged.jwt.signature");
        Assert.Equal(HttpStatusCode.Unauthorized,
            (await client.PostAsync("/platform/invitations/invalid-id/resend", null)).StatusCode);
        Assert.Equal(0, sender.Calls);
    }

    private sealed class FailedCommitRepository(IInvitationResendRepository inner) : IInvitationResendRepository
    {
        public Task<InvitationResendSnapshot?> FindAsync(Guid id, CancellationToken ct) => inner.FindAsync(id, ct);
        public Task<bool> MarkSentAsync(InvitationResendSnapshot expected, DateTime sentAt, DateTime expiresAt, CancellationToken ct) =>
            Task.FromException<bool>(new OperationCanceledException("simulated uncertain commit"));
    }
}
