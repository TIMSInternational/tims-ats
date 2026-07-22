using System.Text.Json.Nodes;
using Tims.Domain.Compensation;

namespace Tims.Application.Compensation;

/// <summary>getBenefitsUtilization repo bundle: the plan enrollment inputs + the active-user count — fed
/// verbatim to <see cref="CompensationKernels.BuildBenefitsUtilization"/>.</summary>
public sealed record BenefitsUtilizationData(IReadOnlyList<BenefitPlanInput> Plans, int TotalUsers);

/// <summary>listPendingAdjustments repo result: the field-authed rows (built as JsonObject from selectFor —
/// restricted columns leave the DB ONLY for entitled roles, never select-then-null) + the record ids the
/// endpoint audits fail-closed BEFORE returning.</summary>
public sealed record PendingAdjustmentsResult(
    IReadOnlyList<JsonObject> Rows,
    IReadOnlyList<string> RecordIds);

/// <summary>getEmployeeComp / myCompensation repo result: the field-authed compensation DTO (JsonObject built
/// from selectFor) + the record id the endpoint audits fail-closed BEFORE returning. Null (no result) when the
/// subject has no compensation row — the endpoint decides whether absence is 404 (getEmployeeComp) or a
/// graceful null body (myCompensation).</summary>
public sealed record EmployeeCompReadResult(string RecordId, JsonObject Dto);
