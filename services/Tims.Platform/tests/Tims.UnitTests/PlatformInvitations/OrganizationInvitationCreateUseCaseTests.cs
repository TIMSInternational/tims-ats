using Tims.Application.Email;
using Tims.Application.PlatformInvitations;

namespace Tims.UnitTests.PlatformInvitations;

public sealed class OrganizationInvitationCreateUseCaseTests
{
    private static readonly OrganizationInvitationInput Input = new("admin@example.test", "<script>Org</script>", "example-org");
    private static readonly Uri Origin = new("https://app.example.test");
    private static readonly DateTimeOffset Instant = new(2026, 9, 14, 12, 0, 0, TimeSpan.Zero);

    [Fact]
    public async Task Slug_conflict_never_dispatches_email()
    {
        var repo = new Repository { Conflict = true }; var sender = new Sender();
        Assert.Null(await Case(repo, sender).ExecuteAsync(Input, Guid.NewGuid(), Origin, default));
        Assert.Equal(0, sender.Calls); Assert.Equal(0, repo.Updates);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task Unconfirmed_or_cancelled_delivery_returns_created_without_updating(bool throws)
    {
        var repo = new Repository(); var sender = new Sender { Accepted = false, Throws = throws };
        var result = await Case(repo, sender).ExecuteAsync(Input, Guid.NewGuid(), Origin, default);
        Assert.Equal("unconfirmed", result!.Delivery); Assert.Equal(repo.Snapshot.Id, result.Id);
        Assert.Equal(1, repo.Creates); Assert.Equal(1, sender.Calls); Assert.Equal(0, repo.Updates);
    }

    [Theory]
    [InlineData(true, false, "accepted")]
    [InlineData(false, false, "changed")]
    [InlineData(true, true, "state_unconfirmed")]
    public async Task Accepted_delivery_preserves_conditional_update_and_uncertainty(bool mark, bool throws, string outcome)
    {
        var repo = new Repository { Mark = mark, Throws = throws }; var sender = new Sender();
        var result = await Case(repo, sender).ExecuteAsync(Input, Guid.NewGuid(), Origin, default);
        Assert.Equal(outcome, result!.Delivery); Assert.Equal(1, repo.Updates);
        Assert.Equal(Instant.UtcDateTime, repo.SentAt); Assert.Equal(Instant.UtcDateTime.AddDays(7), repo.ExpiresAt);
        Assert.Contains("&lt;script&gt;Org&lt;/script&gt;", sender.Html);
        Assert.DoesNotContain("<script>", sender.Html); Assert.Contains("token=private%26token", sender.Html);
    }

    [Theory]
    [InlineData("organizationSlug", 64)]
    [InlineData("organizationName", 101)]
    [InlineData("organizationName", 1)]
    [InlineData("organizationSlug", 1)]
    [InlineData("email", 255)]
    public async Task Invalid_inputs_never_reach_repository(string field, int length)
    {
        var value = new string('a', length);
        var input = field switch
        {
            "organizationName" => Input with { OrganizationName = value },
            "organizationSlug" => Input with { OrganizationSlug = value },
            _ => Input with { Email = new string('a', length - 12) + "@example.com" },
        };
        var repo = new Repository(); var sender = new Sender();
        await Assert.ThrowsAsync<ArgumentException>(() => Case(repo, sender).ExecuteAsync(input, Guid.NewGuid(), Origin, default));
        Assert.Equal(0, repo.Creates); Assert.Equal(0, sender.Calls);
    }

    private static OrganizationInvitationCreateUseCase Case(Repository repo, Sender sender) => new(repo, repo, sender, new Clock());
    private sealed class Clock : TimeProvider { public override DateTimeOffset GetUtcNow() => Instant; }
    private sealed class Repository : IOrganizationInvitationCreateRepository, IInvitationResendRepository
    {
        public InvitationResendSnapshot Snapshot { get; } = new(Guid.NewGuid(), Input.Email, "private&token", "pending", Guid.NewGuid(), Input.OrganizationName, Instant.UtcDateTime);
        public bool Conflict { get; init; }
        public bool Mark { get; init; } = true;
        public bool Throws { get; init; }
        public int Creates { get; private set; }
        public int Updates { get; private set; }
        public DateTime SentAt { get; private set; }
        public DateTime ExpiresAt { get; private set; }
        public Task<OrganizationInvitationPending?> CreateAsync(OrganizationInvitationInput input, Guid actorId, DateTime now, CancellationToken ct)
        { Creates++; return Task.FromResult(Conflict ? null : new OrganizationInvitationPending(Snapshot, now.AddDays(7))); }
        public Task<InvitationResendSnapshot?> FindAsync(Guid id, CancellationToken ct) => throw new NotSupportedException();
        public Task<bool> MarkSentAsync(InvitationResendSnapshot expected, DateTime sentAt, DateTime expiresAt, CancellationToken ct)
        {
            Assert.Same(Snapshot, expected); Updates++; SentAt = sentAt; ExpiresAt = expiresAt;
            return Throws ? Task.FromException<bool>(new OperationCanceledException()) : Task.FromResult(Mark);
        }
    }
    private sealed class Sender : IEmailSender
    {
        public bool Accepted { get; init; } = true;
        public bool Throws { get; init; }
        public int Calls { get; private set; }
        public string Html { get; private set; } = "";
        public Task<bool> SendEmailAsync(string to, string subject, string html, CancellationToken ct)
        { Calls++; Html = html; return Throws ? Task.FromException<bool>(new OperationCanceledException()) : Task.FromResult(Accepted); }
    }
}
