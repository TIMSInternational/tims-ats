namespace Tims.Application.PlatformOrganizations;

/// <summary>
/// Data access for the platform-owner organizations READ surface (Phase-5 slice 19, issue #76).
///
/// <para><b>NEVER wrapped in TenantScope.</b> Every method here is deliberately CROSS-ORG: a platform
/// owner is not a tenant member, so there is no <c>SET LOCAL ROLE app_tenant</c> + org GUC to wrap.
/// This mirrors <c>AuditReadDbContext</c> and the statement at <c>Program.cs:448</c>. The authorization
/// boundary is <c>PlatformOwnerGate</c> alone — RLS does not restrict this reader, and on production
/// the connecting role is BYPASSRLS regardless.</para>
/// </summary>
public interface IPlatformOrganizationsReadRepository
{
    /// <summary>The five counts behind <c>getOrganizationKpis</c> (<c>organizations.ts:25-40</c>).</summary>
    /// <param name="now">
    /// Injected rather than read from the clock inside the repository so the 7-day trial window is
    /// deterministic under test — <c>expiringThisWeek</c> is <c>trialEndsAt BETWEEN now AND now+7d</c>.
    /// </param>
    Task<PlatformOrganizationKpis> GetKpisAsync(DateTime now, CancellationToken cancellationToken);

    /// <summary>
    /// <c>listOrganizations</c>. Returns the page plus the total matching the SAME filter, exactly as the
    /// TS returns <c>{ organizations, total }</c>.
    /// </summary>
    Task<PlatformOrganizationListResult> ListAsync(PlatformOrganizationListQuery query, CancellationToken cancellationToken);

    /// <summary>
    /// <c>getOrganization</c>. Null when the id does not exist — the endpoint turns that into 404, matching
    /// the TS <c>TRPCError({ code: 'NOT_FOUND' })</c> at <c>organizations.ts:145</c>.
    /// </summary>
    Task<PlatformOrganizationDetail?> GetByIdAsync(Guid id, CancellationToken cancellationToken);
}
