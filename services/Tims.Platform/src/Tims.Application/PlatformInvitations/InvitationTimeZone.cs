namespace Tims.Application.PlatformInvitations;

/// <summary>
/// The organization's time zone for an invitation email's expiry line (Pilot UX audit E-23). Best effort: by the
/// time it runs the invitation is already committed (or about to be resent), so a failed read must not stop the
/// email. The expiry is then stated in UTC, labelled as such (<see cref="InvitationEmail"/>).
/// </summary>
public static class InvitationTimeZone
{
    public static async Task<string?> FindAsync(IInvitationResendRepository repository, Guid? organizationId,
        CancellationToken ct)
    {
        if (organizationId is not { } id || id == Guid.Empty) return null;
        try { return await repository.FindTimeZoneAsync(id, ct); }
        catch (Exception) { return null; }
    }
}
