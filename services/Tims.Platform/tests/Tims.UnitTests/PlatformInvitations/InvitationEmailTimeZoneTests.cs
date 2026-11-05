using Tims.Application.PlatformInvitations;

namespace Tims.UnitTests.PlatformInvitations;

/// <summary>Pilot UX audit E-23: the invitation's expiry is stated in the organization's time zone.</summary>
public sealed class InvitationEmailTimeZoneTests
{
    private const string Url = "https://app.example.test/accept-invitation?token=t";
    // 03:00 UTC on 16 November is 21:00 on 15 November in Costa Rica.
    private static readonly DateTime ExpiresAt = new(2026, 11, 16, 3, 0, 0, DateTimeKind.Utc);

    [Fact]
    public void Spanish_email_states_the_local_day_with_the_zone_label()
    {
        var body = InvitationEmail.Render("Org", "recruiter", Url, ExpiresAt, timeZone: "America/Costa_Rica");
        Assert.Contains("Válida hasta: 15 de noviembre de 2026, 9:00", body);
        Assert.Contains("hora de Costa Rica (GMT-6)</span>", body);
        Assert.DoesNotContain("16 de noviembre", body);
        Assert.DoesNotContain("UTC", body);
    }

    [Fact]
    public void English_email_states_the_local_day_with_the_zone_label()
    {
        var body = InvitationEmail.Render("Org", "recruiter", Url, ExpiresAt, "en", timeZone: "America/Costa_Rica");
        Assert.Contains("Valid until: November 15, 2026, 9:00 PM, Costa Rica time (GMT-6)</span>", body);
    }

    [Fact]
    public void Without_a_zone_the_expiry_is_stated_in_utc_labelled()
    {
        var body = InvitationEmail.Render("Org", null, Url, ExpiresAt, reminder: true);
        Assert.Contains("Válida hasta: 16 de noviembre de 2026, 3:00", body);
        Assert.Contains(" (UTC)</span>", body);
    }
}
