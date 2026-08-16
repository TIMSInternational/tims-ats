namespace Tims.Application.PlatformDashboard;

/// <summary>
/// The read port for the three FX-derived dashboard procedures (Phase-5 slice 23, issue #81, PR 3 of 3).
///
/// <para>Every bound is passed IN as a UTC instant rather than read from the clock here, so the use case
/// owns the one <c>new Date()</c> the TS procedures take at entry. The repository re-kinds each bound to
/// <c>Unspecified</c> at the EF boundary (TRAP 11) — that conversion belongs to the mapping, not to the
/// domain arithmetic.</para>
///
/// <para>None of these methods resolves an FX rate. They return raw <c>{ amount, currency }</c> ROWS and
/// the use case folds them through <c>FxMoneyConverter</c>, because <c>sumMoney</c> rounds each row to two
/// decimals BEFORE summing — an arithmetic property that cannot survive being pushed into SQL.</para>
/// </summary>
public interface IPlatformDashboardFxRepository
{
    /// <summary><c>getDashboardKpis</c>' nine parallel queries, collapsed into one call.
    /// <paramref name="monthStartUtc"/> bounds the two "this month" deltas,
    /// <paramref name="prevMonthEndUtc"/> the previous-month MRR snapshot, and
    /// <paramref name="sevenDaysFromNowUtc"/> together with <paramref name="nowUtc"/> the expiring-trials
    /// window (<c>trial_ends_at BETWEEN now AND now + 7d</c>, both bounds inclusive as Prisma's
    /// <c>gte</c>/<c>lte</c> are).</summary>
    Task<DashboardKpiInputs> GetKpiInputsAsync(
        DateTime nowUtc,
        DateTime monthStartUtc,
        DateTime prevMonthEndUtc,
        DateTime sevenDaysFromNowUtc,
        CancellationToken cancellationToken);

    /// <summary><c>getRevenueByCustomer</c>'s per-organization rows.
    /// <paramref name="thirtyDaysAgoUtc"/> bounds the paid bucket only; the outstanding bucket has no date
    /// filter at all.</summary>
    Task<IReadOnlyList<RevenueOrgRow>> GetRevenueRowsAsync(
        DateTime thirtyDaysAgoUtc,
        CancellationToken cancellationToken);

    /// <summary><c>getChurnRisk</c>'s per-organization rows. <paramref name="nowUtc"/> bounds the overdue
    /// invoice selection (<c>due_date &lt; now</c>) and <paramref name="sevenDaysAgoUtc"/> the recent-login
    /// count.</summary>
    Task<IReadOnlyList<ChurnOrgRow>> GetChurnRowsAsync(
        DateTime nowUtc,
        DateTime sevenDaysAgoUtc,
        CancellationToken cancellationToken);
}
