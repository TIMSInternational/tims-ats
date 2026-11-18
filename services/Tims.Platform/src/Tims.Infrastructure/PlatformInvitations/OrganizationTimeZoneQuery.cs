using Microsoft.EntityFrameworkCore;

namespace Tims.Infrastructure.PlatformInvitations;

/// <summary>
/// The organization's configured IANA time zone (<c>settings.timezone</c>), else its oldest active company's, or
/// null. Only names PostgreSQL knows (<c>pg_timezone_names</c>) are accepted, so a typo falls through to the next
/// source. The same rule as <c>InvitationOnboardingRepository.TenantTimeZoneAsync</c> (F-2b), which runs on a raw
/// Npgsql transaction instead of a DbContext. The caller owns any tenant scope.
/// </summary>
internal static class OrganizationTimeZoneQuery
{
    public static Task<string?> FindAsync(DbContext db, Guid organizationId, CancellationToken ct) =>
        db.Database.SqlQuery<string>($"""
            SELECT candidate.zone AS "Value" FROM (VALUES
              (1, (SELECT NULLIF(btrim(o.settings->>'timezone'),'') FROM organizations o WHERE o.id={organizationId})),
              (2, (SELECT NULLIF(btrim(c.timezone),'') FROM companies c
                   WHERE c.organization_id={organizationId} AND c.is_active ORDER BY c.created_at, c.id LIMIT 1))
            ) AS candidate(rank, zone)
            WHERE candidate.zone IN (SELECT name FROM pg_timezone_names)
            ORDER BY candidate.rank LIMIT 1
            """).FirstOrDefaultAsync(ct);
}
