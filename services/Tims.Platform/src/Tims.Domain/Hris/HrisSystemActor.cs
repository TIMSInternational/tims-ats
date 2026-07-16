namespace Tims.Domain.Hris;

/// <summary>
/// The reserved SERVICE-PRINCIPAL actor a background HRIS sync attributes its audit rows to. Unlike an
/// interactive read/write there is no human <c>ctx.user.id</c> behind a scheduled sync, so the
/// data_access_logs <c>actor_id</c> is this well-known, non-user constant — the machine identity that
/// performed the pull. It is fixed (never minted per-run) so every HRIS sync audit row is attributable
/// to the same principal and is trivially filterable.
///
/// It is deliberately NOT the nil GUID (which reads as "unset"): the first group is non-zero so a row
/// attributed to the sync principal can never be confused with an accidentally-defaulted actor.
///
/// Slice-4/seed note: the real data_access_logs INSERT runs under a fail-SOFT audit policy (external_employee
/// is Confidential, not Restricted), so if a FK to a principals table is later added, an unseeded principal
/// simply drops the audit row rather than rolling back the sync. Seeding this principal is a Phase-4 concern.
/// </summary>
public static class HrisSystemActor
{
    /// <summary>The reserved HRIS background-sync service-principal actor id (stable, non-nil).</summary>
    public static readonly Guid Id = new("a7150000-0000-4000-8000-000000000001");
}
