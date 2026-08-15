namespace Tims.Application.PlatformDashboard;

/// <summary>
/// The five independent reads behind <c>getAttentionItems</c> (Phase-5 slice 23, issue #81, PR 2 of 3).
/// TS issues them in a single <c>Promise.all</c>; EF Core forbids concurrent operations on one
/// <c>DbContext</c>, so the implementation runs them sequentially — the same "only simultaneity is lost"
/// disposition the invitations KPIs record, and neither stack wraps them in a snapshot transaction.
/// </summary>
public interface IPlatformDashboardAttentionRepository
{
    /// <summary><c>status = pending AND due_date &lt; now</c>, oldest due date first, capped.</summary>
    Task<IReadOnlyList<OverdueInvoiceRow>> GetOverdueInvoicesAsync(DateTime nowUtc, int take, CancellationToken cancellationToken);

    /// <summary><c>status = trialing AND trial_ends_at BETWEEN now AND now+7d</c>, soonest first, capped.
    /// </summary>
    Task<IReadOnlyList<ExpiringTrialRow>> GetExpiringTrialsAsync(
        DateTime nowUtc,
        DateTime sevenDaysFromNowUtc,
        int take,
        CancellationToken cancellationToken);

    /// <summary><c>status = past_due</c>, capped. <b>NO ORDER BY</b> — the TS query declares none, so the
    /// selected rows AND their order are unspecified in both stacks. Reproduced, and recorded as a parity
    /// caveat rather than silently stabilised with an <c>ORDER BY</c> TS does not send.</summary>
    Task<IReadOnlyList<PastDueSubscriptionRow>> GetPastDueSubscriptionsAsync(int take, CancellationToken cancellationToken);

    /// <summary><c>status IN (pending, sent) AND created_at &lt; now-5d</c>, oldest first, capped.</summary>
    Task<IReadOnlyList<StaleInvitationRow>> GetStaleInvitationsAsync(
        DateTime createdBeforeUtc,
        int take,
        CancellationToken cancellationToken);

    /// <summary><c>is_active = false</c>, capped. <b>NO ORDER BY</b>, same as the past-due read.</summary>
    Task<IReadOnlyList<SuspendedOrgRow>> GetSuspendedOrganizationsAsync(int take, CancellationToken cancellationToken);
}
