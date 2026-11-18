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
        // Country-neutral: no specific law is cited and no legal deadline is promised (the date is an estimate).
        Assert.Contains("legislación de protección de datos aplicable", html, StringComparison.Ordinal);
        Assert.Contains("Fecha límite estimada", html, StringComparison.Ordinal);
        Assert.Contains("no es un plazo legal", html, StringComparison.Ordinal);
        Assert.DoesNotContain("Ley ", html, StringComparison.Ordinal);
        Assert.DoesNotContain("debe responderse", html, StringComparison.Ordinal);
        Assert.DoesNotContain("días hábiles", subject, StringComparison.Ordinal);
        Assert.DoesNotContain("días hábiles", CandidateConsentConstants.NotificationMessage, StringComparison.Ordinal);
        Assert.Contains("22/10/2026", html, StringComparison.Ordinal);
        Assert.Contains("https://app.tims.test/settings/data-requests", html, StringComparison.Ordinal);
        Assert.Contains("&lt;Ana&gt;", html, StringComparison.Ordinal); // interpolations are HTML-encoded
        Assert.DoesNotContain("<Ana>", html, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Default_SendsTheEstimate_WithoutTheLey8968Wording()
    {
        var sender = new FakeSender();
        await new DataSubjectRequestNotifier(sender, DataSubjectRequestDeadline.Estimate)
            .SendAsync(Notice("a@tims.test"), Origin, CancellationToken.None);

        var (_, subject, html) = sender.Sent[0];
        Assert.Equal(DataSubjectRequestNotifier.Subject, subject);
        Assert.Contains("no es un plazo legal", html, StringComparison.Ordinal);
        Assert.DoesNotContain("8968", subject + html, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Ley8968_StatesTheNoticeResponseTime_OnTheCostaRicanCalendar()
    {
        var sender = new FakeSender();
        // Sat 3 Oct 2026 05:30 UTC is Fri 2 Oct 23:30 in San José: the email shows the Costa Rican date.
        var notice = new DataSubjectRequestNotice(
            [new DataSubjectRequestRecipient(Guid.NewGuid(), "a@tims.test", "Ana")],
            new DateTime(2026, 10, 3, 5, 30, 0, DateTimeKind.Utc));
        await new DataSubjectRequestNotifier(sender, DataSubjectRequestDeadline.Ley8968)
            .SendAsync(notice, Origin, CancellationToken.None);

        var (_, subject, html) = sender.Sent[0];
        Assert.Equal(DataSubjectRequestNotifier.Ley8968Subject, subject);
        Assert.Contains("responder en 5 días hábiles", subject, StringComparison.Ordinal);
        Assert.Contains("Ley N.° 8968", html, StringComparison.Ordinal);
        Assert.Contains("<strong>5 días hábiles</strong>", html, StringComparison.Ordinal);
        Assert.Contains("02/10/2026", html, StringComparison.Ordinal);
        Assert.DoesNotContain("15 días", subject + html, StringComparison.Ordinal);
        Assert.DoesNotContain("no es un plazo legal", html, StringComparison.Ordinal);
        Assert.Contains("https://app.tims.test/settings/data-requests", html, StringComparison.Ordinal);
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
