using Tims.Application.CandidateConsent;
using Tims.Application.Email;

namespace Tims.UnitTests.CandidateConsent;

public sealed class DataSubjectRequestNotifierTests
{
    private static readonly Uri Origin = new("https://app.tims.test");

    private static DataSubjectRequestNotice Notice(params string[] emails) => new(
        emails.Select((email, i) => new DataSubjectRequestRecipient(Guid.NewGuid(), email, i == 0 ? "<Ana>" : "Leo")).ToList(),
        new DateTime(2026, 10, 22, 15, 0, 0, DateTimeKind.Utc));

    [Fact]
    public async Task SendsOneSpanishEmailPerRecipient_WithDueDateAndLink_NoCandidateData()
    {
        var sender = new FakeSender();
        var (accepted, failed) = await new DataSubjectRequestNotifier(sender)
            .SendAsync(Notice("a@tims.test", "b@tims.test"), Origin, CancellationToken.None);

        Assert.Equal((2, 0), (accepted, failed));
        Assert.Equal(["a@tims.test", "b@tims.test"], sender.Sent.Select(m => m.To).ToArray());
        var (_, subject, html) = sender.Sent[0];
        Assert.Contains("supresión de datos", subject, StringComparison.Ordinal);
        Assert.Contains("un candidato", html, StringComparison.Ordinal);
        Assert.Contains("15 días hábiles", html, StringComparison.Ordinal);
        Assert.Contains("Ley 1581 de 2012 (art. 15)", html, StringComparison.Ordinal);
        Assert.Contains("22/10/2026", html, StringComparison.Ordinal);
        Assert.Contains("https://app.tims.test/settings/data-requests", html, StringComparison.Ordinal);
        Assert.Contains("&lt;Ana&gt;", html, StringComparison.Ordinal); // interpolations are HTML-encoded
        Assert.DoesNotContain("<Ana>", html, StringComparison.Ordinal);
    }

    [Fact]
    public async Task RejectedOrThrowingDelivery_IsCounted_NeverThrown()
    {
        var sender = new FakeSender { Reject = "b@tims.test", Throw = "c@tims.test" };
        var (accepted, failed) = await new DataSubjectRequestNotifier(sender)
            .SendAsync(Notice("a@tims.test", "b@tims.test", "c@tims.test"), Origin, CancellationToken.None);
        Assert.Equal((1, 2), (accepted, failed));
    }

    private sealed class FakeSender : IEmailSender
    {
        public List<(string To, string Subject, string Html)> Sent { get; } = [];

        public string? Reject { get; init; }

        public string? Throw { get; init; }

        public Task<bool> SendEmailAsync(string to, string subject, string html, CancellationToken ct)
        {
            if (to == Throw)
            {
                throw new HttpRequestException("ses down");
            }

            Sent.Add((to, subject, html));
            return Task.FromResult(to != Reject);
        }
    }
}
