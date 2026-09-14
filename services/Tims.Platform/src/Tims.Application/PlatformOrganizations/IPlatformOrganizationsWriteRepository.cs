namespace Tims.Application.PlatformOrganizations;

/// <summary>
/// The persistence port for the platform-owner organizations WRITE surface (Phase-5 slice 20, issue #76).
///
/// <para><b>The audit row is a PARAMETER of the update, not a separate call.</b> That shape is the whole
/// point of the slice: Federico's decision (#76) is that the C# audit write ships FAIL-CLOSED, diverging
/// from TS's <c>.catch(() =&gt; {})</c>, and a fail-closed audit that runs in its own transaction is
/// theatre — throwing after the UPDATE has committed leaves the organization modified and unaudited,
/// which is the exact state the decision exists to forbid. Exposing the audit as a second method would
/// let a future caller reintroduce that split, so the port does not offer one.</para>
///
/// <para><see cref="NotifyPlatformOwnersAsync"/> is deliberately separate for the opposite reason: it must
/// NOT share the transaction (see its own remarks).</para>
/// </summary>
public interface IPlatformOrganizationsWriteRepository
{
    /// <summary>
    /// Applies the present fields of <paramref name="input"/> to the organization and appends the
    /// <c>org_updated</c> audit row IN THE SAME TRANSACTION. Returns <c>null</c> when no such organization
    /// exists — in which case nothing is written, including the audit row.
    /// </summary>
    /// <param name="changesJson">
    /// The pre-serialized value for <c>audit_logs.changes</c>, built by
    /// <see cref="PlatformOrganizationsWriteUseCase.BuildUpdateChangesJson"/>. Passed in rather than built
    /// here so the exact bytes are unit-testable without a database.
    /// </param>
    Task<PlatformOrganizationRow?> UpdateAsync(
        Guid id,
        PlatformOrganizationUpdateInput input,
        string changesJson,
        Guid actorId,
        DateTime now,
        CancellationToken cancellationToken);

    /// <summary>
    /// Sets <c>is_active = !suspend</c> and appends the <c>org_suspended</c> / <c>org_activated</c> audit
    /// row IN THE SAME TRANSACTION. Returns <c>null</c> when no such organization exists.
    /// </summary>
    Task<PlatformOrganizationRow?> SuspendAsync(
        Guid id,
        bool suspend,
        Guid actorId,
        DateTime now,
        CancellationToken cancellationToken);

    /// <summary>
    /// The C# port of <c>notify({ organizationId })</c> (<c>lib/notify.ts:16-41</c>): select every user
    /// with <c>is_platform_owner = true</c> and INSERT one <c>notifications</c> row each.
    ///
    /// <para><b>Runs OUTSIDE the update transaction, on purpose.</b> A notification is a side-effect of a
    /// suspension that has already happened; rolling the suspension back because a fan-out insert failed
    /// would be a worse outcome than a missing notification. That is a deliberate asymmetry with the audit
    /// write above — the audit row is evidence the action occurred, the notification is not.</para>
    ///
    /// <para><b>Cross-org by construction, so never under <c>TenantScope</c>.</b> Platform owners belong to
    /// their own organizations, so the owner lookup cannot run under the suspended org's RLS scope. The TS
    /// side is identical (unscoped <c>db</c>).</para>
    ///
    /// <para><b>Consequence, stated plainly: this ONE call rests on the connecting role being BYPASSRLS.</b>
    /// Production has FORCE RLS with a <c>tenant_isolation</c> policy on BOTH <c>users</c> and
    /// <c>notifications</c>. With no org GUC set, the owner SELECT would return zero rows and the INSERT
    /// would be refused by the WITH CHECK. It works today only because the app connects as <c>postgres</c>.
    /// The failure mode if that ever changes is silent: zero owners found, the method returns early at the
    /// empty-set guard, and suspensions stop notifying with no error. The rest of this slice deliberately
    /// stops depending on BYPASSRLS; this call cannot, because the query is genuinely cross-org. Not covered
    /// by the fixture either — it creates <c>users</c>/<c>notifications</c> without RLS, so the test would
    /// pass either way.</para>
    /// </summary>
    Task NotifyPlatformOwnersAsync(PlatformOwnerNotification notification, CancellationToken cancellationToken);
}
