namespace Tims.Application.CandidateConsent;

/// <summary>
/// Business-day arithmetic for the data-subject-request response deadline (Ley 1581 de 2012, art. 15: a reclamo
/// must be answered within 15 días hábiles). Pure and clock-free.
///
/// <para><b>Holidays are NOT excluded.</b> Only Saturdays and Sundays are skipped; Colombian public holidays
/// (festivos) are counted as working days, so the computed date can be EARLIER than the legal deadline — never later.
/// That is the conservative direction for a compliance reminder: staff are told to answer sooner, not later.</para>
///
/// <para><b>Calendar.</b> <see cref="DueAt"/> decides which calendar day an instant falls on in Colombia time
/// (fixed UTC−05:00 — Colombia observes no daylight saving), so a request filed on Friday 21:00 in Bogotá
/// (Saturday 02:00 UTC) counts from Friday, not from Saturday. The returned instant keeps the request's
/// time of day.</para>
/// </summary>
public static class BusinessDays
{
    /// <summary>Response window for a data subject request, in business days (Ley 1581 de 2012, art. 15).</summary>
    public const int DataSubjectRequestResponseDays = 15;

    /// <summary>Colombia's UTC offset. Colombia has not observed daylight saving since 1993.</summary>
    public static readonly TimeSpan ColombiaOffset = TimeSpan.FromHours(-5);

    /// <summary>
    /// Adds <paramref name="days"/> business days (Mon–Fri) to <paramref name="start"/>, keeping its time of day and
    /// <see cref="DateTime.Kind"/>. The start day itself never counts: Friday + 1 = Monday, Saturday + 1 = Monday.
    /// </summary>
    public static DateTime AddBusinessDays(DateTime start, int days)
    {
        ArgumentOutOfRangeException.ThrowIfNegative(days);
        var current = start;
        var remaining = days;
        while (remaining > 0)
        {
            current = current.AddDays(1);
            if (current.DayOfWeek is not (DayOfWeek.Saturday or DayOfWeek.Sunday))
            {
                remaining--;
            }
        }

        return current;
    }

    /// <summary>
    /// The response deadline of a data subject request created at <paramref name="createdAtUtc"/> (a UTC instant of
    /// any <see cref="DateTime.Kind"/>): 15 business days later, counted on the Colombian calendar. Returns a UTC
    /// instant (Kind=Utc) at the same time of day as the request.
    /// </summary>
    public static DateTime DueAt(DateTime createdAtUtc)
    {
        var local = DateTime.SpecifyKind(createdAtUtc, DateTimeKind.Unspecified) + ColombiaOffset;
        var dueLocal = AddBusinessDays(local, DataSubjectRequestResponseDays);
        return DateTime.SpecifyKind(dueLocal - ColombiaOffset, DateTimeKind.Utc);
    }

    /// <summary>The Colombian calendar date of a UTC instant, as <c>dd/MM/yyyy</c> (for Spanish emails).</summary>
    public static string ColombiaDate(DateTime utc) =>
        (DateTime.SpecifyKind(utc, DateTimeKind.Unspecified) + ColombiaOffset)
            .ToString("dd/MM/yyyy", System.Globalization.CultureInfo.InvariantCulture);
}
