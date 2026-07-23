namespace Tims.Domain.Dei;

// Wire-shaped read models for the DEI READ surface (Phase-5 Slice 11b) — faithful to the tRPC output of the live
// dei router/service. INTERNAL reads = raw model/kernel shape, NO schemaVersion. Records serialize camelCase to
// match the wire. The three demographic-enum distributions rename the generic DistGroup key to their own field
// (gender/ethnicity/status/nationality/range); getDashboardKpis / getLeadershipDiversity / getInclusionIndex
// return the kernel results (DashboardKpis / LeadershipDiversityResult / InclusionIndexResult) directly. The DEI
// wire is numbers/strings only (no DateTime on any output), so no NodeIso converter is needed.

// ── getGenderRepresentation (read #2) ────────────────────────────────────────────

public sealed record GenderGroup(string Gender, int? Count, double? Percentage, bool Suppressed);

public sealed record GenderRepresentationView(IReadOnlyList<GenderGroup> Groups, bool Suppressed);

// ── getAgeDistribution (read #3) ─────────────────────────────────────────────────

public sealed record AgeGroup(string Range, int? Count, double? Percentage, bool Suppressed);

public sealed record AgeDistributionView(IReadOnlyList<AgeGroup> Groups, bool Suppressed);

// ── getNationalityDiversity (read #4) ────────────────────────────────────────────

public sealed record NationalityGroup(string Nationality, int? Count, double? Percentage, bool Suppressed);

public sealed record NationalityDiversityView(
    int? TotalNationalities,
    IReadOnlyList<NationalityGroup> Distribution,
    bool Suppressed);

// ── getEthnicityDistribution (read #5) ───────────────────────────────────────────

public sealed record EthnicityGroup(string Ethnicity, int? Count, double? Percentage, bool Suppressed);

public sealed record EthnicityDistributionView(IReadOnlyList<EthnicityGroup> Groups, bool Suppressed);

// ── getDisabilityDistribution (read #6) ──────────────────────────────────────────

public sealed record DisabilityGroup(string Status, int? Count, double? Percentage, bool Suppressed);

public sealed record DisabilityDistributionView(IReadOnlyList<DisabilityGroup> Groups, bool Suppressed);

// ── getHiringFunnel (read #9) ────────────────────────────────────────────────────

/// <summary>getHiringFunnel wire: <c>{ total }</c> — candidates have no demographics, so NO k-anon suppression.</summary>
public sealed record HiringFunnelView(int Total);

// ── getPromotionEquity (read #10) ────────────────────────────────────────────────

/// <summary>getPromotionEquity wire: the year + the min-5 FLOORED promotion count (null when 1..4).</summary>
public sealed record PromotionEquityView(int Year, int? TotalPromotions, bool Suppressed);

// ── getPayEquity (Slice 11c, FX) ─────────────────────────────────────────────────

/// <summary>One gender cohort's ALREADY-CONVERTED positive salaries (display currency), in first-seen order —
/// the FX conversion happens in the use case (FxMoneyConverter), the pure kernel only shapes + k-anon-floors.</summary>
public sealed record PayEquityGenderInput(string Gender, IReadOnlyList<double> ConvertedSalaries);

/// <summary>One pay-equity result group (raw kernel shape; camelCase on the wire). count/salaries are null when
/// the whole result is suppressed (min-5); the kernel emits an EMPTY <c>Results</c> in that case.</summary>
public sealed record PayEquityGroup(
    string Group, int? Count, int? AverageSalary, double? MedianSalary, bool Suppressed);

/// <summary>getPayEquity wire: per-gender avg/median + the female-vs-male gap% + the display currency. On any
/// sub-floor cohort/complement (or FX-unavailable) → EMPTY results + null gap + suppressed:true (NO group keys).</summary>
public sealed record PayEquityView(
    IReadOnlyList<PayEquityGroup> Results, double? GapPct, bool Suppressed, string Currency);
