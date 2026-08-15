namespace Tims.Application.PlatformDashboard;

/// <summary>
/// The two cross-org lookups behind <c>search</c> (Phase-5 slice 23, issue #81, PR 2 of 3). The third
/// result set — <c>pages</c> — is a static in-process list and needs no repository.
/// </summary>
public interface IPlatformDashboardSearchRepository
{
    /// <summary><c>name | slug | domain</c> case-insensitively CONTAINING the term, name ascending,
    /// capped.</summary>
    Task<IReadOnlyList<SearchOrganizationItem>> SearchOrganizationsAsync(string term, int take, CancellationToken cancellationToken);

    /// <summary><c>first_name | last_name | email</c> case-insensitively CONTAINING the term, first name
    /// ascending, capped. Note the TS query has NO <c>is_active</c> or <c>deleted_at</c> filter — a
    /// deactivated user is findable, and <c>isActive</c> is returned so the UI can say so.</summary>
    Task<IReadOnlyList<SearchUserItem>> SearchUsersAsync(string term, int take, CancellationToken cancellationToken);
}
