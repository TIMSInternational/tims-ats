using Tims.Application.Email;
using Tims.Application.PlatformInvitations;

namespace Tims.UnitTests.PlatformInvitations;

public sealed class UserInvitationCreateUseCaseTests
{
    private static readonly Guid Org = Guid.NewGuid();
    private static readonly UserInvitationInput Input = new("invitee@example.test", Org, "<admin_role>");
    private static readonly DateTimeOffset Now = new(2026, 9, 14, 12, 0, 0, TimeSpan.Zero);
    [Theory]
    [InlineData(UserInvitationCreateOutcome.OrganizationUnavailable)]
    [InlineData(UserInvitationCreateOutcome.RoleUnavailable)]
    public async Task Rejected_target_does_not_send_or_update(UserInvitationCreateOutcome outcome)
    {
        var repo = new Repo { Outcome = outcome }; var sender = new Sender();
        var result = await Case(repo, sender).ExecuteAsync(Input, Guid.NewGuid(), new Uri("https://app.example.test"), default);
        Assert.Equal(outcome, result.Outcome); Assert.Null(result.Response); Assert.Equal(0, sender.Calls); Assert.Equal(0, repo.Updates);
    }
    [Theory]
    [InlineData(true, true, false, "accepted")]
    [InlineData(false, true, false, "unconfirmed")]
    [InlineData(true, false, false, "changed")]
    [InlineData(true, true, true, "state_unconfirmed")]
    public async Task Preserves_delivery_outcome_and_encodes_template(bool accepted, bool updated, bool throws, string outcome)
    {
        var repo = new Repo { Updated = updated, Throws = throws }; var sender = new Sender { Accepted = accepted };
        var result = await Case(repo, sender).ExecuteAsync(Input, Guid.NewGuid(), new Uri("https://app.example.test"), default);
        Assert.Equal(outcome, result.Response!.Delivery); Assert.Equal(Org, result.Response.OrganizationId);
        Assert.Contains("&lt;Org&gt;", sender.Html); Assert.Contains("&lt;admin role&gt;", sender.Html);
        Assert.Contains("token=private%26token", sender.Html); Assert.Equal(accepted ? 1 : 0, repo.Updates);
        Assert.Equal(1, sender.Calls);
    }
    [Theory]
    [InlineData("")]
    [InlineData("bad\nrole")]
    public async Task Invalid_role_never_reaches_repository(string role)
    {
        var repo = new Repo(); var sender = new Sender();
        await Assert.ThrowsAsync<ArgumentException>(() => Case(repo, sender).ExecuteAsync(Input with { RoleSlug = role }, Guid.NewGuid(), new Uri("https://app.example.test"), default));
        Assert.Equal(0, repo.Creates); Assert.Equal(0, sender.Calls);
    }
    [Fact]
    public void Input_limits_match_sender_and_role_storage()
    {
        Assert.False(UserInvitationCreateUseCase.IsValid(Input with { RoleSlug = new string('a', 51) }));
        Assert.True(UserInvitationCreateUseCase.IsValid(Input with { RoleSlug = new string('a', 50) }));
        Assert.True(UserInvitationCreateUseCase.IsValid(Input with { RoleSlug = null }));
        Assert.False(UserInvitationCreateUseCase.IsValid(Input with { OrganizationId = Guid.Empty }));
        Assert.False(UserInvitationCreateUseCase.IsValid(Input with { Email = new string('a', 243) + "@example.com" }));
    }
    private static UserInvitationCreateUseCase Case(Repo repo, Sender sender) => new(repo, repo, sender, new Clock());
    private sealed class Clock : TimeProvider { public override DateTimeOffset GetUtcNow() => Now; }
    private sealed class Repo : IUserInvitationCreateRepository, IInvitationResendRepository
    {
        public UserInvitationCreateOutcome Outcome { get; init; } = UserInvitationCreateOutcome.Created;
        public bool Updated { get; init; } = true;
        public bool Throws { get; init; }
        public int Creates { get; private set; }
        public int Updates { get; private set; }
        public Task<IReadOnlyList<InvitationRole>?> ListRolesAsync(Guid id, CancellationToken ct) => throw new NotSupportedException();
        public Task<UserInvitationPending> CreateAsync(UserInvitationInput input, Guid actor, DateTime now, CancellationToken ct)
        {
            Creates++;
            return Task.FromResult(new UserInvitationPending(Outcome, new(Guid.NewGuid(), Input.Email, "private&token", "pending", Org, "<Org>", now), now.AddDays(7)));
        }
        public Task<InvitationResendSnapshot?> FindAsync(Guid id, CancellationToken ct) => throw new NotSupportedException();
        public Task<bool> MarkSentAsync(InvitationResendSnapshot expected, DateTime sentAt, DateTime expiresAt, CancellationToken ct)
        {
            Updates++; Assert.Equal(Now.UtcDateTime, sentAt); Assert.Equal(Now.UtcDateTime.AddDays(7), expiresAt);
            return Throws ? Task.FromException<bool>(new OperationCanceledException()) : Task.FromResult(Updated);
        }
    }
    private sealed class Sender : IEmailSender
    {
        public bool Accepted { get; init; } = true;
        public int Calls { get; private set; }
        public string Html { get; private set; } = "";
        public Task<bool> SendEmailAsync(string to, string subject, string html, CancellationToken ct)
        { Calls++; Html = html; return Task.FromResult(Accepted); }
    }
}
