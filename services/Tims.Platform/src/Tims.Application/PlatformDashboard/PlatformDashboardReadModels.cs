using System.Text.Json.Serialization;
using Tims.Domain.Json;

namespace Tims.Application.PlatformDashboard;

// Read models for the platform-owner dashboard cluster (Phase-5 slice 23, issue #81), FIRST PR — the
// three FX-free reads getPlanDistribution / getUserGrowth / getRecentActivity from
// routers/platform/dashboard.ts. TS IS THE CONTRACT: every flag is dark, so the tRPC procedures are the
// live path and these records must match them key-for-key and byte-for-byte.

/// <summary>
/// One <c>getPlanDistribution</c> row — <c>{ plan, count, percentage }</c>. <c>percentage</c> is
/// <c>Math.round(count / total * 100)</c>; see <c>PlatformDashboardReadUseCase.JsRound</c> for why the C#
/// rounding must be spelled out rather than left to <c>Math.Round</c>'s banker's default.
/// </summary>
public sealed record PlanDistributionItem(string Plan, int Count, int Percentage);

/// <summary>
/// One <c>getUserGrowth</c> point — <c>{ month, count }</c>, where <c>month</c> is the SPANISH SHORT month
/// name (<c>toLocaleDateString('es', { month: 'short' })</c>), not a <c>YYYY-MM</c> key. The abbreviations
/// are hardcoded in the use case rather than derived from a <c>CultureInfo</c> — Node's ICU emits
/// <c>"sept"</c> for September where .NET's <c>es</c> culture does not, so a culture lookup would diverge.
/// </summary>
public sealed record UserGrowthPoint(string Month, int Count);

/// <summary>
/// One <c>getRecentActivity</c> item. The TS shape is <c>{ id, type, title, timestamp, meta? }</c> where
/// <c>meta</c> is OMITTED (not null) when absent — orgs carry <c>meta: org.plan</c> and users
/// <c>meta: user.email</c>, so in practice it is always present, but the optional is modelled to match.
///
/// <para><c>timestamp</c> is a <c>Date</c> on the TS side, serialised through superjson /
/// <c>toISOString()</c>; the <see cref="NodeIsoDateTimeConverter"/> reproduces that exactly (UTC, 3-digit
/// ms, trailing Z) — the same converter and the same reason as slice 22's dates.</para>
/// </summary>
public sealed record RecentActivityItem(
    string Id,
    string Type,
    string Title,
    [property: JsonConverter(typeof(NodeIsoDateTimeConverter))] DateTime Timestamp,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? Meta);

/// <summary>A raw <c>YYYY-MM → count</c> aggregate row, the input to the month-series kernel. Mirrors the
/// TS <c>{ month: string; count: number }</c> that <c>getUserGrowth</c>'s <c>$queryRaw</c> returns.</summary>
public sealed record MonthCountRow(string Month, int Count);

/// <summary>A recent organization row for the activity merge (<c>id, name, plan, createdAt</c>).</summary>
public sealed record RecentOrgRow(string Id, string Name, string Plan, DateTime CreatedAt);

/// <summary>A recent user row for the activity merge (<c>id, firstName, lastName, email, createdAt,
/// isPlatformOwner</c>).</summary>
public sealed record RecentUserRow(
    string Id,
    string FirstName,
    string LastName,
    string Email,
    DateTime CreatedAt,
    bool IsPlatformOwner);
