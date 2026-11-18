namespace Tims.Application.CandidateConsent;

/// <summary>
/// The staff-facing deadline for answering a data subject request: how many business days after receipt, counted on
/// which calendar, and how the admin notification words it. Selected once at startup by
/// <c>Platform:CandidateNoticeLey8968Enabled</c> (DEFAULT false):
/// <list type="bullet">
/// <item><see cref="Estimate"/> (default): the country-neutral estimate — 15 business days on UTC−05:00, presented as
/// an estimate that is not a legal deadline (<see cref="BusinessDays.DueAt(DateTime)"/>).</item>
/// <item><see cref="Ley8968"/>: the response time the Costa Rica (Ley N.° 8968) candidate notice states — 5 business
/// days, counted on Costa Rica time (UTC−06:00, no daylight saving since 1992). Turn it on together with the web
/// app's Ley 8968 notice, so staff are reminded of the same deadline candidates are told. The 5-day window awaits
/// confirmation by the data controller's counsel.</item>
/// </list>
/// Holidays are never excluded, so the computed date can only be earlier than the deadline, never later.
/// </summary>
public sealed record DataSubjectRequestDeadline(int ResponseDays, TimeSpan UtcOffset, bool IsLey8968)
{
    /// <summary>Costa Rica's UTC offset. Costa Rica has not observed daylight saving since 1992.</summary>
    public static readonly TimeSpan CostaRicaOffset = TimeSpan.FromHours(-6);

    /// <summary>The country-neutral estimate every organization sees by default.</summary>
    public static readonly DataSubjectRequestDeadline Estimate =
        new(BusinessDays.DataSubjectRequestResponseDays, BusinessDays.ColombiaOffset, IsLey8968: false);

    /// <summary>The response time stated by the Ley N.° 8968 candidate notice (<c>portalPrivacyLey8968.exerciseBody</c>).</summary>
    public static readonly DataSubjectRequestDeadline Ley8968 = new(5, CostaRicaOffset, IsLey8968: true);

    public static DataSubjectRequestDeadline For(bool ley8968NoticeEnabled) => ley8968NoticeEnabled ? Ley8968 : Estimate;

    /// <summary>In-app notification text for a new request (staff register: tú).</summary>
    public string NotificationMessage => IsLey8968
        ? "Un candidato solicitó la supresión de sus datos personales. Según el aviso de privacidad para candidatos, debe responderse dentro de 5 días hábiles."
        : CandidateConsentConstants.NotificationMessage;

    /// <summary>The deadline of a request created at <paramref name="createdAtUtc"/>; a UTC instant, same time of day.</summary>
    public DateTime DueAt(DateTime createdAtUtc) => BusinessDays.DueAt(createdAtUtc, ResponseDays, UtcOffset);

    /// <summary>The calendar date of <paramref name="utc"/> on this policy's calendar, as <c>dd/MM/yyyy</c>.</summary>
    public string LocalDate(DateTime utc) => BusinessDays.LocalDate(utc, UtcOffset);
}
