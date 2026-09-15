using Tims.Application.Email;
using Tims.Application.PlatformInvitations;

namespace Tims.UnitTests.PlatformInvitations;

public sealed class InvitationResendUseCaseTests
{
    private static readonly DateTimeOffset Instant = new(2026, 9, 14, 12, 0, 0, TimeSpan.Zero);
    private static readonly Uri Origin = new("https://app.example.test");

    [Theory]
    [InlineData("pending")]
    [InlineData("sent")]
    [InlineData("expired")]
    public async Task Accepted_email_updates_eligible_state_and_returns_only_safe_fields(string status)
    {
        var repository = new FakeRepository { Snapshot = Snapshot(status) };
        var sender = new FakeSender();
        var result = await UseCase(repository, sender).ExecuteAsync(repository.Snapshot.Id, Origin, CancellationToken.None);
        Assert.Equal(InvitationResendOutcome.Sent, result.Outcome);
        Assert.Equal("sent", result.Response!.Status);
        Assert.Equal(Instant.UtcDateTime, result.Response.SentAt);
        Assert.Equal(Instant.UtcDateTime.AddDays(7), result.Response.ExpiresAt);
        Assert.Equal(1, repository.Updates);
        var json = System.Text.Json.JsonSerializer.Serialize(result.Response);
        Assert.DoesNotContain(repository.Snapshot.Token, json);
        Assert.DoesNotContain(repository.Snapshot.Email, json);
        Assert.Contains("2026-09-14T12:00:00.000Z", json);
    }

    [Theory]
    [InlineData("accepted")]
    [InlineData("revoked")]
    [InlineData("unexpected")]
    public async Task Ineligible_state_never_sends_or_updates(string status)
    {
        var repository = new FakeRepository { Snapshot = Snapshot(status) };
        var sender = new FakeSender();
        var result = await UseCase(repository, sender).ExecuteAsync(repository.Snapshot.Id, Origin, CancellationToken.None);
        Assert.Equal(InvitationResendOutcome.InvalidStatus, result.Outcome);
        Assert.Equal(0, sender.Calls);
        Assert.Equal(0, repository.Updates);
    }

    [Fact]
    public async Task Missing_invitation_never_sends()
    {
        var sender = new FakeSender();
        var result = await UseCase(new FakeRepository(), sender).ExecuteAsync(Guid.NewGuid(), Origin, CancellationToken.None);
        Assert.Equal(InvitationResendOutcome.NotFound, result.Outcome);
        Assert.Equal(0, sender.Calls);
    }

    [Fact]
    public async Task Unconfirmed_delivery_never_updates_or_retries()
    {
        var repository = new FakeRepository { Snapshot = Snapshot("pending") };
        var sender = new FakeSender { Accepted = false };
        var result = await UseCase(repository, sender).ExecuteAsync(repository.Snapshot.Id, Origin, CancellationToken.None);
        Assert.Equal(InvitationResendOutcome.DeliveryUnconfirmed, result.Outcome);
        Assert.Equal(1, sender.Calls);
        Assert.Equal(0, repository.Updates);
    }

    [Fact]
    public async Task Encodes_untrusted_html_and_token_but_keeps_the_actual_recipient()
    {
        var repository = new FakeRepository
        {
            Snapshot = Snapshot("pending") with
            {
                OrganizationName = "<img src=x>&\"",
                Token = "a&b=1\"",
            }
        };
        var sender = new FakeSender();
        await UseCase(repository, sender).ExecuteAsync(repository.Snapshot.Id, Origin, CancellationToken.None);
        Assert.Equal(repository.Snapshot.Email, sender.To);
        Assert.DoesNotContain("<img", sender.Html);
        Assert.Contains("&lt;img src=x&gt;&amp;&quot;", sender.Html);
        Assert.Contains("https://app.example.test/accept-invitation?token=a%26b%3D1%22", sender.Html);
    }

    [Fact]
    public async Task Concurrent_change_returns_conflict_without_retrying_email()
    {
        var repository = new FakeRepository { Snapshot = Snapshot("sent"), Updated = false };
        var sender = new FakeSender();
        var result = await UseCase(repository, sender).ExecuteAsync(repository.Snapshot.Id, Origin, CancellationToken.None);
        Assert.Equal(InvitationResendOutcome.ChangedDuringDelivery, result.Outcome);
        Assert.Null(result.Response);
        Assert.Equal(1, sender.Calls);
    }

    [Fact]
    public async Task Database_failure_after_acceptance_is_distinguished_from_email_failure()
    {
        var repository = new FakeRepository { Snapshot = Snapshot("pending"), Failure = new OperationCanceledException() };
        var sender = new FakeSender();
        var result = await UseCase(repository, sender).ExecuteAsync(repository.Snapshot.Id, Origin, CancellationToken.None);
        Assert.Equal(InvitationResendOutcome.StateUnconfirmed, result.Outcome);
        Assert.Equal(repository.Snapshot.OrganizationId, result.OrganizationId);
        Assert.Equal(1, sender.Calls);
    }

    private static InvitationResendSnapshot Snapshot(string status) => new(Guid.NewGuid(), "candidate@example.test",
        Guid.NewGuid().ToString(), status, Guid.NewGuid(), "Org", Instant.UtcDateTime);
    private static InvitationResendUseCase UseCase(FakeRepository repository, FakeSender sender) => new(repository, sender, new FixedClock());
    private sealed class FixedClock : TimeProvider { public override DateTimeOffset GetUtcNow() => Instant; }

    private sealed class FakeRepository : IInvitationResendRepository
    {
        public InvitationResendSnapshot? Snapshot { get; init; }
        public bool Updated { get; init; } = true;
        public Exception? Failure { get; init; }
        public int Updates { get; private set; }
        public Task<InvitationResendSnapshot?> FindAsync(Guid id, CancellationToken ct) => Task.FromResult(Snapshot);
        public Task<bool> MarkSentAsync(InvitationResendSnapshot expected, DateTime sentAt, DateTime expiresAt, CancellationToken ct)
        {
            Updates++;
            return Failure is null ? Task.FromResult(Updated) : Task.FromException<bool>(Failure);
        }
    }

    private sealed class FakeSender : IEmailSender
    {
        public bool Accepted { get; init; } = true;
        public int Calls { get; private set; }
        public string? To { get; private set; }
        public string? Html { get; private set; }
        public Task<bool> SendEmailAsync(string to, string subject, string html, CancellationToken ct)
        {
            Calls++; To = to; Html = html;
            return Task.FromResult(Accepted);
        }
    }
}
