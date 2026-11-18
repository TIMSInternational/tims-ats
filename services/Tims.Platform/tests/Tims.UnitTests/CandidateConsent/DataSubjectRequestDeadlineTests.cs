using Tims.Application.CandidateConsent;

namespace Tims.UnitTests.CandidateConsent;

public sealed class DataSubjectRequestDeadlineTests
{
    [Fact]
    public void Default_IsTheCountryNeutralEstimate_Unchanged()
    {
        var policy = DataSubjectRequestDeadline.For(ley8968NoticeEnabled: false);
        Assert.Same(DataSubjectRequestDeadline.Estimate, policy);
        Assert.False(policy.IsLey8968);
        Assert.Equal(15, policy.ResponseDays);
        Assert.Equal(TimeSpan.FromHours(-5), policy.UtcOffset);
        Assert.Equal(CandidateConsentConstants.NotificationMessage, policy.NotificationMessage);

        // The same instants the pre-existing BusinessDays.DueAt produces (Thu 1 Oct 2026 + 15 = Thu 22 Oct).
        var stored = new DateTime(2026, 10, 1, 15, 30, 0, DateTimeKind.Unspecified);
        Assert.Equal(BusinessDays.DueAt(stored), policy.DueAt(stored));
        Assert.Equal(new DateTime(2026, 10, 22, 15, 30, 0, DateTimeKind.Utc), policy.DueAt(stored));
    }

    [Fact]
    public void Ley8968_IsFiveBusinessDays_OnTheCostaRicanCalendar()
    {
        var policy = DataSubjectRequestDeadline.For(ley8968NoticeEnabled: true);
        Assert.Same(DataSubjectRequestDeadline.Ley8968, policy);
        Assert.True(policy.IsLey8968);
        Assert.Equal(5, policy.ResponseDays);
        Assert.Equal(TimeSpan.FromHours(-6), policy.UtcOffset);

        // Thu 1 Oct 2026 15:30 UTC + 5 business days = Thu 8 Oct, same time of day.
        Assert.Equal(
            new DateTime(2026, 10, 8, 15, 30, 0, DateTimeKind.Utc),
            policy.DueAt(new DateTime(2026, 10, 1, 15, 30, 0, DateTimeKind.Utc)));
    }

    [Fact]
    public void Ley8968_CountsFromTheCostaRicanDay_NotColombias()
    {
        // Sat 3 Oct 05:30 UTC is still Fri 2 Oct 23:30 in San José (UTC−6) but already Sat 3 Oct 00:30 in Bogotá
        // (UTC−5). Counted from FRIDAY → Fri 9 Oct 23:30 San José = Sat 10 Oct 05:30 UTC.
        var due = DataSubjectRequestDeadline.Ley8968.DueAt(new DateTime(2026, 10, 3, 5, 30, 0, DateTimeKind.Utc));
        Assert.Equal(new DateTime(2026, 10, 10, 5, 30, 0, DateTimeKind.Utc), due);
        Assert.Equal(DateTimeKind.Utc, due.Kind);
        Assert.Equal("09/10/2026", DataSubjectRequestDeadline.Ley8968.LocalDate(due));
    }

    [Fact]
    public void Ley8968_HolidaysAreNotExcluded()
    {
        // Tue 15 Sep 2026 is a Costa Rican public holiday (Independence Day) and still counts: the date can only be
        // earlier than the deadline, never later. Mon 14 Sep 10:00 UTC + 5 = Mon 21 Sep.
        Assert.Equal(
            new DateTime(2026, 9, 21, 10, 0, 0, DateTimeKind.Utc),
            DataSubjectRequestDeadline.Ley8968.DueAt(new DateTime(2026, 9, 14, 10, 0, 0, DateTimeKind.Utc)));
    }

    [Fact]
    public void Ley8968_NotificationStatesTheNoticeResponseTime()
    {
        Assert.Contains("5 días hábiles", DataSubjectRequestDeadline.Ley8968.NotificationMessage, StringComparison.Ordinal);
        Assert.Contains("aviso de privacidad para candidatos", DataSubjectRequestDeadline.Ley8968.NotificationMessage,
            StringComparison.Ordinal);
    }
}
