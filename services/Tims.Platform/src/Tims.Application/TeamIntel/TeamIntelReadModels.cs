using System.Text.Json.Nodes;
using System.Text.Json.Serialization;
using Tims.Domain.Json;

namespace Tims.Application.TeamIntel;

/// <summary>
/// Wire DTOs for the team-intel READ surface — faithful ports of the RAW shapes the TS
/// <c>teamIntel.getTeamProfile</c> / <c>getMembers</c> return (Prisma model + include shape). INTERNAL
/// staff reads → NO <c>schemaVersion</c> (versioning is external-vendor-only, the Slice-3 lesson). Dates
/// serialize through <see cref="NodeIsoDateTimeOffsetConverter"/> so the wire form is byte-identical to
/// Node's <c>Date.toISOString()</c> (<c>…fffZ</c>).
/// </summary>
public sealed record TeamLeaderView(
    string Id,
    string FirstName,
    string LastName,
    string? Avatar,
    string? JobTitle,
    string Email);

public sealed record TeamBusinessUnitView(string Id, string Name, string CompanyId);

/// <summary>Member.user select on getTeamProfile — NO email / createdAt (narrower than getMembers).</summary>
public sealed record TeamProfileMemberUser(
    string Id,
    string FirstName,
    string LastName,
    string? Avatar,
    string? JobTitle);

public sealed record TeamProfileMember(
    string Id,
    string UserId,
    string TeamId,
    string Role,
    [property: JsonConverter(typeof(NodeIsoDateTimeOffsetConverter))] DateTimeOffset JoinedAt,
    TeamProfileMemberUser User);

public sealed record TeamCountView(int Vacancies, int Okrs);

/// <summary>The <c>getTeamProfile</c> response — the raw Team model + leader/businessUnit/members includes
/// + <c>_count</c>. The <c>_count</c> JSON key is preserved verbatim (Prisma's aggregate key).</summary>
public sealed record TeamProfileView(
    string Id,
    string OrganizationId,
    string BusinessUnitId,
    string Name,
    string? LeaderId,
    JsonNode? Settings,
    bool IsActive,
    [property: JsonConverter(typeof(NodeIsoDateTimeOffsetConverter))] DateTimeOffset CreatedAt,
    [property: JsonConverter(typeof(NodeIsoDateTimeOffsetConverter))] DateTimeOffset UpdatedAt,
    TeamLeaderView? Leader,
    TeamBusinessUnitView? BusinessUnit,
    IReadOnlyList<TeamProfileMember> Members,
    [property: JsonPropertyName("_count")] TeamCountView Count);

/// <summary>Member.user select on getMembers — INCLUDES email + createdAt (wider than getTeamProfile).</summary>
public sealed record TeamMemberUserView(
    string Id,
    string FirstName,
    string LastName,
    string? Avatar,
    string? JobTitle,
    string Email,
    [property: JsonConverter(typeof(NodeIsoDateTimeOffsetConverter))] DateTimeOffset CreatedAt);

public sealed record TeamMemberView(
    string Id,
    string UserId,
    string TeamId,
    string Role,
    [property: JsonConverter(typeof(NodeIsoDateTimeOffsetConverter))] DateTimeOffset JoinedAt,
    TeamMemberUserView User);

/// <summary>The <c>getBalanceScore</c> response — the balance kernel wrapped with the <c>teamId</c>.</summary>
public sealed record BalanceScoreResponse(
    string TeamId,
    int MemberCount,
    int UniqueRoles,
    int RoleDiversity,
    double AvgTenureMonths,
    int SizeScore,
    int BalanceScore);

/// <summary>Repository bundle for the org-rollup dashboard KPIs (counts + the org headcount for tenure/diversity).</summary>
public sealed record DashboardKpiData(
    int TotalTeams,
    int TotalMembers,
    int TeamsWithLeader,
    IReadOnlyList<long> MemberCreatedAtMs,
    IReadOnlyList<string?> MemberJobTitles);

/// <summary>The <c>getDashboardKpis</c> response.</summary>
public sealed record DashboardKpiView(
    int TotalTeams,
    int TotalMembers,
    int TeamsWithLeader,
    int TeamsWithoutLeader,
    double AvgTeamSize,
    double AvgTenureYears,
    double DiversityIndex);
