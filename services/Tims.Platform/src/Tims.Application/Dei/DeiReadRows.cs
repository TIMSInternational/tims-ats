using System.Text.Json.Nodes;

namespace Tims.Application.Dei;

// Intermediate repository DTOs for the DEI READ surface (Phase-5 Slice 11b) — the raw aggregates the reads pull
// BEFORE the pure @tims/shared / Tims.Domain.Dei kernels shape them. Kept infra-free (Application layer).

/// <summary>One grouped demographic count — {key,count}, where key is the native-enum label (gender/ethnicity/
/// disabilityStatus) or the plain nationality string.</summary>
public sealed record DeiGroupCount(string Key, int Count);

/// <summary>getNationalityDiversity / dashboard input: the present-nationality counts + the null-nationality
/// implicit-group count (folded into suppression, never emitted as a key).</summary>
public sealed record NationalityCountsData(IReadOnlyList<DeiGroupCount> Counts, int NullCount);

/// <summary>getAgeDistribution input: the raw DOBs (bucketed server-side by the use case with the request clock)
/// + the null-DOB implicit-group count.</summary>
public sealed record AgeRawData(IReadOnlyList<DateTime> BirthDates, int NullDobCount);

/// <summary>getDashboardKpis input bundle: every aggregate the KPI shaper differences across (the 8 TS
/// Promise.all queries), pulled under ONE TenantScope.</summary>
public sealed record DeiDashboardData(
    int TotalEmployees,
    int WithDemographics,
    IReadOnlyList<DeiGroupCount> Genders,
    IReadOnlyList<DeiGroupCount> Nationalities,
    int NullNationalityCount,
    int NullDobCount,
    IReadOnlyList<DeiGroupCount> Ethnicities,
    IReadOnlyList<string> LeaderGenders);

/// <summary>getInclusionIndex input: the most-recent climate survey's questions + each response's answers
/// (answers-only minimal select). Null (from the repo) ⇒ the org has no climate survey.</summary>
public sealed record ClimateInclusionData(
    IReadOnlyList<JsonObject> Questions,
    IReadOnlyList<JsonObject> ResponseAnswers);
