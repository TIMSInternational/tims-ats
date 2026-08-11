using Microsoft.EntityFrameworkCore;

namespace Tims.Infrastructure.OrgProvisioning;

/// <summary>
/// The triple of ids <c>provisionOrgDefaults</c> returns (<c>org-provisioning.ts:17,33</c>).
///
/// <para>All three production TS callers discard it; only
/// <c>tests/organization/signup-defaults.test.ts:72-75</c> consumes it. Preserved anyway — it is the
/// documented contract, #75 may want the ids, and dropping a return value during a port is a narrowing.</para>
/// </summary>
public sealed record OrgDefaultsIds(Guid CompanyId, Guid BusinessUnitId, Guid TeamId);

/// <summary>
/// The C# port of <c>packages/api/src/services/org-provisioning.ts</c> (Phase-5 slice 21, issue #76) — the
/// two helpers that turn a bare <c>organizations</c> row into a usable org.
///
/// <para><b>Ported FIRST because #75 depends on its shape.</b> <c>platform/invitations.ts:100-101</c> calls
/// the identical pair, in the same order, inside its own org-creation transaction. There is a third TS
/// caller too — <c>apps/web/app/auth/callback/route.ts:92-93</c>, self-serve signup — which is NOT in
/// scope for any C# slice, and which is why these tables can never reach <c>efcore[]</c>: the TS writer
/// cannot be retired.</para>
///
/// <para><b>#75's dependency is HALF satisfied by this file, and the other half is deliberately not here
/// yet.</b> <c>invitations.ts:83-114</c> needs FIVE things inside one transaction:
/// <c>organization.create</c> (<c>:84-91</c>), this helper pair (<c>:100-101</c>), <c>role.create</c>
/// (<c>:103-105</c>) and <c>subscription.create</c> (<c>:106-113</c>). Only the helper pair and the shared
/// <see cref="RoleWriteEntity"/> map live here. The <c>organizations</c> and <c>subscriptions</c> INSERTs —
/// and with them the two traps this slice paid for, the explicit <c>::"OrgPlan"</c>/<c>::"SubscriptionStatus"</c>
/// enum casts and the <c>Kind=Utc</c> → <c>Unspecified</c> timestamp normalisation — are still PRIVATE to
/// <c>PlatformOrganizationsCreateRepository</c>. #75 must either promote them here or re-derive them; it
/// must NOT assume calling this writer alone produces a usable org.</para>
///
/// <para><b>A static class in Infrastructure, not an Application port.</b> It operates on an EF
/// <see cref="DbContext"/>; an Application-layer interface over a <c>DbContext</c> would leak persistence
/// into Application for no seam. The house precedent for "shared EF logic two contexts both need" is
/// <c>AuditLogModelConfiguration</c> — a static extension in Infrastructure — and this is the same
/// shape.</para>
///
/// <para><b>The context parameter is the BASE <see cref="DbContext"/>, deliberately.</b> This IS the TS
/// <c>tx: Prisma.TransactionClient</c> first parameter. Typing it as the concrete
/// <c>PlatformOrganizationsCreateDbContext</c> would force #75 either to depend on the
/// platform-organizations context or to duplicate this writer — the exact drift the shared service exists
/// to prevent. Everything here needs only <c>Set&lt;T&gt;()</c>, <c>SaveChangesAsync</c> and
/// <c>Database</c>.</para>
///
/// <para><b>SaveChanges inside, Commit never.</b> The writer issues its own staged
/// <c>SaveChangesAsync</c> calls — which is what makes the FK order explicit and reviewable instead of
/// emergent, since these entities declare no navigation properties for EF to topologically sort by — but it
/// never opens or commits a transaction. The transaction is the caller's, exactly as in TS. Multiple
/// <c>SaveChangesAsync</c> inside one explicit transaction is fully atomic.</para>
/// </summary>
public static class OrgProvisioningWriter
{
    /// <summary><c>country: 'CO'</c>, hard-coded by the TS (<c>org-provisioning.ts:19</c>).</summary>
    public const string DefaultCountry = "CO";

    /// <summary><c>name: 'General'</c> (<c>org-provisioning.ts:24</c>).</summary>
    public const string DefaultBusinessUnit = "General";

    /// <summary><c>name: 'Equipo General'</c> (<c>org-provisioning.ts:29</c>).</summary>
    public const string DefaultTeam = "Equipo General";

    /// <summary>
    /// <c>planCode: 'ats-base'</c> (<c>org-provisioning.ts:52</c>) — hard-coded, and the organization's own
    /// <c>plan</c> is ignored entirely. Deliberate per the helper's own <c>:36-46</c> comment (INVU
    /// precedent: a professional-plan org still gets the full ats-base bundle). Do NOT add a plan parameter.
    /// </summary>
    public const string BasePlanCode = "ats-base";

    /// <summary><c>source: 'plan'</c> (<c>org-provisioning.ts:62</c>).</summary>
    public const string PlanSource = "plan";

    /// <summary>
    /// <c>provisionOrgDefaults</c> (<c>org-provisioning.ts:13-34</c>): one <c>companies</c> row, one
    /// <c>business_units</c> row under it, one <c>teams</c> row under that.
    ///
    /// <para>Strictly sequential with a <c>SaveChanges</c> per row, because each FKs the previous one. Every
    /// other column is left to its DB default (<c>currency 'USD'</c>, <c>timezone 'America/Bogota'</c>,
    /// <c>language 'es'</c>, <c>settings '{}'</c>, <c>is_active true</c>, <c>created_at</c>) or to NULL
    /// (<c>legal_name</c>, <c>tax_id</c>, <c>code</c>, <c>parent_id</c>, <c>leader_id</c>), matching the TS
    /// <c>create</c> payloads exactly.</para>
    /// </summary>
    /// <param name="companyName">
    /// Kept as a parameter even though all three TS callers pass the organization's own name: it IS a
    /// parameter there, and #75 supplies it from a DIFFERENT input field
    /// (<c>input.organizationName</c>, <c>invitations.ts:100</c>). Deriving it here would erase the seam #75
    /// needs.
    /// </param>
    public static async Task<OrgDefaultsIds> ProvisionDefaultsAsync(
        DbContext db,
        Guid organizationId,
        string companyName,
        DateTime now,
        CancellationToken cancellationToken)
    {
        EnsureCallerTransaction(db);
        now = ToPostgresTimestamp(now);

        var company = new CompanyWriteEntity
        {
            Id = Guid.NewGuid(),
            OrganizationId = organizationId,
            Name = companyName,
            Country = DefaultCountry,
            UpdatedAt = now,
        };

        db.Set<CompanyWriteEntity>().Add(company);
        await db.SaveChangesAsync(cancellationToken).ConfigureAwait(false);

        var businessUnit = new BusinessUnitWriteEntity
        {
            Id = Guid.NewGuid(),
            OrganizationId = organizationId,
            CompanyId = company.Id,
            Name = DefaultBusinessUnit,
            UpdatedAt = now,
        };

        db.Set<BusinessUnitWriteEntity>().Add(businessUnit);
        await db.SaveChangesAsync(cancellationToken).ConfigureAwait(false);

        var team = new TeamWriteEntity
        {
            Id = Guid.NewGuid(),
            OrganizationId = organizationId,
            BusinessUnitId = businessUnit.Id,
            Name = DefaultTeam,
            UpdatedAt = now,
        };

        db.Set<TeamWriteEntity>().Add(team);
        await db.SaveChangesAsync(cancellationToken).ConfigureAwait(false);

        return new OrgDefaultsIds(company.Id, businessUnit.Id, team.Id);
    }

    /// <summary>
    /// <c>provisionOrgEntitlements</c> (<c>org-provisioning.ts:47-67</c>): read the <c>ats-base</c>
    /// plan-module catalogue and INSERT one <c>org_entitlements</c> row per entry.
    ///
    /// <para><b>Ported exactly, including three things that look like omissions and are not.</b> There is no
    /// <c>OrderBy</c> — the TS <c>findMany</c> has none, so insert order is Postgres-unspecified and
    /// reproducing that is the port (it is unobservable in practice: <c>activated_at DEFAULT
    /// CURRENT_TIMESTAMP</c> evaluates to TRANSACTION START, so all N rows share one timestamp regardless).
    /// There is no <c>kind != 'addon'</c> filter — the addon exclusion is a property of the SEED
    /// (<c>seed-entitlements.ts:22-25</c>), not of this query, and adding one would be an improvement and a
    /// divergence. And it is a plain INSERT, not an upsert, documented at <c>org-provisioning.ts:36-40</c>:
    /// neither helper is idempotent, and a retry hits
    /// <c>org_entitlements_organization_id_module_code_key</c>.</para>
    ///
    /// <para><b>An empty catalogue is a valid outcome, not an error (fail-OPEN).</b> If <c>plan_modules</c>
    /// holds no <c>ats-base</c> rows, the TS loop simply does not execute and the transaction commits an
    /// organization with zero entitlements. Reproduced: returns <c>0</c>, throws nothing.</para>
    /// </summary>
    /// <returns>
    /// The number of entitlement rows granted. The TS returns <c>void</c>; this returns the count purely so
    /// the fail-open case above is ASSERTABLE in a test instead of invisible. No caller is required to check
    /// it, so it is zero behaviour change — divergence (4) in
    /// <c>docs/architecture/csharp-migration/phase-5-slice-21-platform-organizations-create.md</c>,
    /// recorded as added observability so a reviewer can strike it.
    /// </returns>
    public static async Task<int> ProvisionEntitlementsAsync(
        DbContext db,
        Guid organizationId,
        DateTime now,
        CancellationToken cancellationToken)
    {
        EnsureCallerTransaction(db);
        now = ToPostgresTimestamp(now);

        var planModules = await db.Set<PlanModuleReadEntity>()
            .AsNoTracking()
            .Where(pm => pm.PlanCode == BasePlanCode)
            .Select(pm => new { pm.ModuleCode, pm.Limit })
            .ToListAsync(cancellationToken)
            .ConfigureAwait(false);

        if (planModules.Count == 0)
        {
            return 0;
        }

        foreach (var planModule in planModules)
        {
            db.Set<OrgEntitlementWriteEntity>().Add(new OrgEntitlementWriteEntity
            {
                Id = Guid.NewGuid(),
                OrganizationId = organizationId,
                ModuleCode = planModule.ModuleCode,
                Enabled = true,
                Source = PlanSource,
                Limit = planModule.Limit,
                UpdatedAt = now,
            });
        }

        await db.SaveChangesAsync(cancellationToken).ConfigureAwait(false);
        return planModules.Count;
    }

    /// <summary>
    /// Strips the <c>Kind=Utc</c> tag (and only the tag) from the caller's clock reading.
    ///
    /// <para><b>Not defensive padding — without it this writer throws against a real Postgres.</b> Every
    /// <c>updated_at</c> here is <c>timestamp WITHOUT time zone</c>, and Npgsql refuses to bind a
    /// <c>Kind=Utc</c> <see cref="DateTime"/> to that type ("consider using 'timestamp with time zone'").
    /// The natural caller value is <c>TimeProvider.GetUtcNow().UtcDateTime</c>, whose Kind IS Utc, so the
    /// obvious usage would fail on the first INSERT while every unit test stayed green. Normalising here
    /// rather than only in the calling repository means #75 inherits the fix instead of rediscovering it.
    /// The instant is unchanged: the column holds a UTC wall-clock by Prisma's own convention.</para>
    /// </summary>
    private static DateTime ToPostgresTimestamp(DateTime value) =>
        DateTime.SpecifyKind(value, DateTimeKind.Unspecified);

    /// <summary>
    /// <b>An ADDED GUARD, not a port of anything.</b> Recorded as divergence #5 in
    /// <c>docs/architecture/csharp-migration/phase-5-slice-21-platform-organizations-create.md</c> so a
    /// reviewer can strike it.
    ///
    /// <para><c>Prisma.TransactionClient</c> is <c>Omit&lt;PrismaClient, ITXClientDenyList&gt;</c>, so a
    /// full <c>PrismaClient</c> is structurally assignable — nothing stops a TS caller passing the global
    /// <c>db</c> and getting non-atomic auto-commit writes. The atomicity guarantee rests entirely on a
    /// prose comment (<c>org-provisioning.ts:8-10</c>). C# has the same hole and can close it.</para>
    ///
    /// <para>It is proposed despite the standing "port exactly" rule because it changes no path the TS
    /// supports: every TS caller is inside <c>$transaction</c>, so this is unreachable on every successful
    /// path and fires only on a misuse the TS comment already forbids.</para>
    ///
    /// <para>Pinned by <c>OrgProvisioningWriterTests</c> — BOTH helpers, both directions. Without those the
    /// guard is exactly the "reinstated-around with all assertions green" shape
    /// (<c>feedback_tripwires_need_their_own_mutation_proof</c>): every other test in this slice reaches
    /// this writer through <c>PlatformOrganizationsCreateRepository</c>, which always opens a
    /// <c>TenantScope</c> transaction first, so deleting both call sites would have been invisible.</para>
    /// </summary>
    /// <exception cref="InvalidOperationException">The caller has no open transaction.</exception>
    private static void EnsureCallerTransaction(DbContext db)
    {
        if (db.Database.CurrentTransaction is null)
        {
            throw new InvalidOperationException(
                "org-provisioning must run inside the caller's transaction (org-provisioning.ts:8-10)");
        }
    }
}
