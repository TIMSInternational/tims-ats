namespace Tims.Application.NineBox;

/// <summary>getGrid input filters (all optional; each only INTERSECTS the org + period + scope where, never
/// widens). Exclusive branch priority teamId &gt; unitId &gt; companyId, mirroring the TS if/else-if.</summary>
public sealed record GridFilter(Guid? TeamId, Guid? UnitId, Guid? CompanyId);

/// <summary>getMovementHistory input filters (both optional; both intersect — the TS spreads them together).</summary>
public sealed record MovementFilter(Guid? UserId, Guid? CompanyId);

/// <summary>getCalibration narrow-scope gate probe: the session's id + createdById (or null if it does not
/// exist in the caller's org → 404).</summary>
public sealed record CalibrationSessionAnchor(Guid Id, Guid CreatedById);

/// <summary>getDashboardKpis counts: total evaluations, total calibration sessions, and active
/// (status != 'finalized') sessions — all for the org + period.</summary>
public sealed record NineBoxKpiCounts(int TotalEvaluations, int CalibrationSessions, int ActiveCalibrations);
