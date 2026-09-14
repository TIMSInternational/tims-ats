namespace Tims.Application.PlatformInvitations;

// Internal snapshot: token is a bearer credential and must never appear in an API DTO or audit metadata.
public sealed record InvitationResendSnapshot(Guid Id, string Email, string Token, string Status,
    Guid? OrganizationId, string? OrganizationName, DateTime UpdatedAt);

public interface IInvitationResendRepository
{
    Task<InvitationResendSnapshot?> FindAsync(Guid id, CancellationToken ct);
    Task<bool> MarkSentAsync(InvitationResendSnapshot expected, DateTime sentAt, DateTime expiresAt, CancellationToken ct);
}
