namespace Tims.Application.PlatformInvitations;

/// <summary>
/// Data access for the platform-owner invitations READ surface (Phase-5 slice 22, issue #75).
///
/// <para><b>Every method is deliberately CROSS-ORG and is never wrapped in
/// <c>Tims.Infrastructure.TenantScope</c>.</b> The TS procedures use the privileged, unscoped <c>db</c>
/// client with no <c>organizationId</c> predicate anywhere, because a platform owner is supposed to see
/// every tenant's invitations. So Postgres RLS restricts nothing on this path (and the prod login role is
/// BYPASSRLS regardless) — <c>PlatformOwnerGate</c> is the ENTIRE authorization boundary. Do not "fix" any
/// of these into a tenant-scoped read: that would silently empty the platform console.</para>
/// </summary>
public interface IPlatformInvitationsReadRepository
{
    /// <summary>
    /// The four <c>getInvitationKpis</c> counts, unfiltered and cross-org.
    /// <c>pending</c> counts status IN (<c>pending</c>, <c>sent</c>) — two statuses under one key, which is
    /// the TS behaviour and the one thing about this endpoint that is not obvious from its name.
    /// </summary>
    Task<PlatformInvitationKpis> GetKpisAsync(CancellationToken cancellationToken);

    /// <summary>One page of invitations plus the unpaged total for the same filter.</summary>
    Task<PlatformInvitationListResult> ListAsync(PlatformInvitationListQuery query, CancellationToken cancellationToken);

    /// <summary>
    /// EVERY row matching the filter, unbounded — no take, no cap. That is the TS behaviour
    /// (<c>exportInvitationsCsv</c> passes neither <c>take</c> nor <c>skip</c>), and it is reproduced rather
    /// than capped: the audit-log export's <c>ExportCap</c> has no counterpart on the TS side of THIS
    /// surface, so adding one would be a C#-only narrowing that turns a real exposure into a parity FAIL
    /// while the flag is dark. Recorded as a known risk in the slice doc instead.
    /// </summary>
    Task<IReadOnlyList<PlatformInvitationExportRow>> ExportAsync(PlatformInvitationExportQuery query, CancellationToken cancellationToken);
}
