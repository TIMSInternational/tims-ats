namespace Tims.Application.PlatformOrganizations;

/// <summary>
/// The persistence port for the platform-owner organization CREATE surface (Phase-5 slice 21, issue #76) —
/// the C# port of <c>createOrganization</c> (<c>routers/platform/organizations.ts:104-169</c>).
///
/// <para><b>ONE method for SEVEN tables plus the audit row, on purpose.</b> The TS side wraps
/// <c>organizations</c> + <c>companies</c> + <c>business_units</c> + <c>teams</c> + <c>org_entitlements</c>
/// + <c>roles</c> + <c>subscriptions</c> in a single <c>db.$transaction</c> (<c>:113-147</c>), and
/// Federico's decision on #76 adds the <c>org_created</c> audit row to that same transaction (FAIL-CLOSED,
/// diverging from the TS <c>.catch(() =&gt; {})</c> at <c>:166</c>). A fail-closed audit that a caller can
/// split back out is theatre — throwing after the seven tables have committed leaves exactly the state the
/// decision forbids — so, as in
/// <see cref="IPlatformOrganizationsWriteRepository"/>, this port offers no separate audit method and no
/// separate provisioning method.</para>
///
/// <para><see cref="NotifyPlatformOwnersAsync"/> is deliberately separate for the opposite reason: it must
/// NOT share the transaction (see its own remarks).</para>
/// </summary>
public interface IPlatformOrganizationsCreateRepository
{
    /// <summary>
    /// Creates the organization AND all six provisioned tables AND the <c>org_created</c> audit row in ONE
    /// transaction, then returns the created row (the full <c>organizations</c> row, as TS's
    /// <c>select</c>-less <c>organization.create</c> resolves to).
    ///
    /// <para>Returns <see cref="CreateOrganizationOutcome.SlugTaken"/> with a null row — and NOTHING
    /// written, including the audit row — when the INSERT violates <c>organizations_slug_key</c>. Only that
    /// NAMED constraint is treated as the documented duplicate-slug outcome; any other unique violation
    /// propagates rather than being mislabeled.</para>
    ///
    /// <para>The whole unit of work runs UNDER <c>TenantScope</c> opened on the NEW organization id, which
    /// is generated client-side before the first statement. That is mandatory twice over: none of the seven
    /// tables has a DB default for <c>id</c> (Prisma's <c>@default(uuid())</c> is client-side), and
    /// <c>TenantScope.BeginAsync(db, null)</c> would set the GUC to <c>''</c> and fail every RLS predicate
    /// closed. With the new id in the GUC, <c>organizations</c>' <c>WITH CHECK (id = current_org_id)</c> and
    /// the other six tables' <c>organization_id = current_org_id</c> all pass for the rows being inserted.</para>
    /// </summary>
    /// <param name="changesJson">
    /// The pre-serialized value for <c>audit_logs.changes</c>, built by
    /// <see cref="PlatformOrganizationsCreateUseCase.BuildCreateChangesJson"/>. Passed in rather than built
    /// here so the exact bytes are unit-testable without a database — the same rationale as
    /// <see cref="IPlatformOrganizationsWriteRepository.UpdateAsync"/>.
    /// </param>
    /// <param name="now">
    /// The single clock reading for the whole transaction. Every one of the seven tables has
    /// <c>updated_at timestamp(3) NOT NULL</c> with NO DB default (Prisma fills it client-side via
    /// <c>@updatedAt</c>), so an INSERT that omits it fails <c>23502</c>. Injected so all rows of one
    /// transaction carry an identical value and so the writer stays unit-testable.
    /// </param>
    Task<CreateOrganizationResult> CreateAsync(
        PlatformOrganizationCreateInput input,
        string changesJson,
        Guid actorId,
        DateTime now,
        CancellationToken cancellationToken);

    /// <summary>
    /// The C# port of <c>notify({ organizationId })</c> (<c>lib/notify.ts:16-41</c>): select every user with
    /// <c>is_platform_owner = true</c> and INSERT one <c>notifications</c> row each.
    ///
    /// <para><b>Runs OUTSIDE the creation transaction, unscoped, and its failure MUST propagate.</b> The
    /// first two are structural: the owner lookup is cross-org by construction (owners belong to their own
    /// organizations, so it cannot run inside the NEW org's <c>TenantScope</c>), and a failed fan-out must
    /// not undo a completed creation — the deliberate asymmetry with the audit write, which IS evidence the
    /// action occurred.</para>
    ///
    /// <para><b>The third is a parity requirement, re-read from source.</b> <c>organizations.ts:149</c> is
    /// <c>await notify({ ... })</c> with no <c>try</c> and no <c>.catch</c>. It is NOT best-effort: a
    /// notify failure returns 500 to the operator AFTER the seven-table transaction has committed, and —
    /// because the TS audit write is the NEXT statement — leaves the organization committed with no
    /// <c>org_created</c> audit row at all. <see cref="PlatformOrganizationsCreateUseCase.CreateAsync"/>
    /// therefore awaits this with no <c>try</c>/<c>catch</c>. The 500-after-commit is parity, not a bug to
    /// fix. The audit half diverges (this port has already committed the row) and is recorded as divergence
    /// (3) in <c>docs/architecture/csharp-migration/phase-5-slice-21-platform-organizations-create.md</c>
    /// rather than left to surface as a parity surprise.</para>
    ///
    /// <para><b>Consequence, inherited from slice 20 and NOT closed here: this ONE call rests on the
    /// connecting role being BYPASSRLS.</b> Production has FORCE RLS with a <c>tenant_isolation</c> policy
    /// on both <c>users</c> and <c>notifications</c>; with no org GUC set the owner SELECT would return zero
    /// rows and the fan-out would silently no-op at the empty-set guard. The integration fixture connects
    /// as a superuser, so it passes either way — that is a recorded coverage gap, not coverage.</para>
    /// </summary>
    Task NotifyPlatformOwnersAsync(PlatformOwnerNotification notification, CancellationToken cancellationToken);
}
