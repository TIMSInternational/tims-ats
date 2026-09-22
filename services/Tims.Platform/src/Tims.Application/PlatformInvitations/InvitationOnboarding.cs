namespace Tims.Application.PlatformInvitations;

public sealed record InvitationSetup(Guid Id, string Email, Guid OrganizationId, string OrganizationName,
    string? RoleSlug, string Status, DateTime ExpiresAt, bool AccountExists, bool SetupCompleted = false);
public sealed record SetupIdentity(string Id, string Email);
public sealed record SetupProfile(string FirstName, string LastName);
public sealed record SetupResult(string Outcome);

public interface IInvitationOnboardingRepository
{
    Task<InvitationSetup?> PreviewAsync(string token, CancellationToken ct);
    Task<bool> CompleteAsync(string token, SetupIdentity identity, SetupProfile profile, CancellationToken ct);
}

public interface IInvitationIdentityProvider
{
    Task<bool> CreateAsync(string email, string password, CancellationToken ct);
    Task<SetupIdentity?> VerifyAsync(string accessToken, CancellationToken ct);
}

/// <summary>
/// Coordinates identity creation and tenant finalization without persisting passwords. Identity creation
/// alone grants no TIMS access; a verified Supabase session must complete the invitation separately.
/// </summary>
public sealed class InvitationOnboarding(IInvitationOnboardingRepository repository,
    IInvitationIdentityProvider identities, TimeProvider clock)
{
    public Task<InvitationSetup?> PreviewAsync(string token, CancellationToken ct) => repository.PreviewAsync(token, ct);

    public static bool ValidToken(string token) => Guid.TryParseExact(token, "D", out var id) && id != Guid.Empty;

    public static bool ValidProfile(SetupProfile profile) => ValidName(profile.FirstName) && ValidName(profile.LastName);

    private static bool ValidName(string value) =>
        !string.IsNullOrWhiteSpace(value) && value.Length <= 100 && !value.Any(char.IsControl);

    private bool Available(InvitationSetup? invitation) => invitation is not null &&
        invitation.Status is "pending" or "sent" or "accepted" && invitation.ExpiresAt > clock.GetUtcNow().UtcDateTime;

    public async Task<SetupResult> RegisterAsync(string token, string password, CancellationToken ct)
    {
        if (!ValidToken(token) || password.Length is < 12 or > 128) return new("invalid_input");
        var invitation = await repository.PreviewAsync(token, ct);
        if (!Available(invitation) || invitation!.Status == "accepted") return new("unavailable");
        if (invitation.AccountExists) return new("sign_in_required");
        return new(await identities.CreateAsync(invitation.Email, password, ct)
            ? "account_created"
            : "sign_in_or_retry");
    }

    public async Task<SetupResult> CompleteAsync(string token, string accessToken, SetupProfile profile,
        CancellationToken ct)
    {
        if (!ValidToken(token) || !ValidProfile(profile)) return new("invalid_input");
        var identity = await identities.VerifyAsync(accessToken, ct);
        if (identity is null) return new("sign_in_required");
        var invitation = await repository.PreviewAsync(token, ct);
        if (!Available(invitation)) return new("unavailable");
        if (!string.Equals(identity.Email, invitation!.Email, StringComparison.OrdinalIgnoreCase))
            return new("wrong_account");
        return new(await repository.CompleteAsync(token, identity, profile, ct) ? "complete" : "access_conflict");
    }
}
