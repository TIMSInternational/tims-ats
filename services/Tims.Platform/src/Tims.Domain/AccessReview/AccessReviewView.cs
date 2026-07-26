using System.Text.Json.Serialization;
using Tims.Domain.Json;

namespace Tims.Domain.AccessReview;

/// <summary>
/// Orchestration-output shapes for the access-review report — independent of any EF entity
/// (mirrors `AuditLogView.cs`'s split from the repository layer). Field names/shapes match
/// `access-review.service.ts`'s `RoleGrantView`/`AccessReviewRow`/`AccessReviewSummary`/
/// `AccessReviewReport` interfaces exactly (pinned by Task 1's `access-review-report.json` fixture).
/// </summary>
public sealed record RoleGrantView(
    string Slug,
    string Name,
    bool RoleActive,
    [property: JsonConverter(typeof(NodeIsoDateTimeConverter))] DateTime AssignedAt,
    Guid? AssignedBy,
    Guid? CompanyScope,
    Guid? UnitScope,
    [property: JsonConverter(typeof(NodeIsoNullableDateTimeConverter))] DateTime? ExpiresAt,
    IReadOnlyList<string> Grants);

public sealed record AccessReviewRow(
    Guid UserId,
    string Name,
    string Email,
    Guid OrganizationId,
    string? OrgName,
    AccessStatus Status,
    bool IsPlatformOwner,
    [property: JsonConverter(typeof(NodeIsoNullableDateTimeConverter))] DateTime? LastLoginAt,
    IReadOnlyList<RoleGrantView> Roles,
    AccessRiskFlags Flags);

public sealed record AccessReviewSummary(
    int UserCount,
    int PrivilegedCount,
    int StaleCount,
    int DeprovisionGapCount,
    int ExpiredGapCount);

public sealed record AccessReviewReport(
    IReadOnlyList<AccessReviewRow> Rows,
    AccessReviewSummary Summary,
    int CrossOrgRoleCount,
    bool Truncated);

/// <summary>The attestation row as returned by an INSERT (no reviewer join — matches
/// `access-review.repository.ts`'s `insertAttestation` select exactly).</summary>
public sealed record AccessReviewAttestation(
    Guid Id,
    Guid OrganizationId,
    Guid ReviewerId,
    [property: JsonConverter(typeof(NodeIsoDateTimeConverter))] DateTime ReviewedAt,
    int UserCount,
    int PrivilegedCount,
    int StaleCount,
    int DeprovisionGapCount,
    int ExpiredGapCount,
    string? Notes);

/// <summary>One attestation-history item — WITH the nested reviewer join (matches
/// `listAttestations`'s select, which DIFFERS from `insertAttestation`'s: no `organizationId`/
/// `reviewerId` scalar, but a nested `reviewer` object instead).</summary>
public sealed record AccessReviewAttestationHistoryItem(
    Guid Id,
    [property: JsonConverter(typeof(NodeIsoDateTimeConverter))] DateTime ReviewedAt,
    int UserCount,
    int PrivilegedCount,
    int StaleCount,
    int DeprovisionGapCount,
    int ExpiredGapCount,
    string? Notes,
    AccessReviewReviewerView Reviewer);

public sealed record AccessReviewReviewerView(string FirstName, string LastName, string Email);
