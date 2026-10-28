using System.Globalization;
using Microsoft.EntityFrameworkCore;
using Tims.Application.CandidateConsent;

namespace Tims.Infrastructure.CandidateConsent;

/// <summary>Data subject requests: the staff list and the in-transaction admin alerts for a new request.</summary>
public sealed partial class CandidateConsentRepository
{
    public async Task<DataSubjectRequestListView> ListRequestsAsync(
        Guid organizationId, string? status, CancellationToken cancellationToken)
    {
        await using var scope = await TenantScope.BeginAsync(_db, organizationId, cancellationToken).ConfigureAwait(false);
        var query = _db.SubjectRequests.AsNoTracking().Where(r => r.OrganizationId == organizationId);
        if (status is not null)
        {
            query = query.Where(r => r.Status == status);
        }

        var rows = await query
            .OrderBy(r => r.CreatedAt)
            .ThenBy(r => r.Id)
            .Take(CandidateConsentConstants.MaxListRows)
            .Select(r => new
            {
                r.Id,
                r.CandidateId,
                r.RequestType,
                r.Status,
                r.Source,
                r.CreatedAt,
                Candidate = _db.Candidates
                    .Where(c => c.Id == r.CandidateId && c.OrganizationId == organizationId)
                    .Select(c => new { c.FirstName, c.LastName })
                    .FirstOrDefault(),
            })
            .ToListAsync(cancellationToken)
            .ConfigureAwait(false);

        return new DataSubjectRequestListView(rows.Select(r => new DataSubjectRequestListItem(
            r.Id.ToString(),
            r.CandidateId.ToString(),
            r.Candidate?.FirstName,
            r.Candidate?.LastName,
            r.RequestType,
            r.Status,
            r.Source,
            FormatUtc(r.CreatedAt),
            FormatUtc(BusinessDays.DueAt(r.CreatedAt)))).ToList());
    }

    /// <summary>
    /// Stages (does not save) one <c>notifications</c> row per NEW request for every ACTIVE, non-deleted user of the
    /// org holding an active <c>hr_admin</c> or <c>super_admin</c> role (any of their roles; each user once), and
    /// returns them for the post-commit email. The text names no candidate. Null when the org has no such admin.
    /// </summary>
    private async Task<DataSubjectRequestNotice?> StageAdminAlertsAsync(
        Guid organizationId, IReadOnlyList<Guid> requestIds, DateTime now, CancellationToken cancellationToken)
    {
        var slugs = CandidateConsentConstants.RequestNotifyRoleSlugs.ToList();
        var recipients = await _db.Users.AsNoTracking()
            .Where(u => u.OrganizationId == organizationId && u.IsActive && u.DeletedAt == null
                && _db.UserRoles.Any(ur => ur.UserId == u.Id
                    && _db.Roles.Any(role => role.Id == ur.RoleId && role.OrganizationId == organizationId
                        && role.IsActive && slugs.Contains(role.Slug))))
            .OrderBy(u => u.Id)
            .Select(u => new DataSubjectRequestRecipient(u.Id, u.Email, u.FirstName))
            .Take(100)
            .ToListAsync(cancellationToken)
            .ConfigureAwait(false);
        if (recipients.Count == 0)
        {
            return null;
        }

        foreach (var requestId in requestIds)
        {
            foreach (var recipient in recipients)
            {
                _db.Notifications.Add(new ConsentNotificationEntity
                {
                    Id = Guid.NewGuid(),
                    OrganizationId = organizationId,
                    UserId = recipient.UserId,
                    Type = CandidateConsentConstants.NotificationType,
                    Title = CandidateConsentConstants.NotificationTitle,
                    Message = CandidateConsentConstants.NotificationMessage,
                    Module = CandidateConsentConstants.NotificationModule,
                    EntityType = CandidateConsentConstants.NotificationEntityType,
                    EntityId = requestId,
                    ActionUrl = CandidateConsentConstants.StaffListPath,
                });
            }
        }

        return new DataSubjectRequestNotice(recipients, BusinessDays.DueAt(now));
    }

    private static string FormatUtc(DateTime value) =>
        DateTime.SpecifyKind(value, DateTimeKind.Utc).ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", CultureInfo.InvariantCulture);
}
