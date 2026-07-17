using System.Text.Json.Serialization;
using Tims.Domain.Json;

namespace Tims.Domain.Billing;

/// <summary>A single usage metric: the real count <see cref="Used"/> and the entitled-plan
/// <see cref="Limit"/> (<c>null</c> = unlimited, emitted as JSON <c>null</c>).</summary>
public sealed record UsageMetric(int Used, int? Limit);

/// <summary>Storage usage — no metering source yet, so both fields are ALWAYS <c>null</c> (honest,
/// rule #4). Kept as a nested object with the keys present (never omitted), matching the TS literal.</summary>
public sealed record UsageStorage(long? UsedMb, long? LimitMb);

/// <summary>API-call usage — no metering source yet, so both fields are ALWAYS <c>null</c>. Nested object,
/// keys present (never omitted), matching the TS literal.</summary>
public sealed record UsageApiCalls(int? Used, int? Limit);

/// <summary>
/// The <c>billing.getUsage</c> response envelope — a faithful reproduction of the object the TS router
/// returns via the shared <c>buildUsageView</c> (packages/shared/src/constants). employees/vacancies/
/// assessments carry the real count + entitled-plan limit; storage/apiCalls are always-null nested objects;
/// the billing period is echoed as canonical Node-ISO (<c>…fffZ</c>) strings or <c>null</c>. Golden-fixtured
/// BOTH stacks (usage-view.json). No <c>schemaVersion</c> (an INTERNAL staff read = raw view shape).
/// </summary>
public sealed record UsageV1(
    UsageMetric Employees,
    UsageMetric Vacancies,
    UsageMetric Assessments,
    UsageStorage Storage,
    UsageApiCalls ApiCalls,
    [property: JsonConverter(typeof(NodeIsoNullableDateTimeOffsetConverter))]
    DateTimeOffset? PeriodStart,
    [property: JsonConverter(typeof(NodeIsoNullableDateTimeOffsetConverter))]
    DateTimeOffset? PeriodEnd);

/// <summary>
/// Pure builder for <see cref="UsageV1"/> — the port of the TS <c>buildUsageView</c>. The caller supplies the
/// already-counted usage (the <c>assessments</c> count is period-gated by the caller with the same
/// <paramref name="periodStart"/>) plus the subscription's plan/status/period; the builder applies the
/// entitled-plan limits (cancelled/missing → trial) and formats the period. storage/apiCalls stay null.
/// </summary>
public static class UsageViewBuilder
{
    public static UsageV1 Build(
        int employees,
        int vacancies,
        int assessments,
        string? plan,
        string? status,
        DateTimeOffset? periodStart,
        DateTimeOffset? periodEnd)
    {
        var limits = PlanEntitlement.Limits(PlanEntitlement.EntitledPlan(plan, status));
        return new UsageV1(
            Employees: new UsageMetric(employees, limits.Employees),
            Vacancies: new UsageMetric(vacancies, limits.Vacancies),
            Assessments: new UsageMetric(assessments, limits.Assessments),
            Storage: new UsageStorage(null, null),
            ApiCalls: new UsageApiCalls(null, null),
            PeriodStart: periodStart,
            PeriodEnd: periodEnd);
    }
}
