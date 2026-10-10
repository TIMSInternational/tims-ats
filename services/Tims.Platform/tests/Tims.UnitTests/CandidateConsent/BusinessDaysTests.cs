using Tims.Application.CandidateConsent;

namespace Tims.UnitTests.CandidateConsent;

public sealed class BusinessDaysTests
{
    private static DateTime D(int month, int day, int hour = 10) => new(2026, month, day, hour, 0, 0, DateTimeKind.Utc);

    [Fact]
    public void Friday_PlusOne_IsMonday() =>
        Assert.Equal(D(10, 5), BusinessDays.AddBusinessDays(D(10, 2), 1)); // Fri 2 Oct 2026 → Mon 5 Oct

    [Theory]
    [InlineData(3)] // Saturday
    [InlineData(4)] // Sunday
    public void WeekendStart_PlusOne_IsMonday(int day) =>
        Assert.Equal(D(10, 5), BusinessDays.AddBusinessDays(D(10, day), 1));

    [Fact]
    public void WeekendStart_PlusFifteen_CountsFromMonday() =>
        Assert.Equal(D(10, 23), BusinessDays.AddBusinessDays(D(10, 3), 15)); // Sat 3 → Fri 23 Oct

    [Fact]
    public void Fifteen_SpanningThreeWeekends()
    {
        // Thu 1 Oct 2026: Fri 2 (1), 5–9 (2–6), 12–16 (7–11), 19–22 (12–15) → Thu 22 Oct.
        Assert.Equal(D(10, 22), BusinessDays.AddBusinessDays(D(10, 1), 15));
        // Monday + 15 = Monday three weeks later.
        Assert.Equal(D(10, 26), BusinessDays.AddBusinessDays(D(10, 5), 15));
    }

    [Fact]
    public void Zero_IsIdentity_AndNegativeThrows()
    {
        Assert.Equal(D(10, 3), BusinessDays.AddBusinessDays(D(10, 3), 0));
        Assert.Throws<ArgumentOutOfRangeException>(() => BusinessDays.AddBusinessDays(D(10, 3), -1));
    }

    [Fact]
    public void Holidays_AreNotExcluded()
    {
        // Mon 12 Oct 2026 is a Colombian public holiday (Día de la Raza) and is still counted: the result can only be
        // earlier than the legal deadline, never later.
        Assert.Equal(D(10, 12), BusinessDays.AddBusinessDays(D(10, 9), 1));
    }

    [Fact]
    public void DueAt_CountsOnTheColombianCalendar_KeepingTimeOfDay()
    {
        // Sun 4 Oct 20:00 in Bogotá = Mon 5 Oct 01:00 UTC. Counted from SUNDAY (Bogotá) → Fri 23 Oct 20:00 Bogotá,
        // not from Monday (which would give Mon 26 Oct — later than the legal deadline).
        var due = BusinessDays.DueAt(D(10, 5, 1));
        Assert.Equal(new DateTime(2026, 10, 24, 1, 0, 0, DateTimeKind.Utc), due);
        Assert.Equal(DateTimeKind.Utc, due.Kind);
        Assert.Equal("23/10/2026", BusinessDays.ColombiaDate(due));
    }

    [Fact]
    public void DueAt_AcceptsAStoredUnspecifiedTimestamp()
    {
        var stored = new DateTime(2026, 10, 1, 15, 30, 0, DateTimeKind.Unspecified);
        Assert.Equal(new DateTime(2026, 10, 22, 15, 30, 0, DateTimeKind.Utc), BusinessDays.DueAt(stored));
    }
}
